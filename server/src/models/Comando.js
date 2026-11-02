const { Schema, model } = require('mongoose');
const Contador = require('./Contador');

// Cola de comandos para el reloj. El equipo los retira en /iclock/getrequest
// y confirma el resultado en /iclock/devicecmd.
const comandoSchema = new Schema(
  {
    deviceSn: { type: String, required: true },
    cmdId: { type: Number, required: true, unique: true },
    texto: { type: String, required: true },
    tipo: { type: String }, // alta, baja, consulta...
    pin: String,
    estado: {
      type: String,
      enum: ['pendiente', 'enviado', 'ok', 'error'],
      default: 'pendiente',
    },
    retorno: Number, // código que devuelve el equipo (0 = ok)
    intentos: { type: Number, default: 0 },
    enviadoEn: Date,
    respondidoEn: Date,
  },
  { timestamps: true }
);

comandoSchema.index({ deviceSn: 1, estado: 1, cmdId: 1 });

comandoSchema.statics.encolar = async function ({ deviceSn, texto, tipo, pin }) {
  const cmdId = await Contador.siguiente('comando');
  return this.create({ deviceSn, cmdId, texto, tipo, pin });
};

module.exports = model('Comando', comandoSchema);
