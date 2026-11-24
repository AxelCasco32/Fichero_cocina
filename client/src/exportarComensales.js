// Exporta comensales a un Excel (.xlsx) real: respeta textos con acentos y PIN/DNI con ceros adelante.
import { api } from './api.js';
import { hoy } from './util.js';

const ESTADO = (c) =>
  !c.activo ? 'Baja' : c.pendienteRevision ? 'Pendiente de revisión' : c.autorizado ? 'Habilitado' : 'Deshabilitado';

export async function exportarComensales({ estado, busqueda, servicios }) {
  const p = new URLSearchParams({ estado });
  if (busqueda) p.set('q', busqueda);
  const [items, { default: writeXlsxFile }] = await Promise.all([
    api(`/comensales/exportar?${p}`),
    import('write-excel-file/browser'), // se carga solo al exportar
  ]);
  const nombreServicio = (s) => servicios.find((x) => x.codigo === s)?.nombre || s;
  const titulo = (t) => ({ value: t, fontWeight: 'bold', backgroundColor: '#E3F2EE' });
  const texto = (v) => ({ value: v ? String(v) : null, type: String });

  const columnas = [
    { header: titulo('PIN'), cell: (c) => texto(c.pin), width: 12 },
    { header: titulo('Nombre'), cell: (c) => texto(c.nombre), width: 32 },
    { header: titulo('DNI'), cell: (c) => texto(c.dni), width: 13 },
    { header: titulo('Sector'), cell: (c) => texto(c.sector), width: 22 },
    { header: titulo('Servicios'), cell: (c) => texto((c.servicios || []).map(nombreServicio).join(', ')), width: 32 },
    { header: titulo('Estado'), cell: (c) => texto(ESTADO(c)), width: 20 },
    { header: titulo('Huella/rostro'), cell: (c) => texto(c.tieneBiometria ? 'Enrolado' : 'No'), width: 14 },
    { header: titulo('Tarjeta'), cell: (c) => texto(c.tarjeta), width: 14 },
    { header: titulo('Observaciones'), cell: (c) => texto(c.observaciones), width: 30 },
    {
      header: titulo('Alta en el sistema'),
      cell: (c) => ({ value: c.createdAt ? new Date(c.createdAt) : null, type: Date, format: 'dd/mm/yyyy' }),
      width: 18,
    },
  ];

  await writeXlsxFile(items, { columns: columnas, sheet: 'Comensales', stickyRowsCount: 1 }).toFile(
    `comensales-${estado}-${hoy()}.xlsx`
  );
  return items.length;
}
