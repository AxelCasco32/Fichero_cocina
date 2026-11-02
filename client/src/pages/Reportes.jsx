// Monitoreo por hora y por servicio, más el detalle de fichadas exportable a Excel (CSV)
import { useEffect, useState } from 'react';
import { api } from '../api.js';
import { descargarCSV, fechaHora, hoy, RESULTADOS, textoResultado, tonoResultado } from '../util.js';
import FichadaManual from '../components/FichadaManual.jsx';
import { anularFichada, restaurarFichada } from '../components/acciones.js';

function GraficoPorHora({ horas }) {
  // Mostramos solo el rango de horas con actividad (mínimo 6 a 23)
  const conDatos = horas.filter((h) => h.total > 0).map((h) => h.hora);
  const desde = Math.min(6, ...conDatos);
  const hasta = Math.max(23, ...conDatos);
  const visibles = horas.slice(desde, hasta + 1);
  const max = Math.max(1, ...visibles.map((h) => h.total));

  return (
    <>
      <div className="grafico" role="img" aria-label="Fichadas por hora">
        {visibles.map((h) => {
          const ok = h.autorizado || 0;
          const err = (h.no_autorizado || 0) + (h.desconocido || 0) + (h.servicio_no_habilitado || 0) + (h.ya_retiro || 0);
          const otro = h.total - ok - err;
          const alto = (n) => `${(n / max) * 100}%`;
          return (
            <div
              className="col"
              key={h.hora}
              title={`${String(h.hora).padStart(2, '0')}:00 · ${ok} retiraron · ${err} rechazos · ${otro} fuera de horario`}
            >
              {h.total > 0 && <span className="num">{h.total}</span>}
              {otro > 0 && <div className="seg otro" style={{ height: alto(otro) }} />}
              {err > 0 && <div className="seg err" style={{ height: alto(err) }} />}
              {ok > 0 && <div className="seg ok" style={{ height: alto(ok) }} />}
            </div>
          );
        })}
      </div>
      <div className="ejes">
        {visibles.map((h) => (
          <span key={h.hora}>{String(h.hora).padStart(2, '0')}</span>
        ))}
      </div>
      <div className="leyenda">
        <span>
          <i style={{ background: 'var(--ok)' }} />
          Retiraron
        </span>
        <span>
          <i style={{ background: 'var(--err)' }} />
          Rechazos
        </span>
        <span>
          <i style={{ background: '#b9c4c0' }} />
          Fuera de horario
        </span>
      </div>
    </>
  );
}

