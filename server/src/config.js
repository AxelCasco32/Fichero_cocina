require('dotenv').config();

// El reloj guarda la hora local sin zona: el proceso trabaja en la zona del hospital
// (si el servidor está en UTC, las fichadas por 4370 quedarían corridas 3 horas)
process.env.TZ = process.env.TZ_NAME || 'America/Argentina/Buenos_Aires';

const lista = (v) =>
  (v || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

module.exports = {
  port: Number(process.env.PORT || 4000),
  mongoUri: process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/cocina',
  jwtSecret: process.env.JWT_SECRET || 'cambiar-esto',
  jwtExpira: process.env.JWT_EXPIRA || '12h',
  tz: process.env.TZ_NAME || 'America/Argentina/Buenos_Aires',
  tzOffset: process.env.TZ_OFFSET || '-03:00',
  deviceTzHours: Number(process.env.DEVICE_TZ_HOURS || -3),
  snPermitidos: lista(process.env.ADMS_SN_PERMITIDOS),
  dedupSegundos: Number(process.env.DEDUP_SEGUNDOS || 60),
  corsOrigin: process.env.CORS_ORIGIN || 'http://localhost:5173',
  // Un equipo se considera "en línea" si consultó al servidor en este lapso
  onlineSegundos: Number(process.env.ONLINE_SEGUNDOS || 120),
  // Relojes a los que el servidor se conecta por el puerto 4370 ("IP" o "IP:puerto", separados por coma)
  relojes4370: lista(process.env.RELOJES_4370),
  intervalo4370: Number(process.env.INTERVALO_4370 || 5),
};
