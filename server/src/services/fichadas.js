const Comensal = require('../models/Comensal');
const Fichada = require('../models/Fichada');
const SERVICIOS = require('../catalogos/servicios');
const { dedupSegundos } = require('../config');
const { parseFechaEquipo, partesLocales } = require('../utils/fecha');
const tiempoReal = require('../tiempoReal');

const NO_ANULADA = { anulada: { $ne: true } };

function servicioEnHorario(hhmm) {
  return SERVICIOS.find((s) => hhmm >= s.desde && hhmm <= s.hasta) || null;
}

// Decide si la persona puede retirar comida en ese momento.
// `servicioForzado` permite a la carga manual indicar el servicio aunque esté fuera de horario.
async function evaluar(pin, fecha, servicioForzado) {
  const { dia, hhmm } = partesLocales(fecha);
  const servicio = servicioForzado
    ? SERVICIOS.find((s) => s.codigo === servicioForzado) || null
    : servicioEnHorario(hhmm);
  const base = { dia, servicio: servicio ? servicio.codigo : null };

  const comensal = await Comensal.findOne({ pin });
  if (!comensal) return { ...base, resultado: 'desconocido' };

  const r = { ...base, comensal: comensal._id, nombre: comensal.nombre };
  if (!comensal.activo || !comensal.autorizado) return { ...r, resultado: 'no_autorizado' };
  if (!servicio) return { ...r, resultado: 'fuera_de_horario' };
  if (!comensal.servicios.includes(servicio.codigo)) return { ...r, resultado: 'servicio_no_habilitado' };

  const yaRetiro = await Fichada.exists({ pin, dia, servicio: servicio.codigo, resultado: 'autorizado', ...NO_ANULADA });
  if (yaRetiro) return { ...r, resultado: 'ya_retiro' };

  return { ...r, resultado: 'autorizado' };
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
    } catch (err) {
      if (err.code !== 11000) throw err; // 11000 = duplicada, se ignora
    }
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
