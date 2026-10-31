// server.js - API de tareas + envio de notificaciones push
// Instalar: npm install
// Ejecutar: npm start  ->  http://localhost:3000

const express = require('express');
const webpush = require('web-push');
const fs = require('fs');
const path = require('path');

const app = express();
const PUERTO = process.env.PORT || 3000;

// ---------- Persistencia sencilla en archivos JSON ----------
const DIR_DATOS = path.join(__dirname, 'datos');
fs.mkdirSync(DIR_DATOS, { recursive: true });
const ARCH_TAREAS = path.join(DIR_DATOS, 'tareas.json');
const ARCH_SUBS = path.join(DIR_DATOS, 'suscripciones.json');
const ARCH_VAPID = path.join(DIR_DATOS, 'vapid.json');

function leer(archivo, porDefecto) {
  try { return JSON.parse(fs.readFileSync(archivo, 'utf8')); } catch (e) { return porDefecto; }
}
function escribir(archivo, datos) {
  fs.writeFileSync(archivo, JSON.stringify(datos, null, 2));
}

const tareas = new Map(Object.entries(leer(ARCH_TAREAS, {})));
let suscripciones = leer(ARCH_SUBS, []);
const guardarTareas = () => escribir(ARCH_TAREAS, Object.fromEntries(tareas));
const guardarSubs = () => escribir(ARCH_SUBS, suscripciones);

// ---------- Claves VAPID para Web Push ----------
// Se toman de variables de entorno (produccion) o se generan una sola vez (desarrollo)
let vapid = (process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY)
  ? { publicKey: process.env.VAPID_PUBLIC_KEY, privateKey: process.env.VAPID_PRIVATE_KEY }
  : leer(ARCH_VAPID, null);
if (!vapid) {
  vapid = webpush.generateVAPIDKeys();
  escribir(ARCH_VAPID, vapid);
  console.log('Claves VAPID generadas en datos/vapid.json');
}
webpush.setVapidDetails(process.env.VAPID_SUBJECT || 'mailto:equipo.tareas@example.com', vapid.publicKey, vapid.privateKey);

// ---------- Middlewares ----------
app.use(express.json({ limit: '100kb' }));
app.use(express.static(path.join(__dirname, 'public'), {
  setHeaders: (res, ruta) => {
    // El Service Worker no debe quedarse en la cache HTTP para poder actualizarse
    if (ruta.endsWith('sw.js')) res.setHeader('Cache-Control', 'no-cache');
  }
}));

// ---------- Validacion ----------
const ESTADOS = ['pendiente', 'en_progreso', 'completada'];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function validar(t) {
  if (!t || typeof t.titulo !== 'string' || !t.titulo.trim() || t.titulo.length > 80) return 'Titulo obligatorio (maximo 80 caracteres)';
  if (t.descripcion && (typeof t.descripcion !== 'string' || t.descripcion.length > 500)) return 'Descripcion invalida';
  if (!t.fechaLimite || isNaN(Date.parse(t.fechaLimite))) return 'Fecha limite invalida';
  if (!ESTADOS.includes(t.estado)) return 'Estado invalido';
  if (!t.actualizadoEn || isNaN(Date.parse(t.actualizadoEn))) return 'Fecha de actualizacion invalida';
  if (t.ubicacion) {
    const { lat, lng } = t.ubicacion;
    if (typeof lat !== 'number' || typeof lng !== 'number' || lat < -90 || lat > 90 || lng < -180 || lng > 180) return 'Ubicacion invalida';
  }
  return null;
}

function publica(t) {
  const { avisosServidor, ...resto } = t;
  return resto;
}

// ---------- API de tareas ----------
app.get('/api/tareas', (req, res) => {
  res.json([...tareas.values()].map(publica));
});

