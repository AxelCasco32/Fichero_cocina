// Monitor en vivo (rediseño): la última fichada en grande, los servicios del día y la actividad
// reciente. Se actualiza solo por Socket.io; las animaciones son de CSS (Monitor.css).
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { NavLink } from 'react-router-dom';
import { api } from '../api.js';
import { useConectado, useEvento } from '../socket.js';
import { activos, enLinea, useAhora, useEquipos } from '../equipos.jsx';
import { hora, hoy, textoResultado, tonoResultado, TZ } from '../util.js';
import Icono from '../components/Icono.jsx';
import FichadaManual from '../components/FichadaManual.jsx';
import { anularFichada } from '../components/acciones.js';
import './Monitor.css';

const COLORES = ['mint', 'blue', 'violet', 'orange'];
const ICONO_RESULTADO = { ok: 'check', warn: 'alerta', err: 'cerrar', muted: 'reloj', espera: 'actividad' };
const PILL = { ok: 'success', err: 'denied', warn: 'warn', muted: 'muted' };

const hhmm = (fecha = new Date()) =>
  new Intl.DateTimeFormat('en-GB', { timeZone: TZ, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(fecha);
const diaCorto = (fecha) =>
  new Intl.DateTimeFormat('es-AR', { timeZone: TZ, day: '2-digit', month: 'short' }).format(new Date(fecha)).replace('.', '');
const diaISO = (fecha) => new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(new Date(fecha));
const minutos = (t) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
const iniciales = (nombre) =>
  (nombre || '')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0].toUpperCase())
    .join('') || '#';

// Pitido corto cuando la fichada es rechazada
function pitido() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const osc = ctx.createOscillator();
    osc.frequency.value = 440;
    osc.connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.35);
    osc.onended = () => ctx.close();
  } catch {
    /* sin audio */
  }
}

function leerPreferencia(clave, porDefecto) {
  try {
    const v = localStorage.getItem(clave);
    return v === null ? porDefecto : v === '1';
  } catch {
    return porDefecto;
  }
}

