// Endpoints que llama el MB360 en modo ADMS / Push (protocolo /iclock).
//
//  GET  /iclock/cdata?SN=..&options=all  -> handshake: le decimos qué datos mandar
//  POST /iclock/cdata?SN=..&table=ATTLOG -> fichadas
//  POST /iclock/cdata?SN=..&table=OPERLOG-> usuarios, huellas, rostros, eventos
//  GET  /iclock/getrequest?SN=..         -> el equipo pregunta si hay comandos
//  POST /iclock/devicecmd?SN=..          -> el equipo responde cómo le fue con cada comando

const express = require('express');
const Dispositivo = require('../models/Dispositivo');
const Comensal = require('../models/Comensal');
const Comando = require('../models/Comando');
const Plantilla = require('../models/Plantilla');
const UsuarioReloj = require('../models/UsuarioReloj');
const { deviceTzHours, snPermitidos } = require('../config');
const { parseAttlog, parseRegistros, parseRespuestasComando, parseInfo, pinDe } = require('./parser');
const { registrarFichadas } = require('../services/fichadas');
const tiempoReal = require('../tiempoReal');

const router = express.Router();

// El reloj manda texto plano con distintos Content-Type: aceptamos todo como texto
router.use(express.text({ type: () => true, limit: '20mb' }));

const texto = (res, cuerpo, status = 200) => res.status(status).type('text/plain').send(cuerpo);

// Identifica el equipo, verifica que esté permitido y actualiza su "última conexión"
router.use(async (req, res, next) => {
  const sn = String(req.query.SN || '').trim();
  if (!sn) return texto(res, 'ERROR: falta SN', 400);
  if (snPermitidos.length && !snPermitidos.includes(sn)) {
    console.warn(`[adms] equipo no permitido: ${sn}`);
    return texto(res, 'ERROR: equipo no autorizado', 403);
  }
  try {
    const cambios = { ultimaConexion: new Date() };
    if (req.query.INFO) Object.assign(cambios, parseInfo(req.query.INFO));
    const anterior = await Dispositivo.findOneAndUpdate(
      { sn },
      { $set: cambios, $setOnInsert: { sn } },
      { upsert: true, new: false }
    );
    if (!anterior) console.log(`[adms] equipo nuevo registrado: ${sn}`);
    req.sn = sn;
    // Si este reloj se maneja por el puerto 4370, ADMS no le manda comandos (los ejecuta el conector)
    if (anterior?.modo === '4370') {
      if (req.method === 'GET') return texto(res, 'OK');
      return texto(res, 'OK: 0');
    }
    // Si el equipo nunca hizo el saludo inicial (cdata?options=all), no sabe que tiene que
    // subir las fichadas. Le mandamos CHECK, que lo obliga a pedir la configuración de nuevo.
    if (!anterior?.handshakeEn && req.path.startsWith('/getrequest')) await pedirHandshake(sn);
    tiempoReal.emitir('dispositivo', { sn, ultimaConexion: cambios.ultimaConexion });
    next();
  } catch (err) {
    next(err);
  }
});

async function pedirHandshake(sn) {
  // Como mucho un CHECK automático cada 30 minutos (aunque el anterior haya fallado)
  const yaPedido = await Comando.exists({
    deviceSn: sn,
    tipo: 'actualizar',
    $or: [
      { estado: { $in: ['pendiente', 'enviado'] } },
      { createdAt: { $gt: new Date(Date.now() - 30 * 60 * 1000) } },
    ],
  });
  if (!yaPedido) {
    await Comando.encolar({ deviceSn: sn, texto: 'CHECK', tipo: 'actualizar' });
    console.log(`[adms] ${sn} nunca pidió la configuración: se le envía CHECK`);
  }
}

