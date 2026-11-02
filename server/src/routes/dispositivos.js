// Gestión del/los reloj(es): estado, comandos, usuarios cargados en el equipo y acciones remotas
const express = require('express');
const Dispositivo = require('../models/Dispositivo');
const Comando = require('../models/Comando');
const Comensal = require('../models/Comensal');
const UsuarioReloj = require('../models/UsuarioReloj');
const Plantilla = require('../models/Plantilla');
const Auditoria = require('../models/Auditoria');
const { onlineSegundos } = require('../config');
const { enviarAlta, enviarBaja, accionEquipo, ACCIONES_EQUIPO } = require('../adms/comandos');
const { requireRol } = require('../middleware/auth');
const a = require('../utils/async');

const router = express.Router();

// Acciones que pueden afectar la operación: solo administradores
const SOLO_ADMIN = new Set(['reiniciar', 'vaciar-fichadas']);

async function buscarEquipo(req, res, next) {
  req.equipo = await Dispositivo.findOne({ sn: req.params.sn });
  if (!req.equipo) return res.status(404).json({ error: 'Equipo no encontrado' });
  next();
}

router.get(
  '/',
  a(async (_req, res) => {
    const limite = Date.now() - onlineSegundos * 1000;
    const [lista, pendientes, enReloj] = await Promise.all([
      Dispositivo.find().sort({ sn: 1 }).lean(),
      Comando.aggregate([
        { $match: { estado: { $in: ['pendiente', 'enviado'] } } },
        { $group: { _id: '$deviceSn', n: { $sum: 1 } } },
      ]),
      UsuarioReloj.aggregate([{ $group: { _id: '$deviceSn', n: { $sum: 1 } } }]),
    ]);
    res.json(
      lista.map((d) => ({
        ...d,
        enLinea: !!d.ultimaConexion && d.ultimaConexion.getTime() > limite,
        comandosPendientes: pendientes.find((p) => p._id === d.sn)?.n || 0,
        usuariosConocidos: enReloj.find((p) => p._id === d.sn)?.n || 0,
      }))
    );
  })
);

router.put(
  '/:sn',
  requireRol('admin'),
  a(buscarEquipo),
  a(async (req, res) => {
    req.equipo.nombre = String(req.body.nombre || '').trim() || 'MB360';
    await req.equipo.save();
    res.json(req.equipo);
  })
);

// Últimos comandos del equipo (para ver si los ABM llegaron)
router.get(
  '/:sn/comandos',
  a(async (req, res) => {
    res.json(await Comando.find({ deviceSn: req.params.sn }).sort({ cmdId: -1 }).limit(100).lean());
  })
);

// Cancela los comandos que el reloj todavía no aplicó (por ejemplo, trabados)
router.post(
  '/:sn/comandos/cancelar',
  a(async (req, res) => {
    const r = await Comando.updateMany(
      { deviceSn: req.params.sn, estado: { $in: ['pendiente', 'enviado'] } },
      { $set: { estado: 'error', retorno: -9999 } }
    );
    await Auditoria.registrar(req, 'cancelar_comandos', 'dispositivo', req.params.sn, { cantidad: r.modifiedCount });
    res.json({ cancelados: r.modifiedCount });
  })
);

