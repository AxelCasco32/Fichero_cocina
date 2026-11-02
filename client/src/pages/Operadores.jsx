// Personal que usa la web (solo administradores)
import { useEffect, useState } from 'react';
import { api } from '../api.js';
import { useAuth } from '../auth.jsx';

const NUEVO = { usuario: '', nombre: '', password: '', rol: 'cocina' };

export default function Operadores() {
  const { operador: yo } = useAuth();
  const [lista, setLista] = useState([]);
  const [form, setForm] = useState(NUEVO);
  const [error, setError] = useState('');
  const [mensaje, setMensaje] = useState('');

  const cargar = () =>
    api('/operadores')
      .then(setLista)
      .catch((e) => setError(e.message));

  useEffect(() => {
    cargar();
  }, []);

  function avisar(t) {
    setMensaje(t);
    setTimeout(() => setMensaje(''), 4000);
  }

  async function crear(e) {
    e.preventDefault();
    setError('');
    try {
      await api('/operadores', { method: 'POST', body: form });
      avisar(`Usuario ${form.usuario} creado`);
      setForm(NUEVO);
      cargar();
    } catch (err) {
      setError(err.message);
    }
  }

  async function actualizar(op, cambios, texto) {
    setError('');
    try {
      await api(`/operadores/${op._id}`, { method: 'PUT', body: cambios });
      avisar(texto);
      cargar();
    } catch (err) {
      setError(err.message);
    }
  }

  function resetear(op) {
    const password = window.prompt(`Nueva contraseña para ${op.usuario} (mínimo 8 caracteres)`);
    if (password) actualizar(op, { password }, `Contraseña de ${op.usuario} actualizada`);
  }

  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });

  return (
    <>
      <h1>Operadores</h1>
      {error && <div className="error">{error}</div>}
      {mensaje && <div className="aviso" style={{ background: 'var(--ok-bg)', color: 'var(--ok)' }}>{mensaje}</div>}

      <form className="panel" onSubmit={crear}>
        <h2>Nuevo operador</h2>
        <div className="fila" style={{ alignItems: 'flex-end' }}>
          <label className="campo">
            Usuario
            <input value={form.usuario} onChange={set('usuario')} required />
          </label>
          <label className="campo">
            Nombre
            <input value={form.nombre} onChange={set('nombre')} required />
          </label>
          <label className="campo">
            Contraseña
            <input type="password" value={form.password} onChange={set('password')} minLength={8} required />
          </label>
          <label className="campo">
            Rol
            <select value={form.rol} onChange={set('rol')}>
              <option value="cocina">Cocina</option>
              <option value="admin">Administrador</option>
            </select>
          </label>
          <button className="primario">Crear</button>
        </div>
        <small>
          Cocina: monitor, ABM de comensales y reportes. Administrador: además equipos y operadores.
        </small>
      </form>

      <div className="panel">
        <table>
          <thead>
            <tr>
              <th>Usuario</th>
              <th>Nombre</th>
              <th>Rol</th>
              <th>Estado</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {lista.map((op) => {
              const soyYo = op._id === yo._id;
              return (
                <tr key={op._id}>
                  <td>{op.usuario}</td>
                  <td>{op.nombre}</td>
                  <td>
                    <select
                      value={op.rol}
                      disabled={soyYo}
                      onChange={(e) => actualizar(op, { rol: e.target.value }, `Rol de ${op.usuario} actualizado`)}
                    >
                      <option value="cocina">Cocina</option>
                      <option value="admin">Administrador</option>
                    </select>
                  </td>
                  <td>{op.activo ? <span className="tag ok">Activo</span> : <span className="tag muted">Inactivo</span>}</td>
                  <td className="acciones">
                    <button className="chico" onClick={() => resetear(op)}>
                      Cambiar contraseña
                    </button>
                    {!soyYo && (
                      <button
                        className={`chico ${op.activo ? 'peligro' : ''}`}
                        onClick={() =>
                          actualizar(op, { activo: !op.activo }, `${op.usuario} ${op.activo ? 'desactivado' : 'activado'}`)
                        }
                      >
                        {op.activo ? 'Desactivar' : 'Activar'}
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </>
  );
}
