// Conexión directa con el reloj por el puerto 4370 (protocolo "PC" de ZKTeco, el mismo que usa su software).
// El servidor se conecta al reloj y, cada pocos segundos:
//   1. se fija si hay fichadas nuevas y las trae;
//   2. ejecuta los comandos pendientes de la cola (altas, bajas, lectura de usuarios, etc.).
// Así la web funciona igual que con ADMS: usa la misma cola de comandos y los mismos modelos.

const Zkteco = require('zkteco-js');
const Dispositivo = require('../models/Dispositivo');
const Comando = require('../models/Comando');
const Comensal = require('../models/Comensal');
const UsuarioReloj = require('../models/UsuarioReloj');
const { registrarFichadas } = require('../services/fichadas');
const tiempoReal = require('../tiempoReal');

const CMD = {
  ACK_OK: 2000,
  RESTART: 1004,
  REFRESHDATA: 1013,
  USER_WRQ: 8,
  DELETE_USER: 18,
};

// El reloj guarda los nombres en ASCII: sacamos acentos y caracteres raros
function nombreParaReloj(nombre) {
  return String(nombre || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^\x20-\x7E]/g, '')
    .trim()
    .slice(0, 24);
}

const esperar = (ms) => new Promise((ok) => setTimeout(ok, ms));

class Conector {
  constructor({ ip, puerto = 4370, intervalo = 5, indice = 0 }) {
    this.ip = ip;
    this.puerto = puerto;
    this.intervaloMs = Math.max(2, intervalo) * 1000;
    this.puertoLocalUdp = 5000 + indice;
    this.zk = null;
    this.sn = null;
    this.usuarios = new Map(); // pin -> { uid, nombre }
    this.ultimoTotalFichadas = null;
    this.fallos = 0;
    this.detenido = false;
    this.inicio = new Date();
  }

  log(...a) {
    console.log(`[4370 ${this.ip}]`, ...a);
  }

  iniciar() {
    this.log(`conectando cada ${this.intervaloMs / 1000} s…`);
    this.bucle();
  }

  async bucle() {
    while (!this.detenido) {
      try {
        await this.ciclo();
        this.fallos = 0;
        await esperar(this.intervaloMs);
      } catch (err) {
        this.fallos++;
        const causa = mensajeError(err);
        if (this.fallos === 1 || this.fallos % 12 === 0) this.log(`sin conexión: ${causa} (reintentando)`);
        await this.cerrar();
        await esperar(Math.min(30000, this.intervaloMs * this.fallos));
      }
    }
  }

  async cerrar() {
    const zk = this.zk;
    this.zk = null;
    if (zk) {
      try {
        await Promise.race([zk.disconnect(), esperar(3000)]);
      } catch {
        /* ya estaba cortada */
      }
    }
  }

  async conectar() {
    const zk = new Zkteco(this.ip, this.puerto, 10000, this.puertoLocalUdp, 8184);
    await zk.createSocket();
    this.zk = zk;

    let sn = null;
    try {
      sn = (await zk.getSerialNumber())?.trim();
    } catch {
      /* algunos firmwares no lo informan */
    }
    this.sn = sn || `IP-${this.ip}`;

    let firmware;
    try {
      firmware = (await zk.getDeviceVersion())?.trim();
    } catch {
      /* opcional */
    }

    await Dispositivo.updateOne(
      { sn: this.sn },
      { $set: { ip: this.ip, modo: '4370', ...(firmware ? { firmware } : {}) }, $setOnInsert: { sn: this.sn } },
      { upsert: true }
    );
    // La primera vez, traemos los usuarios del reloj a la base (como pendientes) antes de las fichadas
    const disp = await Dispositivo.findOne({ sn: this.sn }, 'ultimaLecturaUsuarios').lean();
    await this.leerUsuarios({ soloCache: !!disp?.ultimaLecturaUsuarios });
    this.log(`conectado ✔ (SN ${this.sn}, ${this.usuarios.size} usuarios en el reloj)`);
  }

  async ciclo() {
    if (!this.zk) await this.conectar();

    const ahora = new Date();
    const cambios = { ultimaConexion: ahora };

    // ¿Cambió la cantidad de fichadas? (consulta liviana)
    let total = null;
    try {
      const info = await this.zk.getInfo();
      total = info.logCounts;
      cambios.usuariosEnEquipo = info.userCounts;
      cambios['info.UserCount'] = info.userCounts;
      cambios['info.TransactionCount'] = info.logCounts;
    } catch {
      total = null; // si el firmware no lo informa, sincronizamos igual (más lento)
    }
    await Dispositivo.updateOne({ sn: this.sn }, { $set: cambios });
    tiempoReal.emitir('dispositivo', { sn: this.sn, ultimaConexion: ahora });

    if (total === null || total !== this.ultimoTotalFichadas) {
      await this.sincronizarFichadas();
      this.ultimoTotalFichadas = total;
    }

    await this.procesarComandos();
  }

