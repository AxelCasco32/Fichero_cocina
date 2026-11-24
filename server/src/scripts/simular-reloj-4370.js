// Simula un reloj ZKTeco hablando el protocolo del puerto 4370, para probar el modo 4370 sin el equipo.
//
// Uso:  node src/scripts/simular-reloj-4370.js [puerto=4370] [--viejo] [--registro=8]
//   - Sin opciones simula un equipo nuevo (MB360): TCP, usuarios de 72 bytes, fichadas de 40.
//   - --viejo simula un equipo antiguo (628-C, firmware 6): solo UDP, usuarios de 28 bytes y
//     fichadas de 16 bytes (o de 8 con --registro=8).
//   - Arranca con 3 usuarios y algunas fichadas de ayer.
//   - Para "fichar":  curl "http://localhost:4371/fichar?pin=1001"   (puerto + 1)
//   - Para ver su memoria:  curl http://localhost:4371/estado
//
// Para probar los dos a la vez: uno en 4370 y el viejo en otro puerto, por ejemplo
//   node src/scripts/simular-reloj-4370.js 4380 --viejo     (fichar: curl "http://localhost:4381/fichar?pin=1001")

const net = require('net');
const dgram = require('dgram');
const http = require('http');

const args = process.argv.slice(2);
const PUERTO = Number(args.find((x) => /^\d+$/.test(x)) || 4370);
const VIEJO = args.includes('--viejo');
const REGISTRO = VIEJO ? (args.includes('--registro=8') ? 8 : 16) : 40;
const SN = VIEJO ? 'SIMVIEJO' : 'SIM4370';

const C = {
  CONNECT: 1000, EXIT: 1001, ACK_OK: 2000, OPTIONS_RRQ: 11, GET_VERSION: 1100, FREE_SIZES: 50,
  DATA_WRRQ: 1503, DATA: 1501, FREE_DATA: 1502, USER_WRQ: 8, DELETE_USER: 18, REFRESHDATA: 1013,
  CLEAR_ATTLOG: 15, RESTART: 1004, STARTENROLL: 61, CANCELCAPTURE: 62, GET_USERTEMP: 88, REG_EVENT: 500,
  ACK_ERROR: 2001,
};

// Enrolamiento simulado: huellas guardadas ("uid:dedo") y cómo termina el próximo enrolamiento
// (se cambia con  curl "http://localhost:4371/enrolar?resultado=duplicada"  — ok | duplicada | tiempo)
const huellas = new Set();
let resultadoEnrolar = 'ok';
let enrolando = null; // { timers, enviar }

function evento(enviar, codigo) {
  const d = Buffer.alloc(2);
  d.writeUInt16LE(codigo, 0);
  enviar(paquete(C.REG_EVENT, 1, 0, d));
}

function empezarEnrolamiento(uid, dedo, enviar) {
  const timers = [];
  const en = (ms, fn) => timers.push(setTimeout(fn, ms));
  enrolando = { timers, enviar };
  console.log(`[reloj] enrolando uid ${uid} dedo ${dedo}: "apoye el dedo" (resultado simulado: ${resultadoEnrolar})`);
  if (resultadoEnrolar === 'tiempo') {
    en(6000, () => { evento(enviar, 6); enrolando = null; });
    return;
  }
  for (let i = 1; i <= 3; i++) {
    en(i * 1800, () => evento(enviar, 60)); // dedo detectado (calidad)
    en(i * 1800 + 600, () => { evento(enviar, 100); console.log(`[reloj] lectura ${i}/3 ok`); });
  }
  en(3 * 1800 + 1400, () => {
    if (resultadoEnrolar === 'duplicada') evento(enviar, 5);
    else { huellas.add(`${uid}:${dedo}`); evento(enviar, 0); console.log('[reloj] huella guardada'); }
    enrolando = null;
  });
}

const usuarios = new Map([
  [1, { uid: 1, pin: '1001', nombre: 'GONZALEZ MARIA' }],
  [2, { uid: 2, pin: '1002', nombre: 'RUIZ CARLOS' }],
  [3, { uid: 3, pin: '35126900', nombre: 'PEREZ JUAN' }],
]);
const fichadas = [];
const ayer = new Date(Date.now() - 24 * 3600 * 1000);
for (const [pin, h] of [['1001', 12], ['1002', 12], ['35126900', 13]]) {
  const d = new Date(ayer);
  d.setHours(h, 15, 0, 0);
  fichadas.push({ pin, fecha: d });
}

