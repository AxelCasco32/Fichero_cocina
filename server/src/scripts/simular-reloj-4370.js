// Simula un reloj ZKTeco hablando el protocolo del puerto 4370, para probar el modo 4370 sin el equipo.
//
// Uso:  node src/scripts/simular-reloj-4370.js [puerto=4370]
//   - Arranca con 3 usuarios y algunas fichadas de ayer.
//   - Para "fichar":  curl "http://localhost:4371/fichar?pin=1001"   (puerto + 1)
//   - Para ver su memoria:  curl http://localhost:4371/estado

const net = require('net');
const http = require('http');

const PUERTO = Number(process.argv[2] || 4370);
const SN = 'SIM4370';

const C = {
  CONNECT: 1000, EXIT: 1001, ACK_OK: 2000, OPTIONS_RRQ: 11, GET_VERSION: 1100, FREE_SIZES: 50,
  DATA_WRRQ: 1503, DATA: 1501, FREE_DATA: 1502, USER_WRQ: 8, DELETE_USER: 18, REFRESHDATA: 1013,
  CLEAR_ATTLOG: 15, RESTART: 1004,
};

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

function trama(cmd, sesion, reply, datos = Buffer.alloc(0)) {
  const cuerpo = Buffer.alloc(8 + datos.length);
  cuerpo.writeUInt16LE(cmd, 0);
  cuerpo.writeUInt16LE(sesion, 4);
  cuerpo.writeUInt16LE(reply, 6);
  datos.copy(cuerpo, 8);
  const pre = Buffer.from([0x50, 0x50, 0x82, 0x7d, 0, 0, 0, 0]);
  pre.writeUInt32LE(cuerpo.length, 4);
  return Buffer.concat([pre, cuerpo]);
}

function bloqueUsuarios() {
  const regs = [...usuarios.values()].map((u) => {
    const b = Buffer.alloc(72);
    b.writeUInt16LE(u.uid, 0);
    b.write(u.nombre, 11, 24, 'latin1');
    b.write(u.pin, 48, 9, 'latin1');
    return b;
  });
  const total = Buffer.alloc(4);
  total.writeUInt32LE(regs.length * 72, 0);
  return Buffer.concat([total, ...regs]);
}

function bloqueFichadas() {
  const regs = fichadas.map((f, i) => {
    const b = Buffer.alloc(40);
    b.writeUInt16LE(i + 1, 0);
    b.write(f.pin, 2, 9, 'latin1');
    b.writeUInt8(15, 26); // verificación: rostro
    b.writeUInt32LE(codificarFecha(f.fecha), 27);
    return b;
  });
  const total = Buffer.alloc(4);
  total.writeUInt32LE(regs.length * 40, 0);
  return Buffer.concat([total, ...regs]);
}

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
        const cmd = p.readUInt16LE(0);
        const reply = p.readUInt16LE(6);
        const datos = p.subarray(8);
        const ok = (d) => sock.write(trama(C.ACK_OK, 1, reply, d));

        switch (cmd) {
          case C.OPTIONS_RRQ: {
            const clave = datos.toString('latin1').replace(/\0/g, '');
            ok(Buffer.from(clave === '~SerialNumber' ? `~SerialNumber=${SN}\0` : `${clave}=\0`, 'latin1'));
            break;
          }
          case C.GET_VERSION:
            ok(Buffer.from('Ver 8.0.4.6-SIM\0'));
            break;
          case C.FREE_SIZES: {
            const d = Buffer.alloc(80);
            d.writeUInt32LE(usuarios.size, 16);
            d.writeUInt32LE(fichadas.length, 32);
            ok(d);
            break;
          }
          case C.DATA_WRRQ: {
            const tipo = datos[1];
            sock.write(trama(C.DATA, 1, reply, tipo === 0x09 ? bloqueUsuarios() : bloqueFichadas()));
            break;
          }
          case C.USER_WRQ: {
            const uid = datos.readUInt16LE(0);
            const nombre = datos.subarray(11, 35).toString('latin1').replace(/\0.*$/s, '');
            const pin = datos.subarray(48, 72).toString('latin1').replace(/\0.*$/s, '');
            usuarios.set(uid, { uid, pin, nombre });
            console.log(`[reloj] alta/modificación: uid ${uid} PIN ${pin} "${nombre}"`);
            ok();
            break;
          }
          case C.DELETE_USER: {
            const uid = datos.readUInt16LE(0);
            console.log(`[reloj] baja: uid ${uid} PIN ${usuarios.get(uid)?.pin}`);
            usuarios.delete(uid);
            ok();
            break;
          }
          case C.CLEAR_ATTLOG:
            fichadas.length = 0;
            console.log('[reloj] memoria de fichadas vaciada');
            ok();
            break;
          case C.EXIT:
            ok();
            sock.end();
            break;
          default:
            ok();
        }
      }
    });
  })
  .listen(PUERTO, () => console.log(`[reloj] simulador 4370 escuchando en ${PUERTO}`));

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
    } else if (url.pathname === '/estado') {
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ usuarios: [...usuarios.values()], fichadas: fichadas.length }, null, 1));
    } else {
      res.statusCode = 404;
      res.end();
    }
  })
  .listen(PUERTO + 1);
