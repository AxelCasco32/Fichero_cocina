const { Schema, model } = require('mongoose');

// Copia de respaldo de huellas/rostros que el reloj sube.
// Sirve para restaurarlos si se cambia o resetea el equipo.
const plantillaSchema = new Schema(
  {
    pin: { type: String, required: true },
    tipo: { type: String, required: true }, // FP, FACE, BIODATA
    clave: { type: String, default: '0' }, // índice de dedo / rostro
    datos: Schema.Types.Mixed, // campos crudos tal cual los manda el equipo
    deviceSn: String,
  },
  { timestamps: true }
);

plantillaSchema.index({ pin: 1, tipo: 1, clave: 1 }, { unique: true });

module.exports = model('Plantilla', plantillaSchema);
