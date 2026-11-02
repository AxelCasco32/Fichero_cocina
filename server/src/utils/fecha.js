const { tz, tzOffset } = require('../config');

// El MB360 manda la hora local como texto: "2026-10-30 12:30:05" (sin zona).
// La convertimos a Date (UTC interno) aplicando el offset local.
function parseFechaEquipo(texto) {
  const m = /^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}:\d{2})$/.exec(String(texto || '').trim());
  if (!m) return null;
  const d = new Date(`${m[1]}T${m[2]}${tzOffset}`);
  return Number.isNaN(d.getTime()) ? null : d;
}

const formateador = new Intl.DateTimeFormat('en-CA', {
  timeZone: tz,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hourCycle: 'h23',
});

// Devuelve { dia: 'YYYY-MM-DD', hhmm: 'HH:MM' } en hora local
function partesLocales(date) {
  const p = Object.fromEntries(formateador.formatToParts(date).map((x) => [x.type, x.value]));
  return { dia: `${p.year}-${p.month}-${p.day}`, hhmm: `${p.hour}:${p.minute}` };
}

// Inicio y fin de un día local, como Date
function rangoDia(diaTexto) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(diaTexto || '')) return null;
  const desde = new Date(`${diaTexto}T00:00:00${tzOffset}`);
  const hasta = new Date(desde.getTime() + 24 * 60 * 60 * 1000);
  return { desde, hasta };
}

function hoy() {
  return partesLocales(new Date()).dia;
}

module.exports = { parseFechaEquipo, partesLocales, rangoDia, hoy };
