import { Navigate, NavLink, Route, Routes } from 'react-router-dom';
import { useAuth } from './auth.jsx';
import { useConectado } from './socket.js';
import Login from './pages/Login.jsx';
import Monitor from './pages/Monitor.jsx';
import Comensales from './pages/Comensales.jsx';
import Reportes from './pages/Reportes.jsx';
import Equipos from './pages/Equipos.jsx';
import Operadores from './pages/Operadores.jsx';

function Layout({ children }) {
  const { operador, logout, esAdmin } = useAuth();
  const conectado = useConectado();
  return (
    <div className="layout">
      <aside className="sidebar">
        <div className="marca">
          <span className="marca-icono" aria-hidden>🍽</span>
          <div>
            <strong>Comedor</strong>
            <small>Hospital</small>
          </div>
        </div>
        <nav>
          <NavLink to="/monitor">Monitor en vivo</NavLink>
          <NavLink to="/comensales">Comensales</NavLink>
          <NavLink to="/reportes">Reportes</NavLink>
          <NavLink to="/equipos">Equipos</NavLink>
          {esAdmin && <NavLink to="/operadores">Operadores</NavLink>}
        </nav>
        <div className="sidebar-pie">
          <span className={`punto ${conectado ? 'on' : 'off'}`} />
          <span>{conectado ? 'En vivo' : 'Sin conexión en vivo'}</span>
        </div>
        <div className="usuario">
          <div>
            <strong>{operador.nombre}</strong>
            <small>{operador.rol === 'admin' ? 'Administrador' : 'Cocina'}</small>
          </div>
          <button className="btn-link" onClick={logout}>
            Salir
          </button>
        </div>
      </aside>
      <main className="contenido">{children}</main>
    </div>
  );
}

export default function App() {
  const { operador, cargando, esAdmin } = useAuth();

  if (cargando) return <div className="centrado">Cargando…</div>;
  if (!operador) return <Login />;

  return (
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
  );
}
