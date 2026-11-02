// Consultas, reportes, carga manual y anulación de fichadas
const express = require('express');
const Fichada = require('../models/Fichada');
const Comensal = require('../models/Comensal');
const Auditoria = require('../models/Auditoria');
const SERVICIOS = require('../catalogos/servicios');
const { tzOffset } = require('../config');
const { rangoDia, hoy, partesLocales } = require('../utils/fecha');
const { evaluar, registrarManual, NO_ANULADA } = require('../services/fichadas');
const tiempoReal = require('../tiempoReal');
const a = require('../utils/async');

const router = express.Router();

function rangoDesdeQuery(q) {
  const desde = rangoDia(q.desde || q.fecha || hoy());
  const hasta = rangoDia(q.hasta || q.fecha || hoy());
  if (!desde || !hasta) return null;
  return { $gte: desde.desde, $lt: hasta.hasta };
}

// "2026-10-30T12:15" (hora local, como la manda un <input type="datetime-local">) -> Date
function parseFechaLocal(texto) {
  if (!texto) return new Date();
  const m = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})(?::\d{2})?$/.exec(String(texto));
  if (!m) return null;
  const d = new Date(`${m[1]}T${m[2]}:00${tzOffset}`);
  return Number.isNaN(d.getTime()) ? null : d;
}

// Listado: ?desde=&hasta=&pin=&resultado=&servicio=&origen=&anuladas=excluir|incluir|solo&page=&limit=
router.get(
  '/',
  a(async (req, res) => {
    const fecha = rangoDesdeQuery(req.query);
    if (!fecha) return res.status(400).json({ error: 'Fechas inválidas (YYYY-MM-DD)' });
    const filtro = { fecha };
    for (const k of ['pin', 'resultado', 'servicio', 'origen']) if (req.query[k]) filtro[k] = String(req.query[k]);
    const anuladas = req.query.anuladas || 'excluir';
    if (anuladas === 'excluir') Object.assign(filtro, NO_ANULADA);
    else if (anuladas === 'solo') filtro.anulada = true;

    const page = Math.max(1, Number(req.query.page) || 1);
    const limit = Math.min(500, Math.max(1, Number(req.query.limit) || 100));
    const [items, total] = await Promise.all([
      Fichada.find(filtro).sort({ fecha: -1 }).skip((page - 1) * limit).limit(limit).lean(),
      Fichada.countDocuments(filtro),
    ]);
    res.json({ items, total, page, limit });
  })
);

// Últimas fichadas, para cargar el monitor en vivo al abrir la pantalla
router.get(
  '/recientes',
  a(async (req, res) => {
    const limit = Math.min(200, Number(req.query.limit) || 50);
    res.json(await Fichada.find(NO_ANULADA).sort({ fecha: -1 }).limit(limit).lean());
  })
);

// Fichadas por hora de un día: ?fecha=YYYY-MM-DD
router.get(
  '/por-hora',
  a(async (req, res) => {
    const fecha = rangoDesdeQuery({ fecha: req.query.fecha });
    if (!fecha) return res.status(400).json({ error: 'Fecha inválida (YYYY-MM-DD)' });

    // Un día de comedor son cientos de fichadas: agrupamos en Node (sirve en cualquier versión de Mongo)
    const fichadas = await Fichada.find({ fecha, ...NO_ANULADA }, 'fecha resultado').lean();
    const horas = Array.from({ length: 24 }, (_, hora) => ({ hora, total: 0 }));
    for (const f of fichadas) {
      const hora = Number(partesLocales(f.fecha).hhmm.slice(0, 2));
      const fila = horas[hora];
      fila[f.resultado] = (fila[f.resultado] || 0) + 1;
      fila.total++;
    }
    res.json(horas);
  })
);

