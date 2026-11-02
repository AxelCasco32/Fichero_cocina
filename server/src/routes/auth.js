const express = require('express');
const jwt = require('jsonwebtoken');
const Operador = require('../models/Operador');
const { jwtSecret, jwtExpira } = require('../config');
const { requireAuth } = require('../middleware/auth');
const a = require('../utils/async');

const router = express.Router();

router.post(
  '/login',
  a(async (req, res) => {
    const { usuario, password } = req.body || {};
    const op = await Operador.findOne({ usuario: String(usuario || '').toLowerCase().trim() });
    if (!op || !op.activo || !(await op.verificarPassword(String(password || '')))) {
      return res.status(401).json({ error: 'Usuario o contraseña incorrectos' });
    }
    const token = jwt.sign({ id: op._id, rol: op.rol }, jwtSecret, { expiresIn: jwtExpira });
    res.json({ token, operador: op });
  })
);

router.get('/yo', requireAuth, (req, res) => res.json(req.operador));

module.exports = router;
