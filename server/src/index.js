const http = require('http');
const { Server } = require('socket.io');
const config = require('./config');
const { conectar } = require('./db');
const { crearApp } = require('./app');
const { operadorDesdeToken } = require('./middleware/auth');
const tiempoReal = require('./tiempoReal');
const gestor4370 = require('./reloj4370/gestor');

// La librería de los relojes puede dejar errores de red sin atrapar (por ejemplo, si el equipo se
// apaga a mitad de una descarga). No dejamos que eso tire abajo todo el servidor.
const esErrorDeRed = (err) =>
  /ECONN|ETIMEDOUT|EHOSTUNREACH|ENETUNREACH|EPIPE|ERR_SOCKET|TIMEOUT_ON|socket/i.test(`${err?.code} ${err?.message}`);
process.on('unhandledRejection', (err) => {
  console.error('[server] error no atrapado (se sigue funcionando):', err?.message || err);
});
process.on('uncaughtException', (err) => {
  if (esErrorDeRed(err)) {
    console.error('[server] error de red con un reloj (se sigue funcionando):', err.message);
    return;
  }
  console.error('[server] error fatal:', err);
  process.exit(1);
});

async function main() {
  await conectar();

  const app = crearApp();
  const server = http.createServer(app);

  // Socket.io: la web se conecta con el token y recibe fichadas en vivo
  const io = new Server(server, { cors: { origin: config.corsOrigin } });
  io.use(async (socket, next) => {
    const op = await operadorDesdeToken(socket.handshake.auth?.token);
    if (!op) {
      console.log('[tiempo real] conexión rechazada: sesión vencida o inválida (hay que volver a iniciar sesión)');
      return next(new Error('No autenticado'));
    }
    socket.data.operador = op;
    next();
  });
  io.on('connection', (socket) => {
    socket.join('operadores');
    const quien = socket.data.operador?.usuario || '?';
    console.log(`[tiempo real] pantalla conectada (${quien}) · ${tiempoReal.conectadas()} en vivo`);
    socket.on('disconnect', (motivo) => {
      console.log(`[tiempo real] pantalla desconectada (${quien}, ${motivo}) · ${tiempoReal.conectadas()} en vivo`);
    });
  });
  tiempoReal.setIO(io);

  server.listen(config.port, '0.0.0.0', async () => {
    console.log(`[server] escuchando en el puerto ${config.port}`);
    try {
      const n = await gestor4370.iniciar({ relojesEnv: config.relojes4370, intervaloSeg: config.intervalo4370 });
      if (n) console.log(`[server] conexión directa (4370) con ${n} equipo(s)`);
      else {
        console.log('[server] sin equipos por 4370: agregalos desde la web (Equipos → Agregar equipo)');
        console.log(`[server] los equipos ADMS se registran solos apuntando a esta IP y puerto ${config.port}`);
      }
    } catch (err) {
      console.error('[server] no se pudieron iniciar las conexiones con los relojes:', err);
    }
  });
}

main().catch((err) => {
  console.error('No se pudo iniciar:', err);
  process.exit(1);
});
