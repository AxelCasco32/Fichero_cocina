# Sistema de comedor – ZKTeco MB360

Backend (Node + Express + MongoDB + Socket.io) para gestionar el fichero MB360 de la cocina:
ABM de comensales, validación de retiro por servicio y monitoreo de fichadas en vivo.

## Cómo funciona

```
MB360 ──HTTP /iclock (ADMS)──▶ Express ──▶ MongoDB
   ▲                              │
   └── comandos (alta/baja) ◀─────┤
                                  └── Socket.io ──▶ Web de la cocina (paso 2)
```

1. El MB360 llama al servidor cada pocos segundos (protocolo ADMS/Push).
2. Cada fichada se evalúa: ¿existe? ¿está autorizado? ¿hay un servicio en ese horario?
   ¿lo tiene habilitado? ¿ya retiró en este servicio hoy?
3. El resultado se guarda y se emite en vivo a la web.
4. Las altas y bajas que se hacen en la web se encolan como comandos; el reloj los toma en
   su próxima consulta y confirma si los aplicó.

## Puesta en marcha

Requisitos: Node 18+ y MongoDB 5+ (local o en un servidor del hospital).

```bash
cd server
cp .env.example .env          # y editá JWT_SECRET, MONGO_URI, etc.
npm install
npm run crear-admin -- admin UnaClaveSegura "Tu Nombre"
npm run dev
```

### Frontend (React)

**En desarrollo** (dos terminales):

```bash
# terminal 1
cd server && npm run dev
# terminal 2
cd client && npm install && npm run dev     # abre http://localhost:5173
```

Vite redirige `/api` y `/socket.io` al backend, así que no hay que configurar nada más.

**En producción** (un solo proceso):

```bash
cd client && npm install && npm run build   # genera client/dist
cd ../server && npm start                    # sirve la web y la API en el puerto 4000
```

Desde cualquier PC de la red: `http://IP-DEL-SERVIDOR:4000`.

Pantallas:

| Pantalla | Para qué |
|---|---|
| Monitor en vivo | Para la PC de la cocina: la última fichada en grande (verde = puede retirar, naranja = ya retiró, rojo = no), contadores por servicio, pitido en rechazos, **carga manual** y **anulación** |
| Comensales | Alta, edición, habilitar/deshabilitar, baja y reactivación (restaura la biometría). Pestaña de pendientes de revisión |
| Reportes | Gráfico por hora, totales por servicio, detalle filtrable (origen, anuladas), carga manual, anular/restaurar y exportación a Excel (CSV) |
| Equipos | Estado del reloj, **Base vs. reloj** (quién falta en cada lado y botón para corregir), acciones remotas e historial de comandos |
| Operadores | (solo admin) Usuarios de la web y sus roles |

### Gestión centralizada del fichero

Todo se hace desde la web; en el equipo solo hay que pararse para enrolar el rostro/huella **la primera vez**.

- **Fichadas manuales**: se buscan por nombre/PIN/DNI, se elige hora y motivo, y antes de guardar se ve
  el resultado. Quedan marcadas como "Manual" con el operador que las cargó.
- **Anular fichadas**: no se borran; quedan tachadas, con quién y por qué, y dejan de contar en reportes
  y en el control de "ya retiró". Se pueden restaurar.
- **Base vs. reloj**: "Leer usuarios del reloj" trae la lista real del equipo y la compara con la base:
  *solo en la base* (no pueden fichar → "Enviar al reloj"), *solo en el reloj* (dados de baja que siguen
  cargados → "Borrar del reloj") y *en los dos*.
- **Respaldo biométrico**: cuando alguien se enrola, el reloj sube su plantilla y se guarda. Al reactivar
  a alguien, reenviarlo o cambiar de equipo, se le restaura sin volver a enrolar. Al dar de baja se puede
  elegir borrar ese respaldo.
- **Acciones remotas**: pedir datos nuevos, actualizar información, recuperar fichadas de un rango de
  fechas, enviar todos los comensales y (admin) reiniciar o vaciar la memoria de fichadas del reloj.

> Las fichadas manuales existen solo en el sistema: el MB360 no permite cargarle marcas desde afuera.
> Como todos los reportes salen del sistema, no hace falta que estén en el reloj.

## Modo 4370 (conexión directa) — el que usa el MB360 del hospital

El firmware 8.0.4.6 del MB360 se conecta por ADMS pero rechaza todos los comandos (`UNKNOWN CMD`)
y no sube las fichadas. Por eso el sistema se conecta **él** al reloj por el puerto **4370**, el
mismo que usa el software de ZKTeco.

