// ABM de comensales: alta, modificación, habilitar/deshabilitar, baja y reactivación
import { useCallback, useEffect, useState } from 'react';
import { api } from '../api.js';
import { fechaHora } from '../util.js';

const ESTADOS = [
  { id: 'activos', texto: 'Activos' },
  { id: 'pendientes', texto: 'Pendientes de revisión' },
  { id: 'inactivos', texto: 'Dados de baja' },
  { id: 'todos', texto: 'Todos' },
];

const VACIO = { pin: '', nombre: '', dni: '', sector: '', tarjeta: '', servicios: null, autorizado: true, observaciones: '' };

function Formulario({ inicial, servicios, onCerrar, onGuardado }) {
  const editando = !!inicial._id;
  const [f, setF] = useState({ ...VACIO, ...inicial, servicios: inicial.servicios || servicios.map((s) => s.codigo) });
  const [error, setError] = useState('');
  const [guardando, setGuardando] = useState(false);

  const set = (campo) => (e) => setF({ ...f, [campo]: e.target.type === 'checkbox' ? e.target.checked : e.target.value });
  const toggleServicio = (codigo) =>
    setF({
      ...f,
      servicios: f.servicios.includes(codigo) ? f.servicios.filter((c) => c !== codigo) : [...f.servicios, codigo],
    });

  async function guardar(e) {
    e.preventDefault();
    setError('');
    setGuardando(true);
    const datos = {
      nombre: f.nombre,
      dni: f.dni,
      sector: f.sector,
      tarjeta: f.tarjeta,
      servicios: f.servicios,
      autorizado: f.autorizado,
      observaciones: f.observaciones,
    };
    try {
      const r = editando
        ? await api(`/comensales/${f._id}`, { method: 'PUT', body: datos })
        : await api('/comensales', { method: 'POST', body: { ...datos, pin: f.pin.trim() } });
      onGuardado(r, editando);
    } catch (err) {
      setError(err.message);
      setGuardando(false);
    }
  }

  return (
    <div className="fondo-modal" onMouseDown={(e) => e.target === e.currentTarget && onCerrar()}>
      <form className="modal" onSubmit={guardar}>
        <h2>{editando ? `Editar: ${inicial.nombre}` : 'Nuevo comensal'}</h2>
        {error && <div className="error">{error}</div>}
        {inicial.pendienteRevision && (
          <div className="aviso">
            Esta persona se enroló directamente en el reloj. Revisá los datos y habilitala si corresponde.
          </div>
        )}
        <div className="grilla dos">
          <label className="campo">
            PIN (ID en el reloj)
            <input
              value={f.pin}
              onChange={set('pin')}
              disabled={editando}
              required
              inputMode="numeric"
              pattern="\d{1,9}"
              title="Solo números, hasta 9 dígitos"
            />
            <span className="ayuda">{editando ? 'No se puede cambiar' : 'Solo números. Ej: legajo'}</span>
          </label>
          <label className="campo">
            DNI
            <input value={f.dni || ''} onChange={set('dni')} inputMode="numeric" />
          </label>
        </div>
        <label className="campo" style={{ marginTop: '0.75rem' }}>
          Nombre y apellido
          <input value={f.nombre} onChange={set('nombre')} required maxLength={100} />
          <span className="ayuda">En el reloj se muestran los primeros 24 caracteres</span>
        </label>
        <div className="grilla dos" style={{ marginTop: '0.75rem' }}>
          <label className="campo">
            Sector
            <input value={f.sector || ''} onChange={set('sector')} placeholder="Ej: Enfermería" />
          </label>
          <label className="campo">
            Tarjeta (opcional)
            <input value={f.tarjeta || ''} onChange={set('tarjeta')} />
          </label>
        </div>

        <fieldset style={{ border: 'none', padding: 0, marginTop: '1rem' }}>
          <legend style={{ fontWeight: 600, fontSize: '0.9rem', marginBottom: '0.4rem' }}>Puede retirar</legend>
          <div className="fila">
            {servicios.map((s) => (
              <label key={s.codigo} className="check">
                <input type="checkbox" checked={f.servicios.includes(s.codigo)} onChange={() => toggleServicio(s.codigo)} />
                {s.nombre}
              </label>
            ))}
          </div>
        </fieldset>

        <label className="check" style={{ marginTop: '1rem' }}>
          <input type="checkbox" checked={f.autorizado} onChange={set('autorizado')} />
          Habilitado para retirar comida
        </label>

        <label className="campo" style={{ marginTop: '0.75rem' }}>
          Observaciones
          <textarea rows={2} value={f.observaciones || ''} onChange={set('observaciones')} maxLength={500} />
        </label>

        {!editando && (
          <p className="ayuda" style={{ fontSize: '0.85rem', color: 'var(--suave)' }}>
            Al guardar, la persona se envía al reloj. Después tiene que pararse frente al equipo para enrolar su rostro o
            huella.
          </p>
        )}

        <div className="modal-pie">
          <button type="button" onClick={onCerrar}>
            Cancelar
          </button>
          <button className="primario" disabled={guardando}>
            {guardando ? 'Guardando…' : 'Guardar'}
          </button>
        </div>
      </form>
    </div>
  );
}

