import { useEffect, useState } from 'react';
import { Navigate, NavLink, Route, Routes, useLocation } from 'react-router-dom';
import { useAuth } from './auth.jsx';
import { useConectado } from './socket.js';
import { EquiposProvider, activos, enLinea, hace, useAhora, useEquipos } from './equipos.jsx';
import Icono from './components/Icono.jsx';
import Login from './pages/Login.jsx';
import Monitor from './pages/Monitor.jsx';
import Comensales from './pages/Comensales.jsx';
import Reportes from './pages/Reportes.jsx';
import Equipos from './pages/Equipos.jsx';
import Operadores from './pages/Operadores.jsx';
import './layout.css';

const iniciales = (nombre = '') =>
  nombre
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0].toUpperCase())
    .join('') || '?';

// Estado de los relojes y del tiempo real, al pie del menú
function EstadoRelojes() {
  const { equipos } = useEquipos();
  const conectado = useConectado();
  const ahora = useAhora(1000);
  const lista = activos(equipos);
  const online = lista.filter((e) => enLinea(e, ahora));
  const ultima = lista.reduce((m, e) => (e.ultimaConexion && (!m || e.ultimaConexion > m) ? e.ultimaConexion : m), null);

  let titulo;
  if (!lista.length) titulo = 'Sin relojes cargados';
  else if (lista.length === 1) titulo = `${lista[0].nombre}: ${online.length ? 'conectado' : 'sin conexión'}`;
  else titulo = `${online.length} de ${lista.length} relojes en línea`;
  const ok = lista.length > 0 && online.length === lista.length;

  return (
    <NavLink to="/equipos" className="bc-estado" title="Ver equipos">
      <div className="bc-estado-icono">
        <Icono nombre="equipos" tamano={18} />
      </div>
      <div>
        <strong>{titulo}</strong>
        <small>
          {lista.length ? `Última señal ${hace(ultima, ahora)}` : 'Agregalos en Equipos'}
          {' · '}
          {conectado ? 'en vivo' : 'sin tiempo real'}
        </small>
      </div>
      <span className={`bc-punto ${ok && conectado ? 'on' : online.length ? 'parcial' : 'off'}`} />
    </NavLink>
  );
}

const MENU = [
  { to: '/monitor', texto: 'Monitor en vivo', icono: 'actividad' },
  { to: '/comensales', texto: 'Comensales', icono: 'comensales' },
  { to: '/reportes', texto: 'Reportes', icono: 'reportes' },
  { to: '/equipos', texto: 'Equipos', icono: 'equipos' },
  { to: '/operadores', texto: 'Operadores', icono: 'operadores', soloAdmin: true },
];

function Layout({ children }) {
  const { operador, logout, esAdmin } = useAuth();
  const [abierto, setAbierto] = useState(false);
  const { pathname } = useLocation();
  useEffect(() => setAbierto(false), [pathname]); // en el celular, el menú se cierra al navegar

  return (
    <div className="bc-shell">
      <header className="bc-barra-movil">
        <button className="bc-boton-menu" onClick={() => setAbierto(true)} aria-label="Abrir menú">
          <Icono nombre="menu" />
        </button>
        <img src="/logo.svg" alt="" width="30" height="30" />
        <strong>BioCook</strong>
      </header>

      <button
        className={`bc-fondo-menu ${abierto ? 'abierto' : ''}`}
        onClick={() => setAbierto(false)}
        aria-label="Cerrar menú"
        tabIndex={abierto ? 0 : -1}
      />
      <aside className={`bc-sidebar ${abierto ? 'abierto' : ''}`}>
        <div className="bc-marca">
          <img src="/logo.svg" alt="" width="40" height="40" />
          <div>
            <strong>BioCook</strong>
            <small>Comedor del hospital</small>
          </div>
        </div>
        <nav>
          <p className="bc-nav-titulo">OPERACIONES</p>
          {MENU.filter((m) => !m.soloAdmin || esAdmin).map((m) => (
            <NavLink key={m.to} to={m.to} className="bc-nav-item">
              <Icono nombre={m.icono} />
              <span>{m.texto}</span>
              <span className="bc-nav-flecha">
                <Icono nombre="chevron" tamano={16} />
              </span>
            </NavLink>
          ))}
        </nav>
        <EstadoRelojes />
        <div className="bc-perfil">
          <div className="bc-avatar">{iniciales(operador.nombre)}</div>
          <div>
            <strong>{operador.nombre}</strong>
            <small>{operador.rol === 'admin' ? 'Administrador' : 'Cocina'}</small>
          </div>
          <button onClick={logout} aria-label="Cerrar sesión" title="Cerrar sesión">
            <Icono nombre="salir" tamano={17} />
          </button>
        </div>
      </aside>
      <main className="bc-contenido">{children}</main>
    </div>
  );
}

export default function App() {
  const { operador, cargando, esAdmin } = useAuth();

  if (cargando) return <div className="centrado">Cargando…</div>;
  if (!operador) return <Login />;

  return (
    <EquiposProvider>
      <Layout>
        <Routes>
          <Route path="/monitor" element={<Monitor />} />
          <Route path="/comensales" element={<Comensales />} />
          <Route path="/reportes" element={<Reportes />} />
          <Route path="/equipos" element={<Equipos />} />
          {esAdmin && <Route path="/operadores" element={<Operadores />} />}
          <Route path="*" element={<Navigate to="/monitor" replace />} />
        </Routes>
      </Layout>
    </EquiposProvider>
  );
}