  // Trae las fichadas del reloj y guarda las nuevas
  async sincronizarFichadas({ desde, hasta, forzar = false } = {}) {
    const disp = await Dispositivo.findOne({ sn: this.sn }, 'ultimaFichada').lean();
    const registros = ((await this.zk.getAttendances()).data || [])
      .map((r) => ({ pin: String(r.user_id || '').trim(), fecha: new Date(r.record_time), estado: r.state, verificacion: r.type }))
      .filter((r) => r.pin && !Number.isNaN(r.fecha.getTime()));

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
      await Dispositivo.updateOne({ sn: this.sn }, { $set: { ultimaFichada: maxFecha } });
    }
    if (guardadas || masDeMil) this.log(`${guardadas} fichadas nuevas`);
    return guardadas;
  }

  // Lee los usuarios del reloj. Con soloCache=false también actualiza la "foto" en la base
  async leerUsuarios({ soloCache = false } = {}) {
    const lista = ((await this.zk.getUsers()).data || []).map((u) => ({
      uid: u.uid,
      pin: String(u.userId || '').trim(),
      nombre: String(u.name || '').trim(),
      tarjeta: u.cardno ? String(u.cardno) : undefined,
      privilegio: u.role,
    }));
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
          tarjeta: u.tarjeta,
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
    await Dispositivo.updateOne({ sn: this.sn }, { $set: { ultimaLecturaUsuarios: ahora } });
    return lista;
  }

  async ejecutar(codigo, datos = Buffer.alloc(0)) {
    const r = await this.zk.executeCmd(codigo, datos);
    const respuesta = r && r.length >= 2 ? r.readUInt16LE(0) : null;
    if (respuesta !== CMD.ACK_OK) throw Object.assign(new Error(`el reloj respondió ${respuesta}`), { retorno: -(respuesta || 1) });
    return r;
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
    const nombre = nombreParaReloj(c.nombre);
    const tarjeta = Number(c.tarjeta) || 0;

    // Registro de 72 bytes del usuario (mismo formato que el software de ZKTeco)
    const b = Buffer.alloc(72);
    b.writeUInt16LE(uid, 0);
    b.writeUInt8(existente?.privilegio || 0, 2); // 0 = usuario común
    b.write(nombre, 11, 24, 'latin1');
    b.writeUInt32LE(tarjeta > 0xffffffff ? 0 : tarjeta, 35);
    b.write('1', 40, 7, 'latin1'); // grupo
    b.write(c.pin, 48, 24, 'latin1');

    await this.ejecutar(CMD.USER_WRQ, b);
    await this.ejecutar(CMD.REFRESHDATA).catch(() => {});
    this.usuarios.set(c.pin, { uid, pin: c.pin, nombre, privilegio: existente?.privilegio || 0 });
    await UsuarioReloj.updateOne(
      { deviceSn: this.sn, pin: c.pin },
      { $set: { nombre, vistoEn: new Date() } },
      { upsert: true }
    );
  }

  async bajaUsuario(pin) {
    const u = this.usuarios.get(pin);
    if (u) {
      const b = Buffer.alloc(2);
      b.writeUInt16LE(u.uid, 0);
      await this.ejecutar(CMD.DELETE_USER, b);
      await this.ejecutar(CMD.REFRESHDATA).catch(() => {});
      this.usuarios.delete(pin);
    }
    await UsuarioReloj.deleteOne({ deviceSn: this.sn, pin });
  }

  async procesarComandos() {
    const pendientes = await Comando.find({ deviceSn: this.sn, estado: 'pendiente' }).sort({ cmdId: 1 }).limit(50);
    for (const cmd of pendientes) {
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
        await this.zk.clearAttendanceLog();
        this.ultimoTotalFichadas = 0;
        return;
      case 'reiniciar':
        await this.ejecutar(CMD.RESTART).catch(() => {});
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
  return /ECONN|ETIMEDOUT|EPIPE|socket|TIMEOUT|closed|isn't connected/i.test(m);
}

// Arranca un conector por cada reloj configurado en RELOJES_4370
function iniciarConectores(lista, intervalo) {
  return lista.map((entrada, indice) => {
    const [ip, puerto] = entrada.split(':');
    const c = new Conector({ ip, puerto: Number(puerto) || 4370, intervalo, indice });
    c.iniciar();
    return c;
  });
}

module.exports = { Conector, iniciarConectores, nombreParaReloj };
