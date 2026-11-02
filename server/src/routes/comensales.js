// ABM de comensales. Cada cambio se refleja en el reloj encolando comandos.
const express = require('express');
const Comensal = require('../models/Comensal');
const Auditoria = require('../models/Auditoria');
const Plantilla = require('../models/Plantilla');
const { enviarAlta, enviarBaja } = require('../adms/comandos');
const a = require('../utils/async');
const { escapeRegex } = require('../utils/async');

const router = express.Router();

const CAMPOS_EDITABLES = ['nombre', 'dni', 'sector', 'tarjeta', 'servicios', 'autorizado', 'observaciones'];
const elegir = (obj, campos) =>
  Object.fromEntries(campos.filter((c) => obj[c] !== undefined).map((c) => [c, obj[c]]));

// Listado con búsqueda y paginado: ?q=texto&estado=activos|inactivos|pendientes|todos&page=1&limit=50
router.get(
  '/',
  a(async (req, res) => {
    const page = Math.max(1, Number(req.query.page) || 1);
    const limit = Math.min(200, Math.max(1, Number(req.query.limit) || 50));
    const filtro = {};
    const estado = req.query.estado || 'activos';
    if (estado === 'activos') filtro.activo = true;
    else if (estado === 'inactivos') filtro.activo = false;
    else if (estado === 'pendientes') filtro.pendienteRevision = true;

    if (req.query.q) {
      const rx = new RegExp(escapeRegex(req.query.q.trim()), 'i');
      filtro.$or = [{ nombre: rx }, { pin: rx }, { dni: rx }, { sector: rx }];
    }

    const [items, total] = await Promise.all([
      Comensal.find(filtro).sort({ nombre: 1 }).skip((page - 1) * limit).limit(limit).lean(),
      Comensal.countDocuments(filtro),
    ]);
    res.json({ items, total, page, limit });
  })
);

router.get(
  '/:id',
  a(async (req, res) => {
    const c = await Comensal.findById(req.params.id).lean();
    if (!c) return res.status(404).json({ error: 'No encontrado' });
    res.json(c);
  })
);

// Alta
router.post(
  '/',
  a(async (req, res) => {
    const datos = { pin: req.body.pin, ...elegir(req.body, CAMPOS_EDITABLES) };
    const c = await Comensal.create(datos);
    await enviarAlta(c);
    await Auditoria.registrar(req, 'alta', 'comensal', c.pin, datos);
    res.status(201).json(c);
  })
);

// Modificación (el PIN no se cambia: es la identidad en el reloj)
router.put(
  '/:id',
  a(async (req, res) => {
    const c = await Comensal.findById(req.params.id);
    if (!c) return res.status(404).json({ error: 'No encontrado' });
    if (req.body.pin && req.body.pin !== c.pin) {
      return res.status(400).json({ error: 'El PIN no se puede modificar. Dé de baja y cree uno nuevo.' });
    }

    const cambios = elegir(req.body, CAMPOS_EDITABLES);
    const cambiaEnReloj = ['nombre', 'tarjeta'].some((k) => k in cambios && cambios[k] !== c[k]);
    const reactivar = req.body.activo === true && !c.activo;

    Object.assign(c, cambios);
    if (reactivar) c.activo = true;
    c.pendienteRevision = false; // si alguien lo editó, ya fue revisado
    await c.save();

    // Al reactivar se restaura también su rostro/huellas desde el respaldo: no hace falta re-enrolar
    if (reactivar) await enviarAlta(c, undefined, { conBiometria: true });
    else if (cambiaEnReloj && c.activo) await enviarAlta(c);
    await Auditoria.registrar(req, reactivar ? 'reactivacion' : 'modificacion', 'comensal', c.pin, cambios);
    res.json(c);
  })
);

// Baja: queda inactivo en la base y se BORRA del reloj (incluida su biometría)
router.delete(
  '/:id',
  a(async (req, res) => {
    const c = await Comensal.findById(req.params.id);
    if (!c) return res.status(404).json({ error: 'No encontrado' });
    c.activo = false;
    c.autorizado = false;
    c.pendienteRevision = false;
    // ?borrarBiometria=1 elimina también el respaldo de rostro/huellas (si no va a volver)
    const borrarBiometria = req.query.borrarBiometria === '1';
    if (borrarBiometria) {
      await Plantilla.deleteMany({ pin: c.pin });
      c.tieneBiometria = false;
    }
    await c.save();
    await enviarBaja(c.pin);
    await Auditoria.registrar(req, 'baja', 'comensal', c.pin, { motivo: req.body?.motivo, borrarBiometria });
    res.json(c);
  })
);

// Habilita de una vez a todos los "pendientes de revisión" (los que se trajeron del reloj).
// Ya están cargados en el equipo, así que no se manda nada al reloj.
router.post(
  '/pendientes/habilitar',
  a(async (req, res) => {
    const r = await Comensal.updateMany(
      { pendienteRevision: true, activo: true },
      { $set: { autorizado: true, pendienteRevision: false } }
    );
    await Auditoria.registrar(req, 'habilitar_pendientes', 'comensal', null, { cantidad: r.modifiedCount });
    res.json({ habilitados: r.modifiedCount });
  })
);

// Reenviar al reloj (por ejemplo, si se cambió el equipo)
router.post(
  '/:id/reenviar',
  a(async (req, res) => {
    const c = await Comensal.findById(req.params.id);
    if (!c || !c.activo) return res.status(404).json({ error: 'No encontrado o inactivo' });
    const comandos = await enviarAlta(c, undefined, { conBiometria: true });
    res.json({ encolados: comandos.length });
  })
);

module.exports = router;
