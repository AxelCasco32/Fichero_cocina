// Simula un MB360 hablando ADMS con el servidor, para probar sin el equipo.
// Guarda su "memoria" de usuarios en un archivo, como un reloj real.
//
// Uso:
//   npm run simular -- handshake                 -> primer contacto del equipo
//   npm run simular -- fichar <pin> [HH:MM]      -> manda una fichada (hoy, a esa hora)
//   npm run simular -- comandos                  -> ejecuta los comandos pendientes y responde
//   npm run simular -- enrolar <pin> [nombre]    -> alguien se enrola directo en el reloj
//   npm run simular -- borrar-local <pin>        -> alguien borra un usuario desde el menú del reloj
//   npm run simular -- usuarios                  -> muestra qué tiene cargado el "reloj"
//
// Variables: SERVER=http://localhost:4000  SN=SIMULADO001

const fs = require('fs');
const os = require('os');
const path = require('path');

const SERVER = process.env.SERVER || `http://localhost:${process.env.PORT || 4000}`;
const SN = process.env.SN || 'SIMULADO001';
const MEMORIA = path.join(os.tmpdir(), `simulador-${SN}.json`);

const leer = () => {
  try {
    return JSON.parse(fs.readFileSync(MEMORIA, 'utf8'));
  } catch {
    return { usuarios: {} };
  }
};
const guardar = (m) => fs.writeFileSync(MEMORIA, JSON.stringify(m, null, 2));

async function pedir(metodo, ruta, cuerpo, { silencioso = false } = {}) {
  const url = `${SERVER}/iclock/${ruta}${ruta.includes('?') ? '&' : '?'}SN=${SN}`;
  const r = await fetch(url, {
    method: metodo,
    body: cuerpo,
    headers: cuerpo ? { 'Content-Type': 'text/plain' } : undefined,
  });
  const t = await r.text();
  if (!silencioso) console.log(`${metodo} /iclock/${ruta.split('?')[0]} -> ${r.status}\n${t}\n`);
  return t;
}

function fechaHoy(hhmm) {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat('en-CA', {
      timeZone: 'America/Argentina/Buenos_Aires',
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
    }).formatToParts(new Date()).map((x) => [x.type, x.value])
  );
  const hora = hhmm ? `${hhmm}:${p.second}` : `${p.hour}:${p.minute}:${p.second}`;
  return `${p.year}-${p.month}-${p.day} ${hora}`;
}

const campos = (texto) =>
  Object.fromEntries(
    texto.split('\t').map((p) => {
      const i = p.indexOf('=');
      return [p.slice(0, i), p.slice(i + 1)];
    })
  );

const lineaUsuario = (u) =>
  `USER PIN=${u.pin}\tName=${u.nombre}\tPri=0\tPasswd=\tCard=${u.tarjeta || ''}\tGrp=1\tTZ=0000000100000000`;

// Ejecuta un comando como lo haría el equipo. Devuelve el código de retorno (0 = ok).
async function ejecutar(texto, mem) {
  let m;
  if ((m = /^DATA UPDATE USERINFO (.*)$/.exec(texto))) {
    const c = campos(m[1]);
    mem.usuarios[c.PIN] = { ...(mem.usuarios[c.PIN] || {}), pin: c.PIN, nombre: c.Name, tarjeta: c.Card };
    return 0;
  }
  if ((m = /^DATA UPDATE (FINGERTMP|FACE|BIODATA) (.*)$/.exec(texto))) {
    const c = campos(m[2]);
    const pin = c.PIN || c.Pin;
    if (!mem.usuarios[pin]) return -1;
    mem.usuarios[pin].biometria = true;
    return 0;
  }
  if ((m = /^DATA DELETE USERINFO PIN=(\d+)/.exec(texto))) {
    delete mem.usuarios[m[1]];
    return 0;
  }
  if (texto === 'DATA QUERY USERINFO') {
    const lineas = Object.values(mem.usuarios).map(lineaUsuario);
    if (lineas.length) await pedir('POST', 'cdata?table=OPERLOG&Stamp=9999', lineas.join('\n') + '\n', { silencioso: true });
    console.log(`  (el reloj informó ${lineas.length} usuarios)`);
    return 0;
  }
  return 0; // CHECK, INFO, REBOOT, CLEAR LOG, DATA QUERY ATTLOG: aceptados
}

async function main() {
  const [accion, ...args] = process.argv.slice(2);
  const mem = leer();
  switch (accion) {
    case 'handshake':
      await pedir('GET', 'cdata?options=all&pushver=2.4.1&language=69');
      break;
    case 'fichar': {
      const [pin, hhmm] = args;
      if (!pin) throw new Error('Falta el PIN');
      await pedir('POST', 'cdata?table=ATTLOG&Stamp=9999', `${pin}\t${fechaHoy(hhmm)}\t0\t15\t0\t0\t0\n`);
      break;
    }
    case 'enrolar': {
      const [pin, ...nombre] = args;
      const u = mem.usuarios[pin] || { pin, nombre: nombre.join(' ') || `Usuario ${pin}` };
      u.biometria = true;
      mem.usuarios[pin] = u;
      guardar(mem);
      await pedir(
        'POST',
        'cdata?table=OPERLOG&Stamp=9999',
        `${lineaUsuario(u)}\nFACE PIN=${pin}\tFID=0\tSIZE=4\tVALID=1\tTMP=AAAA\n`
      );
      break;
    }
    case 'borrar-local':
      delete mem.usuarios[args[0]];
      guardar(mem);
      console.log(`Usuario ${args[0]} borrado del reloj (sin avisar al servidor)`);
      break;
    case 'usuarios':
      console.table(Object.values(mem.usuarios));
      break;
    case 'comandos': {
      const n = Object.keys(mem.usuarios).length;
      const t = await pedir('GET', `getrequest?INFO=${encodeURIComponent(`Ver 8.0.4-SIM,${n},0,10,192.168.1.50`)}`);
      const cmds = [...t.matchAll(/^C:(\d+):(.*)$/gm)].map((m) => ({ id: m[1], texto: m[2] }));
      const respuestas = [];
      for (const c of cmds) respuestas.push(`ID=${c.id}&Return=${await ejecutar(c.texto, mem)}&CMD=DATA`);
      guardar(mem);
      if (respuestas.length) await pedir('POST', 'devicecmd', respuestas.join('\n'));
      break;
    }
    default:
      console.log('Acciones: handshake | fichar <pin> [HH:MM] | comandos | enrolar <pin> [nombre] | borrar-local <pin> | usuarios');
  }
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
