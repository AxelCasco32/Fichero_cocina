// Pantalla para la cocina: muestra en grande la última fichada (verde = puede retirar)
// y la lista de las anteriores. Se actualiza sola por Socket.io.
import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../api.js';
import { useEvento } from '../socket.js';
import { hora, hoy, textoResultado, tonoResultado, TZ } from '../util.js';
import FichadaManual from '../components/FichadaManual.jsx';
import { anularFichada } from '../components/acciones.js';

function horaActual() {
  return new Intl.DateTimeFormat('en-GB', { timeZone: TZ, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(
    new Date()
  );
}

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

export default function Monitor() {
  const [fichadas, setFichadas] = useState([]);
  const [ultima, setUltima] = useState(null);
  const [resumen, setResumen] = useState(null);
  const [equipos, setEquipos] = useState([]);
  const [sonido, setSonido] = useState(true);
  const [animar, setAnimar] = useState(false);
  const [error, setError] = useState('');
  const [cargando, setCargando] = useState(false);
  const timer = useRef(null);

  const cargarResumen = useCallback(() => {
    api(`/fichadas/resumen?fecha=${hoy()}`).then(setResumen).catch(() => {});
  }, []);

  useEffect(() => {
    Promise.all([api('/fichadas/recientes?limit=30'), api('/dispositivos')])
      .then(([recientes, disp]) => {
        setFichadas(recientes);
        setUltima(recientes[0] || null);
        setEquipos(disp);
      })
      .catch((e) => setError(e.message));
    cargarResumen();
    const t = setInterval(() => api('/dispositivos').then(setEquipos).catch(() => {}), 30000);
    return () => clearInterval(t);
  }, [cargarResumen]);

  useEvento('fichada', (f) => {
    setFichadas((prev) => [f, ...prev].slice(0, 30));
    setUltima(f);
    setAnimar(true);
    setTimeout(() => setAnimar(false), 600);
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

  useEvento('dispositivo', (d) => {
    setEquipos((prev) => prev.map((e) => (e.sn === d.sn ? { ...e, ultimaConexion: d.ultimaConexion, enLinea: true } : e)));
  });

  const ahora = horaActual();
  const servicios = resumen?.servicios.filter((s) => s.codigo) || [];
  const tono = ultima ? tonoResultado(ultima.resultado) : 'espera';

  return (
    <>
      <div className="fila entre">
        <h1>Monitor en vivo</h1>
        <div className="fila">
          {equipos.map((e) => (
            <span key={e.sn} className={`tag ${e.enLinea ? 'ok' : 'err'}`} title={e.sn}>
              {e.nombre}: {e.enLinea ? 'en línea' : 'sin conexión'}
            </span>
          ))}
          {!equipos.length && <span className="tag muted">Ningún equipo conectado todavía</span>}
          <label className="check">
            <input type="checkbox" checked={sonido} onChange={(e) => setSonido(e.target.checked)} />
            Sonido en rechazos
          </label>
          <button className="primario" onClick={() => setCargando(true)}>
            + Fichada manual
          </button>
        </div>
      </div>

      {cargando && (
        <FichadaManual onCerrar={() => setCargando(false)} onGuardada={() => setCargando(false)} />
      )}

      {error && <div className="error">{error}</div>}

      <div className={`ultima ${tono} ${animar ? 'nueva' : ''}`} role="status" aria-live="polite">
        {ultima ? (
          <>
            <div>
              <div className="nombre">{ultima.nombre || `PIN ${ultima.pin}`}</div>
              <div className="resultado">{textoResultado(ultima.resultado)}</div>
            </div>
            <div className="meta">
              <div className="grande">{hora(ultima.fecha).slice(0, 5)}</div>
              <div>{ultima.servicio ? ultima.servicio[0].toUpperCase() + ultima.servicio.slice(1) : 'Sin servicio'}</div>
              <div>PIN {ultima.pin}</div>
            </div>
          </>
        ) : (
          <div className="nombre">Esperando fichadas…</div>
        )}
      </div>

      <div className="grilla cuatro" style={{ margin: '1rem 0' }}>
        {servicios.map((s) => {
          const actual = ahora >= s.desde && ahora <= s.hasta;
          return (
            <div key={s.codigo} className={`contador ${actual ? 'actual' : ''}`}>
              <small>
                {s.nombre} · {s.desde}–{s.hasta} {actual && '· ahora'}
              </small>
              <div className="valor">{s.porResultado.autorizado || 0}</div>
              <small>
                retiraron · {s.total - (s.porResultado.autorizado || 0)} rechazos
              </small>
            </div>
          );
        })}
      </div>

      <div className="panel">
        <h2>Últimas fichadas</h2>
        <table>
          <thead>
            <tr>
              <th>Hora</th>
              <th>Nombre</th>
              <th>PIN</th>
              <th>Servicio</th>
              <th>Resultado</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {fichadas.map((f) => (
              <tr key={f._id}>
                <td>{hora(f.fecha)}</td>
                <td>
                  {f.nombre || '—'} {f.origen === 'manual' && <span className="tag muted">Manual</span>}
                </td>
                <td>{f.pin}</td>
                <td>{f.servicio || '—'}</td>
                <td>
                  <span className={`tag ${tonoResultado(f.resultado)}`}>{textoResultado(f.resultado)}</span>
                </td>
                <td className="acciones">
                  <button className="chico" onClick={() => anular(f)}>
                    Anular
                  </button>
                </td>
              </tr>
            ))}
            {!fichadas.length && (
              <tr>
                <td colSpan={6} className="vacio">
                  Todavía no hay fichadas.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </>
  );
}
