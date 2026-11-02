// Gestión del reloj desde la web: estado, usuarios cargados (base vs. reloj),
// acciones remotas y cola de comandos.
import { useCallback, useEffect, useState } from 'react';
import { api } from '../api.js';
import { useAuth } from '../auth.jsx';
import { useEvento } from '../socket.js';
import { fechaHora, hoy } from '../util.js';

const TONO_COMANDO = { ok: 'ok', error: 'err', pendiente: 'warn', enviado: 'muted' };
const ESTADO_COMANDO = { ok: 'aplicado', error: 'error', pendiente: 'en cola', enviado: 'enviado' };

// --- Base vs. reloj ---
function Comparacion({ equipo, onAviso, onError, version }) {
  const [datos, setDatos] = useState(null);
  const [vista, setVista] = useState('soloBase');

  const cargar = useCallback(() => {
    api(`/dispositivos/${equipo.sn}/comparacion`).then(setDatos).catch((e) => onError(e.message));
  }, [equipo.sn, onError]);

  useEffect(cargar, [cargar, version]);

  async function hacer(ruta, texto) {
    try {
      await api(ruta, { method: 'POST' });
      onAviso(texto);
      cargar();
    } catch (e) {
      onError(e.message);
    }
  }

  if (!datos) return <p className="vacio">Cargando…</p>;

  const pestanias = [
    { id: 'soloBase', texto: 'Solo en la base', n: datos.soloBase.length, tono: 'warn' },
    { id: 'soloReloj', texto: 'Solo en el reloj', n: datos.soloReloj.length, tono: 'err' },
    { id: 'sincronizados', texto: 'En los dos', n: datos.sincronizados.length, tono: 'ok' },
  ];
  const filas = datos[vista];

  return (
    <>
      <div className="fila entre" style={{ margin: '0.5rem 0 0.75rem' }}>
        <small>
          {datos.leyendo
            ? 'Leyendo la lista del reloj… (tarda unos segundos)'
            : datos.ultimaLectura
              ? `Lista completa leída del reloj: ${fechaHora(datos.ultimaLectura)}`
              : 'Todavía no se leyó la lista completa del reloj: lo que ves es lo que el sistema le mandó.'}
        </small>
        <button
          className="chico"
          disabled={datos.leyendo}
          onClick={() =>
            hacer(
              `/dispositivos/${equipo.sn}/acciones/consultar-usuarios`,
              'Se pidió la lista al reloj. Se actualiza sola en unos segundos.'
            )
          }
        >
          Leer usuarios del reloj
        </button>
      </div>

      <div className="tabs">
        {pestanias.map((p) => (
          <button key={p.id} className={vista === p.id ? 'activa' : ''} onClick={() => setVista(p.id)}>
            {p.texto} <span className={`tag ${p.n ? p.tono : 'muted'}`}>{p.n}</span>
          </button>
        ))}
      </div>

      <p style={{ fontSize: '0.88rem', color: 'var(--suave)', marginTop: 0 }}>
        {vista === 'soloBase' && 'Están activos en el sistema pero no en el reloj: no van a poder fichar.'}
        {vista === 'soloReloj' && 'Están cargados en el reloj pero dados de baja en el sistema.'}
        {vista === 'sincronizados' && 'Cargados correctamente en los dos lados.'}
      </p>

      <table>
        <thead>
          <tr>
            <th>PIN</th>
            <th>Nombre</th>
            <th>{vista === 'soloBase' ? 'Respaldo biométrico' : 'Biometría en reloj'}</th>
            <th>Estado</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {filas.map((u) => (
            <tr key={u.pin}>
              <td>{u.pin}</td>
              <td>
                <strong>{u.nombre || u.nombreReloj || '—'}</strong>
                {u.nombreDistinto && <small style={{ display: 'block' }}>En el reloj figura como "{u.nombreReloj}"</small>}
              </td>
              <td>
                {vista === 'soloBase' ? (
                  u.tieneRespaldo ? <span className="tag ok">Sí, se restaura</span> : <span className="tag muted">No</span>
                ) : u.biometriaReloj ? (
                  <span className="tag ok">Enrolado</span>
                ) : u.biometriaReloj == null ? (
                  <span className="tag muted">—</span>
                ) : (
                  <span className="tag warn">Sin enrolar</span>
                )}
              </td>
              <td>
                {u.baja ? (
                  <span className="tag muted">Dado de baja</span>
                ) : u.pendienteRevision ? (
                  <span className="tag warn">Revisar</span>
                ) : u.autorizado === false ? (
                  <span className="tag err">Deshabilitado</span>
                ) : vista === 'soloReloj' ? (
                  <span className="tag err">No está en la base</span>
                ) : (
                  <span className="tag ok">Habilitado</span>
                )}
              </td>
              <td className="acciones">
                {vista === 'soloBase' && (
                  <button
                    className="chico primario"
                    onClick={() =>
                      hacer(`/dispositivos/${equipo.sn}/usuarios/${u.pin}/enviar`, `${u.nombre} enviado al reloj`)
                    }
                  >
                    Enviar al reloj
                  </button>
                )}
                {vista === 'soloReloj' && (
                  <button
                    className="chico peligro"
                    onClick={() =>
                      window.confirm(`¿Borrar a ${u.nombre || u.nombreReloj} (PIN ${u.pin}) del reloj?`) &&
                      hacer(`/dispositivos/${equipo.sn}/usuarios/${u.pin}/borrar`, `PIN ${u.pin} se borra del reloj`)
                    }
                  >
                    Borrar del reloj
                  </button>
                )}
                {vista === 'sincronizados' && u.nombreDistinto && (
                  <button
                    className="chico"
                    onClick={() =>
                      hacer(`/dispositivos/${equipo.sn}/usuarios/${u.pin}/enviar`, `Nombre de ${u.nombre} actualizado en el reloj`)
                    }
                  >
                    Corregir nombre
                  </button>
                )}
              </td>
            </tr>
          ))}
          {!filas.length && (
            <tr>
              <td colSpan={5} className="vacio">
                {vista === 'sincronizados' ? 'Nadie todavía.' : 'Sin diferencias. 👍'}
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </>
  );
}

// --- Cola de comandos ---
function Comandos({ sn, version }) {
  const [comandos, setComandos] = useState([]);
  useEffect(() => {
    api(`/dispositivos/${sn}/comandos`).then(setComandos).catch(() => {});
  }, [sn, version]);
  return (
    <table>
      <thead>
        <tr>
          <th>#</th>
          <th>Tipo</th>
          <th>PIN</th>
          <th>Estado</th>
          <th>Creado</th>
          <th>Respondido</th>
        </tr>
      </thead>
      <tbody>
        {comandos.map((c) => (
          <tr key={c._id}>
            <td>{c.cmdId}</td>
            <td>{c.tipo}</td>
            <td>{c.pin || '—'}</td>
            <td>
              <span className={`tag ${TONO_COMANDO[c.estado]}`}>
                {c.retorno === -9999 ? 'cancelado' : ESTADO_COMANDO[c.estado]}
                {c.estado === 'error' && c.retorno !== -9999 && ` (${c.retorno === -1002 ? 'no soportado' : c.retorno})`}
              </span>
            </td>
            <td>{fechaHora(c.createdAt)}</td>
            <td>{fechaHora(c.respondidoEn)}</td>
          </tr>
        ))}
        {!comandos.length && (
          <tr>
            <td colSpan={6} className="vacio">
              Sin comandos.
            </td>
          </tr>
        )}
      </tbody>
    </table>
  );
}

// --- Panel de un equipo ---
function Equipo({ eq, esAdmin, onAviso, onError, recargarLista, version }) {
  const [pestania, setPestania] = useState('usuarios');
  const [rango, setRango] = useState({ desde: hoy(), hasta: hoy() });

  async function accion(nombre, texto, { body, confirmar } = {}) {
    for (const c of [].concat(confirmar || [])) if (!window.confirm(c)) return;
    try {
      await api(`/dispositivos/${eq.sn}/acciones/${nombre}`, { method: 'POST', body });
      onAviso(texto);
      recargarLista();
    } catch (e) {
      onError(e.message);
    }
  }

  async function sincronizar() {
    if (!window.confirm('Se van a reenviar al reloj todos los comensales activos, con su rostro/huella si hay respaldo. ¿Continuar?')) return;
    try {
      const r = await api(`/dispositivos/${eq.sn}/sincronizar`, { method: 'POST' });
      onAviso(`Se enviaron ${r.usuarios} comensales al reloj (${r.encolados} comandos)`);
      recargarLista();
    } catch (e) {
      onError(e.message);
    }
  }

  async function renombrar() {
    const nombre = window.prompt('Nombre del equipo', eq.nombre);
    if (!nombre) return;
    try {
      await api(`/dispositivos/${eq.sn}`, { method: 'PUT', body: { nombre } });
      recargarLista();
    } catch (e) {
      onError(e.message);
    }
  }

  const info = eq.info || {};

  return (
    <div className="panel">
      <div className="fila entre">
        <h2 style={{ margin: 0 }}>
          {eq.nombre}{' '}
          <span className={`tag ${eq.enLinea ? 'ok' : 'err'}`}>{eq.enLinea ? 'En línea' : 'Sin conexión'}</span>{' '}
          {eq.comandosPendientes > 0 && <span className="tag warn">{eq.comandosPendientes} comandos en cola</span>}
        </h2>
        {esAdmin && (
          <button className="chico" onClick={renombrar}>
            Renombrar
          </button>
        )}
      </div>

      <div className="datos-equipo">
        <div>
          <small>N.º de serie</small>
          {eq.sn}
        </div>
        <div>
          <small>IP</small>
          {eq.ip || '—'}
        </div>
        <div>
          <small>Conexión</small>
          {eq.modo === '4370' ? 'Directa (puerto 4370)' : 'ADMS (el reloj llama)'}
        </div>
        <div>
          <small>Firmware</small>
          {eq.firmware || info.FWVersion || '—'}
        </div>
        <div>
          <small>Usuarios en el reloj</small>
          {info.UserCount ?? eq.usuariosEnEquipo ?? '—'}
        </div>
        <div>
          <small>Fichadas guardadas en el reloj</small>
          {info.TransactionCount ?? '—'}
        </div>
        <div>
          <small>Última conexión</small>
          {fechaHora(eq.ultimaConexion)}
        </div>
      </div>

      <div className="grupo-acciones">
        <span className="titulo">Acciones</span>
        <button className="chico" onClick={() => accion('actualizar', 'Se pidió al reloj que envíe lo pendiente')}>
          Pedir datos nuevos
        </button>
        {eq.comandosPendientes > 0 && (
          <button
            className="chico"
            onClick={async () => {
              if (!window.confirm('¿Cancelar los comandos que el reloj todavía no aplicó?')) return;
              try {
                const r = await api(`/dispositivos/${eq.sn}/comandos/cancelar`, { method: 'POST' });
                onAviso(`Se cancelaron ${r.cancelados} comandos`);
                recargarLista();
              } catch (e) {
                onError(e.message);
              }
            }}
          >
            Cancelar comandos en cola
          </button>
        )}
        <span className="fila" style={{ gap: '0.35rem' }}>
          <input type="date" value={rango.desde} max={hoy()} onChange={(e) => setRango({ ...rango, desde: e.target.value })} />
          <input type="date" value={rango.hasta} max={hoy()} onChange={(e) => setRango({ ...rango, hasta: e.target.value })} />
          <button
            className="chico"
            onClick={() =>
              accion('recuperar-fichadas', 'El reloj va a reenviar las fichadas de ese rango (las repetidas se ignoran)', {
                body: rango,
              })
            }
          >
            Recuperar fichadas
          </button>
        </span>
        {esAdmin && (
          <>
            <button className="chico" onClick={sincronizar}>
              Enviar todos los comensales
            </button>
            <button
              className="chico peligro"
              onClick={() =>
                accion('reiniciar', 'El reloj se va a reiniciar (vuelve en 1–2 minutos)', {
                  confirmar: '¿Reiniciar el reloj? Durante 1–2 minutos no se va a poder fichar.',
                })
              }
            >
              Reiniciar
            </button>
            <button
              className="chico peligro"
              onClick={() =>
                accion('vaciar-fichadas', 'Se vació la memoria de fichadas del reloj', {
                  confirmar: [
                    '¿Vaciar las fichadas guardadas EN EL RELOJ? Las que ya están en el sistema no se tocan.',
                    'Antes conviene usar "Recuperar fichadas" para asegurarte de que el sistema tiene todo. ¿Vaciar igual?',
                  ],
                })
              }
            >
              Vaciar memoria de fichadas
            </button>
          </>
        )}
      </div>

      <div className="tabs" style={{ marginTop: '1rem' }}>
        <button className={pestania === 'usuarios' ? 'activa' : ''} onClick={() => setPestania('usuarios')}>
          Base vs. reloj
        </button>
        <button className={pestania === 'comandos' ? 'activa' : ''} onClick={() => setPestania('comandos')}>
          Historial de comandos
        </button>
      </div>

      {pestania === 'usuarios' ? (
        <Comparacion equipo={eq} onAviso={onAviso} onError={onError} version={version} />
      ) : (
        <Comandos sn={eq.sn} version={version} />
      )}
    </div>
  );
}

export default function Equipos() {
  const { esAdmin } = useAuth();
  const [equipos, setEquipos] = useState([]);
  const [error, setError] = useState('');
  const [mensaje, setMensaje] = useState('');
  const [version, setVersion] = useState(0);

  const cargar = useCallback(() => {
    api('/dispositivos')
      .then(setEquipos)
      .catch((e) => setError(e.message));
    setVersion((v) => v + 1);
  }, []);

  useEffect(() => {
    cargar();
    const t = setInterval(cargar, 20000);
    return () => clearInterval(t);
  }, [cargar]);

  // Cuando el reloj confirma un comando, refrescamos (con un pequeño margen para agrupar varios)
  useEvento('comando', () => {
    clearTimeout(window.__refrescoEquipos);
    window.__refrescoEquipos = setTimeout(cargar, 700);
  });

  const onAviso = useCallback((t) => {
    setError('');
    setMensaje(t);
    setTimeout(() => setMensaje(''), 5000);
  }, []);
  const onError = useCallback((t) => setError(t), []);

  return (
    <>
      <h1>Equipos</h1>
      {error && <div className="error">{error}</div>}
      {mensaje && <div className="aviso" style={{ background: 'var(--ok-bg)', color: 'var(--ok)' }}>{mensaje}</div>}

      {!equipos.length && (
        <div className="panel">
          <p>Todavía no se conectó ningún reloj.</p>
          <p>
            En el MB360 entrá a <strong>Menú → Comunicación → Servidor en la nube (ADMS)</strong> y cargá la IP de este
            servidor y el puerto <strong>4000</strong>. A los pocos segundos aparece acá.
          </p>
        </div>
      )}

      {equipos.map((eq) => (
        <Equipo
          key={eq.sn}
          eq={eq}
          esAdmin={esAdmin}
          onAviso={onAviso}
          onError={onError}
          recargarLista={cargar}
          version={version}
        />
      ))}
    </>
  );
}
