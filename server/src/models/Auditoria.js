const { Schema, model } = require('mongoose');

// Registro de quién hizo cada cambio (altas, bajas, modificaciones)
const auditoriaSchema = new Schema(
  {
    operador: { type: Schema.Types.ObjectId, ref: 'Operador' },
    operadorUsuario: String,
    accion: { type: String, required: true }, // alta, modificacion, baja, ...
    entidad: { type: String, required: true }, // comensal, operador, dispositivo
    entidadId: String,
    detalle: Schema.Types.Mixed,
  },
  { timestamps: { createdAt: 'fecha', updatedAt: false } }
);

auditoriaSchema.index({ fecha: -1 });

auditoriaSchema.statics.registrar = function (req, accion, entidad, entidadId, detalle) {
  return this.create({
    operador: req.operador?._id,
    operadorUsuario: req.operador?.usuario,
    accion,
    entidad,
    entidadId: entidadId != null ? String(entidadId) : undefined,
    detalle,
  });
};

module.exports = model('Auditoria', auditoriaSchema);
