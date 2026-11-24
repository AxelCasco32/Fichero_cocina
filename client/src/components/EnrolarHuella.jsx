// Enrolar la huella de un comensal desde la web.
// 1) Se elige el reloj y el dedo (tocándolo en el dibujo de las manos).
// 2) El reloj le pide a la persona que apoye el dedo 3 veces; acá se ve el avance en vivo.
// 3) Se confirma si quedó guardada.
import { useEffect, useRef, useState } from 'react';
import { api } from '../api.js';
import { useEvento } from '../socket.js';

// Numeración de ZKTeco: 0-4 mano izquierda (meñique → pulgar), 5-9 mano derecha (pulgar → meñique)
const DEDOS = [
  'meñique izquierdo', 'anular izquierdo', 'mayor izquierdo', 'índice izquierdo', 'pulgar izquierdo',
  'pulgar derecho', 'índice derecho', 'mayor derecho', 'anular derecho', 'meñique derecho',
];
const CORTO = ['Meñique', 'Anular', 'Mayor', 'Índice', 'Pulgar', 'Pulgar', 'Índice', 'Mayor', 'Anular', 'Meñique'];
// Alto de cada dedo en el dibujo (como se ven las manos con las palmas hacia abajo)
const ALTO = [52, 70, 80, 72, 44, 44, 72, 80, 70, 52];

const FINALES = {
  ok: { icono: '✔', titulo: 'Huella registrada', tono: 'ok' },
  duplicada: {
    icono: '!',
    titulo: 'Esa huella ya está registrada',
    texto: 'El reloj la reconoció como la de otra persona. Probá con otro dedo o revisá si la persona ya estaba cargada.',
    tono: 'err',
  },
  tiempo: {
    icono: '⏱',
    titulo: 'Se terminó el tiempo',
    texto: 'El reloj no detectó el dedo a tiempo. Volvé a intentarlo con la persona frente al equipo.',
    tono: 'warn',
  },
  cancelado: { icono: '✕', titulo: 'Enrolamiento cancelado', tono: 'muted' },
  no_guardada: {
    icono: '!',
    titulo: 'El reloj no guardó la huella',
    texto: 'Las lecturas terminaron pero la huella no quedó en el equipo. Probá de nuevo apoyando el dedo bien centrado.',
    tono: 'err',
  },
  error: { icono: '!', titulo: 'No se pudo enrolar', tono: 'err' },
};

function Manos({ dedo, onElegir, conHuella = [] }) {
  return (
    <div className="manos">
      {[0, 1].map((mano) => (
        <div key={mano} className="mano">
          <div className="dedos">
            {[0, 1, 2, 3, 4].map((i) => {
              const n = mano * 5 + i;
              return (
                <button
                  key={n}
                  type="button"
                  className={`dedo ${dedo === n ? 'elegido' : ''} ${conHuella.includes(n) ? 'hecho' : ''}`}
                  style={{ height: ALTO[n] }}
                  onClick={() => onElegir(n)}
                  title={DEDOS[n]}
                  aria-label={DEDOS[n]}
                  aria-pressed={dedo === n}
                >
                  {conHuella.includes(n) ? '✔' : ''}
                </button>
              );
            })}
          </div>
          <div className="palma">{mano === 0 ? 'Mano izquierda' : 'Mano derecha'}</div>
        </div>
      ))}
    </div>
  );
}

function Pasos({ lectura, estado }) {
  return (
    <div className="pasos-huella">
      {[1, 2, 3].map((n) => {
        const hecho = lectura > n || (lectura === n && ['lectura', 'procesando'].includes(estado));
        const actual = !hecho && lectura === n;
        return (
          <div key={n} className={`paso ${hecho ? 'hecho' : ''} ${actual ? 'actual' : ''}`}>
            <span>{hecho ? '✔' : n}</span>
            <small>Lectura {n}</small>
          </div>
        );
      })}
    </div>
  );
}

