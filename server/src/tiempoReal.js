// Guarda la instancia de socket.io para poder emitir eventos desde cualquier módulo
let io = null;

const conectadas = () => io?.sockets.adapter.rooms.get('operadores')?.size || 0;

module.exports = {
  setIO(instancia) {
    io = instancia;
  },
  conectadas,
  emitir(evento, datos) {
    if (!io) return;
    io.to('operadores').emit(evento, datos);
    // Registro de cada fichada avisada en vivo (sirve para diagnosticar el monitor)
    if (evento === 'fichada') {
      const n = conectadas();
      console.log(
        `[tiempo real] fichada ${datos.pin} (${datos.resultado}) avisada a ${n} pantalla${n === 1 ? '' : 's'}` +
          (n ? '' : ' — no hay ninguna pantalla conectada en vivo')
      );
    }
  },
};
