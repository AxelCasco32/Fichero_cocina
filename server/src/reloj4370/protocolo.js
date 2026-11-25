// Protocolo del puerto 4370 de ZKTeco, para equipos nuevos (MB360, firmware 8) y antiguos
// (628-C y otros con firmware 6.x).
//
// La conexión (sockets TCP/UDP, sesión, descarga por partes) la hace zkteco-js. Acá resolvemos lo
// que la librería no cubre bien en los equipos viejos:
//   - elegir TCP o UDP (los viejos suelen hablar solo UDP);
//   - el formato de los registros: los equipos nuevos usan usuarios de 72 bytes y fichadas de 40;
//     los viejos, usuarios de 28 bytes y fichadas de 16 u 8 bytes.

const Zkteco = require('zkteco-js');
const { COMMANDS, REQUEST_DATA } = require('zkteco-js/src/helper/command');
const { createTCPHeader, createUDPHeader } = require('zkteco-js/src/helper/utils');

const CMD = {
  ACK_OK: COMMANDS.CMD_ACK_OK,
  OPTIONS_RRQ: COMMANDS.CMD_OPTIONS_RRQ,
  GET_VERSION: COMMANDS.CMD_GET_VERSION,
  FREE_SIZES: COMMANDS.CMD_GET_FREE_SIZES,
  CLEAR_ATTLOG: COMMANDS.CMD_CLEAR_ATTLOG,
  RESTART: 1004,
  REFRESHDATA: 1013,
  USER_WRQ: 8,
  DELETE_USER: 18,
  STARTVERIFY: 60,
  STARTENROLL: 61,
  CANCELCAPTURE: 62,
  GET_USERTEMP: 88,
  GET_TIME: 201,
  SET_TIME: 202,
  REG_EVENT: 500,
  PREPARE_DATA: 1500,
  DATA: 1501,
};

const esperar = (ms) => new Promise((ok) => setTimeout(ok, ms));

// --- Conexión ---

// protocolo: 'tcp' | 'udp' | 'auto' (prueba TCP y, si no responde, UDP)
async function abrir({ ip, puerto = 4370, protocolo = 'auto', puertoLocalUdp, timeoutMs = 10000 }) {
  const zk = new Zkteco(ip, puerto, timeoutMs, puertoLocalUdp, 8184);

  async function porTcp() {
    try {
      await zk.ztcp.createSocket();
      await zk.ztcp.connect();
      zk.connectionType = 'tcp';
    } catch (err) {
      await cerrarTransporte(zk.ztcp);
      throw err;
    }
  }
  async function porUdp() {
    try {
      await zk.zudp.createSocket();
      await zk.zudp.connect();
      zk.connectionType = 'udp';
    } catch (err) {
      await cerrarTransporte(zk.zudp);
      throw err;
    }
  }

  if (protocolo === 'tcp') await porTcp();
  else if (protocolo === 'udp') await porUdp();
  else {
    try {
      await porTcp();
    } catch (errTcp) {
      try {
        await porUdp();
      } catch {
        throw errTcp; // el error de TCP suele explicar mejor el problema (IP o puerto mal)
      }
    }
  }
  return zk;
}

async function cerrarTransporte(t) {
  if (!t?.socket) return;
  try {
    await Promise.race([t.disconnect(), esperar(3000)]);
  } catch {
    /* ya estaba cerrado */
  }
  t.socket = null;
}

async function cerrar(zk) {
  if (!zk) return;
  await cerrarTransporte(zk.ztcp);
  await cerrarTransporte(zk.zudp);
}

const transporte = (zk) => (zk.connectionType === 'udp' ? zk.zudp : zk.ztcp);

// --- Comandos simples ---

// Devuelve la respuesta completa (encabezado de 8 bytes + datos)
async function comando(zk, codigo, datos = Buffer.alloc(0)) {
  const r = await transporte(zk).executeCmd(codigo, datos);
  const respuesta = r && r.length >= 2 ? r.readUInt16LE(0) : null;
  if (respuesta !== CMD.ACK_OK) {
    throw Object.assign(new Error(`el reloj respondió ${respuesta}`), { retorno: -(respuesta || 1) });
  }
  return r;
}

