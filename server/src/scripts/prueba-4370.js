// Prueba de conexión directa con el reloj por el puerto 4370 (el mismo que usa el software de ZKTeco).
// SOLO LEE: no modifica nada en el equipo.
//
// Uso:  npm run prueba-4370 -- 128.128.22.250
//       npm run prueba-4370 -- 128.128.22.250 4370

const Zkteco = require('zkteco-js');

const ip = process.argv[2];
const puerto = Number(process.argv[3] || 4370);

function paso(texto) {
  console.log(`\n=== ${texto}`);
}

async function main() {
  if (!ip) {
    console.log('Uso: npm run prueba-4370 -- <IP del reloj> [puerto]');
    process.exit(1);
  }

  // ip, puerto, timeout (ms), puerto local UDP, tamaño de bloque (más chico = más estable en redes lentas)
  const reloj = new Zkteco(ip, puerto, 10000, 5000, 8184);

  paso(`Conectando a ${ip}:${puerto}…`);
  await reloj.createSocket();
  console.log(`Conectado (${reloj.connectionType}).`);

  paso('Información del equipo');
  for (const [nombre, fn] of [
    ['Firmware', () => reloj.getDeviceVersion()],
    ['Nombre', () => reloj.getDeviceName()],
    ['Hora del reloj', () => reloj.getTime()],
    ['Capacidad / cantidades', () => reloj.getInfo()],
  ]) {
    try {
      const v = await fn();
      console.log(`${nombre}:`, typeof v === 'object' ? JSON.stringify(v) : v);
    } catch (e) {
      console.log(`${nombre}: (no disponible: ${e.message || e})`);
    }
  }

  paso('Usuarios');
  const usuarios = (await reloj.getUsers()).data || [];
  console.log(`Total: ${usuarios.length}`);
  console.table(
    usuarios.slice(0, 5).map((u) => ({ uid: u.uid, pin: u.userId, nombre: u.name, rol: u.role, tarjeta: u.cardno }))
  );

  paso('Fichadas (descargando, puede tardar unos segundos)…');
  const t0 = Date.now();
  const fichadas = (await reloj.getAttendances()).data || [];
  console.log(`Total: ${fichadas.length} (en ${((Date.now() - t0) / 1000).toFixed(1)} s)`);
  console.log('Las 5 más recientes:');
  console.table(
    fichadas
      .slice(-5)
      .reverse()
      .map((f) => ({ pin: f.user_id, fecha: f.record_time, tipo: f.type, estado: f.state }))
  );

  paso('Escuchando fichadas en vivo durante 60 segundos: fichá en el reloj ahora');
  await reloj.getRealTimeLogs((r) => console.log('  → FICHADA EN VIVO:', JSON.stringify(r)));
  await new Promise((ok) => setTimeout(ok, 60000));

  await reloj.disconnect();
  paso('Prueba terminada ✔');
  process.exit(0);
}

main().catch((e) => {
  // La librería envuelve el error varias veces: buscamos el mensaje original
  let causa = e;
  while (causa?.err) causa = causa.err;
  console.error(`\n✖ Error en "${e?.command || 'conexión'}":`, causa?.message || causa);
  console.error(
    '\nRevisá: que el reloj responda ping, que no tenga "contraseña de comunicación" (Comm Key) distinta de 0,\n' +
      'y que el software de ZKTeco no esté conectado al reloj en este mismo momento.'
  );
  process.exit(1);
});
