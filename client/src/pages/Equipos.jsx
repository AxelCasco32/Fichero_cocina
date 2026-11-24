// Gestión del reloj desde la web: estado, usuarios cargados (base vs. reloj),
// acciones remotas y cola de comandos.
import { useCallback, useEffect, useState } from 'react';
import { api } from '../api.js';
import { useAuth } from '../auth.jsx';
import { useEvento } from '../socket.js';
import { fechaHora, hoy } from '../util.js';

const TONO_COMANDO = { ok: 'ok', error: 'err', pendiente: 'warn', enviado: 'muted' };
const ESTADO_COMANDO = { ok: 'aplicado', error: 'error', pendiente: 'en cola', enviado: 'enviado' };

// Tipos de equipo: completan la configuración de conexión recomendada
const TIPOS = [
  { id: 'nuevo', texto: 'MB360 u otro equipo nuevo (firmware 8)', modelo: 'MB360', protocolo: 'auto', formato: 'auto' },
  { id: 'viejo', texto: '628-C u otro equipo antiguo', modelo: '628-C', protocolo: 'auto', formato: 'auto' },
  { id: 'otro', texto: 'Otro / no sé (detectar automáticamente)', modelo: '', protocolo: 'auto', formato: 'auto' },
];
// "6 h 30 min", "45 s"
function duracion(seg) {
  const s = Math.abs(Math.round(seg));
  if (s < 60) return `${s} s`;
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  return [d && `${d} d`, h && `${h} h`, m && `${m} min`].filter(Boolean).join(' ') || '1 min';
}
const corrido = (eq) => eq.modo === '4370' && eq.desfaseHora != null && Math.abs(eq.desfaseHora) > 60;
const textoDesfase = (seg) => `${seg < 0 ? 'atrasado' : 'adelantado'} ${duracion(seg)}`;

const TEXTO_FORMATO = { nuevo: 'Nuevo (firmware 8)', viejo: 'Antiguo (firmware 6)' };
const TEXTO_PROTOCOLO = { auto: 'Automática (TCP y si no, UDP)', tcp: 'TCP', udp: 'UDP' };