const textoRespuesta = (r) => r.subarray(8).toString('latin1').replace(/\0/g, '').trim();

// Lee una opción de configuración ("~SerialNumber", "~DeviceName", ...)
async function opcion(zk, clave) {
  try {
    const texto = textoRespuesta(await comando(zk, CMD.OPTIONS_RRQ, Buffer.from(`${clave}\0`, 'latin1')));
    const valor = texto.startsWith(`${clave}=`) ? texto.slice(clave.length + 1) : texto;
    return valor.trim() || null;
  } catch {
    return null; // algunos firmwares no informan todas las opciones
  }
}

// Un número de serie válido son solo letras y números. Algunos firmwares a veces devuelven la
// respuesta corrupta (por ejemplo "A=WD221860296" en vez de "AEWD221860296"): reintentamos y, si
// sigue mal, se descarta para no registrar el mismo reloj dos veces.
const serieValida = (s) => /^[A-Za-z0-9]{5,32}$/.test(s || '');

async function numeroDeSerie(zk, intentos = 3) {
  for (let i = 0; i < intentos; i++) {
    const s = await opcion(zk, '~SerialNumber');
    if (serieValida(s)) return s;
  }
  return null;
}

async function version(zk) {
  try {
    return textoRespuesta(await comando(zk, CMD.GET_VERSION)) || null;
  } catch {
    return null;
  }
}

// Cantidad de usuarios y de fichadas guardadas en el reloj
async function cantidades(zk) {
  const r = await comando(zk, CMD.FREE_SIZES);
  if (r.length < 44) throw new Error('respuesta corta de FREE_SIZES');
  return { usuarios: r.readUInt32LE(24), fichadas: r.readUInt32LE(40) };
}

// --- Lectura de bloques (usuarios y fichadas) ---

// La librería, al descargar un bloque en partes, deja colgadas escuchas ('data', 'close', 'message')
// en el socket y nunca las saca. Como las fichadas se descargan seguido, se acumulan (pérdida de
// memoria, y las viejas siguen procesando todo lo que llega). Acá se sacan las que agregó la operación.
const EVENTOS_SOCKET = ['data', 'close', 'message', 'end'];
async function sinEscuchasColgadas(socket, operacion) {
  if (!socket) return operacion();
  const antes = new Map(EVENTOS_SOCKET.map((ev) => [ev, new Set(socket.rawListeners(ev))]));
  try {
    return await operacion();
  } finally {
    for (const ev of EVENTOS_SOCKET) {
      for (const fn of socket.rawListeners(ev)) if (!antes.get(ev).has(fn)) socket.removeListener(ev, fn);
    }
  }
}

async function leerBloque(zk, pedido) {
  const t = transporte(zk);
  const r = await sinEscuchasColgadas(t.socket, async () => {
    await t.freeData().catch(() => {});
    const res = await t.readWithBuffer(pedido);
    await t.freeData().catch(() => {});
    return res;
  });
  if (!r || r.err || !Buffer.isBuffer(r.data)) throw r?.err || new Error('el reloj no devolvió datos');
  // Los primeros 4 bytes indican el tamaño de lo que sigue
  const datos = r.data.subarray(4);
  const tamanio = r.data.length >= 4 ? r.data.readUInt32LE(0) : datos.length;
  return tamanio > 0 && tamanio <= datos.length ? datos.subarray(0, tamanio) : datos;
}

// Elige el tamaño de registro: primero por la cuenta exacta (bytes / cantidad), después por divisibilidad
function tamanioRegistro(bytes, cantidad, candidatos) {
  if (!bytes) return candidatos[0];
  if (cantidad > 0 && bytes % cantidad === 0 && candidatos.includes(bytes / cantidad)) return bytes / cantidad;
  return candidatos.find((n) => bytes % n === 0) || null;
}

const texto = (buf) => buf.toString('latin1').split('\0')[0].trim();

