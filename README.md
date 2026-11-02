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

En `server/.env`:
```
RELOJES_4370=128.128.22.250
INTERVALO_4370=5
```
Al arrancar (`npm start`), la consola muestra `[4370 128.128.22.250] conectado ✔`.

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

Para probar sin el equipo: `node src/scripts/simular-reloj-4370.js` (simula un reloj en el puerto
4370; para fichar: `curl "http://localhost:4371/fichar?pin=1001"`) y `RELOJES_4370=127.0.0.1`.
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
- **Doble toque:** si la misma persona ficha dos veces en menos de `DEDUP_SEGUNDOS`, la segunda
  se ignora.
- **Biometría:** las plantillas que sube el reloj se guardan como respaldo (colección
  `plantillas`). Son datos sensibles (Ley 25.326): restringir acceso a la base.