// PUT idempotente: el id (UUID) lo genera el cliente, reenviar la misma tarea no la duplica
app.put('/api/tareas/:id', (req, res) => {
  const id = req.params.id;
  const b = req.body || {};
  if (!UUID.test(id)) return res.status(400).json({ error: 'Identificador invalido' });
  if (b.id && b.id !== id) return res.status(400).json({ error: 'El id no coincide' });
  const error = validar(b);
  if (error) return res.status(400).json({ error });

  const existente = tareas.get(id);

  // Conflicto: el servidor ya tiene una version mas reciente
  if (existente && existente.actualizadoEn > b.actualizadoEn) {
    return res.status(409).json({ mensaje: 'El servidor tiene una version mas reciente', tarea: publica(existente) });
  }
  // Reenvio de la misma version: se confirma sin volver a guardar
  if (existente && existente.actualizadoEn === b.actualizadoEn) {
    return res.status(200).json(publica(existente));
  }

  const fechaLimite = new Date(b.fechaLimite).toISOString();
  const tarea = {
    id,
    titulo: b.titulo.trim(),
    descripcion: (b.descripcion || '').trim(),
    fechaLimite,
    estado: b.estado,
    ubicacion: b.ubicacion
      ? { lat: b.ubicacion.lat, lng: b.ubicacion.lng, precision: b.ubicacion.precision || null, fecha: b.ubicacion.fecha || null }
      : null,
    creadoEn: b.creadoEn || new Date().toISOString(),
    actualizadoEn: b.actualizadoEn,
    recibidoEn: new Date().toISOString(),
    // Si cambia la fecha limite se vuelven a programar los avisos
    avisosServidor: existente && existente.fechaLimite === fechaLimite ? (existente.avisosServidor || {}) : {}
  };
  tareas.set(id, tarea);
  guardarTareas();
  res.status(existente ? 200 : 201).json(publica(tarea));
});

app.delete('/api/tareas/:id', (req, res) => {
  if (!tareas.has(req.params.id)) return res.status(404).json({ error: 'No existe' });
  tareas.delete(req.params.id);
  guardarTareas();
  res.status(204).end();
});

// ---------- API de notificaciones push ----------
app.get('/api/push/clave', (req, res) => res.json({ clave: vapid.publicKey }));

app.post('/api/push/suscripcion', (req, res) => {
  const sub = req.body;
  if (!sub || typeof sub.endpoint !== 'string' || !sub.keys) return res.status(400).json({ error: 'Suscripcion invalida' });
  if (!suscripciones.some((s) => s.endpoint === sub.endpoint)) {
    suscripciones.push(sub);
    guardarSubs();
  }
  res.status(201).json({ ok: true, total: suscripciones.length });
});

app.post('/api/push/prueba', async (req, res) => {
  const enviadas = await enviarPush({
    titulo: 'Prueba de notificacion push',
    cuerpo: 'El servidor puede enviarte avisos aunque la aplicacion este cerrada.',
    url: './'
  });
  res.json({ enviadas, suscripciones: suscripciones.length });
});

async function enviarPush(datos) {
  let enviadas = 0;
  const vigentes = [];
  for (const sub of suscripciones) {
    try {
      await webpush.sendNotification(sub, JSON.stringify(datos));
      enviadas++;
      vigentes.push(sub);
    } catch (err) {
      // 404 / 410: la suscripcion ya no existe en el servicio push
      if (err.statusCode !== 404 && err.statusCode !== 410) vigentes.push(sub);
      console.warn('Error push:', err.statusCode || err.message);
    }
  }
  if (vigentes.length !== suscripciones.length) {
    suscripciones = vigentes;
    guardarSubs();
  }
  return enviadas;
}

// ---------- Avisos programados ----------
// Los revisa el servidor (no una pagina abierta), asi el aviso llega aunque la PWA este cerrada
const MINUTOS_AVISO = 60;

async function revisarVencimientos() {
  if (!suscripciones.length) return;
  const ahora = Date.now();
  let cambios = false;
  for (const t of tareas.values()) {
    if (t.estado === 'completada') continue;
    const minutos = (Date.parse(t.fechaLimite) - ahora) / 60000;
    t.avisosServidor = t.avisosServidor || {};
    let datos = null;
    if (minutos <= 0 && !t.avisosServidor.vencida) {
      datos = { titulo: 'Tarea vencida', cuerpo: `${t.titulo} ya paso su fecha limite.` };
      t.avisosServidor.vencida = true;
    } else if (minutos > 0 && minutos <= MINUTOS_AVISO && !t.avisosServidor.porVencer) {
      datos = { titulo: 'Tarea por vencer', cuerpo: `${t.titulo} vence en ${Math.ceil(minutos)} minutos.` };
      t.avisosServidor.porVencer = true;
    }
    if (datos) {
      await enviarPush({ ...datos, url: `./?tarea=${t.id}`, tag: `push-${t.id}` });
      cambios = true;
    }
  }
  if (cambios) guardarTareas();
}
setInterval(revisarVencimientos, 60 * 1000);

app.listen(PUERTO, () => {
  console.log(`Servidor en http://localhost:${PUERTO}`);
});