// Fecha en el formato comprimido de ZKTeco (hora local del reloj)
function decodificarFecha(n) {
  const segundo = n % 60;
  n = Math.floor(n / 60);
  const minuto = n % 60;
  n = Math.floor(n / 60);
  const hora = n % 24;
  n = Math.floor(n / 24);
  const dia = (n % 31) + 1;
  n = Math.floor(n / 31);
  const mes = n % 12;
  const anio = Math.floor(n / 12) + 2000;
  return new Date(anio, mes, dia, hora, minuto, segundo);
}

function decodificarUsuario(b) {
  if (b.length === 72) {
    return {
      uid: b.readUInt16LE(0),
      privilegio: b.readUInt8(2),
      nombre: texto(b.subarray(11, 35)),
      tarjeta: b.readUInt32LE(35) || undefined,
      pin: texto(b.subarray(48, 72)),
    };
  }
  // 28 bytes: uid(2) privilegio(1) clave(5) nombre(8) tarjeta(4) -(1) grupo(1) horario(2) pin(4, número)
  return {
    uid: b.readUInt16LE(0),
    privilegio: b.readUInt8(2),
    nombre: texto(b.subarray(8, 16)),
    tarjeta: b.readUInt32LE(16) || undefined,
    pin: String(b.readUInt32LE(24)),
  };
}

// Devuelve { usuarios, formato } — formato: 'nuevo' | 'viejo' según lo que mandó el reloj
// `preferido`: si no se puede saber por la cantidad, qué formato probar primero
async function leerUsuarios(zk, { formato, cantidad, preferido } = {}) {
  const datos = await leerBloque(zk, REQUEST_DATA.GET_USERS);
  // El formato configurado es solo una preferencia: manda lo que realmente coincide con los datos
  // (hay equipos "antiguos", como algunos 628-C, con firmware que ya usa el formato nuevo)
  const candidatos = (formato || preferido) === 'viejo' ? [28, 72] : [72, 28];
  const tamanio = tamanioRegistro(datos.length, cantidad, candidatos);
  if (!tamanio) throw new Error(`no se reconoce el formato de usuarios (${datos.length} bytes)`);

  const usuarios = [];
  for (let i = 0; i + tamanio <= datos.length; i += tamanio) {
    const u = decodificarUsuario(datos.subarray(i, i + tamanio));
    if (u.pin && u.pin !== '0') usuarios.push(u);
  }
  const detectado = datos.length ? (tamanio === 72 ? 'nuevo' : 'viejo') : null;
  return { usuarios, formato: detectado };
}

// Devuelve [{ pin, fecha, estado, verificacion }]
// `pinPorUid`: en el registro de 8 bytes el reloj guarda el número interno, no el PIN
async function leerFichadas(zk, { formato, cantidad, pinPorUid = new Map() } = {}) {
  const datos = await leerBloque(zk, REQUEST_DATA.GET_ATTENDANCE_LOGS);
  const candidatos = formato === 'viejo' ? [16, 8, 40] : [40, 16, 8];
  const tamanio = tamanioRegistro(datos.length, cantidad, candidatos);
  if (!tamanio) throw new Error(`no se reconoce el formato de fichadas (${datos.length} bytes)`);

  const fichadas = [];
  for (let i = 0; i + tamanio <= datos.length; i += tamanio) {
    const b = datos.subarray(i, i + tamanio);
    let f;
    if (tamanio === 40) {
      // uid(2) pin(24) verificación(1) fecha(4) estado(1) -(8)
      f = { pin: texto(b.subarray(2, 26)), verificacion: b[26], fecha: decodificarFecha(b.readUInt32LE(27)), estado: b[31] };
    } else if (tamanio === 16) {
      // pin(4, número) fecha(4) verificación(1) estado(1) -(2) código de trabajo(4)
      f = { pin: String(b.readUInt32LE(0)), fecha: decodificarFecha(b.readUInt32LE(4)), verificacion: b[8], estado: b[9] };
    } else {
      // uid(2) verificación(1) fecha(4) estado(1)
      const uid = b.readUInt16LE(0);
      f = { pin: pinPorUid.get(uid) || String(uid), verificacion: b[2], fecha: decodificarFecha(b.readUInt32LE(3)), estado: b[7] };
    }
    if (f.pin && f.pin !== '0' && !Number.isNaN(f.fecha.getTime())) fichadas.push(f);
  }
  return fichadas;
}

