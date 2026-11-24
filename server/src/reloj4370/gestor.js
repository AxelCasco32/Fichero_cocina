// Mantiene una conexión (Conector) por cada reloj 4370 habilitado.
// Los equipos se agregan, editan y quitan desde la web; RELOJES_4370 del .env solo sirve para
// registrar equipos al arrancar (si esa IP todavía no está cargada).

const Dispositivo = require('../models/Dispositivo');
const { Conector, snProvisorio, mensajeError } = require('./conector');
const zk = require('./protocolo');

const conectores = new Map(); // id del Dispositivo -> Conector
let intervalo = 5;

const clave = (ip, puerto) => `${ip}:${Number(puerto) || 4370}`;

function arrancar(doc) {
  const ocupado = [...conectores.values()].find((c) => clave(c.ip, c.puerto) === clave(doc.ip, doc.puerto));
  if (ocupado) {
    console.log(
      `[4370] "${doc.nombre}" (${doc.sn}) usa la misma IP que ${ocupado.sn}: no se conecta dos veces. ` +
        'Quitá el equipo repetido desde la web.'
    );
    return;
  }
  const c = new Conector({ doc, intervalo, onEquipoReemplazado: detener });
  conectores.set(String(doc._id), c);
  c.iniciar();
}

async function detener(id) {
  const c = conectores.get(String(id));
  if (!c) return;
  conectores.delete(String(id));
  await c.detener();
}

// Vuelve a leer la configuración del equipo y reinicia (o detiene) su conexión
async function recargar(id) {
  await detener(id);
  const doc = await Dispositivo.findById(id).lean();
  if (doc && doc.modo === '4370' && doc.habilitado !== false && doc.ip) arrancar(doc);
}

// Registra los equipos de RELOJES_4370 que todavía no están en la base
async function importarDesdeEnv(lista) {
  for (const entrada of lista) {
    const [ip, p] = entrada.split(':');
    const puerto = Number(p) || 4370;
    const filtroPuerto = puerto === 4370 ? { $in: [4370, null] } : puerto;
    if (await Dispositivo.exists({ ip, modo: '4370', puerto: filtroPuerto })) continue;
    await Dispositivo.create({ sn: snProvisorio(ip, puerto), nombre: `Reloj ${ip}`, ip, puerto, modo: '4370' });
    console.log(`[4370] equipo ${ip}:${puerto} registrado desde RELOJES_4370`);
  }
}

async function iniciar({ relojesEnv = [], intervaloSeg = 5 } = {}) {
  intervalo = intervaloSeg;
  await importarDesdeEnv(relojesEnv);
  const lista = await Dispositivo.find({ modo: '4370', habilitado: { $ne: false }, ip: { $nin: [null, ''] } }).lean();
  // Si hay dos registros con la misma IP, se conecta el que tiene un número de serie válido
  // (el otro suele ser una lectura corrupta del número de serie) y se avisa en la consola
  const puntaje = (d) => (zk.serieValida(d.sn) ? 0 : /^IP-/.test(d.sn) ? 1 : 2);
  lista.sort((x, y) => puntaje(x) - puntaje(y)).forEach(arrancar);
  return lista.length;
}

function conectadoA(ip, puerto) {
  return [...conectores.values()].some((c) => clave(c.ip, c.puerto) === clave(ip, puerto));
}

// Prueba la conexión con un equipo sin guardarlo: devuelve lo que informa
async function probar({ ip, puerto = 4370, protocolo = 'auto', formato = 'auto' }) {
  if (conectadoA(ip, puerto)) {
    throw Object.assign(new Error('Ese equipo ya está conectado al sistema'), { status: 409 });
  }
  let z;
  try {
    z = await zk.abrir({ ip, puerto, protocolo, timeoutMs: 6000 });
    const numeroSerie = await zk.numeroDeSerie(z);
    const firmware = await zk.version(z);
    const cant = await zk.cantidades(z).catch(() => null);
    let formatoDetectado = formato !== 'auto' ? formato : null;
    let usuarios = cant?.usuarios ?? null;
    try {
      const r = await zk.leerUsuarios(z, { formato: formato !== 'auto' ? formato : undefined, cantidad: cant?.usuarios });
      formatoDetectado = formatoDetectado || r.formato;
      usuarios = r.usuarios.length;
    } catch {
      /* se informa igual lo que se pudo leer */
    }
    return {
      numeroSerie,
      firmware,
      protocolo: z.connectionType,
      formato: formatoDetectado || zk.formatoPorDefecto({ firmware, protocolo: z.connectionType }),
      usuarios,
      fichadas: cant?.fichadas ?? null,
    };
  } catch (err) {
    throw Object.assign(new Error(`No se pudo conectar: ${mensajeError(err)}`), { status: 502 });
  } finally {
    await zk.cerrar(z);
  }
}

module.exports = { iniciar, recargar, detener, probar, snProvisorio };