function instruccion(e, quien, dedo) {
  switch (e?.estado) {
    case 'preparando':
      return { grande: 'Preparando el reloj…', chico: 'En unos segundos el reloj va a pedir el dedo.' };
    case 'esperando':
      return { grande: `Apoyá el ${dedo} en el lector`, chico: `Pedile a ${quien} que apoye el dedo y lo deje quieto.` };
    case 'leyendo':
      return { grande: 'Leyendo… no muevas el dedo', chico: 'Esperá a que el reloj confirme la lectura.' };
    case 'lectura':
      return { grande: 'Bien. Levantá el dedo y volvé a apoyarlo', chico: `Faltan ${3 - e.lectura} lectura${3 - e.lectura === 1 ? '' : 's'}.` };
    case 'reintentar':
      return { grande: 'No se leyó bien: apoyalo de nuevo', chico: 'Apoyá el dedo plano y bien centrado, sin presionar fuerte.' };
    case 'procesando':
      return { grande: 'Guardando la huella…', chico: 'Ya podés levantar el dedo.' };
    default:
      return { grande: 'Enviando el pedido al reloj…', chico: '' };
  }
}

export default function EnrolarHuella({ comensal, onCerrar, onListo, esNuevo = false }) {
  const [relojes, setRelojes] = useState(null);
  const [sn, setSn] = useState('');
  const [dedo, setDedo] = useState(6); // índice derecho
  const [fase, setFase] = useState('elegir'); // elegir | enrolando | fin
  const [pedido, setPedido] = useState(null); // { cmdId, sn }
  const [evento, setEvento] = useState(null);
  const [error, setError] = useState('');
  const [hechos, setHechos] = useState([]); // dedos registrados en esta sesión
  const ultimoEvento = useRef(Date.now());

  useEffect(() => {
    api('/dispositivos')
      .then((lista) => {
        const directos = lista.filter((d) => d.modo === '4370' && d.habilitado !== false);
        setRelojes(directos);
        const enLinea = directos.find((d) => d.enLinea);
        if (enLinea || directos[0]) setSn((enLinea || directos[0]).sn);
      })
      .catch((e) => setError(e.message));
  }, []);

  useEvento('enrolamiento', (e) => {
    if (!pedido || e.cmdId !== pedido.cmdId) return;
    ultimoEvento.current = Date.now();
    setEvento(e);
    if (FINALES[e.estado]) {
      setFase('fin');
      if (e.estado === 'ok') {
        setHechos((h) => [...new Set([...h, e.dedo])]);
        onListo?.();
      }
    }
  });

  // Si el reloj no da señales en 90 s, algo se cortó
  useEffect(() => {
    if (fase !== 'enrolando') return undefined;
    const t = setInterval(() => {
      if (Date.now() - ultimoEvento.current > 90000) {
        setEvento({ estado: 'error', mensaje: 'El reloj dejó de responder. Revisá en Equipos si sigue en línea.' });
        setFase('fin');
      }
    }, 3000);
    return () => clearInterval(t);
  }, [fase]);

  async function empezar() {
    setError('');
    setEvento(null);
    try {
      const r = await api(`/comensales/${comensal._id}/enrolar`, { method: 'POST', body: { sn, dedo } });
      ultimoEvento.current = Date.now();
      setPedido(r);
      setFase('enrolando');
    } catch (e) {
      setError(e.message);
    }
  }

  async function cancelar() {
    try {
      await api(`/comensales/${comensal._id}/enrolar/cancelar`, { method: 'POST', body: { sn: pedido.sn } });
    } catch {
      /* si falla, el reloj corta solo por tiempo */
    }
  }

  function otroDedo() {
    setFase('elegir');
    setEvento(null);
    setPedido(null);
    // sugerimos el índice de la otra mano si ya se hizo uno
    if (hechos.includes(dedo)) setDedo(dedo === 6 ? 3 : 6);
  }

  const reloj = relojes?.find((r) => r.sn === sn);
  const cerrarFuera = (e) => e.target === e.currentTarget && fase !== 'enrolando' && onCerrar();

  return (
    <div className="fondo-modal" onMouseDown={cerrarFuera}>
      <div className="modal enrolar">
        <h2>Enrolar huella · {comensal.nombre}</h2>
        {error && <div className="error">{error}</div>}

        {fase === 'elegir' && (
          <>
            {esNuevo && (
              <p className="nota">
                {comensal.nombre} ya está cargado. Ahora registrá su huella con la persona frente al reloj.
              </p>
            )}
            {relojes && !relojes.length && (
              <div className="aviso">
                No hay relojes conectados por conexión directa. La huella se puede enrolar en el equipo, o agregá el reloj en
                Equipos.
              </div>
            )}
            {relojes && relojes.length > 0 && (
              <>
                <label className="campo">
                  1. ¿En qué reloj está la persona?
                  <select value={sn} onChange={(e) => setSn(e.target.value)}>
                    {relojes.map((r) => (
                      <option key={r.sn} value={r.sn} disabled={!r.enLinea}>
                        {r.nombre} {r.modelo ? `(${r.modelo})` : ''} {r.enLinea ? '' : '— sin conexión'}
                      </option>
                    ))}
                  </select>
                </label>

                <div className="campo" style={{ marginTop: '1rem' }}>
                  2. Tocá el dedo a registrar
                  <Manos dedo={dedo} onElegir={setDedo} conHuella={hechos} />
                  <div className="dedo-elegido">
                    {CORTO[dedo]} {dedo < 5 ? 'izquierdo' : 'derecho'}
                    {dedo === 6 && <small> · recomendado</small>}
                  </div>
                </div>
              </>
            )}
            <div className="modal-pie">
              <button type="button" onClick={onCerrar}>
                {esNuevo ? 'Ahora no' : 'Cancelar'}
              </button>
              <button className="primario" onClick={empezar} disabled={!reloj?.enLinea}>
                Empezar
              </button>
            </div>
          </>
        )}

        {fase === 'enrolando' && (
          <>
            {(() => {
              const i = instruccion(evento, comensal.nombre, DEDOS[dedo]);
              return (
                <div className="instruccion">
                  <div className="huella-icono" aria-hidden="true">
                    ☝
                  </div>
                  <div className="grande" role="status" aria-live="polite">
                    {i.grande}
                  </div>
                  {i.chico && <div className="chico-texto">{i.chico}</div>}
                </div>
              );
            })()}
            <Pasos lectura={evento?.lectura || 0} estado={evento?.estado} />
            <p className="nota" style={{ textAlign: 'center' }}>
              Reloj: <strong>{reloj?.nombre}</strong> · Dedo: <strong>{DEDOS[dedo]}</strong>. La pantalla del reloj también va
              indicando qué hacer.
            </p>
            <div className="modal-pie">
              <button type="button" className="peligro" onClick={cancelar}>
                Cancelar
              </button>
            </div>
          </>
        )}

        {fase === 'fin' &&
          (() => {
            const f = FINALES[evento?.estado] || FINALES.error;
            return (
              <>
                <div className={`resultado-huella ${f.tono}`}>
                  <div className="icono">{f.icono}</div>
                  <div className="grande">{f.titulo}</div>
                  <div className="chico-texto">
                    {evento?.estado === 'ok'
                      ? `${comensal.nombre} ya puede fichar con el ${DEDOS[dedo]}.${
                          evento.verificado ? '' : ' (El reloj no permitió confirmarlo: probá fichar una vez.)'
                        }`
                      : evento?.mensaje || f.texto}
                  </div>
                </div>
                <div className="modal-pie">
                  {evento?.estado === 'ok' ? (
                    <>
                      <button type="button" onClick={otroDedo}>
                        Registrar otro dedo
                      </button>
                      <button className="primario" onClick={onCerrar}>
                        Listo
                      </button>
                    </>
                  ) : (
                    <>
                      <button type="button" onClick={onCerrar}>
                        Cerrar
                      </button>
                      <button type="button" onClick={otroDedo}>
                        Elegir otro dedo
                      </button>
                      <button className="primario" onClick={empezar}>
                        Reintentar
                      </button>
                    </>
                  )}
                </div>
              </>
            );
          })()}
      </div>
    </div>
  );
}
