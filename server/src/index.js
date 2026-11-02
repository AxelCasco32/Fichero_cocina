const http = require('http');
const { Server } = require('socket.io');
const config = require('./config');
const { conectar } = require('./db');
const { crearApp } = require('./app');
const { operadorDesdeToken } = require('./middleware/auth');
const tiempoReal = require('./tiempoReal');
const { iniciarConectores } = require('./reloj4370/conector');

async function main() {
  await conectar();

  const app = crearApp();
  const server = http.createServer(app);

  // Socket.io: la web se conecta con el token y recibe fichadas en vivo
  const io = new Server(server, { cors: { origin: config.corsOrigin } });
  io.use(async (socket, next) => {
    const op = await operadorDesdeToken(socket.handshake.auth?.token);
    if (!op) return next(new Error('No autenticado'));
    socket.data.operador = op;
    next();
  });
  io.on('connection', (socket) => socket.join('operadores'));
  tiempoReal.setIO(io);

  server.listen(config.port, '0.0.0.0', () => {
    console.log(`[server] escuchando en el puerto ${config.port}`);
    if (config.relojes4370.length) {
      console.log(`[server] modo 4370: conectando a ${config.relojes4370.join(', ')}`);
      iniciarConectores(config.relojes4370, config.intervalo4370);
    } else {
      console.log(`[server] modo ADMS: configurá el reloj apuntando a esta IP y puerto ${config.port}`);
    }
  });
}

main().catch((err) => {
  console.error('No se pudo iniciar:', err);
  process.exit(1);
});