export default function Monitor() {
  const [fichadas, setFichadas] = useState([]);
  const [ultima, setUltima] = useState(null);
  const [resumen, setResumen] = useState(null);
  const [sonido, setSonido] = useState(() => leerPreferencia('monitor-sonido', true));
  const [busqueda, setBusqueda] = useState('');
  const [filtro, setFiltro] = useState('todos');
  const [error, setError] = useState('');
  const [manual, setManual] = useState(false);
  const { equipos } = useEquipos();
  const conectado = useConectado();
  const ahora = useAhora(15000);
  const timer = useRef(null);

  const cargarResumen = useCallback(() => {
    api(`/fichadas/resumen?fecha=${hoy()}`).then(setResumen).catch(() => {});
  }, []);

  useEffect(() => {
    api('/fichadas/recientes?limit=30')
      .then((recientes) => {
        setFichadas(recientes);
        setUltima(recientes[0] || null);
      })
      .catch((e) => setError(e.message));
    cargarResumen();
  }, [cargarResumen]);

  useEffect(() => {
    try {
      localStorage.setItem('monitor-sonido', sonido ? '1' : '0');
    } catch {
      /* sin almacenamiento */
    }
  }, [sonido]);

  useEvento('fichada', (f) => {
    setFichadas((prev) => [f, ...prev.filter((x) => x._id !== f._id)].slice(0, 30));
    setUltima(f);
    if (sonido && tonoResultado(f.resultado) === 'err') pitido();
    // Agrupamos actualizaciones del resumen si llegan varias fichadas seguidas
    clearTimeout(timer.current);
    timer.current = setTimeout(cargarResumen, 800);
  });

  // Si alguien anula una fichada (desde esta u otra PC), la sacamos de la pantalla
  useEvento('fichada:anulada', ({ _id }) => {
    setFichadas((prev) => {
      const resto = prev.filter((f) => f._id !== _id);
      setUltima((u) => (u && u._id === _id ? resto[0] || null : u));
      return resto;
    });
    cargarResumen();
  });

  async function anular(f) {
    try {
      await anularFichada(f);
    } catch (e) {
      setError(e.message);
    }
  }

  // --- Datos derivados ---
  const nombresServicio = useMemo(
    () => Object.fromEntries((resumen?.servicios || []).filter((s) => s.codigo).map((s) => [s.codigo, s.nombre])),
    [resumen]
  );
  const nombreServicio = (codigo) => (codigo ? nombresServicio[codigo] || codigo[0].toUpperCase() + codigo.slice(1) : '—');

  const ahoraHHMM = hhmm(new Date(ahora));
  const servicios = (resumen?.servicios || []).filter((s) => s.codigo);

  const relojes = activos(equipos);
  const online = relojes.filter((e) => enLinea(e, ahora));

  const texto = busqueda.trim().toLowerCase();
  const visibles = fichadas.filter((f) => {
    const tono = tonoResultado(f.resultado);
    if (filtro === 'ok' && tono !== 'ok') return false;
    if (filtro === 'rechazos' && tono === 'ok') return false;
    if (!texto) return true;
    return `${f.nombre || ''} ${f.pin} ${nombreServicio(f.servicio)} ${textoResultado(f.resultado)}`
      .toLowerCase()
      .includes(texto);
  });

  const tono = ultima ? tonoResultado(ultima.resultado) : 'espera';

  return (
    <>
      <div className="bc-monitor">
        <header className="topbar">
          <div>
            <div className={`eyebrow ${conectado ? '' : 'caido'}`}>
              <span className="live-dot" /> {conectado ? 'EN DIRECTO' : 'SIN CONEXIÓN EN VIVO'}
            </div>
            <h1>Monitor en vivo</h1>
          </div>
          <div className="top-actions">
            {relojes.length === 0 && (
              <div className="connection off">
                <span className="punto-eq" /> Ningún reloj cargado
              </div>
            )}
            {relojes.length > 0 && relojes.length <= 2 &&
              relojes.map((e) => {
                const ok = enLinea(e, ahora);
                return (
                  <div key={e.sn} className={`connection ${ok ? '' : 'off'}`} title={e.sn}>
                    <span className="punto-eq" /> {e.nombre}: {ok ? 'en línea' : 'sin conexión'}
                  </div>
                );
              })}
            {relojes.length > 2 && (
              <div className={`connection ${online.length === relojes.length ? '' : 'off'}`} title={relojes.map((e) => e.nombre).join(', ')}>
                <span className="punto-eq" /> {online.length} de {relojes.length} relojes en línea
              </div>
            )}
            <button
              className={`sound-button ${sonido ? 'on' : ''}`}
              onClick={() => setSonido(!sonido)}
              aria-pressed={sonido}
              title="Pitido cuando una fichada es rechazada"
            >
              <Icono nombre="sonido" tamano={18} />
              <span>Sonido</span>
              <i />
            </button>
            <button className="primary-button" onClick={() => setManual(true)}>
              <Icono nombre="mas" tamano={18} /> Fichada manual
            </button>
          </div>
        </header>

        {error && <div className="error-monitor">{error}</div>}

        <section
          key={ultima?._id || 'espera'}
          className={`arrival-card ${tono}`}
          aria-label="Última fichada recibida"
          role="status"
          aria-live="polite"
        >
          <div className="arrival-accent" />
          <div className="scan-visual">
            <div className="scan-ring ring-1" />
            <div className="scan-ring ring-2" />
            <div className="scan-icon">
              <Icono nombre={ICONO_RESULTADO[tono]} tamano={30} />
            </div>
          </div>
          {ultima ? (
            <>
              <div className="arrival-copy">
                <span className="arrival-label">ÚLTIMA FICHADA RECIBIDA</span>
                <h2>{ultima.nombre || `PIN ${ultima.pin}`}</h2>
                <div className="result-line">
                  <span>{textoResultado(ultima.resultado)}</span>
                  <small>
                    PIN {ultima.pin}
                    {ultima.origen === 'manual' && ' · carga manual'}
                  </small>
                </div>
              </div>
              <div className="arrival-time">
                <strong>{hora(ultima.fecha).slice(0, 5)}</strong>
                <span>{ultima.servicio ? nombreServicio(ultima.servicio) : 'Sin servicio'}</span>
                <small>
                  {diaISO(ultima.fecha) === hoy() ? 'Hoy' : 'El'}, {diaCorto(ultima.fecha)}
                </small>
              </div>
              <button className="details-button" onClick={() => anular(ultima)}>
                Anular <Icono nombre="chevron" tamano={15} />
              </button>
            </>
          ) : (
            <div className="arrival-copy">
              <span className="arrival-label">ESPERANDO FICHADAS</span>
              <h2>Todavía no hay fichadas</h2>
              <div className="result-line">
                <small>Cuando alguien fiche en un reloj, aparece acá al instante.</small>
              </div>
            </div>
          )}
        </section>

        <section className="service-grid" aria-label="Resumen por servicio de hoy">
          {servicios.map((s, i) => {
            const actual = ahoraHHMM >= s.desde && ahoraHHMM <= s.hasta;
            const retiraron = s.porResultado.autorizado || 0;
            const rechazos = s.total - retiraron;
            // La barra muestra cuánto pasó del horario del servicio
            const avance = ahoraHHMM > s.hasta ? 100 : actual
              ? Math.round(((minutos(ahoraHHMM) - minutos(s.desde)) / Math.max(1, minutos(s.hasta) - minutos(s.desde))) * 100)
              : 0;
            const color = COLORES[i % COLORES.length];
            return (
              <article key={s.codigo} className={`service-card ${actual ? 'actual' : ''}`} style={{ '--delay': `${i * 70}ms` }}>
                <div className={`service-icon ${color}`}>
                  <Icono nombre="reloj" tamano={19} />
                </div>
                <div className="service-heading">
                  <strong>
                    {s.nombre}
                    {actual && <span className="ahora-tag">AHORA</span>}
                  </strong>
                  <span>
                    {s.desde}–{s.hasta}
                  </span>
                </div>
                <div className="service-value">{retiraron}</div>
                <div className="service-footer">
                  <span>retiraron</span>
                  <span className={rechazos ? 'has-rejections' : ''}>
                    {rechazos} {rechazos === 1 ? 'rechazo' : 'rechazos'}
                  </span>
                </div>
                <div className={`service-progress ${color}`} title={`${avance}% del horario transcurrido`}>
                  <span style={{ width: `${Math.max(avance, 2)}%` }} />
                </div>
              </article>
            );
          })}
        </section>

        <section className="activity-panel">
          <div className="panel-header">
            <div>
              <h2>Actividad reciente</h2>
              <p>Últimas fichadas recibidas de los relojes y cargadas a mano</p>
            </div>
            <div className="panel-tools">
              <label className="search-box">
                <Icono nombre="buscar" tamano={18} />
                <input value={busqueda} onChange={(e) => setBusqueda(e.target.value)} placeholder="Buscar por nombre o PIN" />
              </label>
              <select className="filtro-select" value={filtro} onChange={(e) => setFiltro(e.target.value)} aria-label="Filtrar">
                <option value="todos">Todas</option>
                <option value="ok">Autorizadas</option>
                <option value="rechazos">Rechazos</option>
              </select>
            </div>
          </div>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Hora</th>
                  <th>Comensal</th>
                  <th>PIN</th>
                  <th>Servicio</th>
                  <th>Resultado</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {visibles.map((f, i) => {
                  const t = tonoResultado(f.resultado);
                  return (
                    <tr key={f._id} style={{ '--row-delay': `${Math.min(i, 12) * 35}ms` }}>
                      <td data-label="Hora">
                        <span className="time-cell">{hora(f.fecha)}</span>
                      </td>
                      <td data-label="Comensal">
                        <div className="person-cell">
                          <div className="mini-avatar">{iniciales(f.nombre)}</div>
                          <strong>{f.nombre || 'Sin nombre'}</strong>
                          {f.origen === 'manual' && <span className="manual-pill">Manual</span>}
                        </div>
                      </td>
                      <td data-label="PIN" className="muted">
                        {f.pin}
                      </td>
                      <td data-label="Servicio">
                        <span className="service-pill">{nombreServicio(f.servicio)}</span>
                      </td>
                      <td data-label="Resultado">
                        <span className={`result-pill ${PILL[t] || 'muted'}`}>
                          <i />
                          {textoResultado(f.resultado)}
                        </span>
                      </td>
                      <td>
                        <button className="row-action" onClick={() => anular(f)} aria-label={`Anular fichada de ${f.nombre || f.pin}`}>
                          Anular
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {visibles.length === 0 && (
              <div className="empty-state">
                {fichadas.length ? 'No hay fichadas que coincidan con la búsqueda.' : 'Todavía no hay fichadas.'}
              </div>
            )}
          </div>
          <div className="panel-footer">
            <span>
              Mostrando {visibles.length} de {fichadas.length} fichadas recientes
            </span>
            <NavLink to="/reportes">
              Ver todo el historial <Icono nombre="chevron" tamano={14} />
            </NavLink>
          </div>
        </section>
      </div>

      {manual && <FichadaManual onCerrar={() => setManual(false)} onGuardada={() => setManual(false)} />}
    </>
  );
}
