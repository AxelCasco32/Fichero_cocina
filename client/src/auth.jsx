// Sesión del operador: login, logout y datos del usuario actual
import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { api, getToken, setToken } from './api.js';
import { conectarSocket, desconectarSocket } from './socket.js';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [operador, setOperador] = useState(null);
  const [cargando, setCargando] = useState(!!getToken());

  const logout = useCallback(() => {
    setToken(null);
    desconectarSocket();
    setOperador(null);
  }, []);

  // Al abrir la página, si hay token guardado, recuperamos la sesión
  useEffect(() => {
    if (!getToken()) return;
    api('/auth/yo')
      .then((op) => {
        setOperador(op);
        conectarSocket(getToken());
      })
      .catch(() => setToken(null))
      .finally(() => setCargando(false));
  }, []);

  useEffect(() => {
    window.addEventListener('sesion-vencida', logout);
    return () => window.removeEventListener('sesion-vencida', logout);
  }, [logout]);

  async function login(usuario, password) {
    const { token, operador: op } = await api('/auth/login', { method: 'POST', body: { usuario, password } });
    setToken(token);
    conectarSocket(token);
    setOperador(op);
  }

  return (
    <AuthContext.Provider value={{ operador, cargando, login, logout, esAdmin: operador?.rol === 'admin' }}>
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);
