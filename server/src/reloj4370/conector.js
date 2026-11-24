// Conexión directa con un reloj por el puerto 4370 (protocolo "PC" de ZKTeco, el mismo que usa su software).
// El servidor se conecta al reloj y, cada pocos segundos:
//   1. se fija si hay fichadas nuevas y las trae;
//   2. ejecuta los comandos pendientes de la cola (altas, bajas, lectura de usuarios, etc.).
// Así la web funciona igual que con ADMS: usa la misma cola de comandos y los mismos modelos.
//
// Sirve para equipos nuevos (MB360, firmware 8, TCP) y antiguos (628-C y similares, firmware 6,
// generalmente UDP): ver protocolo.js. Cada equipo se configura desde la web (Equipos → Agregar).

const Dispositivo = require('../models/Dispositivo');
const Comando = require('../models/Comando');
const Comensal = require('../models/Comensal');
const Fichada = require('../models/Fichada');
const UsuarioReloj = require('../models/UsuarioReloj');
const { registrarFichadas } = require('../services/fichadas');
const tiempoReal = require('../tiempoReal');
const zk = require('./protocolo');

const esperar = (ms) => new Promise((ok) => setTimeout(ok, ms));

// Identificador provisorio hasta que el reloj informe su número de serie
const snProvisorio = (ip, puerto = 4370) => `IP-${ip}${Number(puerto) !== 4370 ? `:${puerto}` : ''}`;
const esProvisorio = (sn) => /^IP-/.test(sn || '');

class Conector {
  // doc: el Dispositivo; onEquipoReemplazado(id): avisa al gestor que otro registro fue absorbido
  constructor({ doc, intervalo = 5, onEquipoReemplazado = () => {} }) {
    this.id = doc._id;
    this.sn = doc.sn;
    this.ip = doc.ip;
    this.puerto = doc.puerto || 4370;
    this.protocolo = doc.protocolo || 'auto';
    this.formatoConfig = doc.formato || 'auto';
    this.formato = doc.formatoDetectado || null; // 'nuevo' | 'viejo' (el que se está usando)
    this.intervaloMs = Math.max(2, intervalo) * 1000;
    this.onEquipoReemplazado = onEquipoReemplazado;
    this.zk = null;
    this.usuarios = new Map(); // pin -> { uid, pin, nombre, privilegio }
    this.ultimoTotalFichadas = null;
    this.fallos = 0;
    this.detenido = false;
    this.inicio = new Date();
  }

  log(...a) {
    console.log(`[4370 ${this.ip}${this.puerto !== 4370 ? `:${this.puerto}` : ''}]`, ...a);
  }

  iniciar() {
    this.log(`conectando cada ${this.intervaloMs / 1000} s…`);
    this.bucle();
  }

  async detener() {
    this.detenido = true;
    await this.cerrar();
  }

  async bucle() {
    while (!this.detenido) {
      try {
        if (!this.zk) await this.conectar();
        await this.ciclo();
        this.fallos = 0;
        await esperar(this.intervaloMs);
      } catch (err) {
        if (this.detenido) break;
        this.fallos++;
        const causa = mensajeError(err);
        if (this.fallos === 1 || this.fallos % 12 === 0) {
          this.log(`sin conexión: ${causa} (reintentando)`);
          await Dispositivo.updateOne({ _id: this.id }, { $set: { ultimoError: causa, ultimoErrorEn: new Date() } }).catch(() => {});
        }
        await this.cerrar();
        await esperar(Math.min(30000, this.intervaloMs * this.fallos));
      }
    }
  }

  async cerrar() {
    const z = this.zk;
    this.zk = null;
    await zk.cerrar(z);
  }

  async conectar() {
    this.zk = await zk.abrir({ ip: this.ip, puerto: this.puerto, protocolo: this.protocolo });
    if (this.detenido) return this.cerrar();

    const [serie, firmware] = [await zk.numeroDeSerie(this.zk), await zk.version(this.zk)];
    await this.asegurarIdentidad(serie);

    const via = this.zk.connectionType;
    if (this.formatoConfig !== 'auto') this.formato = this.formatoConfig;
    else if (!this.formato) this.formato = zk.formatoPorDefecto({ firmware, protocolo: via });

    await Dispositivo.updateOne(
      { _id: this.id },
      {
        $set: { modo: '4370', protocoloDetectado: via, ...(firmware ? { firmware } : {}) },
        $unset: { ultimoError: 1, ultimoErrorEn: 1 },
      }
    );

    // La primera vez, traemos los usuarios del reloj a la base (como pendientes) antes de las fichadas
    const disp = await Dispositivo.findById(this.id, 'ultimaLecturaUsuarios').lean();
    await this.leerUsuarios({ soloCache: !!disp?.ultimaLecturaUsuarios });
    this.log(
      `conectado ✔ por ${via.toUpperCase()} (SN ${this.sn}, formato ${this.formato}, ${this.usuarios.size} usuarios en el reloj)`
    );
  }