// --- Handshake y recepción de datos ---
router.get(['/cdata', '/cdata.aspx'], async (req, res) => {
  const disp = await Dispositivo.findOneAndUpdate(
    { sn: req.sn },
    { $set: { handshakeEn: new Date() } },
    { new: true }
  ).lean();
  console.log(`[adms] ${req.sn} pidió la configuración (saludo inicial) ✔`);
  const opciones = [
    `GET OPTION FROM: ${req.sn}`,
    `ATTLOGStamp=${disp?.attlogStamp || 'None'}`,
    `OPERLOGStamp=${disp?.operlogStamp || 'None'}`,
    'ATTPHOTOStamp=None',
    'ErrorDelay=30',
    'Delay=10', // cada cuántos segundos consulta getrequest
    'TransTimes=00:00;14:05',
    'TransInterval=1',
    'TransFlag=TransData AttLog OpLog EnrollUser ChgUser EnrollFP ChgFP FACE UserPic',
    `TimeZone=${deviceTzHours}`,
    'Realtime=1', // manda cada fichada en el momento
    'Encrypt=None',
  ];
  texto(res, opciones.join('\r\n'));
});

router.post(['/cdata', '/cdata.aspx'], async (req, res, next) => {
  try {
    const tabla = String(req.query.table || '').toUpperCase();
    const stamp = req.query.Stamp;
    let cantidad = 0;

    if (tabla === 'ATTLOG') {
      const registros = parseAttlog(req.body);
      cantidad = await registrarFichadas(req.sn, registros);
      if (stamp) await Dispositivo.updateOne({ sn: req.sn }, { attlogStamp: stamp });
      console.log(`[adms] ${req.sn} ATTLOG: ${registros.length} recibidas, ${cantidad} nuevas`);
    } else if (tabla === 'OPERLOG' || tabla === 'BIODATA') {
      cantidad = await procesarRegistros(req.sn, parseRegistros(req.body, tabla));
      if (stamp && tabla === 'OPERLOG') await Dispositivo.updateOne({ sn: req.sn }, { operlogStamp: stamp });
    }
    // ATTPHOTO, options, etc.: se aceptan y se ignoran
    texto(res, `OK: ${cantidad}`);
  } catch (err) {
    next(err);
  }
});

async function procesarRegistros(sn, registros) {
  let n = 0;
  for (const { tipo, campos } of registros) {
    const pin = pinDe(campos);
    if (!pin) continue;

    if (tipo === 'USER') {
      // Actualizamos la "foto" de usuarios del reloj
      await UsuarioReloj.updateOne(
        { deviceSn: sn, pin },
        {
          $set: {
            nombre: (campos.Name || '').trim(),
            tarjeta: campos.Card || undefined,
            privilegio: Number(campos.Pri) || 0,
            vistoEn: new Date(),
          },
        },
        { upsert: true }
      );
      // Usuario que existe en el reloj: si no está en la base, lo creamos deshabilitado
      // para que la cocina lo revise (la base es la fuente de verdad).
      const res = await Comensal.updateOne(
        { pin },
        {
          $setOnInsert: {
            pin,
            nombre: (campos.Name || '').trim() || `Usuario ${pin}`,
            tarjeta: campos.Card || undefined,
            autorizado: false,
            pendienteRevision: true,
          },
        },
        { upsert: true }
      );
      if (res.upsertedCount) console.log(`[adms] usuario ${pin} encontrado en el reloj y creado para revisión`);
      n++;
    } else if (['FP', 'FACE', 'BIODATA'].includes(tipo)) {
      const clave = String(campos.FID ?? campos.No ?? campos.Index ?? '0');
      await Plantilla.updateOne(
        { pin, tipo, clave },
        { $set: { datos: campos, deviceSn: sn } },
        { upsert: true }
      );
      await Comensal.updateOne({ pin }, { tieneBiometria: true });
      await UsuarioReloj.updateOne({ deviceSn: sn, pin }, { $set: { tieneBiometria: true, vistoEn: new Date() } });
      n++;
    }
    // OPLOG (eventos del equipo) se ignora por ahora
  }
  return n;
}

// --- Cola de comandos ---
const REENVIAR_TRAS_MS = 5 * 60 * 1000;
const MAX_INTENTOS = 5;

