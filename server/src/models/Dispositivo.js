const { Schema, model } = require('mongoose');

const dispositivoSchema = new Schema(
  {
    // Identificador del equipo en el sistema (fichadas y comandos lo referencian).
    // Es el número de serie; mientras no se conoce (equipo recién agregado) es "IP-<ip>".
    sn: { type: String, required: true, unique: true },
    nombre: { type: String, default: 'MB360 Cocina' },
    modelo: String, // texto libre: "MB360", "628-C", ...
    ip: String,
    firmware: String,
    usuariosEnEquipo: Number,
    ultimaConexion: Date,
    attlogStamp: { type: String, default: 'None' },
    operlogStamp: { type: String, default: 'None' },
    modo: { type: String, enum: ['adms', '4370'], default: 'adms' }, // cómo se comunica
    ultimaFichada: Date, // fecha de la fichada más reciente traída del reloj (modo 4370)
    handshakeEn: Date, // última vez que el equipo pidió la configuración (cdata?options=all)
    ultimaLecturaUsuarios: Date, // última vez que leímos la lista completa de usuarios del reloj
    info: Schema.Types.Mixed, // datos que devuelve el comando INFO (capacidad, cantidades, etc.)

    // --- Conexión directa (modo 4370) ---
    puerto: { type: Number, default: 4370, min: 1, max: 65535 },
    // auto = prueba TCP y si no responde UDP (los equipos viejos suelen hablar solo UDP)
    protocolo: { type: String, enum: ['auto', 'tcp', 'udp'], default: 'auto' },
    // Formato de los registros: nuevo = firmware 8 (MB360), viejo = firmware 6 (628-C y similares)
    formato: { type: String, enum: ['auto', 'nuevo', 'viejo'], default: 'auto' },
    protocoloDetectado: String, // con qué se conectó la última vez
    formatoDetectado: String, // qué formato se usó la última vez
    habilitado: { type: Boolean, default: true }, // si es false, el sistema no se conecta
    ultimoError: String, // por qué no se pudo conectar (se limpia al conectar)
    ultimoErrorEn: Date,
  },
  { timestamps: true }
);

module.exports = model('Dispositivo', dispositivoSchema);