// Base vs. reloj: compara los comensales con los usuarios que tiene cargados el equipo
router.get(
  '/:sn/comparacion',
  a(buscarEquipo),
  a(async (req, res) => {
    const sn = req.equipo.sn;
    const [enReloj, comensales, consultaPendiente, conRespaldo] = await Promise.all([
      UsuarioReloj.find({ deviceSn: sn }).lean(),
      Comensal.find({}, 'pin nombre sector activo autorizado tieneBiometria pendienteRevision').lean(),
      Comando.exists({ deviceSn: sn, tipo: 'consulta', estado: { $in: ['pendiente', 'enviado'] } }),
      Plantilla.distinct('pin'),
    ]);
    const porPin = new Map(comensales.map((c) => [c.pin, c]));
    const pinsReloj = new Set(enReloj.map((u) => u.pin));
    const respaldo = new Set(conRespaldo);

    const sincronizados = [];
    const soloReloj = [];
    for (const u of enReloj) {
      const c = porPin.get(u.pin);
      const fila = { pin: u.pin, nombreReloj: u.nombre, biometriaReloj: u.tieneBiometria, privilegio: u.privilegio };
      if (c && c.activo) {
        sincronizados.push({
          ...fila,
          _id: c._id,
          nombre: c.nombre,
          sector: c.sector,
          autorizado: c.autorizado,
          pendienteRevision: c.pendienteRevision,
          nombreDistinto: (u.nombre || '') !== c.nombre.slice(0, 24).trim(),
        });
      } else {
        // En el reloj pero dado de baja (o inexistente) en la base
        soloReloj.push({ ...fila, _id: c?._id, nombre: c?.nombre, baja: !!c && !c.activo });
      }
    }
    const soloBase = comensales
      .filter((c) => c.activo && !pinsReloj.has(c.pin))
      .map((c) => ({ ...c, tieneRespaldo: respaldo.has(c.pin) }));

    const orden = (x, y) => (x.nombre || x.nombreReloj || '').localeCompare(y.nombre || y.nombreReloj || '');
    res.json({
      ultimaLectura: req.equipo.ultimaLecturaUsuarios || null,
      leyendo: !!consultaPendiente,
      sincronizados: sincronizados.sort(orden),
      soloReloj: soloReloj.sort(orden),
      soloBase: soloBase.sort(orden),
    });
  })
);

// Mandar un comensal de la base a este reloj (con su biometría si hay respaldo)
router.post(
  '/:sn/usuarios/:pin/enviar',
  a(buscarEquipo),
  a(async (req, res) => {
    const c = await Comensal.findOne({ pin: req.params.pin, activo: true });
    if (!c) return res.status(404).json({ error: 'No hay un comensal activo con ese PIN' });
    const cmds = await enviarAlta(c, req.equipo.sn, { conBiometria: true });
    await Auditoria.registrar(req, 'enviar_a_reloj', 'comensal', c.pin, { sn: req.equipo.sn });
    res.json({ encolados: cmds.length });
  })
);

// Borrar un usuario del reloj (por ejemplo, alguien dado de baja que sigue en el equipo)
router.post(
  '/:sn/usuarios/:pin/borrar',
  a(buscarEquipo),
  a(async (req, res) => {
    await enviarBaja(req.params.pin, req.equipo.sn);
    await Auditoria.registrar(req, 'borrar_de_reloj', 'comensal', req.params.pin, { sn: req.equipo.sn });
    res.json({ encolados: 1 });
  })
);

// Manda TODOS los comensales activos al reloj, con biometría (equipo nuevo o reseteado)
router.post(
  '/:sn/sincronizar',
  requireRol('admin'),
  a(buscarEquipo),
  a(async (req, res) => {
    const activos = await Comensal.find({ activo: true }).lean();
    let encolados = 0;
    for (const c of activos) encolados += (await enviarAlta(c, req.equipo.sn, { conBiometria: true })).length;
    await Auditoria.registrar(req, 'sincronizar', 'dispositivo', req.equipo.sn, { usuarios: activos.length });
    res.json({ usuarios: activos.length, encolados });
  })
);

// Acciones remotas: consultar-usuarios, recuperar-fichadas, actualizar, info, reiniciar, vaciar-fichadas
router.post(
  '/:sn/acciones/:accion',
  a(buscarEquipo),
  a(async (req, res) => {
    const { accion } = req.params;
    if (!ACCIONES_EQUIPO[accion]) return res.status(400).json({ error: 'Acción desconocida' });
    if (SOLO_ADMIN.has(accion) && req.operador.rol !== 'admin') {
      return res.status(403).json({ error: 'Solo un administrador puede hacer esto' });
    }
    const params = {};
    if (accion === 'recuperar-fichadas') {
      const re = /^\d{4}-\d{2}-\d{2}$/;
      if (!re.test(req.body?.desde || '') || !re.test(req.body?.hasta || '')) {
        return res.status(400).json({ error: 'Indicá desde y hasta (YYYY-MM-DD)' });
      }
      Object.assign(params, { desde: req.body.desde, hasta: req.body.hasta });
    }
    const cmd = await accionEquipo(req.equipo.sn, accion, params);
    await Auditoria.registrar(req, accion, 'dispositivo', req.equipo.sn, params);
    res.json(cmd);
  })
);

module.exports = router;