// --- Alta / edición de un equipo ---
function FormEquipo({ inicial, onCerrar, onGuardado }) {
  const editando = !!inicial;
  const directo = !editando || inicial.modo === '4370';
  const [f, setF] = useState(() => ({
    nombre: inicial?.nombre || '',
    modelo: inicial?.modelo || 'MB360',
    ip: inicial?.ip || '',
    puerto: String(inicial?.puerto || 4370),
    protocolo: inicial?.protocolo || 'auto',
    formato: inicial?.formato || 'auto',
    habilitado: inicial?.habilitado !== false,
    horaAutomatica: !!inicial?.horaAutomatica,
  }));
  const [tipo, setTipo] = useState(inicial?.formato === 'viejo' ? 'viejo' : inicial ? 'otro' : 'nuevo');
  const [prueba, setPrueba] = useState(null);
  const [error, setError] = useState('');
  const [ocupado, setOcupado] = useState('');

  const set = (k) => (e) => {
    setF({ ...f, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value });
    setPrueba(null);
  };

  function elegirTipo(id) {
    const t = TIPOS.find((x) => x.id === id);
    setTipo(id);
    setPrueba(null);
    setF({ ...f, protocolo: t.protocolo, formato: t.formato, modelo: t.modelo || f.modelo });
  }

  const conexion = () => ({ ip: f.ip.trim(), puerto: Number(f.puerto), protocolo: f.protocolo, formato: f.formato });

  async function probar() {
    setError('');
    setPrueba(null);
    setOcupado('probando');
    try {
      setPrueba(await api('/dispositivos/probar', { method: 'POST', body: conexion() }));
    } catch (e) {
      setError(e.message);
    }
    setOcupado('');
  }

  async function guardar(e) {
    e.preventDefault();
    setError('');
    setOcupado('guardando');
    const datos = {
      nombre: f.nombre.trim(),
      modelo: f.modelo.trim(),
      ...(directo ? { ...conexion(), habilitado: f.habilitado, horaAutomatica: f.horaAutomatica } : {}),
    };
    try {
      const r = editando
        ? await api(`/dispositivos/${encodeURIComponent(inicial.sn)}`, { method: 'PUT', body: datos })
        : await api('/dispositivos', { method: 'POST', body: datos });
      onGuardado(r, editando);
    } catch (err) {
      setError(err.message);
      setOcupado('');
    }
  }

  return (
    <div className="fondo-modal" onMouseDown={(e) => e.target === e.currentTarget && onCerrar()}>
      <form className="modal" onSubmit={guardar}>
        <h2>{editando ? `Editar: ${inicial.nombre}` : 'Agregar equipo'}</h2>
        {error && <div className="error">{error}</div>}

        {directo && (
          <label className="campo">
            Tipo de equipo
            <select value={tipo} onChange={(e) => elegirTipo(e.target.value)}>
              {TIPOS.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.texto}
                </option>
              ))}
            </select>
          </label>
        )}

        <div className="grilla dos" style={{ marginTop: '0.75rem' }}>
          <label className="campo">
            Nombre
            <input value={f.nombre} onChange={set('nombre')} placeholder="Ej.: Reloj comedor planta baja" />
          </label>
          <label className="campo">
            Modelo
            <input value={f.modelo} onChange={set('modelo')} placeholder="Ej.: 628-C" />
          </label>
        </div>

        {directo && (
          <>
            <div className="grilla dos" style={{ marginTop: '0.75rem' }}>
              <label className="campo">
                IP del reloj
                <input value={f.ip} onChange={set('ip')} placeholder="192.168.1.201" required />
                <span className="ayuda">En el equipo: Menú → Comunicación → Red</span>
              </label>
              <label className="campo">
                Puerto
                <input type="number" min="1" max="65535" value={f.puerto} onChange={set('puerto')} required />
                <span className="ayuda">Casi siempre 4370</span>
              </label>
            </div>

            <details style={{ marginTop: '0.75rem' }}>
              <summary>Opciones avanzadas</summary>
              <div className="grilla dos" style={{ marginTop: '0.5rem' }}>
                <label className="campo">
                  Conexión
                  <select value={f.protocolo} onChange={set('protocolo')}>
                    {Object.entries(TEXTO_PROTOCOLO).map(([k, v]) => (
                      <option key={k} value={k}>
                        {v}
                      </option>
                    ))}
                  </select>
                  <span className="ayuda">Los equipos antiguos suelen usar solo UDP</span>
                </label>
                <label className="campo">
                  Formato de datos
                  <select value={f.formato} onChange={set('formato')}>
                    <option value="auto">Detectar automáticamente</option>
                    <option value="nuevo">{TEXTO_FORMATO.nuevo}</option>
                    <option value="viejo">{TEXTO_FORMATO.viejo}</option>
                  </select>
                </label>
              </div>
            </details>

            <label className="check" style={{ marginTop: '0.75rem' }}>
              <input type="checkbox" checked={f.horaAutomatica} onChange={set('horaAutomatica')} />
              Poner en hora automáticamente (si el reloj se corre más de 1 minuto)
            </label>

            {editando && (
              <label className="check" style={{ marginTop: '0.75rem' }}>
                <input type="checkbox" checked={f.habilitado} onChange={set('habilitado')} />
                Habilitado (si lo destildás, el sistema deja de conectarse a este equipo)
              </label>
            )}

            {prueba && (
              <div className="aviso" style={{ background: 'var(--ok-bg)', color: 'var(--ok)', marginTop: '0.75rem' }}>
                ✔ Conectado por {prueba.protocolo.toUpperCase()}. N.º de serie: <strong>{prueba.numeroSerie || 'no informa'}</strong>
                {' · '}Firmware: {prueba.firmware || '—'}
                {' · '}Formato: {TEXTO_FORMATO[prueba.formato] || prueba.formato}
                {' · '}
                {prueba.usuarios ?? '—'} usuarios, {prueba.fichadas ?? '—'} fichadas guardadas
              </div>
            )}
            <p style={{ fontSize: '0.85rem', color: 'var(--suave)' }}>
              La clave de comunicación del reloj tiene que estar en 0, y el software de ZKTeco no debería estar conectado al
              mismo tiempo.
            </p>
          </>
        )}

        <div className="modal-pie">
          <button type="button" onClick={onCerrar}>
            Cancelar
          </button>
          {directo && (
            <button type="button" onClick={probar} disabled={!!ocupado || !f.ip.trim()}>
              {ocupado === 'probando' ? 'Probando…' : 'Probar conexión'}
            </button>
          )}
          <button className="primario" disabled={!!ocupado}>
            {ocupado === 'guardando' ? 'Guardando…' : 'Guardar'}
          </button>
        </div>
      </form>
    </div>
  );
}

