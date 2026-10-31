// sw.js - Service Worker de la PWA de tareas
importScripts('db.js');

const VERSION = 'v1';
const CACHE_ESTATICO = `tareas-estatico-${VERSION}`;

// Recursos esenciales (App Shell) para abrir la app sin conexion
const APP_SHELL = [
  './',
  './index.html',
  './styles.css',
  './app.js',
  './db.js',
  './manifest.json',
  './icons/icon.svg',
  './icons/icon-192.png',
  './icons/icon-512.png'
];

// 1. Instalacion: precarga del App Shell
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_ESTATICO)
      .then((cache) => cache.addAll(APP_SHELL))
      .then(() => self.skipWaiting())
  );
});

// 2. Activacion: elimina caches de versiones anteriores
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((nombres) => Promise.all(nombres.filter((n) => n !== CACHE_ESTATICO).map((n) => caches.delete(n))))
      .then(() => self.clients.claim())
  );
});

// 3. Fetch: la API nunca se cachea (los datos viven en IndexedDB)
self.addEventListener('fetch', (event) => {
  const req = event.request;
  const url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== self.location.origin || url.pathname.startsWith('/api/')) return;

  // Navegacion: siempre responde con el App Shell (tambien con ?tarea=id)
  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req).catch(() => caches.match('./index.html'))
    );
    return;
  }

  // Recursos estaticos: Cache First con actualizacion en segundo plano
  event.respondWith(
    caches.match(req).then((enCache) => {
      const red = fetch(req).then((resp) => {
        if (resp.ok) caches.open(CACHE_ESTATICO).then((c) => c.put(req, resp.clone()));
        return resp;
      }).catch(() => enCache);
      return enCache || red;
    })
  );
});

// 4. Background Sync: envia los cambios pendientes al recuperar la conexion
self.addEventListener('sync', (event) => {
  if (event.tag !== 'sync-tareas') return;
  event.waitUntil(
    sincronizarPendientes('/api/tareas').then(async (r) => {
      await avisarClientes({ tipo: 'SYNC_TERMINADO', ...r });
      if (r.enviadas > 0) {
        await mostrarSiHayPermiso('Tareas sincronizadas', `${r.enviadas} cambio(s) enviados al servidor.`, 'sync');
      }
      // Si algo fallo, el navegador volvera a intentar
      if (r.fallidas > 0) throw new Error('Cambios pendientes por reintentar');
    })
  );
});

// 5. Periodic Background Sync: revisa vencimientos aunque la pagina este cerrada
//    (Chrome/Edge con la PWA instalada)
self.addEventListener('periodicsync', (event) => {
  if (event.tag === 'revisar-vencimientos') {
    event.waitUntil(revisarVencimientos(self.registration));
  }
});

// 6. Push: avisos programados enviados por el servidor
self.addEventListener('push', (event) => {
  let datos = { titulo: 'Recordatorio de tareas', cuerpo: 'Tienes tareas pendientes.', url: './' };
  if (event.data) {
    try { datos = { ...datos, ...event.data.json() }; } catch (e) { datos.cuerpo = event.data.text(); }
  }
  event.waitUntil(
    self.registration.showNotification(datos.titulo, {
      body: datos.cuerpo,
      icon: 'icons/icon-192.png',
      badge: 'icons/icon-192.png',
      tag: datos.tag || 'push',
      data: { url: datos.url || './' }
    })
  );
});

// 7. Click en un aviso: abre la app en la tarea correspondiente
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const destino = new URL((event.notification.data && event.notification.data.url) || './', self.location.origin).href;
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((ventanas) => {
      for (const v of ventanas) {
        if ('navigate' in v) return v.navigate(destino).then((c) => c && c.focus());
      }
      return self.clients.openWindow(destino);
    })
  );
});

async function mostrarSiHayPermiso(titulo, cuerpo, tag) {
  if (typeof Notification !== 'undefined' && Notification.permission !== 'granted') return;
  try {
    await self.registration.showNotification(titulo, { body: cuerpo, icon: 'icons/icon-192.png', tag });
  } catch (e) { /* sin permiso */ }
}

async function avisarClientes(mensaje) {
  const clientes = await self.clients.matchAll({ includeUncontrolled: true });
  clientes.forEach((c) => c.postMessage(mensaje));
}
