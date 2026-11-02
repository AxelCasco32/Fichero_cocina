// Conexión en vivo con el servidor (fichadas, estado del equipo, comandos)
import { useEffect, useRef, useState } from 'react';
import { io } from 'socket.io-client';
import { apiBase } from './api.js';

let socket = null;
const oyentesEstado = new Set();

export function conectarSocket(token) {
  desconectarSocket();
  socket = io(apiBase || undefined, { auth: { token } });
  const avisar = () => oyentesEstado.forEach((fn) => fn(socket?.connected || false));
  socket.on('connect', avisar);
  socket.on('disconnect', avisar);
  socket.on('connect_error', avisar);
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
    if (!socket) return undefined;
    const fn = (datos) => ref.current(datos);
    socket.on(evento, fn);
    return () => socket?.off(evento, fn);
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