Los equipos se cargan desde la web: **Equipos → Agregar equipo** (solo administradores). Se indica
el tipo de equipo, la IP y el puerto (casi siempre 4370); con **Probar conexión** se ve el número de
serie, el firmware y cuántos usuarios y fichadas tiene antes de guardar. Al guardar, el sistema empieza
a conectarse enseguida y la consola muestra `[4370 <IP>] conectado ✔ por TCP (...)`.

Desde cada equipo también se puede **Editar** (IP, puerto, conexión, formato), **Deshabilitar** (el
sistema deja de conectarse y de mandarle altas y bajas) o **Quitar** (las fichadas que ya trajo se
conservan).

`RELOJES_4370` en `server/.env` sigue funcionando: al arrancar registra esas IP si todavía no están
cargadas. Si quitás un equipo desde la web, sacalo también de ahí o vuelve a aparecer al reiniciar.

### Enrolar huellas desde la web

En **Comensales**, el botón **Huella** de cada persona (y automáticamente después de dar de alta a
alguien) abre el enrolamiento: se elige el reloj y se toca el dedo en el dibujo de las manos. El reloj
le pide a la persona que apoye el dedo 3 veces y la web muestra el avance en vivo; al final se verifica
con el reloj que la huella haya quedado guardada y la persona figura como "Enrolado".

- Solo para relojes con conexión directa (4370) y en línea; un enrolamiento a la vez por reloj.
- Si la huella ya es de otra persona, el reloj la rechaza y se avisa.
- El **rostro** no se puede enrolar a distancia: se hace en el equipo.
- Con el simulador: `curl "http://localhost:4371/enrolar?resultado=duplicada"` (o `tiempo`, `ok`) define
  cómo termina el próximo enrolamiento.

### Equipos antiguos (628-C y otros con firmware 6.x)

Elegí el tipo **"628-C u otro equipo antiguo"** al agregarlo. La diferencia con el MB360:

| | MB360 (firmware 8) | Antiguos (firmware 6) |
|---|---|---|
| Conexión | TCP | Generalmente solo UDP |
| Usuarios | 72 bytes, PIN de hasta 24 caracteres, nombre de 24 letras | 28 bytes, **PIN numérico**, nombre de **8 letras** |
| Fichadas | 40 bytes | 16 u 8 bytes |

Con la conexión en **Automática** el sistema prueba TCP y, si el equipo no responde, UDP. El formato se
detecta solo comparando el tamaño de los datos con la cantidad de usuarios y fichadas; si alguna vez
se detecta mal, se puede fijar en **Opciones avanzadas**. Mientras el equipo no informe su número de
serie, figura como `IP-<ip>`; cuando lo informa, pasa a identificarse con él (y si ese equipo ya estaba
cargado con otra IP, se unifican).

- Cada 5 segundos se fija si hay fichadas nuevas (y las trae) y ejecuta los comandos pendientes
  (altas, bajas, lectura de usuarios, recuperar, vaciar, reiniciar).
- **Primera conexión:** trae los usuarios del reloj como "Pendientes de revisión" y solo las fichadas
  de **hoy**. Después: Comensales → Pendientes → revisar → "Habilitar todos los pendientes", y en
  Equipos → "Recuperar fichadas" con el rango que quieras para traer el historial ya evaluado.
- El software de ZKTeco y este sistema **no deberían conectarse al reloj al mismo tiempo**.
- La **clave de comunicación** del reloj tiene que estar en 0.
- Por 4370 **no se puede restaurar la biometría**: si se da de baja a alguien, al volver tiene que
  enrolarse de nuevo en el equipo.
- En el reloj conviene **desactivar "Servidor en la nube / ADMS"** para que no quede intentando.

Para probar sin el equipo: `node src/scripts/simular-reloj-4370.js` simula un MB360 en el puerto
4370 (para fichar: `curl "http://localhost:4371/fichar?pin=1001"`). Con `--viejo` simula un equipo
antiguo por UDP: `node src/scripts/simular-reloj-4370.js 4380 --viejo` (fichar en el puerto 4381;
`--registro=8` para fichadas de 8 bytes). Después, en la web, agregalo con IP `127.0.0.1` y ese puerto.
Para probar la conexión con el reloj real sin modificar nada: `npm run prueba-4370 -- <IP>`.

## Configurar el MB360 (modo ADMS)

En el equipo: **Menú → Comunicación → Configuración del servidor en la nube (ADMS)**