// --- Escritura de usuarios ---

// El reloj guarda los nombres en ASCII: sacamos acentos y caracteres raros
function nombreParaReloj(nombre, largo = 24) {
  return String(nombre || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^\x20-\x7E]/g, '')
    .trim()
    .slice(0, largo);
}

// Arma el registro de usuario en el formato del equipo
function registroUsuario(formato, { uid, pin, nombre, tarjeta = 0, privilegio = 0 }) {
  const card = Number(tarjeta) > 0 && Number(tarjeta) <= 0xffffffff ? Number(tarjeta) : 0;
  if (formato === 'viejo') {
    const numero = Number(pin);
    if (!/^\d{1,9}$/.test(String(pin)) || numero > 0xffffffff) {
      throw Object.assign(new Error('este equipo solo acepta PIN numéricos'), { retorno: -1003 });
    }
    const b = Buffer.alloc(28);
    b.writeUInt16LE(uid, 0);
    b.writeUInt8(privilegio, 2);
    b.write(nombreParaReloj(nombre, 8), 8, 8, 'latin1');
    b.writeUInt32LE(card, 16);
    b.writeUInt8(1, 21); // grupo
    b.writeUInt32LE(numero, 24);
    return b;
  }
  // Registro de 72 bytes (mismo formato que el software de ZKTeco)
  const b = Buffer.alloc(72);
  b.writeUInt16LE(uid, 0);
  b.writeUInt8(privilegio, 2);
  b.write(nombreParaReloj(nombre, 24), 11, 24, 'latin1');
  b.writeUInt32LE(card, 35);
  b.write('1', 40, 7, 'latin1'); // grupo
  b.write(String(pin), 48, 24, 'latin1');
  return b;
}

async function escribirUsuario(zk, formato, usuario) {
  await comando(zk, CMD.USER_WRQ, registroUsuario(formato, usuario));
  await comando(zk, CMD.REFRESHDATA).catch(() => {});
}

async function borrarUsuario(zk, uid) {
  const b = Buffer.alloc(2);
  b.writeUInt16LE(uid, 0);
  await comando(zk, CMD.DELETE_USER, b);
  await comando(zk, CMD.REFRESHDATA).catch(() => {});
}

const vaciarFichadas = (zk) => comando(zk, CMD.CLEAR_ATTLOG);
const reiniciar = (zk) => comando(zk, CMD.RESTART);

// --- Fecha y hora del reloj ---

function codificarFecha(d) {
  return (
    ((d.getFullYear() % 100) * 12 * 31 + d.getMonth() * 31 + d.getDate() - 1) * 86400 +
    (d.getHours() * 60 + d.getMinutes()) * 60 +
    d.getSeconds()
  );
}

async function leerHora(zk) {
  const r = await comando(zk, CMD.GET_TIME);
  if (r.length < 12) throw new Error('el reloj no informó la hora');
  return decodificarFecha(r.readUInt32LE(8));
}

async function ponerHora(zk, fecha = new Date()) {
  const d = Buffer.alloc(4);
  d.writeUInt32LE(codificarFecha(fecha), 0);
  await comando(zk, CMD.SET_TIME, d);
  await comando(zk, CMD.REFRESHDATA).catch(() => {});
}

// --- Enrolamiento de huella a distancia ---
//
// Secuencia (la misma que usa el software de ZKTeco):
//   1. STARTENROLL con el PIN y el dedo: el reloj muestra "apoye el dedo" en su pantalla.
//   2. Por cada una de las 3 lecturas el reloj manda eventos (REG_EVENT): uno al detectar el dedo y
//      otro con 100 cuando la lectura salió bien. 4 = cancelado, 6 = se agotó el tiempo.
//   3. Al final manda el resultado: 0 = guardada, 5 = esa huella ya es de otra persona.
// Los eventos llegan sin que se los pida, así que se escuchan directo en el socket y se confirman (ACK).
// El resultado se verifica después pidiendo la plantilla de ese dedo.

