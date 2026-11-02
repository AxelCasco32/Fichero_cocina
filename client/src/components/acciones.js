// Acciones sobre fichadas que se usan desde varias pantallas
import { api } from '../api.js';
import { hora } from '../util.js';

// Pide el motivo y anula. Devuelve la fichada anulada o null si se canceló.
export async function anularFichada(f) {
  const motivo = window.prompt(
    `Anular la fichada de ${f.nombre || `PIN ${f.pin}`} (${hora(f.fecha)}).\n\nNo se borra: queda registrada como anulada y deja de contar.\n\nMotivo:`
  );
  if (motivo === null) return null;
  return api(`/fichadas/${f._id}/anular`, { method: 'POST', body: { motivo } });
}

export const restaurarFichada = (f) => api(`/fichadas/${f._id}/restaurar`, { method: 'POST' });