// Fecha en el formato comprimido de ZKTeco
function codificarFecha(d) {
  return (
    ((d.getFullYear() % 100) * 12 * 31 + d.getMonth() * 31 + d.getDate() - 1) * 86400 +
    (d.getHours() * 60 + d.getMinutes()) * 60 +
    d.getSeconds()
  );
}

// Encabezado del protocolo: comando, checksum (el sistema no lo verifica), sesión, n.º de respuesta
function paquete(cmd, sesion, reply, datos = Buffer.alloc(0)) {
  const cuerpo = Buffer.alloc(8 + datos.length);
  cuerpo.writeUInt16LE(cmd, 0);
  cuerpo.writeUInt16LE(sesion, 4);
  cuerpo.writeUInt16LE(reply, 6);
  datos.copy(cuerpo, 8);
  return cuerpo;
}

// Por TCP cada paquete va precedido de 8 bytes con una marca y el largo
function tramaTcp(cuerpo) {
  const pre = Buffer.from([0x50, 0x50, 0x82, 0x7d, 0, 0, 0, 0]);
  pre.writeUInt32LE(cuerpo.length, 4);
  return Buffer.concat([pre, cuerpo]);
}

const conTotal = (regs, tam) => {
  const total = Buffer.alloc(4);
  total.writeUInt32LE(regs.length * tam, 0);
  return Buffer.concat([total, ...regs]);
};
const leerTexto = (b) => b.toString('latin1').replace(/\0.*$/s, '');

function bloqueUsuarios() {
  const tam = VIEJO ? 28 : 72;
  const regs = [...usuarios.values()].map((u) => {
    const b = Buffer.alloc(tam);
    b.writeUInt16LE(u.uid, 0);
    if (VIEJO) {
      b.write(u.nombre.slice(0, 8), 8, 8, 'latin1');
      b.writeUInt32LE(Number(u.pin), 24);
    } else {
      b.write(u.nombre, 11, 24, 'latin1');
      b.write(u.pin, 48, 9, 'latin1');
    }
    return b;
  });
  return conTotal(regs, tam);
}

function bloqueFichadas() {
  const uidPorPin = new Map([...usuarios.values()].map((u) => [u.pin, u.uid]));
  const regs = fichadas.map((f, i) => {
    const b = Buffer.alloc(REGISTRO);
    if (REGISTRO === 40) {
      b.writeUInt16LE(i + 1, 0);
      b.write(f.pin, 2, 9, 'latin1');
      b.writeUInt8(15, 26); // verificación: rostro
      b.writeUInt32LE(codificarFecha(f.fecha), 27);
    } else if (REGISTRO === 16) {
      b.writeUInt32LE(Number(f.pin), 0);
      b.writeUInt32LE(codificarFecha(f.fecha), 4);
      b.writeUInt8(1, 8); // verificación: huella
    } else {
      b.writeUInt16LE(uidPorPin.get(f.pin) || 0, 0); // los de 8 bytes guardan el n.º interno
      b.writeUInt8(1, 2);
      b.writeUInt32LE(codificarFecha(f.fecha), 3);
    }
    return b;
  });
  return conTotal(regs, REGISTRO);
}

