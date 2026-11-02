const jwt = require('jsonwebtoken');
const Operador = require('../models/Operador');
const { jwtSecret } = require('../config');

async function operadorDesdeToken(token) {
  if (!token) return null;
  try {
    const { id } = jwt.verify(token, jwtSecret);
    const op = await Operador.findById(id);
    return op && op.activo ? op : null;
  } catch {
    return null;
  }
}

// Exige un token válido: "Authorization: Bearer <token>"
async function requireAuth(req, res, next) {
  const h = req.headers.authorization || '';
  const token = h.startsWith('Bearer ') ? h.slice(7) : null;
  const op = await operadorDesdeToken(token);
  if (!op) return res.status(401).json({ error: 'No autenticado' });
  req.operador = op;
  next();
}

const requireRol = (...roles) => (req, res, next) =>
  roles.includes(req.operador?.rol) ? next() : res.status(403).json({ error: 'Sin permiso' });

module.exports = { requireAuth, requireRol, operadorDesdeToken };
