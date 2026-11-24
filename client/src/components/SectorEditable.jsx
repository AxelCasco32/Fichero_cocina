// Sector de un comensal con edición rápida: lápiz → escribir (con sugerencias) → Enter.
// Esc cancela; al salir del campo se guarda si cambió.
import { useEffect, useRef, useState } from 'react';
import { api } from '../api.js';
import Icono from './Icono.jsx';

export default function SectorEditable({ comensal, onGuardado, onError, listaId }) {
  const [editando, setEditando] = useState(false);
  const [valor, setValor] = useState(comensal.sector || '');
  const [guardando, setGuardando] = useState(false);
  const input = useRef(null);

  useEffect(() => {
    if (!editando) setValor(comensal.sector || '');
  }, [comensal.sector, editando]);

  useEffect(() => {
    if (editando) input.current?.select();
  }, [editando]);

  async function guardar() {
    const nuevo = valor.trim();
    if (nuevo === (comensal.sector || '')) return setEditando(false);
    setGuardando(true);
    try {
      const r = await api(`/comensales/${comensal._id}/sector`, { method: 'PATCH', body: { sector: nuevo } });
      onGuardado(r.sector);
      setEditando(false);
    } catch (e) {
      onError(e.message);
    }
    setGuardando(false);
  }

  if (!editando) {
    return (
      <span className="sector-celda">
        <span className={comensal.sector ? '' : 'sin-sector'}>{comensal.sector || 'Sin sector'}</span>
        <button
          type="button"
          className="sector-lapiz"
          onClick={() => setEditando(true)}
          title="Cambiar sector"
          aria-label={`Cambiar el sector de ${comensal.nombre}`}
        >
          <Icono nombre="lapiz" tamano={15} />
        </button>
      </span>
    );
  }

  const cancelar = () => {
    setValor(comensal.sector || '');
    setEditando(false);
  };

  return (
    <span className="sector-edicion">
      <input
        ref={input}
        value={valor}
        list={listaId}
        maxLength={80}
        placeholder="Ej.: Enfermería"
        disabled={guardando}
        onChange={(e) => setValor(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') guardar();
          if (e.key === 'Escape') cancelar();
        }}
        onBlur={guardar}
        aria-label={`Sector de ${comensal.nombre}`}
      />
      <button
        type="button"
        className="sector-ok"
        onMouseDown={(e) => e.preventDefault()}
        onClick={guardar}
        disabled={guardando}
        title="Guardar (Enter)"
        aria-label="Guardar sector"
      >
        <Icono nombre="check" tamano={15} />
      </button>
      <button
        type="button"
        className="sector-cancelar"
        onMouseDown={(e) => e.preventDefault()}
        onClick={cancelar}
        disabled={guardando}
        title="Cancelar (Esc)"
        aria-label="Cancelar"
      >
        <Icono nombre="cerrar" tamano={15} />
      </button>
    </span>
  );
}
