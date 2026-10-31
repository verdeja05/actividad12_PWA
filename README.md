# Tareas PWA

Progressive Web App para registrar y dar seguimiento a tareas con fecha limite y ubicacion, que funciona sin conexion y genera avisos de vencimiento.

Actividad 12 - Desarrollo para Dispositivos Inteligentes - UTVT (IDGS-94)

Equipo:
- Luz Ariadna Verdeja Hernandez
- Ada Yasmin Ojeda Espinoza
- Rubi Plata Alvarez
- Joana Benites Sanchez

## Funcionalidades

- Crear, editar, completar y eliminar tareas (titulo, descripcion, fecha limite, estado y ubicacion).
- Almacenamiento local con IndexedDB: las tareas siguen disponibles al cerrar y abrir la app.
- Indicador de conexion (En linea / Sin conexion) y aviso de cambios pendientes.
- Service Worker con cache del App Shell: la app abre y se usa sin internet.
- Sincronizacion de cambios pendientes al recuperar la conexion (Background Sync con alternativa por evento `online`).
- Sin duplicados: cada tarea usa un UUID generado en el cliente y el servidor confirma la version recibida (PUT idempotente).
- Geolocalizacion con autorizacion previa; si se deniega, la tarea se guarda sin ubicacion.
- Avisos locales al registrar una tarea y al consultar una tarea pendiente.
- Ampliacion: avisos programados por el servidor mediante Web Push (VAPID) y Periodic Background Sync.

## Estructura

```
tareas-pwa/
  server.js            API REST + envio de push + revision de vencimientos
  package.json
  public/
    index.html         Listado, formulario y detalle
    styles.css
    app.js             Logica de interfaz, geolocalizacion, avisos
    db.js              IndexedDB y sincronizacion (compartido con el SW)
    sw.js              Service Worker: cache, sync, periodicsync, push
    manifest.json
    icons/             icon.svg, icon-192.png, icon-512.png
  datos/               Se crea al ejecutar (tareas, suscripciones, claves VAPID)
```

## Ejecucion local

Requisitos: Node.js 18 o superior.

```
npm install
npm start
```

Abrir `http://localhost:3000` en Chrome o Edge. `localhost` se considera contexto seguro, por lo que funcionan Service Worker, geolocalizacion y notificaciones.

## API

| Metodo | Ruta | Descripcion |
|---|---|---|
| GET | /api/tareas | Lista de tareas |
| PUT | /api/tareas/:id | Crea o actualiza (idempotente). 201 creada, 200 actualizada o reenvio, 409 el servidor tiene una version mas reciente |
| DELETE | /api/tareas/:id | Elimina (204) o 404 si ya no existe |
| GET | /api/push/clave | Clave publica VAPID |
| POST | /api/push/suscripcion | Registra una suscripcion push |
| POST | /api/push/prueba | Envia una notificacion push de prueba |

## Pruebas offline

1. Abrir DevTools (F12) > Network > Offline.
2. Recargar: la app abre desde la cache.
3. Registrar o editar tareas: quedan como "Pendiente de sincronizar".
4. Volver a "No throttling": los cambios se envian solos y pasan a "Sincronizado".

## Publicacion (Render)

1. Subir el repositorio a GitHub.
2. En https://render.com crear un Web Service desde el repositorio.
3. Build command: `npm install` - Start command: `npm start`.
4. Variables de entorno recomendadas (generar con `npx web-push generate-vapid-keys`):
   `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` (por ejemplo `mailto:correo@dominio.com`).
5. Render entrega una URL HTTPS, requisito para PWA, geolocalizacion y push.

En el plan gratuito el disco no es persistente: las tareas guardadas en el servidor se reinician con cada despliegue (los datos locales del dispositivo se conservan).

## Limitaciones

- Background Sync y Periodic Background Sync solo existen en navegadores basados en Chromium; Periodic Sync requiere la PWA instalada.
- En iOS las notificaciones push solo funcionan con la PWA agregada a la pantalla de inicio (iOS 16.4+).
- El servidor envia los push a todas las suscripciones (no hay usuarios ni autenticacion).
