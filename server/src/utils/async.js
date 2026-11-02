// Envuelve handlers async para que los errores lleguen al middleware de errores
module.exports = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

// Escapa texto para usarlo en una búsqueda con RegExp
module.exports.escapeRegex = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
