// Franjas horarias de cada servicio de comida (hora local).
// Una fichada fuera de estas franjas queda como "fuera_de_horario".
// Ajustalas a los horarios reales de la cocina.
module.exports = [
  { codigo: 'desayuno', nombre: 'Desayuno', desde: '06:30', hasta: '09:30' },
  { codigo: 'almuerzo', nombre: 'Almuerzo', desde: '11:30', hasta: '15:00' },
  { codigo: 'merienda', nombre: 'Merienda', desde: '16:00', hasta: '18:00' },
  { codigo: 'cena', nombre: 'Cena', desde: '20:00', hasta: '23:00' },
];
