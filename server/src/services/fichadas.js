const Comensal = require('../models/Comensal');
const Fichada = require('../models/Fichada');
const SERVICIOS = require('../catalogos/servicios');
const { dedupSegundos, maxRetirosDia } = require('../config');
const { parseFechaEquipo, partesLocales } = require('../utils/fecha');
const tiempoReal = require('../tiempoReal');

const NO_ANULADA = { anulada: { $ne: true } };

function servicioEnHorario(hhmm) {
  return SERVICIOS.find((s) => hhmm >= s.desde && hhmm <= s.hasta) || null;
}

// Próximo servicio después de esa hora (para explicar un "fuera de horario")
function proximoServicio(hhmm) {
  const ordenados = [...SERVICIOS].sort((x, y) => x.desde.localeCompare(y.desde));
  const s = ordenados.find((x) => x.desde > hhmm);
  return s ? `${s.nombre} desde las ${s.desde}` : ordenados[0] ? `${ordenados[0].nombre} de mañana, desde las ${ordenados[0].desde}` : null;
}

// Decide si la persona puede retirar comida en ese momento.
// Devuelve el resultado y un `detalle` en palabras (lo que se muestra en el monitor).
// `servicioForzado` permite a la carga manual indicar el servicio aunque esté fuera de horario.
async function evaluar(pin, fecha, servicioForzado) {
  const { dia, hhmm } = partesLocales(fecha);
  const servicio = servicioForzado
    ? SERVICIOS.find((s) => s.codigo === servicioForzado) || null
    : servicioEnHorario(hhmm);
  const base = { dia, servicio: servicio ? servicio.codigo : null };

  const comensal = await Comensal.findOne({ pin });
  if (!comensal) {
    return { ...base, resultado: 'desconocido', detalle: `No está registrado en el sistema: el PIN ${pin} no está cargado como comensal` };
  }

  const r = { ...base, comensal: comensal._id, nombre: comensal.nombre };
  if (!comensal.activo) return { ...r, resultado: 'no_autorizado', detalle: 'Está dado de baja en el sistema' };
  if (comensal.pendienteRevision) {
    return { ...r, resultado: 'no_autorizado', detalle: 'Se enroló en el reloj pero todavía no fue habilitado en el sistema' };
  }
  if (!comensal.autorizado) return { ...r, resultado: 'no_autorizado', detalle: 'Está deshabilitado para retirar comida' };
  if (!servicio) {
    const prox = proximoServicio(hhmm);
    return { ...r, resultado: 'fuera_de_horario', detalle: `A las ${hhmm} no hay ningún servicio${prox ? ` (próximo: ${prox})` : ''}` };
  }
  if (!comensal.servicios.includes(servicio.codigo)) {
    return { ...r, resultado: 'servicio_no_habilitado', detalle: `No tiene habilitado el servicio de ${servicio.nombre.toLowerCase()}` };
  }

  const anterior = await Fichada.findOne(
    { pin, dia, servicio: servicio.codigo, resultado: 'autorizado', ...NO_ANULADA },
    'fecha'
  ).sort({ fecha: 1 });
  if (anterior) {
    return {
      ...r,
      resultado: 'ya_retiro',
      detalle: `Ya retiró el ${servicio.nombre.toLowerCase()} hoy a las ${partesLocales(anterior.fecha).hhmm}`,
    };
  }

  const retirosHoy = await Fichada.countDocuments({ pin, dia, resultado: 'autorizado', ...NO_ANULADA });
  if (maxRetirosDia > 0 && retirosHoy >= maxRetirosDia) {
    return {
      ...r,
      resultado: 'limite_diario',
      detalle: `Superó el máximo de retiros por día: ya retiró ${retirosHoy} ${retirosHoy === 1 ? 'vez' : 'veces'} hoy (máximo ${maxRetirosDia})`,
    };
  }

  const n = retirosHoy + 1;
  return {
    ...r,
    resultado: 'autorizado',
    detalle: `Puede retirar el ${servicio.nombre.toLowerCase()}${maxRetirosDia > 0 ? ` · retiro ${n} de ${maxRetirosDia} del día` : ''}`,
  };
}

// Procesa las fichadas que llegan del reloj (en orden cronológico).
// Devuelve cuántas se guardaron.
// `opciones.emitirDesde`: solo avisa en vivo las fichadas posteriores a esa fecha (para no
// inundar el monitor al importar el historial del reloj).
async function registrarFichadas(deviceSn, registros, opciones = {}) {
  const ordenados = registros
    .map((r) => ({ ...r, fecha: r.fecha instanceof Date ? r.fecha : parseFechaEquipo(r.fechaTexto) }))
    .filter((r) => r.fecha)
    .sort((a, b) => a.fecha - b.fecha);

  let guardadas = 0;
  let sinAviso = 0; // historial: se guarda sin avisar al monitor
  for (const r of ordenados) {
    // Reenvío exacto de una fichada ya guardada
    if (await Fichada.exists({ deviceSn, pin: r.pin, fecha: r.fecha })) continue;

    // Doble toque: la misma persona fichó hace menos de N segundos
    const ventana = new Date(r.fecha.getTime() - dedupSegundos * 1000);
    if (await Fichada.exists({ pin: r.pin, fecha: { $gte: ventana, $lte: r.fecha }, ...NO_ANULADA })) continue;

    const evaluacion = await evaluar(r.pin, r.fecha);
    // Si no está en la base pero el reloj sabe su nombre, lo mostramos igual
    if (!evaluacion.nombre && opciones.nombres?.get(r.pin)) evaluacion.nombre = opciones.nombres.get(r.pin);
    try {
      const doc = await Fichada.create({
        pin: r.pin,
        fecha: r.fecha,
        deviceSn,
        estado: Number.isFinite(r.estado) ? r.estado : undefined,
        verificacion: Number.isFinite(r.verificacion) ? r.verificacion : undefined,
        ...evaluacion,
      });
      guardadas++;
      if (!opciones.emitirDesde || r.fecha >= opciones.emitirDesde) tiempoReal.emitir('fichada', doc.toJSON());
      else sinAviso++;
    } catch (err) {
      if (err.code !== 11000) throw err; // 11000 = duplicada, se ignora
    }
  }
  if (sinAviso) {
    console.log(`[fichadas] ${sinAviso} guardadas como historial, sin aviso en vivo (fecha del reloj de hace más de 10 min)`);
  }
  return guardadas;
}

// Fichada cargada a mano desde la web (por ejemplo, el reloj no reconoció a la persona)
async function registrarManual({ pin, fecha, servicio, motivo, operador }) {
  const evaluacion = await evaluar(pin, fecha, servicio || undefined);
  const doc = await Fichada.create({
    pin,
    fecha,
    deviceSn: 'MANUAL',
    origen: 'manual',
    cargadaPor: operador,
    motivo,
    ...evaluacion,
  });
  tiempoReal.emitir('fichada', doc.toJSON());
  return doc;
}

module.exports = { evaluar, registrarFichadas, registrarManual, servicioEnHorario, NO_ANULADA };