// Dedos según la numeración de ZKTeco: 0-4 mano izquierda (meñique → pulgar), 5-9 derecha (pulgar → meñique)
const DEDOS = [
  'meñique izquierdo', 'anular izquierdo', 'mayor izquierdo', 'índice izquierdo', 'pulgar izquierdo',
  'pulgar derecho', 'índice derecho', 'mayor derecho', 'anular derecho', 'meñique derecho',
];

function enviarCrudo(zk, paquete) {
  const t = transporte(zk);
  if (!t.socket) return;
  if (zk.connectionType === 'udp') t.socket.send(paquete, 0, paquete.length, t.port, t.ip, () => {});
  else t.socket.write(paquete);
}

// Confirma un evento recibido (si no, el reloj lo repite)
function ack(zk) {
  const t = transporte(zk);
  const crear = zk.connectionType === 'udp' ? createUDPHeader : createTCPHeader;
  enviarCrudo(zk, crear(CMD.ACK_OK, t.sessionId || 0, 65533, Buffer.alloc(0)));
}

// Escucha los paquetes que manda el reloj por su cuenta. Devuelve una función para dejar de escuchar.
function escucharEventos(zk, alRecibir) {
  const t = transporte(zk);
  if (zk.connectionType === 'udp') {
    const h = (msg) => msg.length >= 8 && alRecibir(msg.readUInt16LE(0), msg.subarray(8));
    t.socket.on('message', h);
    return () => t.socket?.removeListener('message', h);
  }
  let pendiente = Buffer.alloc(0);
  const h = (chunk) => {
    pendiente = Buffer.concat([pendiente, chunk]);
    while (pendiente.length >= 8 && pendiente.readUInt32LE(0) === 0x7d825050) {
      const largo = pendiente.readUInt32LE(4);
      if (pendiente.length < 8 + largo) return;
      const p = pendiente.subarray(8, 8 + largo);
      pendiente = pendiente.subarray(8 + largo);
      if (p.length >= 8) alRecibir(p.readUInt16LE(0), p.subarray(8));
    }
    if (pendiente.length >= 4 && pendiente.readUInt32LE(0) !== 0x7d825050) pendiente = Buffer.alloc(0);
  };
  t.socket.on('data', h);
  return () => t.socket?.removeListener('data', h);
}

