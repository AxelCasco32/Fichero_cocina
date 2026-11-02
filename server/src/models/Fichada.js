const { Schema, model } = require('mongoose');

const RESULTADOS = [
  'autorizado', // puede retirar
  'no_autorizado', // existe pero está deshabilitado
  'ya_retiro', // ya retiró en este servicio hoy
  'fuera_de_horario', // no hay servicio en esa franja
  'servicio_no_habilitado', // el servicio no está en su lista
  'desconocido', // el PIN no existe en la base
];

const fichadaSchema = new Schema(
  {
    pin: { type: String, required: true },
    comensal: { type: Schema.Types.ObjectId, ref: 'Comensal' },
    nombre: String, // copia del nombre al momento de fichar
    fecha: { type: Date, required: true },
    dia: { type: String, required: true }, // 'YYYY-MM-DD' local
    servicio: { type: String, default: null },
    resultado: { type: String, enum: RESULTADOS, required: true },
    deviceSn: { type: String, required: true }, // 'MANUAL' si se cargó desde la web
    estado: Number, // estado de marcación que manda el reloj
    verificacion: Number, // 1 huella, 15 rostro, etc.

    // Carga manual desde la web
    origen: { type: String, enum: ['reloj', 'manual'], default: 'reloj' },
    cargadaPor: String, // usuario del operador
    motivo: String,

    // Anulación (no se borra: queda para auditoría)
    anulada: { type: Boolean, default: false },
    anuladaPor: String,
    anuladaMotivo: String,
    anuladaEn: Date,
  },
  { timestamps: true }
);

// El reloj puede reenviar fichadas: este índice evita duplicarlas
fichadaSchema.index({ deviceSn: 1, pin: 1, fecha: 1 }, { unique: true });
fichadaSchema.index({ fecha: -1 });
fichadaSchema.index({ pin: 1, dia: 1, servicio: 1 });

module.exports = model('Fichada', fichadaSchema);
module.exports.RESULTADOS = RESULTADOS;
