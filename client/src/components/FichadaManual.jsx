// Ventana para cargar una fichada a mano: buscar la persona, elegir hora y motivo.
// Muestra antes de guardar qué resultado va a tener (autorizado, ya retiró, etc.).
import { useEffect, useState } from 'react';
import { api } from '../api.js';
import { TZ, textoResultado, tonoResultado } from '../util.js';

const MOTIVOS = ['El reloj no lo reconoció', 'Equipo sin funcionar', 'Corte de luz / sin red', 'Olvidó fichar', 'Otro'];

// "YYYY-MM-DDTHH:MM" de ahora en hora local, para el <input type="datetime-local">
function ahoraLocal() {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat('en-CA', {
      timeZone: TZ,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    })
      .formatToParts(new Date())
      .map((x) => [x.type, x.value])
  );
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}`;
}

export default function FichadaManual({ onCerrar, onGuardada }) {
  const [busqueda, setBusqueda] = useState('');
  const [opciones, setOpciones] = useState([]);
  const [persona, setPersona] = useState(null);
  const [fecha, setFecha] = useState(ahoraLocal());
  const [servicio, setServicio] = useState('');
  const [servicios, setServicios] = useState([]);
  const [motivo, setMotivo] = useState(MOTIVOS[0]);
  const [detalle, setDetalle] = useState('');
  const [vista, setVista] = useState(null);
  const [error, setError] = useState('');
  const [guardando, setGuardando] = useState(false);

  useEffect(() => {
    api('/fichadas/servicios').then(setServicios).catch(() => {});
  }, []);

  // Búsqueda de personas mientras se escribe
  useEffect(() => {
    if (persona || busqueda.trim().length < 2) return setOpciones([]);
    const t = setTimeout(() => {
      api(`/comensales?estado=activos&limit=8&q=${encodeURIComponent(busqueda.trim())}`)
        .then((r) => setOpciones(r.items))
        .catch(() => {});
    }, 250);
    return () => clearTimeout(t);
  }, [busqueda, persona]);

  // Vista previa del resultado
  useEffect(() => {
    setVista(null);
    if (!persona || !fecha) return;
    api('/fichadas/manual/evaluar', { method: 'POST', body: { pin: persona.pin, fecha, servicio } })
      .then((r) => {
        setVista(r);
        setError('');
      })
      .catch((e) => setError(e.message));
  }, [persona, fecha, servicio]);

  async function guardar(e) {
    e.preventDefault();
    setGuardando(true);
    setError('');
    const textoMotivo = motivo === 'Otro' ? detalle.trim() : detalle.trim() ? `${motivo}: ${detalle.trim()}` : motivo;
    try {
      const f = await api('/fichadas/manual', {
        method: 'POST',
        body: { pin: persona.pin, fecha, servicio, motivo: textoMotivo },
      });
      onGuardada(f);
    } catch (err) {
      setError(err.message);
      setGuardando(false);
    }
  }

  return (
    <div className="fondo-modal" onMouseDown={(e) => e.target === e.currentTarget && onCerrar()}>
      <form className="modal" onSubmit={guardar}>
        <h2>Cargar fichada manual</h2>
        {error && <div className="error">{error}</div>}

        {!persona ? (
          <label className="campo">
            Persona
            <input
              autoFocus
              placeholder="Escribí nombre, PIN o DNI"
              value={busqueda}
              onChange={(e) => setBusqueda(e.target.value)}
            />
            {opciones.length > 0 && (
              <div className="lista-opciones">
                {opciones.map((c) => (
                  <button type="button" key={c._id} onClick={() => setPersona(c)}>
                    <strong>{c.nombre}</strong> <small>PIN {c.pin}{c.sector ? ` · ${c.sector}` : ''}</small>
                  </button>
                ))}
              </div>
            )}
            {busqueda.trim().length >= 2 && !opciones.length && <span className="ayuda">Sin resultados</span>}
          </label>
        ) : (
          <div className="persona-elegida">
            <div>
              <strong>{persona.nombre}</strong>
              <small style={{ display: 'block' }}>
                PIN {persona.pin}
                {persona.sector ? ` · ${persona.sector}` : ''}
              </small>
            </div>
            <button type="button" className="chico" onClick={() => setPersona(null)}>
              Cambiar
            </button>
          </div>
        )}

        <div className="grilla dos" style={{ marginTop: '0.75rem' }}>
          <label className="campo">
            Fecha y hora
            <input type="datetime-local" value={fecha} max={ahoraLocal()} onChange={(e) => setFecha(e.target.value)} required />
          </label>
          <label className="campo">
            Servicio
            <select value={servicio} onChange={(e) => setServicio(e.target.value)}>
              <option value="">Según el horario</option>
              {servicios.map((s) => (
                <option key={s.codigo} value={s.codigo}>
                  {s.nombre} ({s.desde}–{s.hasta})
                </option>
              ))}
            </select>
          </label>
        </div>

        <div className="grilla dos" style={{ marginTop: '0.75rem' }}>
          <label className="campo">
            Motivo
            <select value={motivo} onChange={(e) => setMotivo(e.target.value)}>
              {MOTIVOS.map((m) => (
                <option key={m}>{m}</option>
              ))}
            </select>
          </label>
          <label className="campo">
            Detalle {motivo === 'Otro' ? '' : '(opcional)'}
            <input value={detalle} onChange={(e) => setDetalle(e.target.value)} required={motivo === 'Otro'} />
          </label>
        </div>

        {vista && (
          <div className={`vista-previa ${tonoResultado(vista.resultado)}`}>
            Resultado: <strong>{textoResultado(vista.resultado)}</strong>
            {vista.servicio && ` · ${vista.servicio}`}
            {vista.resultado !== 'autorizado' && (
              <small style={{ display: 'block' }}>
                Se va a registrar igual, con este resultado. No cuenta como retiro.
              </small>
            )}
          </div>
        )}

        <div className="modal-pie">
          <button type="button" onClick={onCerrar}>
            Cancelar
          </button>
          <button className="primario" disabled={!persona || !vista || guardando}>
            {guardando ? 'Guardando…' : 'Registrar fichada'}
          </button>
        </div>
      </form>
    </div>
  );
}
