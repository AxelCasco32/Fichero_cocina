const express = require('express');
const Auditoria = require('../models/Auditoria');
const a = require('../utils/async');

const router = express.Router();

// ?entidad=comensal&entidadId=123&limit=100
router.get(
  '/',
  a(async (req, res) => {
    const filtro = {};
    if (req.query.entidad) filtro.entidad = String(req.query.entidad);
    if (req.query.entidadId) filtro.entidadId = String(req.query.entidadId);
    const limit = Math.min(500, Number(req.query.limit) || 100);
    res.json(await Auditoria.find(filtro).sort({ fecha: -1 }).limit(limit).lean());
  })
);

module.exports = router;