- Dirección del servidor: IP de la PC/servidor donde corre este backend
- Puerto: el de `PORT` (4000 por defecto)
- HTTPS: desactivado (dentro de la red del hospital)

Cuando el equipo se conecte, vas a ver en la consola `equipo nuevo registrado: <SN>`.
Después poné ese número de serie en `ADMS_SN_PERMITIDOS` para que solo ese equipo pueda enviar datos.

Si el menú no tiene la opción ADMS / servidor en la nube, el firmware no soporta Push y hay que
usar el modo socket (puerto 4370): avisame y lo adaptamos.

## Probar sin el equipo

Con el servidor corriendo, en otra terminal:

```bash
npm run simular -- handshake            # primer contacto
npm run simular -- fichar 1001 12:10    # fichada de hoy a las 12:10
npm run simular -- comandos             # el "reloj" retira altas/bajas pendientes
npm run simular -- usuario 2002 Juan    # usuario enrolado directo en el reloj
```

## API

Todas (salvo login) requieren `Authorization: Bearer <token>`.

| Método | Ruta | Qué hace |
|---|---|---|
| POST | /api/auth/login | `{usuario, password}` → `{token, operador}` |
| GET | /api/comensales?q=&estado=activos\|inactivos\|pendientes\|todos | Listado con búsqueda |
| POST | /api/comensales | Alta (`pin`, `nombre`, `dni`, `sector`, `tarjeta`, `servicios`, `autorizado`) |
| PUT | /api/comensales/:id | Modificación (el PIN no se cambia). `{activo:true}` reactiva |
| DELETE | /api/comensales/:id | Baja: inactivo + se borra del reloj |
| POST | /api/comensales/:id/reenviar | Reenvía la persona al reloj |
| GET | /api/fichadas?desde=&hasta=&pin=&resultado=&servicio= | Listado |
| GET | /api/fichadas/recientes | Últimas fichadas (monitor) |
| GET | /api/fichadas/por-hora?fecha=YYYY-MM-DD | 24 filas con totales por resultado |
| GET | /api/fichadas/resumen?fecha= | Totales por servicio |
| GET | /api/fichadas/servicios | Catálogo de servicios y horarios |
| GET | /api/dispositivos | Equipos, en línea o no, comandos pendientes |
| POST | /api/dispositivos/probar | (admin) `{ip, puerto, protocolo, formato}` → número de serie, firmware, formato detectado |
| POST | /api/dispositivos | (admin) Agrega un equipo 4370 (`nombre`, `modelo`, `ip`, `puerto`, `protocolo`, `formato`) |
| PUT | /api/dispositivos/:sn | (admin) Edita nombre, modelo, conexión o `habilitado` |
| DELETE | /api/dispositivos/:sn | (admin) Quita el equipo (las fichadas se conservan) |
| GET | /api/dispositivos/:sn/comandos | Historial de comandos |
| POST | /api/dispositivos/:sn/sincronizar | (admin) Manda todos los activos al reloj |
| POST | /api/dispositivos/:sn/consultar-usuarios | (admin) Pide la lista de usuarios del reloj |
| CRUD | /api/operadores | (admin) Personal que usa la web |
| GET | /api/auditoria | (admin) Quién hizo qué |

Eventos de Socket.io (conectar con `auth: { token }`): `fichada`, `dispositivo`, `comando`.

## Decisiones importantes

- **La base es la fuente de verdad.** Si alguien se enrola directo en el reloj y no está en la
  base, se crea como *pendiente de revisión* y sin autorización.
- **Deshabilitar ≠ dar de baja.** `autorizado: false` bloquea el retiro pero conserva la
  biometría en el reloj. La baja (DELETE) borra a la persona del equipo, y si vuelve hay que
  enrolarla de nuevo.
- **Horarios de servicio** en `server/src/catalogos/servicios.js`.
- **Límite diario:** cada persona puede tener como máximo `MAX_RETIROS_DIA` fichadas aceptadas por día
  (3 por defecto, sumando todos los servicios). Desde la siguiente, la fichada queda como *Límite diario
  alcanzado* (rojo y pitido en el monitor). Las anuladas no cuentan. `0` = sin límite. El control lo hace
  el sistema: el MB360 no tiene un contador por día y sigue mostrando "verificado" en pantalla.
- **Doble toque:** si la misma persona ficha dos veces en menos de `DEDUP_SEGUNDOS`, la segunda
  se ignora.
- **Biometría:** las plantillas que sube el reloj se guardan como respaldo (colección
  `plantillas`). Son datos sensibles (Ley 25.326): restringir acceso a la base.
