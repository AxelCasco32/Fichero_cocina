// Gestión del personal que usa la web (solo administradores)
const express = require('express');
const Operador = require('../models/Operador');
const Auditoria = require('../models/Auditoria');
const a = require('../utils/async');

const router = express.Router();

router.get(
  '/',
  a(async (_req, res) => res.json(await Operador.find().sort({ nombre: 1 })))
);

router.post(
  '/',
  a(async (req, res) => {
    const { usuario, nombre, password, rol } = req.body || {};
    if (!password || String(password).length < 8) {
      return res.status(400).json({ error: 'La contraseña debe tener al menos 8 caracteres' });
    }
    const op = await Operador.create({
      usuario,
      nombre,
      rol,
      passwordHash: await Operador.hashPassword(String(password)),
    });
    await Auditoria.registrar(req, 'alta', 'operador', op.usuario, { rol: op.rol });
    res.status(201).json(op);
  })
);

router.put(
  '/:id',
  a(async (req, res) => {
    const op = await Operador.findById(req.params.id);
    if (!op) return res.status(404).json({ error: 'No encontrado' });
    const { nombre, rol, activo, password } = req.body || {};
    if (nombre !== undefined) op.nombre = nombre;
    if (rol !== undefined) op.rol = rol;
    if (activo !== undefined) op.activo = !!activo;
    if (password) {
      if (String(password).length < 8) return res.status(400).json({ error: 'Mínimo 8 caracteres' });
      op.passwordHash = await Operador.hashPassword(String(password));
    }
    if (String(op._id) === String(req.operador._id) && (op.rol !== 'admin' || !op.activo)) {
      return res.status(400).json({ error: 'No podés quitarte el rol de admin ni desactivarte' });
    }
    await op.save();
    await Auditoria.registrar(req, 'modificacion', 'operador', op.usuario, { nombre, rol, activo, password: !!password });
    res.json(op);
  })
);

module.exports = router;
