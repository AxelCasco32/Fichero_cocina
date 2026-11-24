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
const gestor4370 = require('../reloj4370/gestor');
const { nombreParaReloj } = require('../reloj4370/protocolo');

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

// --- Alta, edición y baja de equipos (conexión directa por 4370) ---

const PROTOCOLOS = ['auto', 'tcp', 'udp'];
const FORMATOS = ['auto', 'nuevo', 'viejo'];

// IPv4 (cuatro números de 0 a 255) o un nombre de equipo de la red (sin puntos seguidos)
function ipValida(ip) {
  if (/^[\d.]+$/.test(ip)) {
    const partes = ip.split('.');
    return partes.length === 4 && partes.every((n) => /^\d{1,3}$/.test(n) && Number(n) <= 255);
  }
  return /^(?=.{1,253}$)[a-zA-Z0-9-]+(\.[a-zA-Z0-9-]+)*$/.test(ip);
}

// Valida los datos de conexión; devuelve { error } o los datos limpios
function datosConexion(body, actual = {}) {
  const ip = String(body.ip ?? actual.ip ?? '').trim();
  const puerto = Number(body.puerto ?? actual.puerto ?? 4370);
  const protocolo = body.protocolo ?? actual.protocolo ?? 'auto';
  const formato = body.formato ?? actual.formato ?? 'auto';
  if (!ipValida(ip)) return { error: `"${ip}" no es una IP válida (por ejemplo 192.168.1.50)` };
  if (!Number.isInteger(puerto) || puerto < 1 || puerto > 65535) return { error: 'El puerto tiene que ser un número entre 1 y 65535' };
  if (!PROTOCOLOS.includes(protocolo)) return { error: 'Conexión inválida' };
  if (!FORMATOS.includes(formato)) return { error: 'Formato inválido' };
  return { ip, puerto, protocolo, formato };
}

const enUso = (ip, puerto, excepto) =>
  Dispositivo.exists({
    ip,
    puerto: puerto === 4370 ? { $in: [4370, null] } : puerto,
    ...(excepto ? { _id: { $ne: excepto } } : {}),
  });

// Prueba la conexión sin guardar nada: devuelve número de serie, firmware, formato, etc.
router.post(
  '/probar',
  requireRol('admin'),
  a(async (req, res) => {
    const d = datosConexion(req.body || {});
    if (d.error) return res.status(400).json({ error: d.error });
    try {
      res.json(await gestor4370.probar(d));
    } catch (err) {
      res.status(err.status || 500).json({ error: err.message });
    }
  })
);

// Agregar un equipo: el sistema empieza a conectarse enseguida
router.post(
  '/',
  requireRol('admin'),
  a(async (req, res) => {
    const d = datosConexion(req.body || {});
    if (d.error) return res.status(400).json({ error: d.error });
    if (await enUso(d.ip, d.puerto)) return res.status(409).json({ error: 'Ya hay un equipo cargado con esa IP y puerto' });

    const equipo = await Dispositivo.create({
      ...d,
      sn: gestor4370.snProvisorio(d.ip, d.puerto),
      nombre: String(req.body.nombre || '').trim() || `Reloj ${d.ip}`,
      modelo: String(req.body.modelo || '').trim() || undefined,
      modo: '4370',
      habilitado: req.body.habilitado !== false,
      horaAutomatica: req.body.horaAutomatica === true,
    });
    await Auditoria.registrar(req, 'agregar_equipo', 'dispositivo', equipo.sn, { ...d, modelo: equipo.modelo });
    await gestor4370.recargar(equipo._id);
    res.status(201).json(equipo);
  })
);

// Editar nombre, modelo y (en equipos 4370) los datos de conexión o habilitarlo/deshabilitarlo
router.put(
  '/:sn',
  requireRol('admin'),
  a(buscarEquipo),
  a(async (req, res) => {
    const eq = req.equipo;
    if (req.body.nombre !== undefined) eq.nombre = String(req.body.nombre || '').trim() || eq.nombre;
    if (req.body.modelo !== undefined) eq.modelo = String(req.body.modelo || '').trim() || undefined;

    if (eq.modo === '4370') {
      const d = datosConexion(req.body, eq);
      if (d.error) return res.status(400).json({ error: d.error });
      if ((d.ip !== eq.ip || d.puerto !== (eq.puerto || 4370)) && (await enUso(d.ip, d.puerto, eq._id))) {
        return res.status(409).json({ error: 'Ya hay otro equipo cargado con esa IP y puerto' });
      }
      if (d.formato !== eq.formato) eq.formatoDetectado = undefined; // que se vuelva a detectar
      Object.assign(eq, d);
      if (typeof req.body.habilitado === 'boolean') eq.habilitado = req.body.habilitado;
      if (typeof req.body.horaAutomatica === 'boolean') eq.horaAutomatica = req.body.horaAutomatica;
    }
    await eq.save();
    await Auditoria.registrar(req, 'editar_equipo', 'dispositivo', eq.sn, req.body);
    if (eq.modo === '4370') await gestor4370.recargar(eq._id);
    res.json(eq);
  })
);

// Quitar un equipo del sistema. Las fichadas que ya trajo se conservan.
router.delete(
  '/:sn',
  requireRol('admin'),
  a(buscarEquipo),
  a(async (req, res) => {
    const eq = req.equipo;
    await gestor4370.detener(eq._id);
    await Promise.all([
      Comando.updateMany({ deviceSn: eq.sn, estado: { $in: ['pendiente', 'enviado'] } }, { $set: { estado: 'error', retorno: -9999 } }),
      UsuarioReloj.deleteMany({ deviceSn: eq.sn }),
    ]);
    await Dispositivo.deleteOne({ _id: eq._id });
    await Auditoria.registrar(req, 'quitar_equipo', 'dispositivo', eq.sn, { ip: eq.ip, nombre: eq.nombre });
    res.json({ ok: true });
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
    // Cómo debería figurar el nombre en el reloj (los equipos viejos guardan solo 8 letras)
    const nombreEsperado = (n) =>
      req.equipo.modo === '4370'
        ? nombreParaReloj(n, req.equipo.formatoDetectado === 'viejo' ? 8 : 24)
        : n.slice(0, 24).trim();

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
          nombreDistinto: (u.nombre || '') !== nombreEsperado(c.nombre),
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
    if (accion === 'poner-hora' && req.equipo.modo !== '4370') {
      return res.status(400).json({ error: 'Este reloj usa ADMS: la hora se pone desde el menú del equipo' });
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
    gestor4370.despertar(req.equipo.sn); // que se ejecute ya, sin esperar el próximo ciclo
    res.json(cmd);
  })
);

module.exports = router;
