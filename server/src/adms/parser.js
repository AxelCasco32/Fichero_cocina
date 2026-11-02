// Funciones puras para leer lo que manda el reloj por ADMS/Push.

function lineas(cuerpo) {
  return String(cuerpo || '')
    .split(/\r?\n/)
    .map((l) => l.replace(/\0/g, '').trimEnd())
    .filter((l) => l.trim() !== '');
}

// ATTLOG: "PIN<TAB>2026-10-30 12:30:05<TAB>estado<TAB>verificacion<TAB>..."
function parseAttlog(cuerpo) {
  return lineas(cuerpo)
    .map((l) => {
      const c = l.split('\t');
      if (c.length < 2) return null;
      return {
        pin: c[0].trim(),
        fechaTexto: c[1].trim(),
        estado: c[2] !== undefined ? Number(c[2]) : undefined,
        verificacion: c[3] !== undefined ? Number(c[3]) : undefined,
      };
    })
    .filter((r) => r && /^\d+$/.test(r.pin));
}

// "CLAVE=valor<TAB>CLAVE=valor" -> { CLAVE: 'valor', ... }
function parseCampos(texto) {
  const obj = {};
  for (const parte of String(texto).split('\t')) {
    const i = parte.indexOf('=');
    if (i <= 0) continue;
    obj[parte.slice(0, i).trim()] = parte.slice(i + 1);
  }
  return obj;
}

// OPERLOG / BIODATA: cada línea empieza con un tipo: "USER PIN=1\tName=...", "FP PIN=1\tFID=6...",
// "FACE ...", "BIODATA ...", "OPLOG ...". Si la tabla es BIODATA las líneas pueden venir sin prefijo.
function parseRegistros(cuerpo, tablaPorDefecto) {
  return lineas(cuerpo).map((l) => {
    const m = /^([A-Z]+)\s+(.*)$/.exec(l);
    if (m && m[2].includes('=')) return { tipo: m[1], campos: parseCampos(m[2]) };
    return { tipo: tablaPorDefecto || 'DESCONOCIDO', campos: parseCampos(l) };
  });
}

// Respuestas a comandos: "ID=12&Return=0&CMD=DATA" (una por línea)
function parseRespuestasComando(cuerpo) {
  return lineas(cuerpo)
    .map((l) => {
      const p = new URLSearchParams(l);
      const id = Number(p.get('ID'));
      if (!Number.isFinite(id)) return null;
      return { cmdId: id, retorno: Number(p.get('Return')), cmd: p.get('CMD') };
    })
    .filter(Boolean);
}

// INFO del getrequest: "Ver 8.0.4.2,cantUsuarios,cantHuellas,cantFichadas,IP,..."
function parseInfo(info) {
  if (!info) return {};
  const c = String(info).split(',');
  return {
    firmware: c[0] || undefined,
    usuariosEnEquipo: Number.isFinite(Number(c[1])) ? Number(c[1]) : undefined,
    ip: c[4] || undefined,
  };
}

// Pin del campo de un registro (el firmware usa PIN o Pin según versión)
const pinDe = (campos) => campos.PIN ?? campos.Pin ?? campos.pin;

module.exports = { parseAttlog, parseRegistros, parseRespuestasComando, parseInfo, parseCampos, pinDe };
