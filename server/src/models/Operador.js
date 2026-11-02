const { Schema, model } = require('mongoose');
const bcrypt = require('bcryptjs');

// Personal que usa la web (cocina o administración)
const operadorSchema = new Schema(
  {
    usuario: { type: String, required: true, unique: true, trim: true, lowercase: true },
    nombre: { type: String, required: true, trim: true },
    passwordHash: { type: String, required: true },
    rol: { type: String, enum: ['admin', 'cocina'], default: 'cocina' },
    activo: { type: Boolean, default: true },
  },
  { timestamps: true }
);

operadorSchema.methods.verificarPassword = function (password) {
  return bcrypt.compare(password, this.passwordHash);
};

operadorSchema.statics.hashPassword = function (password) {
  return bcrypt.hash(password, 10);
};

operadorSchema.set('toJSON', {
  transform: (_doc, ret) => {
    delete ret.passwordHash;
    return ret;
  },
});

module.exports = model('Operador', operadorSchema);