export default function Reportes() {
  const [fecha, setFecha] = useState(hoy());
  const [horas, setHoras] = useState([]);
  const [resumen, setResumen] = useState(null);
  const [filtros, setFiltros] = useState({ resultado: '', servicio: '', pin: '', origen: '', anuladas: 'excluir' });
  const [lista, setLista] = useState({ items: [], total: 0, limit: 100 });
  const [page, setPage] = useState(1);
  const [error, setError] = useState('');
  const [exportando, setExportando] = useState(false);
  const [cargandoManual, setCargandoManual] = useState(false);
  const [version, setVersion] = useState(0); // se incrementa para recargar todo
  const recargar = () => setVersion((v) => v + 1);

  useEffect(() => {
    setError('');
    Promise.all([api(`/fichadas/por-hora?fecha=${fecha}`), api(`/fichadas/resumen?fecha=${fecha}`)])
      .then(([h, r]) => {
        setHoras(h);
        setResumen(r);
      })
      .catch((e) => setError(e.message));
  }, [fecha, version]);

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

  const parametros = (extra = {}) => {
    const p = new URLSearchParams({ fecha, ...extra });
    for (const [k, v] of Object.entries(filtros)) if (v) p.set(k, v.trim());
    return p;
  };

  useEffect(() => {
    api(`/fichadas?${parametros({ page, limit: 100 })}`)
      .then(setLista)
      .catch((e) => setError(e.message));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fecha, filtros, page, version]);

  async function exportar() {
    setExportando(true);
    try {
      const todas = [];
      for (let p = 1; ; p++) {
        const r = await api(`/fichadas?${parametros({ page: p, limit: 500 })}`);
        todas.push(...r.items);
        if (todas.length >= r.total || !r.items.length) break;
      }
      descargarCSV(`fichadas-${fecha}.csv`, todas, [
        { titulo: 'Fecha y hora', valor: (f) => fechaHora(f.fecha) },
        { titulo: 'PIN', valor: (f) => f.pin },
        { titulo: 'Nombre', valor: (f) => f.nombre },
        { titulo: 'Servicio', valor: (f) => f.servicio || '' },
        { titulo: 'Resultado', valor: (f) => textoResultado(f.resultado) },
        { titulo: 'Origen', valor: (f) => (f.origen === 'manual' ? `Manual (${f.cargadaPor})` : f.deviceSn) },
        { titulo: 'Motivo carga', valor: (f) => f.motivo || '' },
        { titulo: 'Anulada', valor: (f) => (f.anulada ? `Sí: ${f.anuladaMotivo} (${f.anuladaPor})` : '') },
      ]);
    } catch (e) {
      setError(e.message);
    } finally {
      setExportando(false);
    }
  }

  const setFiltro = (k) => (e) => {
    setFiltros({ ...filtros, [k]: e.target.value });
    setPage(1);
  };
  const paginas = Math.max(1, Math.ceil(lista.total / lista.limit));
  const totalDia = horas.reduce((s, h) => s + h.total, 0);

  return (
    <>
      {cargandoManual && (
        <FichadaManual
          onCerrar={() => setCargandoManual(false)}
          onGuardada={() => {
            setCargandoManual(false);
            recargar();
          }}
        />
      )}

      <div className="fila entre">
        <h1>Reportes</h1>
        <div className="fila">
        <button className="primario" onClick={() => setCargandoManual(true)}>
          + Fichada manual
        </button>
        <label className="fila">
          Día
          <input
            type="date"
            value={fecha}
            max={hoy()}
            onChange={(e) => {
              setFecha(e.target.value || hoy());
              setPage(1);
            }}
          />
        </label>
        </div>
      </div>

      {error && <div className="error">{error}</div>}

      <div className="panel">
        <div className="fila entre">
          <h2>Fichadas por hora</h2>
          <small>{totalDia} fichadas en el día</small>
        </div>
        <GraficoPorHora horas={horas} />
      </div>

      {resumen && (
        <div className="panel">
          <h2>Por servicio</h2>
          <table>
            <thead>
              <tr>
                <th>Servicio</th>
                <th>Retiraron</th>
                <th>Ya habían retirado</th>
                <th>No autorizados</th>
                <th>No registrados</th>
                <th>Total</th>
              </tr>
            </thead>
            <tbody>
              {resumen.servicios.map((s) => (
                <tr key={s.codigo || 'fuera'}>
                  <td>
                    <strong>{s.nombre}</strong> {s.desde && <small>{s.desde}–{s.hasta}</small>}
                  </td>
                  <td>{s.porResultado.autorizado || 0}</td>
                  <td>{s.porResultado.ya_retiro || 0}</td>
                  <td>{(s.porResultado.no_autorizado || 0) + (s.porResultado.servicio_no_habilitado || 0)}</td>
                  <td>{s.porResultado.desconocido || 0}</td>
                  <td>{s.total}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="panel">
        <div className="fila entre" style={{ marginBottom: '0.75rem' }}>
          <h2 style={{ margin: 0 }}>Detalle</h2>
          <div className="fila">
            <input placeholder="PIN" value={filtros.pin} onChange={setFiltro('pin')} style={{ width: 100 }} />
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
            <select value={filtros.resultado} onChange={setFiltro('resultado')}>
              <option value="">Todos los resultados</option>
              {Object.entries(RESULTADOS).map(([k, v]) => (
                <option key={k} value={k}>
                  {v.texto}
                </option>
              ))}
            </select>
            <select value={filtros.origen} onChange={setFiltro('origen')}>
              <option value="">Reloj y manuales</option>
              <option value="reloj">Solo del reloj</option>
              <option value="manual">Solo manuales</option>
            </select>
            <select value={filtros.anuladas} onChange={setFiltro('anuladas')}>
              <option value="excluir">Sin anuladas</option>
              <option value="incluir">Con anuladas</option>
              <option value="solo">Solo anuladas</option>
            </select>
            <button onClick={exportar} disabled={exportando || !lista.total}>
              {exportando ? 'Exportando…' : 'Exportar a Excel'}
            </button>
          </div>
        </div>
        <table>
          <thead>
            <tr>
              <th>Fecha y hora</th>
              <th>Nombre</th>
              <th>PIN</th>
              <th>Servicio</th>
              <th>Resultado</th>
              <th>Origen</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {lista.items.map((f) => (
              <tr key={f._id} className={f.anulada ? 'anulada' : ''}>
                <td>{fechaHora(f.fecha)}</td>
                <td>{f.nombre || '—'}</td>
                <td>{f.pin}</td>
                <td>{f.servicio || '—'}</td>
                <td>
                  <span className={`tag ${tonoResultado(f.resultado)}`}>{textoResultado(f.resultado)}</span>
                </td>
                <td>
                  {f.origen === 'manual' ? (
                    <span title={f.motivo}>
                      Manual <small>({f.cargadaPor})</small>
                    </span>
                  ) : (
                    'Reloj'
                  )}
                </td>
                <td className="acciones">
                  {f.anulada ? (
                    <>
                      <small title={f.anuladaMotivo} style={{ marginRight: '0.4rem' }}>
                        Anulada por {f.anuladaPor}
                      </small>
                      <button className="chico" onClick={() => restaurar(f)}>
                        Restaurar
                      </button>
                    </>
                  ) : (
                    <button className="chico" onClick={() => anular(f)}>
                      Anular
                    </button>
                  )}
                </td>
              </tr>
            ))}
            {!lista.items.length && (
              <tr>
                <td colSpan={7} className="vacio">
                  Sin fichadas para este filtro.
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
    </>
  );
}
