// Reportes (rediseño): indicadores del período, gráfico (por hora en un día, por día en 7/30 días),
// resumen por servicio y detalle filtrable con exportación a Excel.
// Usa los estilos del monitor (.bc-monitor) más los propios (Reportes.css).
import { useEffect, useMemo, useState } from 'react';
import { api } from '../api.js';
import { detalleFichada, fechaHora, hoy, RESULTADOS, textoResultado, tonoResultado, TZ } from '../util.js';
import Icono from '../components/Icono.jsx';
import FichadaManual from '../components/FichadaManual.jsx';
import { anularFichada, restaurarFichada } from '../components/acciones.js';
import './Monitor.css';
import './Reportes.css';

const PERIODOS = [
  { id: 'dia', texto: 'Día', dias: 1 },
  { id: '7', texto: '7 días', dias: 7 },
  { id: '30', texto: '30 días', dias: 30 },
];
const PILL = { ok: 'success', err: 'denied', warn: 'warn', muted: 'muted' };
const RECHAZOS = ['no_autorizado', 'servicio_no_habilitado', 'desconocido', 'limite_diario'];

// --- Fechas (todas en la zona del hospital) ---
const sumarDias = (dia, n) => {
  const t = new Date(`${dia}T12:00:00Z`);
  t.setUTCDate(t.getUTCDate() + n);
  return t.toISOString().slice(0, 10);
};
const fmt = (opciones) => new Intl.DateTimeFormat('es-AR', { timeZone: TZ, ...opciones });
const diaLargo = (dia) => fmt({ day: 'numeric', month: 'short', year: 'numeric' }).format(new Date(`${dia}T12:00:00Z`)).replace('.', '');
const diaCorto = (dia) => fmt({ day: '2-digit', month: '2-digit' }).format(new Date(`${dia}T12:00:00Z`));
const fechaFila = (f) => {
  const d = new Date(f);
  return `${fmt({ day: 'numeric', month: 'short' }).format(d).replace('.', '')} · ${fmt({ hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(d)}`;
};
const horaCorta = (f) => fmt({ hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(f));
const iniciales = (nombre) =>
  (nombre || '')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0].toUpperCase())
    .join('') || '#';

// Totales de un resumen por servicio
function totales(resumen) {
  const t = { total: 0, ok: 0, repetidas: 0, rechazos: 0, fuera: 0 };
  for (const s of resumen?.servicios || []) {
    const r = s.porResultado;
    t.total += s.total;
    t.ok += r.autorizado || 0;
    t.repetidas += r.ya_retiro || 0;
    t.rechazos += RECHAZOS.reduce((n, k) => n + (r[k] || 0), 0);
    t.fuera += r.fuera_de_horario || 0;
  }
  return t;
}

// Separa una fila (de una hora o de un día) en retiraron / rechazos / fuera de horario
function partes(fila) {
  const ok = fila.autorizado || 0;
  const fuera = fila.fuera_de_horario || 0;
  return { ok, fuera, err: fila.total - ok - fuera };
}

