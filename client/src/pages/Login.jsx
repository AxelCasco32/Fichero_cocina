import { useState } from 'react';
import { useAuth } from '../auth.jsx';

export default function Login() {
  const { login } = useAuth();
  const [usuario, setUsuario] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [enviando, setEnviando] = useState(false);

  async function enviar(e) {
    e.preventDefault();
    setError('');
    setEnviando(true);
    try {
      await login(usuario, password);
    } catch (err) {
      setError(err.message);
    } finally {
      setEnviando(false);
    }
  }

  return (
    <div className="login">
      <form onSubmit={enviar}>
        <div>
          <h1>Comedor</h1>
          <small>Ingresá con tu usuario de cocina</small>
        </div>
        {error && <div className="error">{error}</div>}
        <label className="campo">
          Usuario
          <input value={usuario} onChange={(e) => setUsuario(e.target.value)} autoFocus autoComplete="username" />
        </label>
        <label className="campo">
          Contraseña
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password"
          />
        </label>
        <button className="primario" disabled={enviando || !usuario || !password}>
          {enviando ? 'Ingresando…' : 'Ingresar'}
        </button>
      </form>
    </div>
  );
}
