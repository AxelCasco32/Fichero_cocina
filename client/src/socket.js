// Conexión en vivo con el servidor (fichadas, estado del equipo, comandos)
import { useEffect, useRef, useState } from 'react';
import { io } from 'socket.io-client';
import { apiBase } from './api.js';

let socket = null;
const oyentesEstado = new Set();
// Pantallas suscriptas a cada evento. Se guardan acá (y no en el socket) para que sigan
// escuchando aunque la conexión se cree después de abrir la pantalla o se vuelva a crear.
const oyentes = new Map(); // evento -> Set(fn)

export function conectarSocket(token) {
  desconectarSocket();
  socket = io(apiBase || undefined, { auth: { token } });
  const avisar = () => oyentesEstado.forEach((fn) => fn(socket?.connected || false));
  socket.on('connect', avisar);
  socket.on('disconnect', avisar);
  socket.on('connect_error', (err) => {
    console.warn('[tiempo real] no se pudo conectar:', err.message);
    avisar();
  });
  socket.onAny((evento, datos) => oyentes.get(evento)?.forEach((fn) => fn(datos)));
}

export function desconectarSocket() {
  if (socket) socket.disconnect();
  socket = null;
  oyentesEstado.forEach((fn) => fn(false));
}

// Escucha un evento mientras el componente está montado
export function useEvento(evento, handler) {
  const ref = useRef(handler);
  ref.current = handler;
  useEffect(() => {
    const fn = (datos) => ref.current(datos);
    if (!oyentes.has(evento)) oyentes.set(evento, new Set());
    oyentes.get(evento).add(fn);
    return () => oyentes.get(evento)?.delete(fn);
  }, [evento]);
}

export function useConectado() {
  const [ok, setOk] = useState(socket?.connected || false);
  useEffect(() => {
    oyentesEstado.add(setOk);
    return () => oyentesEstado.delete(setOk);
  }, []);
  return ok;
}
