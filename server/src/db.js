const mongoose = require('mongoose');
const { mongoUri } = require('./config');

async function conectar(uri = mongoUri) {
  mongoose.set('strictQuery', true);
  await mongoose.connect(uri);
  console.log('[db] conectado a MongoDB');
}

module.exports = { conectar };
