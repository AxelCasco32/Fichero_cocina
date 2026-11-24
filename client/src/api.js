// Cliente de la API: agrega el token y convierte errores en excepciones con el mensaje del servidor
const BASE = import.meta.env.VITE_API_URL || '';

// "Mantener mi sesión iniciada": el token va a localStorage (sobrevive al cerrar el navegador);
// si no, a sessionStorage (se borra al cerrarlo).
function leerToken() {
  try {
    return localStorage.getItem('token') || sessionStorage.getItem('token');
  } catch {
    return null;
  }
}

let token = leerToken();

export function setToken(t, { recordar = true } = {}) {
  token = t;
  try {
    localStorage.removeItem('token');
    sessionStorage.removeItem('token');
    if (t) (recordar ? localStorage : sessionStorage).setItem('token', t);
  } catch {
    /* sin almacenamiento: la sesión dura lo que dure la pestaña */
  }
}

export const getToken = () => token;
export const apiBase = BASE;

export async function api(ruta, { method = 'GET', body } = {}) {
  const r = await fetch(`${BASE}/api${ruta}`, {
    method,
    headers: {
      ...(body ? { 'Content-Type': 'application/json' } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const datos = await r.json().catch(() => ({}));
  if (r.status === 401 && ruta !== '/auth/login') {
    setToken(null);
    window.dispatchEvent(new Event('sesion-vencida'));
  }
  if (!r.ok) throw new Error(datos.error || `Error ${r.status}`);
  return datos;
}
