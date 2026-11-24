// Pantalla de ingreso de BioCook: panel de marca animado a la izquierda (se oculta en pantallas
// chicas) y formulario a la derecha. Las animaciones son de CSS (Login.css) y respetan
// "reducir movimiento" del sistema.
import { useEffect, useState } from 'react';
import { apiBase } from '../api.js';
import { useAuth } from '../auth.jsx';
import './Login.css';

function Logo({ tamano = 40 }) {
  return <img className="bc-logo" src="/logo.svg" alt="" width={tamano} height={tamano} />;
}

function Icono({ nombre }) {
  const trazos = {
    usuario: (
      <>
        <circle cx="12" cy="8" r="4" />
        <path d="M4.5 20c1.4-3.6 4.2-5.5 7.5-5.5s6.1 1.9 7.5 5.5" />
      </>
    ),
    candado: (
      <>
        <rect x="4" y="10" width="16" height="11" rx="3" />
        <path d="M8 10V7a4 4 0 0 1 8 0v3M12 14v3" />
      </>
    ),
    ojo: (
      <>
        <path d="M2.5 12s3.5-6 9.5-6 9.5 6 9.5 6-3.5 6-9.5 6-9.5-6-9.5-6Z" />
        <circle cx="12" cy="12" r="2.5" />
      </>
    ),
    ojoTachado: (
      <path d="m3 3 18 18M10.6 6.1A10.8 10.8 0 0 1 12 6c6 0 9.5 6 9.5 6a14.7 14.7 0 0 1-2.1 2.8M6.6 6.6C4 8.3 2.5 12 2.5 12s3.5 6 9.5 6c1.2 0 2.3-.2 3.3-.6M9.8 9.8a3 3 0 0 0 4.4 4.4" />
    ),
    flecha: <path d="M5 12h14M14 7l5 5-5 5" />,
    escudo: (
      <>
        <path d="M12 3 5 6v5c0 4.5 2.8 8.2 7 10 4.2-1.8 7-5.5 7-10V6l-7-3Z" />
        <path d="m9 12 2 2 4-4" />
      </>
    ),
    rayo: <path d="M13 3 5 13h6l-1 8 8-10h-6l1-8Z" />,
  };
  return (
    <svg
      className="icon"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {trazos[nombre]}
    </svg>
  );
}

// Ilustración: huella escaneándose, con tarjetitas flotantes
function VisualBiometrico() {
  return (
    <div className="biometric-visual" aria-hidden="true">
      <div className="orbital orbital-one" />
      <div className="orbital orbital-two" />
      <div className="scan-card">
        <div className="scan-corners" />
        <svg className="fingerprint" viewBox="0 0 180 220" fill="none">
          <path d="M90 18c-40 0-72 31-72 69 0 20 7 34 7 55" />
          <path d="M90 34c-31 0-56 24-56 54 0 23 8 33 7 60" />
          <path d="M90 50c-22 0-40 17-40 38 0 29 10 39 3 76" />
          <path d="M90 66c-13 0-24 10-24 23 0 34 12 47 1 87" />
          <path d="M90 82c-5 0-8 4-8 9 0 30 13 49 0 98" />
          <path d="M98 91c0 35 14 55 1 100" />
          <path d="M106 72c8 6 12 15 12 26 0 42 10 57-2 91" />
          <path d="M116 56c14 10 22 25 22 43 0 41 8 55-3 78" />
          <path d="M125 42c18 12 29 32 29 55 0 35 6 49-1 66" />
          <path d="M142 31c20 17 32 40 32 66 0 21 3 34 0 47" />
        </svg>
        <div className="scan-line" />
        <div className="verified-pill">
          <span /> Puede retirar
        </div>
      </div>
      <div className="metric-card metric-top">
        <span className="metric-icon">
          <Icono nombre="rayo" />
        </span>
        <div>
          <strong>En vivo</strong>
          <small>Fichadas al instante</small>
        </div>
      </div>
      <div className="metric-card metric-bottom">
        <div className="mini-avatars">
          <span>D</span>
          <span>A</span>
          <span>C</span>
        </div>
        <small>Desayuno · Almuerzo · Cena</small>
      </div>
    </div>
  );
}

// Indicador real: ¿responde el servidor?
function useEstadoServidor() {
  const [enLinea, setEnLinea] = useState(null);
  useEffect(() => {
    let vivo = true;
    const consultar = () =>
      fetch(`${apiBase}/api/salud`)
        .then((r) => vivo && setEnLinea(r.ok))
        .catch(() => vivo && setEnLinea(false));
    consultar();
    const t = setInterval(consultar, 15000);
    return () => {
      vivo = false;
      clearInterval(t);
    };
  }, []);
  return enLinea;
}

