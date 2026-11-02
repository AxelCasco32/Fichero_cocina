const path = require('path');
const fs = require('fs');
const express = require('express');
const cors = require('cors');
const { corsOrigin } = require('./config');
const { requireAuth, requireRol } = require('./middleware/auth');

function crearApp() {
  const app = express();
  app.disable('x-powered-by');

  // 1) Endpoints del reloj: van ANTES del JSON parser y sin login (el equipo no sabe loguearse)
  app.use('/iclock', (req, _res, next) => {
    // Registro de lo que pide el reloj (sin las consultas de rutina, para no llenar la consola)
    if (!(req.method === 'GET' && req.path.startsWith('/getrequest') && !req.query.INFO)) {
      console.log('[iclock]', req.method, req.originalUrl);
    }
    next();
  });
  app.use('/iclock', require('./adms/router'));

  // 2) API para la web
  app.use(cors({ origin: corsOrigin }));
  app.use(express.json({ limit: '1mb' }));

  app.get('/api/salud', (_req, res) => res.json({ ok: true, hora: new Date() }));
  app.use('/api/auth', require('./routes/auth'));
  app.use('/api/comensales', requireAuth, require('./routes/comensales'));
  app.use('/api/fichadas', requireAuth, require('./routes/fichadas'));
  app.use('/api/dispositivos', requireAuth, require('./routes/dispositivos'));
  app.use('/api/operadores', requireAuth, requireRol('admin'), require('./routes/operadores'));
  app.use('/api/auditoria', requireAuth, requireRol('admin'), require('./routes/auditoria'));

  app.use('/api', (_req, res) => res.status(404).json({ error: 'Ruta no encontrada' }));

  // 3) Frontend compilado (client/dist): en producción todo corre con un solo proceso
  const dist = path.join(__dirname, '..', '..', 'client', 'dist');
  if (fs.existsSync(dist)) {
    app.use(express.static(dist));
    app.get(/^\/(?!api|iclock|socket\.io).*/, (_req, res) => res.sendFile(path.join(dist, 'index.html')));
  }

  // Errores: validaciones de Mongoose -> 400, duplicados -> 409, el resto -> 500
  app.use((err, _req, res, _next) => {
    if (err.name === 'ValidationError') {
      return res.status(400).json({ error: Object.values(err.errors).map((e) => e.message).join('. ') });
    }
    if (err.name === 'CastError') return res.status(400).json({ error: 'ID inválido' });
    if (err.code === 11000) {
      const campo =
        Object.keys(err.keyValue || err.keyPattern || {})[0] ||
        (/index: (\w+?)_\d/.exec(err.message || '') || [])[1] ||
        'dato';
      return res.status(409).json({ error: `Ya existe un registro con ese ${campo}` });
    }
    console.error(err);
    res.status(500).json({ error: 'Error interno' });
  });

  return app;
}

module.exports = { crearApp };
