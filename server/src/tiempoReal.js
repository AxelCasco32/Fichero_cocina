// Guarda la instancia de socket.io para poder emitir eventos desde cualquier módulo
let io = null;

module.exports = {
  setIO(instancia) {
    io = instancia;
  },
  emitir(evento, datos) {
    if (io) io.to('operadores').emit(evento, datos);
  },
};