  // Un equipo agregado a mano se identifica por su IP hasta que informa el número de serie.
  // Cuando lo informa, se pasa a usar el número de serie (y si ese equipo ya estaba registrado
  // con otra IP, se unifica en un solo registro).
  async asegurarIdentidad(serie) {
    const doc = await Dispositivo.findById(this.id);
    if (!doc) throw new Error('el equipo fue quitado del sistema');
    this.sn = doc.sn;
    if (!serie || serie === doc.sn || !esProvisorio(doc.sn)) return;

    const viejo = doc.sn;
    const otro = await Dispositivo.findOne({ sn: serie });
    if (otro) {
      // El mismo reloj ya estaba registrado (por ejemplo, le cambiaron la IP): conservamos su historial
      await this.onEquipoReemplazado(otro._id);
      doc.ultimaFichada = otro.ultimaFichada;
      doc.ultimaLecturaUsuarios = otro.ultimaLecturaUsuarios;
      if (!doc.modelo && otro.modelo) doc.modelo = otro.modelo;
      await Dispositivo.deleteOne({ _id: otro._id });
      await UsuarioReloj.deleteMany({ deviceSn: viejo }); // se vuelven a leer del reloj
    } else {
      await UsuarioReloj.updateMany({ deviceSn: viejo }, { $set: { deviceSn: serie } });
    }
    doc.sn = serie;
    await doc.save();
    await Comando.updateMany({ deviceSn: viejo }, { $set: { deviceSn: serie } });
    await Fichada.updateMany({ deviceSn: viejo }, { $set: { deviceSn: serie } }).catch((e) => {
      if (e.code !== 11000) throw e; // fichadas repetidas: quedan con el identificador viejo
    });
    this.sn = serie;
    this.log(`número de serie ${serie}: el equipo pasa a identificarse así (antes ${viejo})`);
  }

  async ciclo() {
    const ahora = new Date();
    const cambios = { ultimaConexion: ahora };

    // ¿Cambió la cantidad de fichadas? (consulta liviana)
    let total = null;
    try {
      const c = await zk.cantidades(this.zk);
      total = c.fichadas;
      this.cantidadUsuarios = c.usuarios;
      cambios.usuariosEnEquipo = c.usuarios;
      cambios['info.UserCount'] = c.usuarios;
      cambios['info.TransactionCount'] = c.fichadas;
    } catch (err) {
      if (esErrorDeConexion(err)) throw err;
      total = null; // si el firmware no lo informa, sincronizamos igual (más lento)
      if (!this.avisoSinCantidades) {
        this.avisoSinCantidades = true;
        this.log('este reloj no informa cantidades: se descargan las fichadas en cada ciclo');
      }
    }
    await Dispositivo.updateOne({ _id: this.id }, { $set: cambios });
    tiempoReal.emitir('dispositivo', { sn: this.sn, ultimaConexion: ahora });

    if (total === null || total !== this.ultimoTotalFichadas) {
      await this.sincronizarFichadas({ cantidad: total });
      this.ultimoTotalFichadas = total;
    }

    await this.procesarComandos();
  }