// Resumen del día por servicio: ?fecha=YYYY-MM-DD
router.get(
  '/resumen',
  a(async (req, res) => {
    const dia = req.query.fecha || hoy();
    if (!rangoDia(dia)) return res.status(400).json({ error: 'Fecha inválida (YYYY-MM-DD)' });

    const fichadas = await Fichada.find({ dia, ...NO_ANULADA }, 'servicio resultado').lean();
    const servicios = [...SERVICIOS, { codigo: null, nombre: 'Fuera de horario' }].map((s) => ({
      ...s,
      total: 0,
      porResultado: {},
    }));
    for (const f of fichadas) {
      const s = servicios.find((x) => x.codigo === (f.servicio || null));
      if (!s) continue;
      s.porResultado[f.resultado] = (s.porResultado[f.resultado] || 0) + 1;
      s.total++;
    }
    res.json({ dia, servicios });
  })
);

// Catálogo de servicios (para armar formularios en la web)
router.get('/servicios', (_req, res) => res.json(SERVICIOS));

// --- Carga manual ---

async function validarManual(body) {
  const pin = String(body.pin || '').trim();
  const comensal = await Comensal.findOne({ pin });
  if (!comensal) return { error: 'No existe un comensal con ese PIN' };
  const fecha = parseFechaLocal(body.fecha);
  if (!fecha) return { error: 'Fecha y hora inválidas' };
  if (fecha.getTime() > Date.now() + 60 * 1000) return { error: 'La fecha no puede ser futura' };
  const servicio = body.servicio || null;
  if (servicio && !SERVICIOS.some((s) => s.codigo === servicio)) return { error: 'Servicio inválido' };
  return { pin, comensal, fecha, servicio };
}

// Vista previa: qué resultado tendría la fichada (no guarda nada)
router.post(
  '/manual/evaluar',
  a(async (req, res) => {
    const v = await validarManual(req.body || {});
    if (v.error) return res.status(400).json({ error: v.error });
    res.json(await evaluar(v.pin, v.fecha, v.servicio || undefined));
  })
);

router.post(
  '/manual',
  a(async (req, res) => {
    const v = await validarManual(req.body || {});
    if (v.error) return res.status(400).json({ error: v.error });
    const motivo = String(req.body.motivo || '').trim();
    if (motivo.length < 3) return res.status(400).json({ error: 'Indicá el motivo de la carga manual' });

    const doc = await registrarManual({
      pin: v.pin,
      fecha: v.fecha,
      servicio: v.servicio,
      motivo,
      operador: req.operador.usuario,
    });
    await Auditoria.registrar(req, 'carga_manual', 'fichada', doc._id, {
      pin: v.pin,
      fecha: v.fecha,
      resultado: doc.resultado,
      motivo,
    });
    res.status(201).json(doc);
  })
);

// --- Anulación ---

router.post(
  '/:id/anular',
  a(async (req, res) => {
    const motivo = String(req.body?.motivo || '').trim();
    if (motivo.length < 3) return res.status(400).json({ error: 'Indicá el motivo de la anulación' });
    const f = await Fichada.findById(req.params.id);
    if (!f) return res.status(404).json({ error: 'No encontrada' });
    if (f.anulada) return res.status(400).json({ error: 'Ya estaba anulada' });

    Object.assign(f, { anulada: true, anuladaPor: req.operador.usuario, anuladaMotivo: motivo, anuladaEn: new Date() });
    await f.save();
    await Auditoria.registrar(req, 'anulacion', 'fichada', f._id, { pin: f.pin, fecha: f.fecha, motivo });
    tiempoReal.emitir('fichada:anulada', { _id: String(f._id) });
    res.json(f);
  })
);

router.post(
  '/:id/restaurar',
  a(async (req, res) => {
    const f = await Fichada.findById(req.params.id);
    if (!f) return res.status(404).json({ error: 'No encontrada' });
    if (!f.anulada) return res.status(400).json({ error: 'No está anulada' });
    f.anulada = false;
    f.anuladaPor = f.anuladaMotivo = f.anuladaEn = undefined;
    await f.save();
    await Auditoria.registrar(req, 'restauracion', 'fichada', f._id, { pin: f.pin, fecha: f.fecha });
    res.json(f);
  })
);

module.exports = router;
