const { Schema, model } = require('mongoose');

const dispositivoSchema = new Schema(
  {
    sn: { type: String, required: true, unique: true }, // número de serie
    nombre: { type: String, default: 'MB360 Cocina' },
    ip: String,
    firmware: String,
    usuariosEnEquipo: Number,
    ultimaConexion: Date,
    attlogStamp: { type: String, default: 'None' },
    operlogStamp: { type: String, default: 'None' },
    modo: { type: String, enum: ['adms', '4370'], default: 'adms' }, // cómo se comunica
    ultimaFichada: Date, // fecha de la fichada más reciente traída del reloj (modo 4370)
    handshakeEn: Date, // última vez que el equipo pidió la configuración (cdata?options=all)
    ultimaLecturaUsuarios: Date, // última vez que leímos la lista completa de usuarios del reloj
    info: Schema.Types.Mixed, // datos que devuelve el comando INFO (capacidad, cantidades, etc.)
  },
  { timestamps: true }
);

module.exports = model('Dispositivo', dispositivoSchema);