  // Trae las fichadas del reloj y guarda las nuevas
  async sincronizarFichadas({ desde, hasta, forzar = false, cantidad } = {}) {
    const disp = await Dispositivo.findById(this.id, 'ultimaFichada').lean();
    const pinPorUid = new Map([...this.usuarios.values()].map((u) => [u.uid, u.pin]));
    const registros = await zk.leerFichadas(this.zk, { formato: this.formato, cantidad, pinPorUid });

    // Solo las posteriores a la última procesada (con 5 min de margen); el resto ya está
    let nuevas = registros;
    if (desde || hasta) {
      nuevas = registros.filter((r) => (!desde || r.fecha >= desde) && (!hasta || r.fecha < hasta));
    } else if (!forzar && disp?.ultimaFichada) {
      const limite = new Date(disp.ultimaFichada.getTime() - 5 * 60 * 1000);
      nuevas = registros.filter((r) => r.fecha > limite);
    } else if (!forzar) {
      // Primera conexión: solo las de hoy. El historial se trae con "Recuperar fichadas",
      // después de revisar y habilitar a los comensales (así se evalúan bien).
      const { rangoDia, hoy } = require('../utils/fecha');
      const inicioDeHoy = rangoDia(hoy()).desde;
      nuevas = registros.filter((r) => r.fecha >= inicioDeHoy);
      if (registros.length > nuevas.length) {
        this.log(
          `el reloj tiene ${registros.length - nuevas.length} fichadas anteriores a hoy: ` +
            'se pueden traer desde Equipos → "Recuperar fichadas"'
        );
      }
    }

    if (!nuevas.length) return 0;

    const masDeMil = nuevas.length > 1000;
    if (masDeMil) this.log(`importando ${nuevas.length} fichadas del reloj (puede tardar unos minutos)…`);

    // Las fichadas viejas (historial) se guardan sin avisar al monitor en vivo
    const emitirDesde = new Date(Math.max(this.inicio.getTime(), Date.now()) - 10 * 60 * 1000);
    const nombres = new Map([...this.usuarios.values()].map((u) => [u.pin, u.nombre]));
    const guardadas = await registrarFichadas(this.sn, nuevas, { emitirDesde, nombres });

    const maxFecha = registros.reduce((m, r) => (r.fecha > m ? r.fecha : m), new Date(0));
    if (!disp?.ultimaFichada || maxFecha > disp.ultimaFichada) {
      await Dispositivo.updateOne({ _id: this.id }, { $set: { ultimaFichada: maxFecha } });
    }

    if (guardadas || masDeMil) this.log(`${guardadas} fichadas nuevas`);
    return guardadas;
  }

  // Lee los usuarios del reloj. Con soloCache=false también actualiza la "foto" en la base
  async leerUsuarios({ soloCache = false } = {}) {
    let cantidad = this.cantidadUsuarios;
    if (cantidad == null) cantidad = await zk.cantidades(this.zk).then((c) => c.usuarios).catch(() => undefined);
    const r = await zk.leerUsuarios(this.zk, {
      formato: this.formatoConfig !== 'auto' ? this.formatoConfig : undefined,
      cantidad,
      preferido: this.formato,
    });
    if (r.formato && r.formato !== this.formato) {
      if (this.formatoConfig !== 'auto' && r.formato !== this.formatoConfig) {
        this.log(`el equipo usa el formato ${r.formato} (estaba configurado ${this.formatoConfig}): se usa el del equipo`);
      }
      this.formato = r.formato;
    }
    await Dispositivo.updateOne({ _id: this.id }, { $set: { formatoDetectado: this.formato } });

    const lista = r.usuarios;
    this.usuarios = new Map(lista.filter((u) => u.pin).map((u) => [u.pin, u]));
    if (soloCache) return lista;

    const ahora = new Date();
    await UsuarioReloj.deleteMany({ deviceSn: this.sn });
    if (this.usuarios.size) {
      await UsuarioReloj.insertMany(
        [...this.usuarios.values()].map((u) => ({
          deviceSn: this.sn,
          pin: u.pin,
          nombre: u.nombre,
          tarjeta: u.tarjeta ? String(u.tarjeta) : undefined,
          privilegio: u.privilegio,
          tieneBiometria: null, // el protocolo 4370 no lo informa en la lista
          vistoEn: ahora,
        })),
        { ordered: false }
      );
    }

    // Quien está en el reloj y no en la base se crea deshabilitado, para revisar
    const existentes = new Set(await Comensal.distinct('pin'));
    const nuevos = [...this.usuarios.values()].filter((u) => /^\d{1,9}$/.test(u.pin) && !existentes.has(u.pin));
    if (nuevos.length) {
      await Comensal.insertMany(
        nuevos.map((u) => ({
          pin: u.pin,
          nombre: u.nombre || `Usuario ${u.pin}`,
          autorizado: false,
          pendienteRevision: true,
        })),
        { ordered: false }
      ).catch((e) => {
        if (e.code !== 11000 && !e.writeErrors) throw e;
      });
      this.log(`${nuevos.length} usuarios del reloj agregados como "pendientes de revisión"`);
    }
    await Dispositivo.updateOne({ _id: this.id }, { $set: { ultimaLecturaUsuarios: ahora } });
    return lista;
  }