// Atiende un comando y devuelve el paquete de respuesta.
// `enviar` manda paquetes por iniciativa del reloj (eventos del enrolamiento).
function responder(p, cortar, enviar) {
  const cmd = p.readUInt16LE(0);
  const reply = p.readUInt16LE(6);
  const datos = p.subarray(8);
  const ok = (d) => paquete(C.ACK_OK, 1, reply, d);

  switch (cmd) {
    case C.ACK_OK:
      return null; // confirmación de un evento: un reloj real no la contesta
    case C.OPTIONS_RRQ: {
      const clave = datos.toString('latin1').replace(/\0/g, '');
      return ok(Buffer.from(clave === '~SerialNumber' ? `~SerialNumber=${SN}\0` : `${clave}=\0`, 'latin1'));
    }
    case C.GET_VERSION:
      return ok(Buffer.from(VIEJO ? 'Ver 6.60 Sep 27 2010\0' : 'Ver 8.0.4.6-SIM\0'));
    case C.FREE_SIZES: {
      const d = Buffer.alloc(80);
      d.writeUInt32LE(usuarios.size, 16);
      d.writeUInt32LE(fichadas.length, 32);
      return ok(d);
    }
    case C.DATA_WRRQ:
      return paquete(C.DATA, 1, reply, datos[1] === 0x09 ? bloqueUsuarios() : bloqueFichadas());
    case C.USER_WRQ: {
      const uid = datos.readUInt16LE(0);
      const nombre = VIEJO ? leerTexto(datos.subarray(8, 16)) : leerTexto(datos.subarray(11, 35));
      const pin = VIEJO ? String(datos.readUInt32LE(24)) : leerTexto(datos.subarray(48, 72));
      usuarios.set(uid, { uid, pin, nombre });
      console.log(`[reloj] alta/modificación: uid ${uid} PIN ${pin} "${nombre}" (${datos.length} bytes)`);
      return ok();
    }
    case C.DELETE_USER: {
      const uid = datos.readUInt16LE(0);
      console.log(`[reloj] baja: uid ${uid} PIN ${usuarios.get(uid)?.pin}`);
      usuarios.delete(uid);
      return ok();
    }
    case C.STARTENROLL: {
      const pin = VIEJO ? String(datos.readUInt32LE(0)) : leerTexto(datos.subarray(0, 24));
      const dedo = VIEJO ? datos.readInt8(4) : datos.readInt8(24);
      const u = [...usuarios.values()].find((x) => x.pin === pin);
      if (!u) return paquete(C.ACK_ERROR, 1, reply);
      setTimeout(() => empezarEnrolamiento(u.uid, dedo, enviar), 50);
      return ok();
    }
    case C.CANCELCAPTURE:
      if (enrolando) {
        enrolando.timers.forEach(clearTimeout);
        const { enviar: env } = enrolando;
        enrolando = null;
        console.log('[reloj] enrolamiento cancelado');
        setTimeout(() => evento(env, 4), 30);
      }
      return ok();
    case C.GET_USERTEMP: {
      const clave = `${datos.readInt16LE(0)}:${datos.readInt8(2)}`;
      return huellas.has(clave) ? paquete(C.DATA, 1, reply, Buffer.from('PLANTILLA-SIMULADA')) : paquete(C.ACK_ERROR, 1, reply);
    }
    case C.CLEAR_ATTLOG:
      fichadas.length = 0;
      console.log('[reloj] memoria de fichadas vaciada');
      return ok();
    case C.EXIT:
      cortar();
      return ok();
    default:
      return ok();
  }
}

const descripcion = VIEJO ? `equipo viejo (UDP, fichadas de ${REGISTRO} bytes)` : 'equipo nuevo (TCP)';

if (VIEJO) {
  // Los equipos viejos hablan solo UDP: un datagrama por comando, sin el prefijo de TCP
  const sock = dgram.createSocket('udp4');
  sock.on('message', (msg, rinfo) => {
    if (msg.length < 8) return;
    const enviar = (pkt) => sock.send(pkt, rinfo.port, rinfo.address);
    const r = responder(msg, () => {}, enviar);
    if (r) enviar(r);
  });
  sock.bind(PUERTO, () => console.log(`[reloj] simulador 4370 escuchando en ${PUERTO}: ${descripcion}`));
} else {
  net
    .createServer((sock) => {
      let pendiente = Buffer.alloc(0);
      sock.on('error', () => {});
      sock.on('data', (chunk) => {
        pendiente = Buffer.concat([pendiente, chunk]);
        while (pendiente.length >= 8) {
          const largo = pendiente.readUInt32LE(4);
          if (pendiente.length < 8 + largo) return;
          const p = pendiente.subarray(8, 8 + largo);
          pendiente = pendiente.subarray(8 + largo);
          let fin = false;
          const r = responder(p, () => (fin = true), (pkt) => !sock.destroyed && sock.write(tramaTcp(pkt)));
          if (r) sock.write(tramaTcp(r));
          if (fin) sock.end();
        }
      });
    })
    .listen(PUERTO, () => console.log(`[reloj] simulador 4370 escuchando en ${PUERTO}: ${descripcion}`));
}

http
  .createServer((req, res) => {
    const url = new URL(req.url, 'http://x');
    if (url.pathname === '/fichar') {
      const pin = url.searchParams.get('pin');
      const hora = url.searchParams.get('hora'); // HH:MM opcional
      const fecha = new Date();
      if (hora) fecha.setHours(Number(hora.slice(0, 2)), Number(hora.slice(3, 5)), 0, 0);
      fecha.setMilliseconds(0);
      fichadas.push({ pin, fecha });
      console.log(`[reloj] fichó ${pin} a las ${fecha.toLocaleTimeString('es-AR')}`);
      res.end('ok\n');
    } else if (url.pathname === '/enrolar') {
      resultadoEnrolar = url.searchParams.get('resultado') || 'ok';
      res.end(`el próximo enrolamiento termina: ${resultadoEnrolar}\n`);
    } else if (url.pathname === '/estado') {
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ usuarios: [...usuarios.values()], fichadas: fichadas.length, huellas: [...huellas] }, null, 1));
    } else {
      res.statusCode = 404;
      res.end();
    }
  })
  .listen(PUERTO + 1);