function Grafico({ filas, etiqueta, titulo }) {
  const max = Math.max(1, ...filas.map((f) => f.total));
  // Escala "redonda" para el eje
  const paso = Math.max(1, Math.ceil(max / 3));
  const tope = paso * 3;
  const alto = (n) => `${(n / tope) * 100}%`;
  return (
    <div className="chart-body" role="img" aria-label={titulo}>
      <div className="y-axis">
        {[3, 2, 1, 0].map((i) => (
          <span key={i}>{paso * i}</span>
        ))}
      </div>
      <div className="bars">
        {filas.map((f) => {
          const p = partes(f);
          return (
            <div className="bar-column" key={etiqueta(f)}>
              <div
                className="bar-stack"
                title={`${etiqueta(f)} · ${f.total} fichadas: ${p.ok} retiraron, ${p.err} rechazos, ${p.fuera} fuera de horario`}
              >
                {f.total > 0 && (
                  <span className="bar-total" style={{ bottom: alto(f.total) }}>
                    {f.total}
                  </span>
                )}
                {p.ok > 0 && <span className="bar ok" style={{ height: alto(p.ok) }} />}
                {p.err > 0 && <span className="bar denied" style={{ height: alto(p.err) }} />}
                {p.fuera > 0 && <span className="bar late" style={{ height: alto(p.fuera) }} />}
              </div>
              <small>{etiqueta(f)}</small>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default function Reportes() {
  const [hasta, setHasta] = useState(hoy());
  const [periodo, setPeriodo] = useState('dia');
  const [grafico, setGrafico] = useState({ porHora: true, filas: [] }); // el tipo viaja con los datos
  const [resumen, setResumen] = useState(null);
  const [anterior, setAnterior] = useState(null);
  const [filtros, setFiltros] = useState({ resultado: '', servicio: '', pin: '', origen: '', anuladas: 'excluir' });
  const [lista, setLista] = useState({ items: [], total: 0, limit: 100 });
  const [page, setPage] = useState(1);
  const [error, setError] = useState('');
  const [exportando, setExportando] = useState(false);
  const [manual, setManual] = useState(false);
  const [version, setVersion] = useState(0); // se incrementa para recargar todo
  const recargar = () => setVersion((v) => v + 1);

  const dias = PERIODOS.find((p) => p.id === periodo).dias;
  const desde = sumarDias(hasta, -(dias - 1));
  const rango = useMemo(() => new URLSearchParams({ desde, hasta }).toString(), [desde, hasta]);
  const rangoAnterior = new URLSearchParams({ desde: sumarDias(desde, -dias), hasta: sumarDias(desde, -1) }).toString();

  useEffect(() => {
    setError('');
    Promise.all([
      api(dias === 1 ? `/fichadas/por-hora?${rango}` : `/fichadas/por-dia?${rango}`),
      api(`/fichadas/resumen?${rango}`),
      api(`/fichadas/resumen?${rangoAnterior}`).catch(() => null),
    ])
      .then(([g, r, ant]) => {
        setGrafico({ porHora: dias === 1, filas: g });
        setResumen(r);
        setAnterior(ant);
      })
      .catch((e) => setError(e.message));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rango, version]);

  const parametros = (extra = {}) => {
    const p = new URLSearchParams({ desde, hasta, ...extra });
    for (const [k, v] of Object.entries(filtros)) if (v) p.set(k, v.trim());
    return p;
  };

  useEffect(() => {
    api(`/fichadas?${parametros({ page, limit: 100 })}`)
      .then(setLista)
      .catch((e) => setError(e.message));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rango, filtros, page, version]);

  async function anular(f) {
    try {
      if (await anularFichada(f)) recargar();
    } catch (e) {
      setError(e.message);
    }
  }

  async function restaurar(f) {
    try {
      await restaurarFichada(f);
      recargar();
    } catch (e) {
      setError(e.message);
    }
  }

  const nombreServicio = (codigo) =>
    codigo ? resumen?.servicios.find((s) => s.codigo === codigo)?.nombre || codigo : '—';

  async function exportar() {
    setExportando(true);
    setError('');
    try {
      const todas = [];
      for (let p = 1; ; p++) {
        const r = await api(`/fichadas?${parametros({ page: p, limit: 500 })}`);
        todas.push(...r.items);
        if (todas.length >= r.total || !r.items.length) break;
      }
      const { default: writeXlsxFile } = await import('write-excel-file/browser');
      const titulo = (t) => ({ value: t, fontWeight: 'bold', backgroundColor: '#E3F2EE' });
      const texto = (v) => ({ value: v ? String(v) : null, type: String });
      const columnas = [
        { header: titulo('Fecha y hora'), cell: (f) => texto(fechaHora(f.fecha)), width: 18 },
        { header: titulo('PIN'), cell: (f) => texto(f.pin), width: 12 },
        { header: titulo('Nombre'), cell: (f) => texto(f.nombre), width: 30 },
        { header: titulo('Servicio'), cell: (f) => texto(f.servicio ? nombreServicio(f.servicio) : ''), width: 14 },
        { header: titulo('Resultado'), cell: (f) => texto(textoResultado(f.resultado)), width: 22 },
        { header: titulo('Motivo'), cell: (f) => texto(detalleFichada(f)), width: 48 },
        { header: titulo('Origen'), cell: (f) => texto(f.origen === 'manual' ? `Manual (${f.cargadaPor})` : `Reloj ${f.deviceSn}`), width: 22 },
        { header: titulo('Motivo de la carga'), cell: (f) => texto(f.motivo), width: 26 },
        { header: titulo('Anulada'), cell: (f) => texto(f.anulada ? `Sí: ${f.anuladaMotivo || ''} (${f.anuladaPor})` : ''), width: 28 },
      ];
      const nombre = dias === 1 ? `fichadas-${hasta}.xlsx` : `fichadas-${desde}-a-${hasta}.xlsx`;
      await writeXlsxFile(todas, { columns: columnas, sheet: 'Fichadas', stickyRowsCount: 1 }).toFile(nombre);
    } catch (e) {
      setError(`No se pudo exportar: ${e.message}`);
    } finally {
      setExportando(false);
    }
  }

  const setFiltro = (k) => (e) => {
    setFiltros({ ...filtros, [k]: e.target.value });
    setPage(1);
  };

  // --- Indicadores ---
  const t = totales(resumen);
  const tAnt = anterior ? totales(anterior) : null;
  const pct = (n, d) => (d ? `${((n / d) * 100).toLocaleString('es-AR', { maximumFractionDigits: 1 })}%` : '0%');
  let comparacion = null;
  if (tAnt) {
    const nombreAnt = dias === 1 ? 'el día anterior' : `los ${dias} días anteriores`;
    if (!tAnt.total) comparacion = <>Sin fichadas en {nombreAnt}</>;
    else {
      const cambio = Math.round(((t.total - tAnt.total) / tAnt.total) * 100);
      comparacion = (
        <>
          <b className={cambio < 0 ? 'baja' : ''}>
            {cambio > 0 ? '+' : ''}
            {cambio}%
          </b>{' '}
          frente a {nombreAnt}
        </>
      );
    }
  }

  // Gráfico: en un día, de 6 a 23 h (o más si hubo actividad fuera de ese rango)
  const porHora = grafico.porHora;
  let filasGrafico = grafico.filas;
  if (porHora && filasGrafico.length) {
    const conDatos = filasGrafico.filter((h) => h.total > 0).map((h) => h.hora);
    filasGrafico = filasGrafico.slice(Math.min(6, ...conDatos), Math.max(23, ...conDatos) + 1);
  }

  const paginas = Math.max(1, Math.ceil(lista.total / lista.limit));
  const textoPeriodo = dias === 1 ? (hasta === hoy() ? 'hoy' : diaLargo(hasta)) : `${diaLargo(desde)} al ${diaLargo(hasta)}`;

  return (
    <>
      <div className="bc-monitor bc-reportes">
        <header className="topbar report-topbar">
          <div>
            <div className="eyebrow">ANÁLISIS DE ACTIVIDAD</div>
            <h1>Reportes</h1>
          </div>
          <div className="top-actions">
            <div className="period-switch" role="group" aria-label="Período">
              {PERIODOS.map((p) => (
                <button
                  key={p.id}
                  className={periodo === p.id ? 'active' : ''}
                  aria-pressed={periodo === p.id}
                  onClick={() => {
                    setPeriodo(p.id);
                    setPage(1);
                  }}
                >
                  {p.texto}
                </button>
              ))}
            </div>
            <label className="date-button report-date" title={dias === 1 ? 'Elegir el día' : 'Elegir el último día del período'}>
              <Icono nombre="calendario" tamano={17} />
              <span>{dias === 1 ? diaLargo(hasta) : `hasta ${diaLargo(hasta)}`}</span>
              <input
                type="date"
                value={hasta}
                max={hoy()}
                onChange={(e) => {
                  setHasta(e.target.value || hoy());
                  setPage(1);
                }}
                aria-label="Fecha"
              />
            </label>
            <button className="primary-button report-manual" onClick={() => setManual(true)}>
              <Icono nombre="mas" tamano={18} /> Fichada manual
            </button>
          </div>
        </header>

        {error && <div className="error-monitor">{error}</div>}

        <section className="report-kpis" aria-label={`Indicadores de ${textoPeriodo}`}>
          <article>
            <div className="kpi-icon green">
              <Icono nombre="check" />
            </div>
            <div>
              <span>Total fichadas</span>
              <strong>{t.total}</strong>
              <small>{comparacion || ' '}</small>
            </div>
          </article>
          <article>
            <div className="kpi-icon teal">
              <Icono nombre="comensales" />
            </div>
            <div>
              <span>Retiraron</span>
              <strong>{t.ok}</strong>
              <small>{pct(t.ok, t.total)} del total</small>
            </div>
          </article>
          <article>
            <div className="kpi-icon red">
              <Icono nombre="cerrar" />
            </div>
            <div>
              <span>Incidencias</span>
              <strong>{t.rechazos + t.repetidas}</strong>
              <small>
                {t.rechazos} {t.rechazos === 1 ? 'rechazo' : 'rechazos'} · {t.repetidas}{' '}
                {t.repetidas === 1 ? 'repetida' : 'repetidas'}
              </small>
            </div>
          </article>
          <article>
            <div className="kpi-icon slate">
              <Icono nombre="reloj" />
            </div>
            <div>
              <span>Fuera de horario</span>
              <strong>{t.fuera}</strong>
              <small>
                {resumen?.ultimaFueraDeHorario
                  ? dias === 1
                    ? `Última a las ${horaCorta(resumen.ultimaFueraDeHorario)}`
                    : `Última: ${fechaFila(resumen.ultimaFueraDeHorario)}`
                  : 'Ninguna'}
              </small>
            </div>
          </article>
        </section>

        <section className="report-card chart-card">
          <div className="report-card-head">
            <div>
              <h2>{porHora ? 'Fichadas por hora' : 'Fichadas por día'}</h2>
              <p>{porHora ? 'Distribución de la actividad durante el día' : `Actividad del ${textoPeriodo}`}</p>
            </div>
            <div className="chart-legend">
              <span>
                <i className="ok" />
                Retiraron
              </span>
              <span>
                <i className="denied" />
                Rechazos y repetidas
              </span>
              <span>
                <i className="late" />
                Fuera de horario
              </span>
            </div>
          </div>
          <Grafico
            filas={filasGrafico}
            titulo={porHora ? 'Fichadas por hora' : 'Fichadas por día'}
            etiqueta={(f) => (porHora ? String(f.hora).padStart(2, '0') : diaCorto(f.dia))}
          />
        </section>

        <section className="report-card breakdown-card">
          <div className="report-card-head">
            <div>
              <h2>Resumen por servicio</h2>
              <p>Resultado de las fichadas por franja de comida · {textoPeriodo}</p>
            </div>
          </div>
          <div className="breakdown-list">
            <div className="breakdown-row breakdown-header">
              <span>Servicio</span>
              <span>Retiraron</span>
              <span>Ya habían retirado</span>
              <span>Límite diario</span>
              <span>No autorizados</span>
              <span>No registrados</span>
              <span>Total</span>
            </div>
            {(resumen?.servicios || []).map((s) => {
              const r = s.porResultado;
              const noAut = (r.no_autorizado || 0) + (r.servicio_no_habilitado || 0);
              return (
                <div className="breakdown-row" key={s.codigo || 'fuera'}>
                  <div>
                    <strong>{s.nombre}</strong>
                    <small>{s.desde ? `${s.desde}–${s.hasta}` : 'Sin servicio'}</small>
                  </div>
                  <span data-label="Retiraron">{r.autorizado || 0}</span>
                  <span data-label="Repetidas">{r.ya_retiro || 0}</span>
                  <span data-label="Límite" className={r.limite_diario ? 'danger-number' : ''}>
                    {r.limite_diario || 0}
                  </span>
                  <span data-label="No autorizados" className={noAut ? 'danger-number' : ''}>
                    {noAut}
                  </span>
                  <span data-label="No registrados" className={r.desconocido ? 'danger-number' : ''}>
                    {r.desconocido || 0}
                  </span>
                  <strong data-label="Total">{s.total}</strong>
                </div>
              );
            })}
          </div>
        </section>

        <section className="activity-panel report-detail">
          <div className="panel-header">
            <div>
              <h2>Detalle de fichadas</h2>
              <p>Consultá y filtrá el registro completo · {textoPeriodo}</p>
            </div>
            <div className="report-filters">
              <label className="compact-select">
                <span>PIN</span>
                <input value={filtros.pin} onChange={setFiltro('pin')} placeholder="Todos" inputMode="numeric" />
              </label>
              <label className="compact-select">
                <span>Servicio</span>
                <select value={filtros.servicio} onChange={setFiltro('servicio')}>
                  <option value="">Todos los servicios</option>
                  {resumen?.servicios
                    .filter((s) => s.codigo)
                    .map((s) => (
                      <option key={s.codigo} value={s.codigo}>
                        {s.nombre}
                      </option>
                    ))}
                </select>
              </label>
              <label className="compact-select">
                <span>Resultado</span>
                <select value={filtros.resultado} onChange={setFiltro('resultado')}>
                  <option value="">Todos los resultados</option>
                  {Object.entries(RESULTADOS).map(([k, v]) => (
                    <option key={k} value={k}>
                      {v.texto}
                    </option>
                  ))}
                </select>
              </label>
              <label className="compact-select">
                <span>Origen</span>
                <select value={filtros.origen} onChange={setFiltro('origen')}>
                  <option value="">Reloj y manuales</option>
                  <option value="reloj">Solo del reloj</option>
                  <option value="manual">Solo manuales</option>
                </select>
              </label>
              <label className="compact-select">
                <span>Anuladas</span>
                <select value={filtros.anuladas} onChange={setFiltro('anuladas')}>
                  <option value="excluir">Sin anuladas</option>
                  <option value="incluir">Con anuladas</option>
                  <option value="solo">Solo anuladas</option>
                </select>
              </label>
              <button className="export-button" onClick={exportar} disabled={exportando || !lista.total}>
                <Icono nombre="descargar" tamano={16} /> {exportando ? 'Exportando…' : 'Exportar a Excel'}
              </button>
            </div>
          </div>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Fecha y hora</th>
                  <th>Comensal</th>
                  <th>PIN</th>
                  <th>Servicio</th>
                  <th>Resultado</th>
                  <th>Origen</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {lista.items.map((f, i) => {
                  const tono = tonoResultado(f.resultado);
                  return (
                    <tr key={f._id} className={f.anulada ? 'fila-anulada' : ''} style={{ '--row-delay': `${Math.min(i, 12) * 35}ms` }}>
                      <td data-label="Fecha y hora">
                        <span className="time-cell">{fechaFila(f.fecha)}</span>
                      </td>
                      <td data-label="Comensal">
                        <div className="person-cell">
                          <div className="mini-avatar">{iniciales(f.nombre)}</div>
                          <strong>{f.nombre || 'Sin nombre'}</strong>
                        </div>
                      </td>
                      <td data-label="PIN" className="muted">
                        {f.pin}
                      </td>
                      <td data-label="Servicio">
                        <span className="service-pill">{nombreServicio(f.servicio)}</span>
                      </td>
                      <td data-label="Resultado">
                        <span className={`result-pill ${PILL[tono] || 'muted'}`} title={detalleFichada(f)}>
                          <i />
                          {textoResultado(f.resultado)}
                        </span>
                        {tono !== 'ok' && <small className="motivo-fila">{detalleFichada(f)}</small>}
                      </td>
                      <td data-label="Origen" className="muted">
                        {f.origen === 'manual' ? (
                          <span title={f.motivo}>
                            Manual <small>({f.cargadaPor})</small>
                          </span>
                        ) : (
                          'Reloj'
                        )}
                      </td>
                      <td>
                        {f.anulada ? (
                          <span className="acciones-anulada">
                            <small title={f.anuladaMotivo}>Anulada por {f.anuladaPor}</small>
                            <button className="row-action" onClick={() => restaurar(f)}>
                              Restaurar
                            </button>
                          </span>
                        ) : (
                          <button className="row-action" onClick={() => anular(f)} aria-label={`Anular fichada de ${f.nombre || f.pin}`}>
                            Anular
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {!lista.items.length && <div className="empty-state">No hay fichadas para estos filtros.</div>}
          </div>
          <div className="panel-footer">
            <span>
              Mostrando {lista.items.length} de {lista.total} fichadas
            </span>
            {paginas > 1 && (
              <span className="paginador">
                <button disabled={page <= 1} onClick={() => setPage(page - 1)}>
                  Anterior
                </button>
                <span>
                  Página {page} de {paginas}
                </span>
                <button disabled={page >= paginas} onClick={() => setPage(page + 1)}>
                  Siguiente <Icono nombre="chevron" tamano={14} />
                </button>
              </span>
            )}
          </div>
        </section>
      </div>

      {manual && (
        <FichadaManual
          onCerrar={() => setManual(false)}
          onGuardada={() => {
            setManual(false);
            recargar();
          }}
        />
      )}
    </>
  );
}