  async altaUsuario(c) {
    const existente = this.usuarios.get(c.pin);
    let uid = existente?.uid;
    if (!uid) {
      const usados = new Set([...this.usuarios.values()].map((u) => u.uid));
      uid = 1;
      while (usados.has(uid)) uid++;
      if (uid > 65535) throw new Error('El reloj no tiene lugar para más usuarios');
    }
    const nombre = zk.nombreParaReloj(c.nombre, this.formato === 'viejo' ? 8 : 24);
    const privilegio = existente?.privilegio || 0; // 0 = usuario común

    await zk.escribirUsuario(this.zk, this.formato, { uid, pin: c.pin, nombre, tarjeta: c.tarjeta, privilegio });
    this.usuarios.set(c.pin, { uid, pin: c.pin, nombre, privilegio });
    await UsuarioReloj.updateOne(
      { deviceSn: this.sn, pin: c.pin },
      { $set: { nombre, vistoEn: new Date() } },
      { upsert: true }
    );
  }

  async bajaUsuario(pin) {
    const u = this.usuarios.get(pin);
    if (u) {
      await zk.borrarUsuario(this.zk, u.uid);
      this.usuarios.delete(pin);
    }
    await UsuarioReloj.deleteOne({ deviceSn: this.sn, pin });
  }

  async procesarComandos() {
    const pendientes = await Comando.find({ deviceSn: this.sn, estado: 'pendiente' }).sort({ cmdId: 1 }).limit(50);
    for (const cmd of pendientes) {
      if (this.detenido) return;
      cmd.estado = 'enviado';
      cmd.enviadoEn = new Date();
      cmd.intentos = (cmd.intentos || 0) + 1;
      try {
        await this.ejecutarComando(cmd);
        cmd.estado = 'ok';
        cmd.retorno = 0;
      } catch (err) {
        // Si se cortó la conexión, el comando vuelve a la cola y se reintenta
        if (esErrorDeConexion(err)) {
          cmd.estado = 'pendiente';
          await cmd.save();
          throw err;
        }
        cmd.estado = 'error';
        cmd.retorno = err.retorno ?? -1;
        this.log(`comando ${cmd.cmdId} (${cmd.tipo}) falló: ${mensajeError(err)}`);
      }
      cmd.respondidoEn = new Date();
      await cmd.save();
      tiempoReal.emitir('comando', cmd.toJSON());
    }
  }

  async ejecutarComando(cmd) {
    switch (cmd.tipo) {
      case 'alta': {
        const c = await Comensal.findOne({ pin: cmd.pin }).lean();
        if (!c) throw Object.assign(new Error('el comensal ya no existe'), { retorno: -2 });
        return this.altaUsuario(c);
      }
      case 'baja':
        return this.bajaUsuario(cmd.pin);
      case 'consulta':
        return this.leerUsuarios();
      case 'actualizar':
        return this.sincronizarFichadas();
      case 'recuperar': {
        // "DATA QUERY ATTLOG StartTime=YYYY-MM-DD 00:00:00\tEndTime=YYYY-MM-DD 23:59:59"
        const m = /StartTime=(\S+) (\S+)\s+EndTime=(\S+) (\S+)/.exec(cmd.texto);
        const { tzOffset } = require('../config');
        const desde = m ? new Date(`${m[1]}T${m[2]}${tzOffset}`) : undefined;
        const hasta = m ? new Date(new Date(`${m[3]}T${m[4]}${tzOffset}`).getTime() + 1000) : undefined;
        return this.sincronizarFichadas({ desde, hasta, forzar: true });
      }
      case 'vaciar':
        // Antes de vaciar, nos aseguramos de tener todo
        await this.sincronizarFichadas({ forzar: true });
        await zk.vaciarFichadas(this.zk);
        this.ultimoTotalFichadas = 0;
        return;
      case 'reiniciar':
        await zk.reiniciar(this.zk).catch(() => {});
        await this.cerrar(); // el reloj corta la conexión; se reconecta solo
        return;
      case 'info':
        return; // los datos se actualizan solos en cada ciclo
      case 'biometria':
        throw Object.assign(new Error('restaurar biometría no está disponible por 4370'), { retorno: -1002 });
      default:
        throw Object.assign(new Error(`tipo de comando desconocido: ${cmd.tipo}`), { retorno: -1002 });
    }
  }
}

function mensajeError(err) {
  let e = err;
  while (e?.err) e = e.err;
  return e?.message || String(e);
}

function esErrorDeConexion(err) {
  const m = mensajeError(err);
  return /ECONN|ETIMEDOUT|EHOSTUNREACH|ENETUNREACH|EPIPE|socket|TIMEOUT|closed|isn't connected/i.test(m);
}

module.exports = { Conector, snProvisorio, esProvisorio, mensajeError };