router.get(['/getrequest', '/getrequest.aspx'], async (req, res, next) => {
  try {
    const hace5min = new Date(Date.now() - REENVIAR_TRAS_MS);
    const comandos = await Comando.find({
      deviceSn: req.sn,
      intentos: { $lt: MAX_INTENTOS },
      $or: [{ estado: 'pendiente' }, { estado: 'enviado', enviadoEn: { $lt: hace5min } }],
    })
      .sort({ cmdId: 1 })
      .limit(1); // de a uno: algunos firmwares no responden si reciben varios juntos

    if (!comandos.length) return texto(res, 'OK');
    console.log(`[adms] ${req.sn} <- comando ${comandos[0].cmdId}: ${comandos[0].texto.slice(0, 80)}`);

    await Comando.updateMany(
      { _id: { $in: comandos.map((c) => c._id) } },
      { $set: { estado: 'enviado', enviadoEn: new Date() }, $inc: { intentos: 1 } }
    );
    // Cada comando termina en salto de línea: algunos firmwares no lo reconocen sin él
    texto(res, comandos.map((c) => `C:${c.cmdId}:${c.texto}\n`).join(''));
  } catch (err) {
    next(err);
  }
});

router.post(['/devicecmd', '/devicecmd.aspx'], async (req, res, next) => {
  try {
    console.log(`[adms] ${req.sn} -> respuesta: ${String(req.body || '').trim().slice(0, 200)}`);
    for (const r of parseRespuestasComando(req.body)) {
      const cmd = await Comando.findOneAndUpdate(
        { cmdId: r.cmdId, deviceSn: req.sn },
        { estado: r.retorno >= 0 ? 'ok' : 'error', retorno: r.retorno, respondidoEn: new Date() },
        { new: true }
      );
      if (!cmd) continue;
      if (cmd.estado === 'ok') await despuesDeComando(req.sn, cmd);
      tiempoReal.emitir('comando', cmd.toJSON());
    }
    // La respuesta a INFO trae datos del equipo en líneas "Clave=valor"
    const info = parseInfoDetallada(req.body);
    if (Object.keys(info).length) await Dispositivo.updateOne({ sn: req.sn }, { $set: { info } });
    texto(res, 'OK');
  } catch (err) {
    next(err);
  }
});

// Mantiene la "foto" del reloj al día cuando el equipo confirma nuestros comandos
async function despuesDeComando(sn, cmd) {
  if (cmd.tipo === 'alta' && cmd.pin) {
    const nombre = (/\tName=([^\t]*)/.exec(cmd.texto) || [])[1];
    await UsuarioReloj.updateOne(
      { deviceSn: sn, pin: cmd.pin },
      { $set: { nombre, vistoEn: new Date() } },
      { upsert: true }
    );
  } else if (cmd.tipo === 'biometria' && cmd.pin) {
    await UsuarioReloj.updateOne({ deviceSn: sn, pin: cmd.pin }, { $set: { tieneBiometria: true } });
  } else if (cmd.tipo === 'baja' && cmd.pin) {
    await UsuarioReloj.deleteOne({ deviceSn: sn, pin: cmd.pin });
  } else if (cmd.tipo === 'consulta' && cmd.enviadoEn) {
    // Consulta completa terminada: quien no apareció desde que se pidió ya no está en el reloj
    await UsuarioReloj.deleteMany({ deviceSn: sn, vistoEn: { $lt: cmd.enviadoEn } });
    await Dispositivo.updateOne({ sn }, { ultimaLecturaUsuarios: new Date() });
  }
}

function parseInfoDetallada(cuerpo) {
  const info = {};
  for (const linea of String(cuerpo || '').split(/\r?\n/)) {
    const l = linea.replace(/^~/, '').trim();
    if (!l || l.startsWith('ID=')) continue;
    const i = l.indexOf('=');
    if (i > 0) info[l.slice(0, i)] = l.slice(i + 1);
  }
  return info;
}

router.all(['/ping', '/ping.aspx'], (_req, res) => texto(res, 'OK'));

// Cualquier error en ADMS: lo registramos y respondemos texto (el equipo reintenta)
router.use((err, req, res, _next) => {
  console.error('[adms] error', req.method, req.originalUrl, err);
  texto(res, 'ERROR', 500);
});

module.exports = router;
