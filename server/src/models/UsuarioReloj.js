const { Schema, model } = require('mongoose');

// "Foto" de los usuarios que hay cargados en cada reloj.
// Se actualiza cuando el equipo informa usuarios (consulta completa o enrolamiento)
// y cuando confirma nuestras altas y bajas.
const usuarioRelojSchema = new Schema(
  {
    deviceSn: { type: String, required: true },
    pin: { type: String, required: true },
    nombre: String,
    tarjeta: String,
    privilegio: Number, // 0 usuario, 14 administrador del equipo
    tieneBiometria: { type: Boolean, default: false },
    vistoEn: { type: Date, default: Date.now },
  },
  { timestamps: true }
);

usuarioRelojSchema.index({ deviceSn: 1, pin: 1 }, { unique: true });

module.exports = model('UsuarioReloj', usuarioRelojSchema);
