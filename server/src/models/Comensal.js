const { Schema, model } = require('mongoose');
const SERVICIOS = require('../catalogos/servicios');

// Persona habilitada (o no) a retirar comida.
// El "pin" es el ID de usuario en el reloj: es la clave que une ambos mundos.
const comensalSchema = new Schema(
  {
    pin: {
      type: String,
      required: true,
      unique: true,
      trim: true,
      match: [/^\d{1,9}$/, 'El PIN debe ser numérico (hasta 9 dígitos)'],
    },
    nombre: { type: String, required: true, trim: true, maxlength: 100 },
    dni: { type: String, trim: true },
    sector: { type: String, trim: true },
    tarjeta: { type: String, trim: true },
    // Qué servicios puede retirar (desayuno, almuerzo, ...)
    servicios: {
      type: [String],
      default: () => SERVICIOS.map((s) => s.codigo),
      validate: {
        validator: (arr) => arr.every((c) => SERVICIOS.some((s) => s.codigo === c)),
        message: 'Servicio inválido',
      },
    },
    // false = no puede retirar, pero sigue cargado en el reloj (conserva su biometría)
    autorizado: { type: Boolean, default: true },
    // false = dado de baja y borrado del reloj
    activo: { type: Boolean, default: true },
    // true si el reloj informó huella o rostro enrolado
    tieneBiometria: { type: Boolean, default: false },
    // Creado automáticamente porque apareció en el reloj y no en la base
    pendienteRevision: { type: Boolean, default: false },
    observaciones: { type: String, trim: true, maxlength: 500 },
  },
  { timestamps: true }
);

comensalSchema.index({ nombre: 1 });
comensalSchema.index({ dni: 1 });

module.exports = model('Comensal', comensalSchema);
