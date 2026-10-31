// db.js - Almacenamiento local con IndexedDB y sincronizacion con el servidor
// Se usa desde la pagina (window) y desde el Service Worker (self)

const DB_NOMBRE = 'tareasDB';
const DB_VERSION = 1;
const STORE = 'tareas';

function abrirDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NOMBRE, DB_VERSION);
    req.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains(STORE)) {
        const store = db.createObjectStore(STORE, { keyPath: 'id' });
        store.createIndex('sync', 'sync', { unique: false });
        store.createIndex('fechaLimite', 'fechaLimite', { unique: false });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function operacion(modo, fn) {
  const db = await abrirDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, modo);
    const store = tx.objectStore(STORE);
    let resultado;
    const req = fn(store);
    if (req) req.onsuccess = () => { resultado = req.result; };
    tx.oncomplete = () => { db.close(); resolve(resultado); };
    tx.onerror = () => { db.close(); reject(tx.error); };
  });
}

const guardarTarea = (tarea) => operacion('readwrite', (s) => s.put(tarea)).then(() => tarea);
const obtenerTarea = (id) => operacion('readonly', (s) => s.get(id));
const obtenerTodas = () => operacion('readonly', (s) => s.getAll());
const borrarTareaLocal = (id) => operacion('readwrite', (s) => s.delete(id));

async function listarTareas() {
  const todas = await obtenerTodas();
  return todas.filter((t) => !t.eliminada);
}

async function contarPendientesSync() {
  const todas = await obtenerTodas();
  return todas.filter((t) => t.sync === 'pendiente').length;
}

// Envia al servidor los cambios marcados como pendientes.
// Solo se marca "sincronizado" cuando el servidor confirma la misma version.
async function sincronizarPendientes(base = '/api/tareas') {
  const pendientes = (await obtenerTodas()).filter((t) => t.sync === 'pendiente');
  let enviadas = 0;
  let fallidas = 0;
  let conflictos = 0;

  for (const t of pendientes) {
    const url = `${base}/${encodeURIComponent(t.id)}`;
    try {
      if (t.eliminada) {
        const r = await fetch(url, { method: 'DELETE' });
        if (r.ok || r.status === 404) {
          await borrarTareaLocal(t.id);
          enviadas++;
        } else {
          fallidas++;
        }
        continue;
      }

      const { sync, avisos, eliminada, confirmadoEn, ...cuerpo } = t;
      const r = await fetch(url, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(cuerpo)
      });

      if (r.status === 409) {
        // El servidor tiene una version mas nueva: se adopta la del servidor
        const { tarea } = await r.json();
        const actual = await obtenerTarea(t.id);
        await guardarTarea({ ...tarea, sync: 'sincronizado', confirmadoEn: tarea.recibidoEn, avisos: (actual && actual.avisos) || {} });
        conflictos++;
      } else if (r.ok) {
        const servidor = await r.json();
        const actual = await obtenerTarea(t.id);
        // Si el usuario la edito mientras se enviaba, queda pendiente para el siguiente ciclo
        if (actual && actual.actualizadoEn === servidor.actualizadoEn) {
          actual.sync = 'sincronizado';
          actual.confirmadoEn = servidor.recibidoEn;
          await guardarTarea(actual);
        }
        enviadas++;
      } else {
        fallidas++;
      }
    } catch (err) {
      fallidas++;
    }
  }
  return { enviadas, fallidas, conflictos, total: pendientes.length };
}

// Trae las tareas del servidor y actualiza las locales que no tengan cambios pendientes
async function descargarDelServidor(base = '/api/tareas') {
  const r = await fetch(base);
  if (!r.ok) return 0;
  const remotas = await r.json();
  let nuevas = 0;
  for (const remota of remotas) {
    const local = await obtenerTarea(remota.id);
    if (!local) {
      await guardarTarea({ ...remota, sync: 'sincronizado', confirmadoEn: remota.recibidoEn, avisos: {} });
      nuevas++;
    } else if (local.sync === 'sincronizado' && remota.actualizadoEn > local.actualizadoEn) {
      await guardarTarea({ ...remota, sync: 'sincronizado', confirmadoEn: remota.recibidoEn, avisos: {} });
    }
  }
  return nuevas;
}

function formatearFecha(iso) {
  return new Date(iso).toLocaleString('es-MX', { dateStyle: 'medium', timeStyle: 'short' });
}

function minutosRestantes(tarea) {
  return (Date.parse(tarea.fechaLimite) - Date.now()) / 60000;
}

// Revisa tareas proximas a vencer (24 h) o vencidas y muestra un aviso una sola vez por tarea.
// La usan la pagina abierta y el Service Worker (Periodic Background Sync).
async function revisarVencimientos(registration) {
  if (typeof Notification !== 'undefined' && Notification.permission !== 'granted') return 0;
  const tareas = (await listarTareas()).filter((t) => t.estado !== 'completada' && t.fechaLimite);
  let mostrados = 0;
  for (const t of tareas) {
    const min = minutosRestantes(t);
    t.avisos = t.avisos || {};
    let titulo = null;
    if (min <= 0 && !t.avisos.vencida) {
      titulo = 'Tarea vencida';
      t.avisos.vencida = true;
    } else if (min > 0 && min <= 24 * 60 && !t.avisos.porVencer) {
      titulo = 'Tarea por vencer';
      t.avisos.porVencer = true;
    }
    if (titulo) {
      try {
        await registration.showNotification(titulo, {
          body: `${t.titulo} - Fecha limite: ${formatearFecha(t.fechaLimite)}`,
          icon: 'icons/icon-192.png',
          badge: 'icons/icon-192.png',
          tag: `venc-${t.id}`,
          data: { url: `./?tarea=${t.id}` }
        });
        await guardarTarea(t);
        mostrados++;
      } catch (e) { /* sin permiso o sin soporte */ }
    }
  }
  return mostrados;
}