// --- Base vs. reloj ---
function Comparacion({ equipo, onAviso, onError, version }) {
  const [datos, setDatos] = useState(null);
  const [vista, setVista] = useState('soloBase');

  const cargar = useCallback(() => {
    api(`/dispositivos/${encodeURIComponent(equipo.sn)}/comparacion`).then(setDatos).catch((e) => onError(e.message));
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
              `/dispositivos/${encodeURIComponent(equipo.sn)}/acciones/consultar-usuarios`,
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
                      hacer(`/dispositivos/${encodeURIComponent(equipo.sn)}/usuarios/${u.pin}/enviar`, `${u.nombre} enviado al reloj`)
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
                      hacer(`/dispositivos/${encodeURIComponent(equipo.sn)}/usuarios/${u.pin}/borrar`, `PIN ${u.pin} se borra del reloj`)
                    }
                  >
                    Borrar del reloj
                  </button>
                )}
                {vista === 'sincronizados' && u.nombreDistinto && (
                  <button
                    className="chico"
                    onClick={() =>
                      hacer(`/dispositivos/${encodeURIComponent(equipo.sn)}/usuarios/${u.pin}/enviar`, `Nombre de ${u.nombre} actualizado en el reloj`)
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
    api(`/dispositivos/${encodeURIComponent(sn)}/comandos`).then(setComandos).catch(() => {});
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
function Equipo({ eq, esAdmin, onAviso, onError, recargarLista, version, onEditar }) {
  const [pestania, setPestania] = useState('usuarios');
  const [rango, setRango] = useState({ desde: hoy(), hasta: hoy() });

  async function accion(nombre, texto, { body, confirmar } = {}) {
    for (const c of [].concat(confirmar || [])) if (!window.confirm(c)) return;
    try {
      await api(`/dispositivos/${encodeURIComponent(eq.sn)}/acciones/${nombre}`, { method: 'POST', body });
      onAviso(texto);
      recargarLista();
    } catch (e) {
      onError(e.message);
    }
  }

  async function sincronizar() {
    if (!window.confirm('Se van a reenviar al reloj todos los comensales activos, con su rostro/huella si hay respaldo. ¿Continuar?')) return;
    try {
      const r = await api(`/dispositivos/${encodeURIComponent(eq.sn)}/sincronizar`, { method: 'POST' });
      onAviso(`Se enviaron ${r.usuarios} comensales al reloj (${r.encolados} comandos)`);
      recargarLista();
    } catch (e) {
      onError(e.message);
    }
  }

  async function cambiarHabilitado() {
    const habilitar = eq.habilitado === false;
    if (!habilitar && !window.confirm(`¿Deshabilitar ${eq.nombre}? El sistema deja de conectarse y de mandarle altas y bajas.`)) return;
    try {
      await api(`/dispositivos/${encodeURIComponent(eq.sn)}`, { method: 'PUT', body: { habilitado: habilitar } });
      onAviso(habilitar ? `${eq.nombre} habilitado: se conecta en unos segundos` : `${eq.nombre} deshabilitado`);
      recargarLista();
    } catch (e) {
      onError(e.message);
    }
  }

  async function quitar() {
    if (!window.confirm(`¿Quitar ${eq.nombre} del sistema? Las fichadas que ya trajo se conservan.`)) return;
    try {
      await api(`/dispositivos/${encodeURIComponent(eq.sn)}`, { method: 'DELETE' });
      onAviso(`${eq.nombre} se quitó del sistema`);
      recargarLista();
    } catch (e) {
      onError(e.message);
    }
  }

  const info = eq.info || {};
  const deshabilitado = eq.habilitado === false;

  return (
    <div className="panel">
      <div className="fila entre">
        <h2 style={{ margin: 0 }}>
          {eq.nombre}{' '}
          {deshabilitado ? (
            <span className="tag muted">Deshabilitado</span>
          ) : (
            <span className={`tag ${eq.enLinea ? 'ok' : 'err'}`}>{eq.enLinea ? 'En línea' : 'Sin conexión'}</span>
          )}{' '}
          {eq.comandosPendientes > 0 && <span className="tag warn">{eq.comandosPendientes} comandos en cola</span>}
        </h2>
        {esAdmin && (
          <span className="fila" style={{ gap: '0.4rem' }}>
            <button className="chico" onClick={() => onEditar(eq)}>
              Editar
            </button>
            {eq.modo === '4370' && (
              <button className="chico" onClick={cambiarHabilitado}>
                {deshabilitado ? 'Habilitar' : 'Deshabilitar'}
              </button>
            )}
            <button className="chico peligro" onClick={quitar}>
              Quitar
            </button>
          </span>
        )}
      </div>

      {!eq.enLinea && !deshabilitado && eq.ultimoError && (
        <div className="error" style={{ marginTop: '0.75rem' }}>
          No se puede conectar: {eq.ultimoError} ({fechaHora(eq.ultimoErrorEn)}). Revisá que el equipo esté prendido, la IP y
          el puerto, y que la clave de comunicación esté en 0.
        </div>
      )}

      {!deshabilitado && corrido(eq) && (
        <div className="aviso fila entre" style={{ marginTop: '0.75rem' }}>
          <span>
            ⏰ El reloj está <strong>{textoDesfase(eq.desfaseHora)}</strong>. Las fichadas se registran con su hora, así que
            el servicio y el "ya retiró" se calculan mal.
          </span>
          {esAdmin && (
            <button className="chico primario" onClick={() => accion('poner-hora', 'Poniendo el reloj en hora…')}>
              Poner en hora
            </button>
          )}
        </div>
      )}

      <div className="datos-equipo">
        <div>
          <small>N.º de serie</small>
          {/^IP-/.test(eq.sn) ? 'todavía no informado' : eq.sn}
        </div>
        <div>
          <small>Modelo</small>
          {eq.modelo || '—'}
        </div>
        <div>
          <small>IP</small>
          {eq.ip || '—'}
          {eq.modo === '4370' && eq.puerto && eq.puerto !== 4370 ? `:${eq.puerto}` : ''}
        </div>
        <div>
          <small>Conexión</small>
          {eq.modo === '4370'
            ? `Directa (puerto ${eq.puerto || 4370})${eq.protocoloDetectado ? ` · ${eq.protocoloDetectado.toUpperCase()}` : ''}`
            : 'ADMS (el reloj llama)'}
        </div>
        {eq.modo === '4370' && (
          <div>
            <small>Formato de datos</small>
            {TEXTO_FORMATO[eq.formatoDetectado] || (eq.formato === 'auto' ? 'a detectar' : TEXTO_FORMATO[eq.formato])}
          </div>
        )}
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
        {eq.modo === '4370' && (
          <div>
            <small>Hora del reloj</small>
            {eq.desfaseHora == null ? (
              '—'
            ) : corrido(eq) ? (
              <span className="tag warn">{textoDesfase(eq.desfaseHora)}</span>
            ) : (
              <span className="tag ok">En hora</span>
            )}
            {eq.horaAutomatica && <small style={{ display: 'block' }}>se corrige sola</small>}
          </div>
        )}
      </div>

      <div className="grupo-acciones">
        <span className="titulo">Acciones</span>
        <button className="chico" onClick={() => accion('actualizar', 'Se pidió al reloj que envíe lo pendiente')}>
          Pedir datos nuevos
        </button>
        {eq.modo === '4370' && esAdmin && (
          <button className="chico" onClick={() => accion('poner-hora', 'Poniendo el reloj en hora…')}>
            Poner en hora
          </button>
        )}
        {eq.comandosPendientes > 0 && (
          <button
            className="chico"
            onClick={async () => {
              if (!window.confirm('¿Cancelar los comandos que el reloj todavía no aplicó?')) return;
              try {
                const r = await api(`/dispositivos/${encodeURIComponent(eq.sn)}/comandos/cancelar`, { method: 'POST' });
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
  const [form, setForm] = useState(null); // null | { equipo } (equipo null = agregar)

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

  function guardado(eq, editando) {
    setForm(null);
    onAviso(editando ? 'Cambios guardados' : `${eq.nombre} agregado: el sistema se conecta en unos segundos`);
    cargar();
  }

  return (
    <>
      <div className="fila entre">
        <h1>Equipos</h1>
        {esAdmin && (
          <button className="primario" onClick={() => setForm({ equipo: null })}>
            + Agregar equipo
          </button>
        )}
      </div>
      {error && <div className="error">{error}</div>}
      {mensaje && <div className="aviso" style={{ background: 'var(--ok-bg)', color: 'var(--ok)' }}>{mensaje}</div>}

      {!equipos.length && (
        <div className="panel">
          <p>Todavía no hay ningún reloj.</p>
          <p>
            Usá <strong>Agregar equipo</strong> y cargá la IP del reloj (sirve para el MB360 y para equipos antiguos como el
            628-C). El sistema se conecta por el puerto 4370.
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
          onEditar={(equipo) => setForm({ equipo })}
        />
      ))}

      {form && <FormEquipo inicial={form.equipo} onCerrar={() => setForm(null)} onGuardado={guardado} />}
    </>
  );
}