// Devuelve { estado: 'ok' | 'duplicada' | 'cancelado' | 'tiempo' | 'error', mensaje? }
// onEvento({ estado: 'esperando' | 'leyendo' | 'lectura' | 'reintentar' | 'procesando', lectura })
async function enrolarHuella(zk, { formato, pin, dedo, onEvento = () => {}, debeCancelar = () => false, timeoutMs = 60000 }) {
  const eventos = [];
  const codigos = []; // todo lo que mandó el reloj (para diagnóstico)
  let avisar = null;
  const dejar = escucharEventos(zk, (cmd, datos) => {
    if (cmd !== CMD.REG_EVENT) return;
    ack(zk);
    const codigo = datos.length >= 2 ? datos.readUInt16LE(0) : 0;
    codigos.push(codigo);
    eventos.push(codigo);
    if (avisar) avisar();
  });
  // Espera el próximo evento (o la cancelación, o que se acabe el tiempo)
  const siguiente = (hasta) =>
    new Promise((ok) => {
      let timer = null;
      const terminar = (valor) => {
        clearInterval(timer);
        avisar = null;
        ok(valor);
        return true;
      };
      // Devuelve true si ya terminó la espera
      const revisar = () => {
        if (eventos.length) return terminar(eventos.shift());
        if (debeCancelar()) return terminar('cancelar');
        if (Date.now() >= hasta) return terminar(null);
        return false;
      };
      if (!revisar()) {
        avisar = revisar;
        timer = setInterval(revisar, 250);
      }
    });

  try {
    await comando(zk, CMD.CANCELCAPTURE).catch(() => {});
    let datos;
    if (formato === 'viejo') {
      datos = Buffer.alloc(5);
      datos.writeUInt32LE(Number(pin), 0);
      datos.writeInt8(dedo, 4);
    } else {
      datos = Buffer.alloc(26);
      datos.write(String(pin), 0, 24, 'latin1');
      datos.writeInt8(dedo, 24);
      datos.writeInt8(1, 25);
    }
    try {
      await comando(zk, CMD.STARTENROLL, datos);
    } catch (err) {
      return { estado: 'error', mensaje: `el reloj no aceptó el pedido de enrolar (${err.message})` };
    }
    onEvento({ estado: 'esperando', lectura: 1 });

    const hasta = Date.now() + timeoutMs;
    let lecturas = 0;
    // Los firmwares no avisan todos igual. Si después de varias señales el reloj se queda callado
    // 10 s, damos el enrolamiento por terminado y se verifica directamente si guardó la huella.
    const limite = () => (codigos.length >= 3 ? Math.min(hasta, ultimoEvento + 10000) : hasta);
    let ultimoEvento = Date.now();
    const fin = (estado) => ({ estado, codigos });
    for (;;) {
      const res = await siguiente(limite());
      if (res === 'cancelar') {
        enviarCrudo(zk, (zk.connectionType === 'udp' ? createUDPHeader : createTCPHeader)(CMD.CANCELCAPTURE, transporte(zk).sessionId || 0, 1, Buffer.alloc(0)));
        return fin('cancelado');
      }
      if (res === null) return fin(Date.now() < hasta ? 'sin_confirmar' : codigos.length ? 'sin_confirmar' : 'tiempo');
      ultimoEvento = Date.now();
      if (res === 4) return fin('cancelado');
      if (res === 6) return fin('tiempo');
      if (lecturas < 3) {
        if (res === 100) {
          lecturas++;
          onEvento(lecturas < 3 ? { estado: 'lectura', lectura: lecturas } : { estado: 'procesando', lectura: 3 });
        } else {
          // El significado de los demás códigos varía según el firmware: mostramos "leyendo"
          onEvento({ estado: 'leyendo', lectura: lecturas + 1 });
        }
        continue;
      }
      if (res === 5) return fin('duplicada');
      return fin('ok');
    }
  } finally {
    dejar();
    // Devolvemos el reloj a su modo normal
    await comando(zk, CMD.REG_EVENT, Buffer.alloc(4)).catch(() => {});
    await comando(zk, CMD.CANCELCAPTURE).catch(() => {});
    await comando(zk, CMD.STARTVERIFY).catch(() => {});
  }
}

// ¿El reloj tiene guardada la huella de ese dedo? true / false / null (no se pudo saber).
// Ojo: si la tiene, el reloj puede mandar la plantilla en varias partes; conviene reconectar después.
async function tieneHuella(zk, { uid, dedo }) {
  const datos = Buffer.alloc(3);
  datos.writeInt16LE(uid, 0);
  datos.writeInt8(dedo, 2);
  try {
    const r = await transporte(zk).executeCmd(CMD.GET_USERTEMP, datos);
    const codigo = r?.length >= 2 ? r.readUInt16LE(0) : null;
    if (codigo === CMD.DATA || codigo === CMD.PREPARE_DATA) return true;
    if (codigo === CMD.ACK_OK) return r.length > 16;
    if (codigo === 2001) return false; // ACK_ERROR: no la tiene
    return null; // el firmware no entiende la consulta: no se puede saber
  } catch {
    return null;
  }
}

// Formato a usar cuando el reloj todavía no tiene usuarios para detectarlo
function formatoPorDefecto({ firmware, protocolo }) {
  if (/ver\s*6\./i.test(firmware || '')) return 'viejo';
  if (/ver\s*8\./i.test(firmware || '')) return 'nuevo';
  return protocolo === 'udp' ? 'viejo' : 'nuevo';
}

module.exports = {
  abrir,
  cerrar,
  comando,
  opcion,
  numeroDeSerie,
  serieValida,
  version,
  cantidades,
  leerUsuarios,
  leerFichadas,
  escribirUsuario,
  borrarUsuario,
  vaciarFichadas,
  reiniciar,
  leerHora,
  ponerHora,
  DEDOS,
  enrolarHuella,
  tieneHuella,
  formatoPorDefecto,
  nombreParaReloj,
  registroUsuario,
  decodificarFecha,
};
