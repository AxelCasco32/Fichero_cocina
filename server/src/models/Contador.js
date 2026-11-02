const { Schema, model } = require('mongoose');

// Secuencias numéricas (el protocolo necesita IDs de comando numéricos)
const contadorSchema = new Schema({ _id: String, seq: { type: Number, default: 0 } });

contadorSchema.statics.siguiente = async function (nombre) {
  const doc = await this.findOneAndUpdate(
    { _id: nombre },
    { $inc: { seq: 1 } },
    { upsert: true, new: true }
  );
  return doc.seq;
};

module.exports = model('Contador', contadorSchema);
