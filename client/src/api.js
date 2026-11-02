// Cliente de la API: agrega el token y convierte errores en excepciones con el mensaje del servidor
const BASE = import.meta.env.VITE_API_URL || '';

function leerToken() {
  try {
    return localStorage.getItem('token');
  } catch {
    return null;
  }
}

let token = leerToken();

export function setToken(t) {
  token = t;
  try {
    if (t) localStorage.setItem('token', t);
    else localStorage.removeItem('token');
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