export default function Login() {
  const { login } = useAuth();
  const [usuario, setUsuario] = useState('');
  const [password, setPassword] = useState('');
  const [verClave, setVerClave] = useState(false);
  const [recordar, setRecordar] = useState(true);
  const [olvido, setOlvido] = useState(false);
  const [error, setError] = useState('');
  const [enviando, setEnviando] = useState(false);
  const servidor = useEstadoServidor();

  async function enviar(e) {
    e.preventDefault();
    setError('');
    setEnviando(true);
    try {
      await login(usuario.trim(), password, { recordar });
    } catch (err) {
      setError(err.message);
      setEnviando(false);
    }
  }

  return (
    <main className="bc-login app-shell">
      <section className="brand-panel">
        <header className="brand-header">
          <span className="brand">
            <Logo />
            <span>BioCook</span>
          </span>
          <span className={`system-status ${servidor === false ? 'caido' : ''}`}>
            <i /> {servidor === false ? 'Sin conexión con el servidor' : 'Sistema en línea'}
          </span>
        </header>

        <div className="brand-content">
          <div className="eyebrow">
            <span /> Comedor del hospital
          </div>
          <h1>
            Gestión simple.
            <br />
            <em>Personas reales.</em>
          </h1>
          <p>Controlá las fichadas del comedor de forma segura, ágil y precisa.</p>
          <div className="visual-wrap">
            <VisualBiometrico />
          </div>
        </div>

        <footer className="brand-footer">
          <span>Huella y rostro</span>
          <span>Fichadas en tiempo real</span>
          <span>Todos los relojes en un lugar</span>
        </footer>
      </section>

      <section className="login-panel">
        <div className="mobile-brand">
          <span className="brand dark">
            <Logo />
            <span>BioCook</span>
          </span>
        </div>

        <div className="login-card">
          <div className="login-heading">
            <span className="welcome-logo">
              <Logo tamano={46} />
            </span>
            <h2>Bienvenido de nuevo</h2>
            <p>Ingresá con tu usuario para acceder al panel del comedor.</p>
          </div>

          {servidor === false && (
            <div className="aviso-login" role="alert">
              No hay conexión con el servidor. Revisá que esté encendido.
            </div>
          )}
          {error && (
            <div className="error-login" role="alert">
              {error}
            </div>
          )}

          <form onSubmit={enviar}>
            <label className="field-label" htmlFor="usuario">
              Usuario
            </label>
            <div className="input-wrap">
              <Icono nombre="usuario" />
              <input
                id="usuario"
                name="usuario"
                type="text"
                placeholder="Tu usuario"
                autoComplete="username"
                autoCapitalize="none"
                autoFocus
                required
                value={usuario}
                onChange={(e) => setUsuario(e.target.value)}
              />
            </div>

            <div className="password-row">
              <label className="field-label" htmlFor="password">
                Contraseña
              </label>
              <button type="button" className="link-olvido" onClick={() => setOlvido((v) => !v)}>
                ¿Olvidaste tu contraseña?
              </button>
            </div>
            {olvido && (
              <p className="ayuda-olvido">
                Pedile a un administrador que te asigne una nueva desde <strong>Operadores</strong>.
              </p>
            )}
            <div className="input-wrap">
              <Icono nombre="candado" />
              <input
                id="password"
                name="password"
                type={verClave ? 'text' : 'password'}
                placeholder="Tu contraseña"
                autoComplete="current-password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
              <button
                className="eye-button"
                type="button"
                onClick={() => setVerClave((v) => !v)}
                aria-label={verClave ? 'Ocultar contraseña' : 'Mostrar contraseña'}
              >
                <Icono nombre={verClave ? 'ojoTachado' : 'ojo'} />
              </button>
            </div>

            <label className="remember">
              <input type="checkbox" checked={recordar} onChange={(e) => setRecordar(e.target.checked)} />
              <span className="checkmark" />
              Mantener mi sesión iniciada
            </label>

            <button className="submit-button" type="submit" disabled={enviando || !usuario.trim() || !password}>
              <span>{enviando ? 'Verificando acceso…' : 'Iniciar sesión'}</span>
              {!enviando && <Icono nombre="flecha" />}
              {enviando && <i className="spinner" />}
            </button>
          </form>

          <div className="security-note">
            <span>
              <Icono nombre="escudo" />
            </span>
            <p>
              <strong>Acceso solo para personal autorizado</strong>
              <br />
              Cada acción queda registrada con tu usuario.
            </p>
          </div>
        </div>

        <footer className="login-footer">
          <span>© {new Date().getFullYear()} BioCook</span>
          <span>Comedor del hospital</span>
        </footer>
      </section>
    </main>
  );
}
