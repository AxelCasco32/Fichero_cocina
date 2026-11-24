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

async function leerBloque(zk, pedido) {
  const t = transporte(zk);
  await t.freeData().catch(() => {});
  const r = await t.readWithBuffer(pedido);
  await t.freeData().catch(() => {});
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
  const candidatos = formato === 'nuevo' ? [72] : formato === 'viejo' ? [28] : preferido === 'viejo' ? [28, 72] : [72, 28];
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
  const candidatos = formato === 'nuevo' ? [40] : formato === 'viejo' ? [16, 8] : [40, 16, 8];
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
  version,
  cantidades,
  leerUsuarios,
  leerFichadas,
  escribirUsuario,
  borrarUsuario,
  vaciarFichadas,
  reiniciar,
  formatoPorDefecto,
  nombreParaReloj,
  registroUsuario,
  decodificarFecha,
};