export default function Comensales() {
  const [estado, setEstado] = useState('activos');
  const [q, setQ] = useState('');
  const [busqueda, setBusqueda] = useState('');
  const [page, setPage] = useState(1);
  const [datos, setDatos] = useState({ items: [], total: 0, limit: 50 });
  const [servicios, setServicios] = useState([]);
  const [editando, setEditando] = useState(null);
  const [error, setError] = useState('');
  const [mensaje, setMensaje] = useState('');

  const cargar = useCallback(() => {
    const p = new URLSearchParams({ estado, page, limit: 50 });
    if (busqueda) p.set('q', busqueda);
    api(`/comensales?${p}`)
      .then(setDatos)
      .catch((e) => setError(e.message));
  }, [estado, busqueda, page]);

  useEffect(() => {
    api('/fichadas/servicios').then(setServicios).catch(() => {});
  }, []);
  useEffect(cargar, [cargar]);

  // Busca 300 ms después de que dejan de escribir
  useEffect(() => {
    const t = setTimeout(() => {
      setBusqueda(q.trim());
      setPage(1);
    }, 300);
    return () => clearTimeout(t);
  }, [q]);

  function avisar(texto) {
    setMensaje(texto);
    setTimeout(() => setMensaje(''), 4000);
  }

  async function accion(fn, texto) {
    setError('');
    try {
      await fn();
      avisar(texto);
      cargar();
    } catch (e) {
      setError(e.message);
    }
  }

  const habilitar = (c, valor) =>
    accion(
      () => api(`/comensales/${c._id}`, { method: 'PUT', body: { autorizado: valor } }),
      `${c.nombre}: ${valor ? 'habilitado' : 'deshabilitado'}`
    );

  const darDeBaja = (c) => {
    const ok = window.confirm(
      `¿Dar de baja a ${c.nombre}?\n\nSe borra del reloj. Si solo querés que no retire comida por un tiempo, usá "Deshabilitar".`
    );
    if (!ok) return;
    const borrar =
      c.tieneBiometria &&
      window.confirm(
        `¿Borrar también el respaldo de su rostro/huella?\n\nAceptar: se elimina (si vuelve, hay que enrolarlo de nuevo).\nCancelar: se guarda, y al reactivarlo se restaura solo.`
      );
    accion(
      () => api(`/comensales/${c._id}${borrar ? '?borrarBiometria=1' : ''}`, { method: 'DELETE' }),
      `${c.nombre} dado de baja`
    );
  };

  const reactivar = (c) =>
    accion(
      () => api(`/comensales/${c._id}`, { method: 'PUT', body: { activo: true, autorizado: true } }),
      c.tieneBiometria
        ? `${c.nombre} reactivado: se reenvió al reloj con su rostro/huella`
        : `${c.nombre} reactivado: se reenvió al reloj (tiene que enrolarse en el equipo)`
    );

  const paginas = Math.max(1, Math.ceil(datos.total / datos.limit));

  return (
    <>
      <div className="fila entre">
        <h1>Comensales</h1>
        <button className="primario" onClick={() => setEditando({})}>
          + Nuevo comensal
        </button>
      </div>

      {error && <div className="error">{error}</div>}
      {mensaje && <div className="aviso" style={{ background: 'var(--ok-bg)', color: 'var(--ok)' }}>{mensaje}</div>}

      <div className="panel">
        <div className="tabs">
          {ESTADOS.map((e) => (
            <button
              key={e.id}
              className={estado === e.id ? 'activa' : ''}
              onClick={() => {
                setEstado(e.id);
                setPage(1);
              }}
            >
              {e.texto}
            </button>
          ))}
        </div>

        <div className="fila entre" style={{ marginBottom: '0.75rem' }}>
          <input
            type="search"
            placeholder="Buscar por nombre, PIN, DNI o sector"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            style={{ minWidth: 300 }}
          />
          <div className="fila">
            {estado === 'pendientes' && datos.total > 0 && (
              <button
                className="chico primario"
                onClick={() =>
                  window.confirm(
                    `¿Habilitar a los ${datos.total} pendientes para retirar comida?\n\nRevisá antes la lista: después se pueden deshabilitar de a uno.`
                  ) &&
                  accion(
                    () => api('/comensales/pendientes/habilitar', { method: 'POST' }),
                    `Se habilitaron ${datos.total} comensales`
                  )
                }
              >
                Habilitar todos los pendientes
              </button>
            )}
            <small>{datos.total} resultados</small>
          </div>
        </div>

        <table>
          <thead>
            <tr>
              <th>PIN</th>
              <th>Nombre</th>
              <th>Sector</th>
              <th>Servicios</th>
              <th>Estado</th>
              <th>Biometría</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {datos.items.map((c) => (
              <tr key={c._id}>
                <td>{c.pin}</td>
                <td>
                  <strong>{c.nombre}</strong>
                  {c.dni && <small style={{ display: 'block' }}>DNI {c.dni}</small>}
                </td>
                <td>{c.sector || '—'}</td>
                <td>
                  <small>{c.servicios.map((s) => servicios.find((x) => x.codigo === s)?.nombre || s).join(', ')}</small>
                </td>
                <td>
                  {!c.activo ? (
                    <span className="tag muted">Baja</span>
                  ) : c.pendienteRevision ? (
                    <span className="tag warn">Revisar</span>
                  ) : c.autorizado ? (
                    <span className="tag ok">Habilitado</span>
                  ) : (
                    <span className="tag err">Deshabilitado</span>
                  )}
                </td>
                <td>{c.tieneBiometria ? <span className="tag ok">Enrolado</span> : <span className="tag muted">—</span>}</td>
                <td className="acciones">
                  {c.activo ? (
                    <>
                      <button className="chico" onClick={() => setEditando(c)}>
                        Editar
                      </button>
                      {c.autorizado ? (
                        <button className="chico" onClick={() => habilitar(c, false)}>
                          Deshabilitar
                        </button>
                      ) : (
                        <button className="chico" onClick={() => habilitar(c, true)}>
                          Habilitar
                        </button>
                      )}
                      <button className="chico peligro" onClick={() => darDeBaja(c)}>
                        Baja
                      </button>
                    </>
                  ) : (
                    <>
                      <small style={{ marginRight: '0.5rem' }}>desde {fechaHora(c.updatedAt)}</small>
                      <button className="chico" onClick={() => reactivar(c)}>
                        Reactivar
                      </button>
                    </>
                  )}
                </td>
              </tr>
            ))}
            {!datos.items.length && (
              <tr>
                <td colSpan={7} className="vacio">
                  No hay comensales en esta vista.
                </td>
              </tr>
            )}
          </tbody>
        </table>

        {paginas > 1 && (
          <div className="paginado">
            <button className="chico" disabled={page <= 1} onClick={() => setPage(page - 1)}>
              Anterior
            </button>
            <span>
              Página {page} de {paginas}
            </span>
            <button className="chico" disabled={page >= paginas} onClick={() => setPage(page + 1)}>
              Siguiente
            </button>
          </div>
        )}
      </div>

      {editando && servicios.length > 0 && (
        <Formulario
          inicial={editando}
          servicios={servicios}
          onCerrar={() => setEditando(null)}
          onGuardado={(c, fueEdicion) => {
            setEditando(null);
            avisar(fueEdicion ? `${c.nombre} actualizado` : `${c.nombre} creado y enviado al reloj`);
            cargar();
          }}
        />
      )}
    </>
  );
}
