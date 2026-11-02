// Arma y encola los comandos que el reloj ejecuta (protocolo ADMS/Push)
const Comando = require('../models/Comando');
const Dispositivo = require('../models/Dispositivo');
const Plantilla = require('../models/Plantilla');

// El reloj guarda nombres cortos y separa campos con TAB:
// limpiamos tabs/saltos de línea y cortamos a 24 caracteres.
function limpiar(texto, max) {
  return String(texto || '')
    .replace(/[\t\r\n]/g, ' ')
    .trim()
    .slice(0, max);
}

function textoAltaUsuario(c) {
  return [
    `DATA UPDATE USERINFO PIN=${c.pin}`,
    `Name=${limpiar(c.nombre, 24)}`,
    'Pri=0', // usuario común (14 = administrador del equipo)
    'Passwd=',
    `Card=${limpiar(c.tarjeta, 20)}`,
    'Grp=1',
    'TZ=0000000100000000',
  ].join('\t');
}

const textoBajaUsuario = (pin) => `DATA DELETE USERINFO PIN=${pin}`;

// Tabla de destino según cómo nos llegó la plantilla
const TABLA_PLANTILLA = { FP: 'FINGERTMP', FACE: 'FACE', BIODATA: 'BIODATA' };

// Reconstruye el comando con los mismos campos que mandó el reloj al enrolar
function textoRestaurarPlantilla(p) {
  const tabla = TABLA_PLANTILLA[p.tipo];
  if (!tabla || !p.datos) return null;
  const campos = Object.entries(p.datos).map(([k, v]) => `${k}=${v}`);
  return `DATA UPDATE ${tabla} ${campos.join('\t')}`;
}

async function snsDestino(deviceSn) {
  if (deviceSn) return [deviceSn];
  const disp = await Dispositivo.find({}, 'sn').lean();
  return disp.map((d) => d.sn);
}

// Encola el alta/actualización de un comensal en todos los relojes (o en uno).
// Con `conBiometria`, también le manda su rostro/huellas guardados (si hay respaldo).
async function enviarAlta(comensal, deviceSn, { conBiometria = false } = {}) {
  const sns = await snsDestino(deviceSn);
  const plantillas = conBiometria ? await Plantilla.find({ pin: comensal.pin }).lean() : [];
  // Por 4370 no se puede restaurar biometría: a esos relojes solo va el alta
  const modo4370 = new Set(
    (await Dispositivo.find({ sn: { $in: sns }, modo: '4370' }, 'sn').lean()).map((d) => d.sn)
  );
  const encolados = [];
  for (const sn of sns) {
    encolados.push(
      await Comando.encolar({ deviceSn: sn, texto: textoAltaUsuario(comensal), tipo: 'alta', pin: comensal.pin })
    );
    if (modo4370.has(sn)) continue;
    for (const p of plantillas) {
      const texto = textoRestaurarPlantilla(p);
      if (texto) encolados.push(await Comando.encolar({ deviceSn: sn, texto, tipo: 'biometria', pin: comensal.pin }));
    }
  }
  return encolados;
}

async function enviarBaja(pin, deviceSn) {
  const sns = await snsDestino(deviceSn);
  return Promise.all(
    sns.map((sn) => Comando.encolar({ deviceSn: sn, texto: textoBajaUsuario(pin), tipo: 'baja', pin }))
  );
}

// Comandos de control del equipo
const ACCIONES_EQUIPO = {
  'consultar-usuarios': { texto: () => 'DATA QUERY USERINFO', tipo: 'consulta' },
  'recuperar-fichadas': {
    texto: ({ desde, hasta }) => `DATA QUERY ATTLOG StartTime=${desde} 00:00:00\tEndTime=${hasta} 23:59:59`,
    tipo: 'recuperar',
  },
  actualizar: { texto: () => 'CHECK', tipo: 'actualizar' }, // fuerza a subir datos nuevos
  info: { texto: () => 'INFO', tipo: 'info' },
  reiniciar: { texto: () => 'REBOOT', tipo: 'reiniciar' },
  'vaciar-fichadas': { texto: () => 'CLEAR LOG', tipo: 'vaciar' }, // borra las fichadas guardadas EN el reloj
};

function accionEquipo(deviceSn, accion, params = {}) {
  const a = ACCIONES_EQUIPO[accion];
  if (!a) throw new Error(`Acción desconocida: ${accion}`);
  return Comando.encolar({ deviceSn, texto: a.texto(params), tipo: a.tipo });
}

module.exports = {
  textoAltaUsuario,
  textoBajaUsuario,
  textoRestaurarPlantilla,
  enviarAlta,
  enviarBaja,
  accionEquipo,
  ACCIONES_EQUIPO,
};
