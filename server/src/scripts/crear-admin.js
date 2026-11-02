// Crea (o resetea) un operador administrador.
// Uso: npm run crear-admin -- <usuario> <contraseña> "<Nombre Apellido>"
const mongoose = require('mongoose');
const { conectar } = require('../db');
const Operador = require('../models/Operador');

async function main() {
  const [usuario, password, nombre = 'Administrador'] = process.argv.slice(2);
  if (!usuario || !password || password.length < 8) {
    console.log('Uso: npm run crear-admin -- <usuario> <contraseña de 8+ caracteres> "<Nombre>"');
    process.exit(1);
  }
  await conectar();
  const passwordHash = await Operador.hashPassword(password);
  await Operador.findOneAndUpdate(
    { usuario: usuario.toLowerCase() },
    { usuario: usuario.toLowerCase(), nombre, passwordHash, rol: 'admin', activo: true },
    { upsert: true }
  );
  console.log(`Administrador "${usuario}" listo.`);
  await mongoose.disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
