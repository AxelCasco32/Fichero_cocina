// Estado de los relojes compartido por el menú lateral y el monitor:
// se pide al servidor cada 30 s y se actualiza en vivo con cada señal de un equipo.
import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { api } from './api.js';
import { useEvento } from './socket.js';

const EN_LINEA_MS = 120 * 1000; // igual que ONLINE_SEGUNDOS del servidor

const Ctx = createContext({ equipos: [], recargar: () => {} });

export function EquiposProvider({ children }) {
  const [equipos, setEquipos] = useState([]);
  const recargar = useCallback(() => {
    api('/dispositivos')
      .then(setEquipos)
      .catch(() => {});
  }, []);

  useEffect(() => {
    recargar();
    const t = setInterval(recargar, 30000);
    return () => clearInterval(t);
  }, [recargar]);

  useEvento('dispositivo', (d) => {
    setEquipos((prev) => prev.map((e) => (e.sn === d.sn ? { ...e, ultimaConexion: d.ultimaConexion } : e)));
  });

  return <Ctx.Provider value={{ equipos, recargar }}>{children}</Ctx.Provider>;
}

export const useEquipos = () => useContext(Ctx);

export const activos = (lista) => lista.filter((e) => e.habilitado !== false);
export const enLinea = (e, ahora = Date.now()) =>
  !!e.ultimaConexion && ahora - new Date(e.ultimaConexion).getTime() < EN_LINEA_MS;

// "hace 4 s", "hace 3 min", "hace 2 h"
export function hace(fecha, ahora = Date.now()) {
  if (!fecha) return 'sin señal';
  const s = Math.max(0, Math.round((ahora - new Date(fecha).getTime()) / 1000));
  if (s < 60) return `hace ${s} s`;
  if (s < 3600) return `hace ${Math.round(s / 60)} min`;
  if (s < 86400) return `hace ${Math.round(s / 3600)} h`;
  return `hace ${Math.round(s / 86400)} d`;
}

// Reloj que se actualiza cada `ms` (para textos tipo "hace 4 s")
export function useAhora(ms = 1000) {
  const [ahora, setAhora] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setAhora(Date.now()), ms);
    return () => clearInterval(t);
  }, [ms]);
  return ahora;
}
