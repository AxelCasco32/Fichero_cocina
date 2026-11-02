export const TZ = 'America/Argentina/Buenos_Aires';

// Cómo se muestra cada resultado de fichada
export const RESULTADOS = {
  autorizado: { texto: 'Autorizado', tono: 'ok' },
  ya_retiro: { texto: 'Ya retiró', tono: 'warn' },
  no_autorizado: { texto: 'No autorizado', tono: 'err' },
  servicio_no_habilitado: { texto: 'Servicio no habilitado', tono: 'err' },
  desconocido: { texto: 'No registrado', tono: 'err' },
  fuera_de_horario: { texto: 'Fuera de horario', tono: 'muted' },
};

export const textoResultado = (r) => RESULTADOS[r]?.texto || r;
export const tonoResultado = (r) => RESULTADOS[r]?.tono || 'muted';

export const hora = (d) =>
  d
    ? new Date(d).toLocaleTimeString('es-AR', {
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hourCycle: 'h23',
        timeZone: TZ,
      })
    : '';

export const fechaHora = (d) =>
  d
    ? new Date(d).toLocaleString('es-AR', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        hourCycle: 'h23',
        timeZone: TZ,
      })
    : '—';

export const hoy = () => new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(new Date());

// Descarga una lista de objetos como CSV (abre bien en Excel)
export function descargarCSV(nombre, filas, columnas) {
  const esc = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const lineas = [columnas.map((c) => esc(c.titulo)).join(';')];
  for (const f of filas) lineas.push(columnas.map((c) => esc(c.valor(f))).join(';'));
  const blob = new Blob(['﻿' + lineas.join('\r\n')], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = nombre;
  a.click();
  URL.revokeObjectURL(a.href);
}
