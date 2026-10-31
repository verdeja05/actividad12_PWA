// app.js - Interfaz de la PWA de tareas
const API = '/api/tareas';
const $ = (id) => document.getElementById(id);

// Iconos SVG (sin emojis)
const svg = (d) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
const ICONO = {
  mas: svg('<path d="M12 5v14M5 12h14"/>'),
  campana: svg('<path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/>'),
  campanaOn: svg('<path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/><path d="M4 2C2.8 3.7 2 5.7 2 8"/><path d="M22 8c0-2.3-.8-4.3-2-6"/>'),
  reloj: svg('<circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/>'),
  pin: svg('<path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z"/><circle cx="12" cy="10" r="3"/>'),
  nubeOk: svg('<path d="M17.5 19H9a7 7 0 1 1 6.71-9h1.79a4.5 4.5 0 1 1 0 9Z"/><path d="m9 14 2 2 4-4"/>'),
  nubeSubir: svg('<path d="M4 14.9A7 7 0 1 1 15.7 8h1.8a4.5 4.5 0 0 1 2.5 8.2"/><path d="M12 12v9"/><path d="m16 16-4-4-4 4"/>'),
  ver: svg('<path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z"/><circle cx="12" cy="12" r="3"/>'),
  editar: svg('<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/>'),
  check: svg('<path d="M20 6 9 17l-5-5"/>'),
  borrar: svg('<path d="M3 6h18"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>'),
  cerrar: svg('<path d="M18 6 6 18M6 6l12 12"/>'),
  ubicar: svg('<circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3"/><circle cx="12" cy="12" r="7"/>')
};

const ESTADOS = { pendiente: 'Pendiente', en_progreso: 'En progreso', completada: 'Completada' };

let tareas = [];
let filtro = 'todas';
let editandoId = null;
let ubicacionForm = null;

// ---------------- Inicio ----------------
document.addEventListener('DOMContentLoaded', async () => {
  $('btnNueva').innerHTML = `${ICONO.mas} Nueva tarea`;
  $('btnUbicacion').innerHTML = `${ICONO.ubicar} Agregar ubicacion`;
  $('btnCerrarDetalle').innerHTML = ICONO.cerrar;
  pintarBotonAvisos();
  registrarEventos();
  actualizarRed();
  await iniciarServiceWorker();
  await cargar();
  if (navigator.onLine) await sincronizar(false);
  abrirTareaDeUrl();
  revisarAvisosPagina();
  // Mientras la pagina esta abierta se revisan vencimientos cada minuto.
  // Con la pagina cerrada los avisos dependen de Push / Periodic Sync, no de este temporizador.
  setInterval(revisarAvisosPagina, 60 * 1000);
});

async function iniciarServiceWorker() {
  if (!('serviceWorker' in navigator)) return;
  try {
    await navigator.serviceWorker.register('sw.js');
    navigator.serviceWorker.addEventListener('message', async (e) => {
      if (e.data && e.data.tipo === 'SYNC_TERMINADO') {
        await cargar();
        if (e.data.enviadas) toast(`${e.data.enviadas} cambio(s) sincronizados con el servidor.`);
      }
    });
  } catch (err) {
    console.error('No se pudo registrar el Service Worker', err);
  }
}

function registrarEventos() {
  window.addEventListener('online', async () => { actualizarRed(); await sincronizar(true); });
  window.addEventListener('offline', actualizarRed);

  document.querySelectorAll('.filtro').forEach((b) => b.addEventListener('click', () => {
    document.querySelectorAll('.filtro').forEach((x) => x.classList.remove('activo'));
    b.classList.add('activo');
    filtro = b.dataset.filtro;
    pintarLista();
  }));

  $('btnNueva').addEventListener('click', () => abrirFormulario());
  $('btnCancelar').addEventListener('click', cerrarFormulario);
  $('formTarea').addEventListener('submit', guardarFormulario);

  $('btnUbicacion').addEventListener('click', () => { $('confirmUbic').hidden = false; });
  $('btnCancelarUbic').addEventListener('click', () => {
    $('confirmUbic').hidden = true;
    mensajeUbicacion('La tarea se guardara sin ubicacion.', 'aviso');
  });
  $('btnPermitirUbic').addEventListener('click', obtenerUbicacion);
  $('btnQuitarUbic').addEventListener('click', () => { ubicacionForm = null; pintarUbicacionForm(); });

  $('lista').addEventListener('click', accionLista);
  $('btnAvisos').addEventListener('click', activarAvisos);
  $('btnSincronizar').addEventListener('click', () => sincronizar(true));
  $('btnPruebaPush').addEventListener('click', probarPush);
  $('btnCerrarDetalle').addEventListener('click', () => $('dlgDetalle').close());
  document.querySelector('.sistema').addEventListener('toggle', pintarCapacidades);
}

// ---------------- Datos ----------------
async function cargar() {
  tareas = await listarTareas();
  pintarResumen();
  pintarLista();
  await actualizarBannerSync();
}

function esVencida(t) {
  return t.estado !== 'completada' && Date.parse(t.fechaLimite) < Date.now();
}

function tiempoRestante(iso) {
  const min = Math.round((Date.parse(iso) - Date.now()) / 60000);
  const abs = Math.abs(min);
  let txt;
  if (abs < 60) txt = `${abs} min`;
  else if (abs < 60 * 24) txt = `${Math.round(abs / 60)} h`;
  else txt = `${Math.round(abs / 1440)} dia(s)`;
  return min < 0 ? `Vencio hace ${txt}` : `Vence en ${txt}`;
}

// datetime-local <-> ISO (UTC)
function isoAInputLocal(iso) {
  const d = new Date(iso);
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
}

function escapar(txt) {
  const d = document.createElement('div');
  d.textContent = txt ?? '';
  return d.innerHTML;
}

// ---------------- Render ----------------
function pintarResumen() {
  $('cPendientes').textContent = tareas.filter((t) => t.estado === 'pendiente').length;
  $('cProgreso').textContent = tareas.filter((t) => t.estado === 'en_progreso').length;
  $('cCompletadas').textContent = tareas.filter((t) => t.estado === 'completada').length;
  $('cVencidas').textContent = tareas.filter(esVencida).length;
}

function pintarLista() {
  let lista = [...tareas];
  if (filtro === 'vencidas') lista = lista.filter(esVencida);
  else if (filtro !== 'todas') lista = lista.filter((t) => t.estado === filtro);

  lista.sort((a, b) => {
    if ((a.estado === 'completada') !== (b.estado === 'completada')) return a.estado === 'completada' ? 1 : -1;
    return Date.parse(a.fechaLimite) - Date.parse(b.fechaLimite);
  });

  if (!lista.length) {
    $('lista').innerHTML = `<p class="vacio">${tareas.length ? 'No hay tareas con este filtro.' : 'Aun no tienes tareas. Registra la primera con "Nueva tarea".'}</p>`;
    return;
  }

  $('lista').innerHTML = lista.map((t) => {
    const vencida = esVencida(t);
    const ubic = t.ubicacion
      ? `${t.ubicacion.lat.toFixed(5)}, ${t.ubicacion.lng.toFixed(5)}`
      : 'Sin ubicacion';
    const sync = t.sync === 'pendiente'
      ? `<span class="sync pendiente">${ICONO.nubeSubir} Pendiente de sincronizar</span>`
      : `<span class="sync sincronizado">${ICONO.nubeOk} Sincronizado</span>`;
    return `
      <article class="tarea ${t.estado} ${vencida ? 'vencida' : ''}" data-id="${t.id}">
        <div class="tarea-cab">
          <h3>${escapar(t.titulo)}</h3>
          <span class="badge ${t.estado}">${ESTADOS[t.estado]}</span>
        </div>
        ${t.descripcion ? `<p class="desc">${escapar(t.descripcion)}</p>` : ''}
        <div class="meta">
          <span class="${vencida ? 'rojo' : ''}">${ICONO.reloj} ${formatearFecha(t.fechaLimite)} - ${t.estado === 'completada' ? 'Completada' : tiempoRestante(t.fechaLimite)}</span>
          <span>${ICONO.pin} ${ubic}</span>
          ${sync}
        </div>
        <div class="acciones">
          <button class="btn chico" data-accion="ver" data-id="${t.id}" type="button">${ICONO.ver} Ver</button>
          <button class="btn chico" data-accion="editar" data-id="${t.id}" type="button">${ICONO.editar} Editar</button>
          ${t.estado !== 'completada' ? `<button class="btn chico" data-accion="completar" data-id="${t.id}" type="button">${ICONO.check} Completar</button>` : ''}
          <button class="btn chico peligro" data-accion="eliminar" data-id="${t.id}" type="button">${ICONO.borrar} Eliminar</button>
        </div>
      </article>`;
  }).join('');
}

function actualizarRed() {
  const el = $('estadoRed');
  el.textContent = navigator.onLine ? 'En linea' : 'Sin conexion';
  el.className = `chip-red ${navigator.onLine ? 'en-linea' : 'sin-red'}`;
  actualizarBannerSync();
}

async function actualizarBannerSync() {
  const n = await contarPendientesSync();
  const banner = $('bannerSync');
  if (!n) { banner.hidden = true; return; }
  banner.hidden = false;
  banner.textContent = navigator.onLine
    ? `${n} cambio(s) pendientes de sincronizar. Enviando al servidor...`
    : `${n} cambio(s) guardados en el dispositivo. Se enviaran al recuperar la conexion.`;
}

// ---------------- Formulario ----------------
function abrirFormulario(tarea = null) {
  editandoId = tarea ? tarea.id : null;
  $('tituloForm').textContent = tarea ? 'Editar tarea' : 'Nueva tarea';
  $('fTitulo').value = tarea ? tarea.titulo : '';
  $('fDescripcion').value = tarea ? tarea.descripcion : '';
  $('fEstado').value = tarea ? tarea.estado : 'pendiente';
  if (tarea) {
    $('fFecha').value = isoAInputLocal(tarea.fechaLimite);
  } else {
    const manana = new Date(Date.now() + 24 * 3600 * 1000);
    manana.setMinutes(0, 0, 0);
    $('fFecha').value = isoAInputLocal(manana.toISOString());
  }
  ubicacionForm = tarea && tarea.ubicacion ? { ...tarea.ubicacion } : null;
  $('confirmUbic').hidden = true;
  $('errorForm').hidden = true;
  pintarUbicacionForm();
  $('panelForm').hidden = false;
  $('panelForm').scrollIntoView({ behavior: 'smooth', block: 'start' });
  $('fTitulo').focus();
}

function cerrarFormulario() {
  $('panelForm').hidden = true;
  $('formTarea').reset();
  editandoId = null;
  ubicacionForm = null;
}

async function guardarFormulario(e) {
  e.preventDefault();
  const titulo = $('fTitulo').value.trim();
  const fecha = $('fFecha').value;
  if (!titulo || !fecha) {
    $('errorForm').textContent = 'El titulo y la fecha limite son obligatorios.';
    $('errorForm').hidden = false;
    return;
  }

  const ahora = new Date().toISOString();
  const anterior = editandoId ? await obtenerTarea(editandoId) : null;
  const fechaLimite = new Date(fecha).toISOString();

  const tarea = {
    id: anterior ? anterior.id : crypto.randomUUID(), // identificador unico generado en el cliente
    titulo,
    descripcion: $('fDescripcion').value.trim(),
    fechaLimite,
    estado: $('fEstado').value,
    ubicacion: ubicacionForm,
    creadoEn: anterior ? anterior.creadoEn : ahora,
    actualizadoEn: ahora,
    sync: 'pendiente',
    confirmadoEn: anterior ? anterior.confirmadoEn : null,
    // Si cambia la fecha limite se reinician los avisos de vencimiento
    avisos: anterior && anterior.fechaLimite === fechaLimite ? (anterior.avisos || {}) : {}
  };

  await guardarTarea(tarea);
  cerrarFormulario();
  await cargar();

  const sinUbic = tarea.ubicacion ? '' : ' (sin ubicacion)';
  await avisoLocal(
    anterior ? 'Tarea actualizada' : 'Tarea registrada',
    `${tarea.titulo}${sinUbic}. Fecha limite: ${formatearFecha(tarea.fechaLimite)}`,
    `reg-${tarea.id}`,
    tarea.id
  );
  await solicitarSync();
}

// ---------------- Geolocalizacion ----------------
function obtenerUbicacion() {
  $('confirmUbic').hidden = true;
  if (!('geolocation' in navigator)) {
    mensajeUbicacion('Este dispositivo no permite obtener la ubicacion. La tarea se guardara sin ubicacion.', 'aviso');
    return;
  }
  mensajeUbicacion('Solicitando autorizacion y obteniendo ubicacion...', '');
  navigator.geolocation.getCurrentPosition(
    (pos) => {
      ubicacionForm = {
        lat: Number(pos.coords.latitude.toFixed(6)),
        lng: Number(pos.coords.longitude.toFixed(6)),
        precision: Math.round(pos.coords.accuracy),
        fecha: new Date().toISOString()
      };
      pintarUbicacionForm();
    },
    (err) => {
      ubicacionForm = null;
      pintarUbicacionForm();
      const textos = {
        1: 'Permiso de ubicacion denegado. Puedes guardar la tarea sin ubicacion.',
        2: 'No se pudo determinar la ubicacion. Puedes guardar la tarea sin ubicacion.',
        3: 'Se agoto el tiempo para obtener la ubicacion. Intenta de nuevo o guarda sin ubicacion.'
      };
      mensajeUbicacion(textos[err.code] || 'No se pudo obtener la ubicacion.', 'aviso');
    },
    { enableHighAccuracy: true, timeout: 15000, maximumAge: 60000 }
  );
}

function pintarUbicacionForm() {
  if (ubicacionForm) {
    mensajeUbicacion(`Ubicacion registrada: ${ubicacionForm.lat}, ${ubicacionForm.lng} (precision aprox. ${ubicacionForm.precision} m)`, 'ok');
    $('btnQuitarUbic').hidden = false;
    $('btnUbicacion').innerHTML = `${ICONO.ubicar} Actualizar ubicacion`;
  } else {
    mensajeUbicacion('Sin ubicacion registrada.', '');
    $('btnQuitarUbic').hidden = true;
    $('btnUbicacion').innerHTML = `${ICONO.ubicar} Agregar ubicacion`;
  }
}

function mensajeUbicacion(texto, clase) {
  const el = $('ubicTexto');
  el.textContent = texto;
  el.className = `ubic-texto ${clase}`;
}

// ---------------- Acciones del listado ----------------
async function accionLista(e) {
  const btn = e.target.closest('button[data-accion]');
  if (!btn) return;
  const tarea = await obtenerTarea(btn.dataset.id);
  if (!tarea) return;

  switch (btn.dataset.accion) {
    case 'ver':
      verDetalle(tarea);
      break;
    case 'editar':
      abrirFormulario(tarea);
      break;
    case 'completar':
      tarea.estado = 'completada';
      tarea.actualizadoEn = new Date().toISOString();
      tarea.sync = 'pendiente';
      await guardarTarea(tarea);
      await cargar();
      toast(`"${tarea.titulo}" marcada como completada.`);
      await solicitarSync();
      break;
    case 'eliminar':
      if (!confirm(`Eliminar la tarea "${tarea.titulo}"?`)) return;
      if (!tarea.confirmadoEn) {
        // Nunca llego al servidor: se elimina solo del dispositivo
        await borrarTareaLocal(tarea.id);
      } else {
        // Ya existe en el servidor: se marca para eliminar al sincronizar
        tarea.eliminada = true;
        tarea.sync = 'pendiente';
        tarea.actualizadoEn = new Date().toISOString();
        await guardarTarea(tarea);
      }
      await cargar();
      toast('Tarea eliminada.');
      await solicitarSync();
      break;
  }
}

function verDetalle(t) {
  $('dTitulo').textContent = t.titulo;
  const mapa = t.ubicacion
    ? `<a href="https://www.openstreetmap.org/?mlat=${t.ubicacion.lat}&mlon=${t.ubicacion.lng}#map=17/${t.ubicacion.lat}/${t.ubicacion.lng}" target="_blank" rel="noopener">${t.ubicacion.lat}, ${t.ubicacion.lng}</a> (precision aprox. ${t.ubicacion.precision} m)`
    : 'Sin ubicacion';
  $('dCuerpo').innerHTML = `
    <dl class="detalle">
      <dt>Estado</dt><dd><span class="badge ${t.estado}">${ESTADOS[t.estado]}</span></dd>
      <dt>Descripcion</dt><dd>${escapar(t.descripcion) || 'Sin descripcion'}</dd>
      <dt>Fecha limite</dt><dd>${formatearFecha(t.fechaLimite)} - ${t.estado === 'completada' ? 'Completada' : tiempoRestante(t.fechaLimite)}</dd>
      <dt>Ubicacion</dt><dd>${mapa}</dd>
      <dt>Sincronizacion</dt><dd>${t.sync === 'pendiente' ? 'Pendiente de enviar al servidor' : `Confirmada por el servidor (${t.confirmadoEn ? formatearFecha(t.confirmadoEn) : '-'})`}</dd>
      <dt>Identificador</dt><dd><code>${t.id}</code></dd>
    </dl>`;
  $('dlgDetalle').showModal();

  // Aviso al consultar una tarea pendiente
  if (t.estado !== 'completada') {
    avisoLocal(
      esVencida(t) ? 'Tarea vencida' : 'Tarea pendiente',
      `${t.titulo}: ${tiempoRestante(t.fechaLimite)}.`,
      `pend-${t.id}`,
      t.id
    );
  }
}

function abrirTareaDeUrl() {
  const id = new URLSearchParams(location.search).get('tarea');
  if (!id) return;
  const t = tareas.find((x) => x.id === id);
  if (t) verDetalle(t);
  history.replaceState(null, '', location.pathname);
}

// ---------------- Sincronizacion ----------------
async function solicitarSync() {
  if ('serviceWorker' in navigator) {
    const reg = await navigator.serviceWorker.ready;
    if ('sync' in reg) {
      try {
        await reg.sync.register('sync-tareas'); // Background Sync (Chrome / Edge)
        return;
      } catch (e) { /* se usa el mecanismo alternativo */ }
    }
  }
  // Alternativa para Firefox / Safari: enviar si hay conexion; si no, al evento "online"
  if (navigator.onLine) await sincronizar(false);
}

async function sincronizar(mostrarResultado) {
  if (!navigator.onLine) {
    if (mostrarResultado) toast('Sin conexion. Los cambios se enviaran al recuperarla.');
    return;
  }
  try {
    const r = await sincronizarPendientes(API);
    await descargarDelServidor(API);
    await cargar();
    if (r.enviadas) {
      toast(`${r.enviadas} cambio(s) sincronizados con el servidor.`);
      if (mostrarResultado) avisoLocal('Tareas sincronizadas', `${r.enviadas} cambio(s) enviados al servidor.`, 'sync');
    } else if (mostrarResultado) {
      toast(r.fallidas ? 'El servidor no respondio. Se reintentara.' : 'Todo esta sincronizado.');
    }
  } catch (e) {
    if (mostrarResultado) toast('No fue posible sincronizar.');
  }
}

// ---------------- Avisos ----------------
async function avisoLocal(titulo, cuerpo, tag, idTarea) {
  // Siempre se muestra dentro de la app
  toast(`${titulo}: ${cuerpo}`);
  // Y como notificacion del sistema si el usuario dio permiso
  if (!('Notification' in window) || Notification.permission !== 'granted' || !('serviceWorker' in navigator)) return;
  try {
    const reg = await navigator.serviceWorker.ready;
    await reg.showNotification(titulo, {
      body: cuerpo,
      icon: 'icons/icon-192.png',
      badge: 'icons/icon-192.png',
      tag,
      data: { url: idTarea ? `./?tarea=${idTarea}` : './' }
    });
  } catch (e) { console.warn('No se pudo mostrar la notificacion', e); }
}

async function revisarAvisosPagina() {
  if (!('serviceWorker' in navigator)) return;
  const reg = await navigator.serviceWorker.ready;
  const n = await revisarVencimientos(reg);
  if (n) await cargar();
}

function pintarBotonAvisos() {
  const activo = 'Notification' in window && Notification.permission === 'granted';
  $('btnAvisos').innerHTML = activo ? ICONO.campanaOn : ICONO.campana;
  $('btnAvisos').classList.toggle('activo', activo);
  $('btnAvisos').title = activo ? 'Avisos activados' : 'Activar avisos';
}

async function activarAvisos() {
  if (!('Notification' in window)) {
    toast('Este navegador no soporta notificaciones. Los avisos se mostraran dentro de la app.');
    return;
  }
  const permiso = await Notification.requestPermission();
  pintarBotonAvisos();
  if (permiso !== 'granted') {
    toast('Avisos no autorizados. Los recordatorios se mostraran solo dentro de la app.');
    return;
  }
  const reg = await navigator.serviceWorker.ready;

  // Periodic Background Sync: revisa vencimientos con la app cerrada (PWA instalada en Chrome/Edge)
  if ('periodicSync' in reg) {
    try {
      const estado = await navigator.permissions.query({ name: 'periodic-background-sync' });
      if (estado.state === 'granted') {
        await reg.periodicSync.register('revisar-vencimientos', { minInterval: 60 * 60 * 1000 });
      }
    } catch (e) { /* no disponible */ }
  }

  const push = await suscribirPush(reg);
  await avisoLocal('Avisos activados', push
    ? 'Recibiras recordatorios de vencimiento aunque la app este cerrada.'
    : 'Recibiras avisos mientras uses la app.', 'avisos');
  revisarAvisosPagina();
  pintarCapacidades();
}

function base64AUint8(base64) {
  const relleno = '='.repeat((4 - (base64.length % 4)) % 4);
  const b64 = (base64 + relleno).replace(/-/g, '+').replace(/_/g, '/');
  const bruto = atob(b64);
  return Uint8Array.from([...bruto].map((c) => c.charCodeAt(0)));
}

async function suscribirPush(reg) {
  if (!('PushManager' in window) || !navigator.onLine) return false;
  try {
    const r = await fetch('/api/push/clave');
    if (!r.ok) return false;
    const { clave } = await r.json();
    let sub = await reg.pushManager.getSubscription();
    if (!sub) {
      sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: base64AUint8(clave) });
    }
    const g = await fetch('/api/push/suscripcion', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(sub)
    });
    return g.ok;
  } catch (e) {
    console.warn('Push no disponible:', e);
    return false;
  }
}

async function probarPush() {
  if (!navigator.onLine) { toast('Se necesita conexion para probar push.'); return; }
  try {
    const r = await fetch('/api/push/prueba', { method: 'POST' });
    const d = await r.json();
    toast(d.enviadas ? 'Notificacion push enviada por el servidor.' : 'No hay suscripciones push. Activa los avisos primero.');
  } catch (e) {
    toast('No se pudo contactar al servidor.');
  }
}

// ---------------- Estado del sistema ----------------
async function pintarCapacidades() {
  const proto = ('ServiceWorkerRegistration' in window) ? ServiceWorkerRegistration.prototype : {};
  let sw = 'No';
  if ('serviceWorker' in navigator) sw = navigator.serviceWorker.controller ? 'Activo' : 'Registrado';
  let geo = 'geolocation' in navigator ? 'Disponible' : 'No';
  try {
    const p = await navigator.permissions.query({ name: 'geolocation' });
    geo = { granted: 'Autorizada', denied: 'Denegada', prompt: 'Se preguntara' }[p.state] || geo;
  } catch (e) { /* sin Permissions API */ }
  let push = 'PushManager' in window ? 'Disponible' : 'No';
  if (push !== 'No' && 'serviceWorker' in navigator) {
    try {
      const reg = await navigator.serviceWorker.ready;
      if (await reg.pushManager.getSubscription()) push = 'Suscrito';
    } catch (e) { /* */ }
  }
  const notif = 'Notification' in window
    ? { granted: 'Autorizadas', denied: 'Bloqueadas', default: 'Sin decidir' }[Notification.permission]
    : 'No';

  const filas = [
    ['Service Worker', sw],
    ['IndexedDB', 'indexedDB' in window ? 'Disponible' : 'No'],
    ['Background Sync', 'sync' in proto ? 'Disponible' : 'No (se usa evento online)'],
    ['Periodic Background Sync', 'periodicSync' in proto ? 'Disponible' : 'No'],
    ['Notificaciones', notif],
    ['Push API', push],
    ['Geolocalizacion', geo],
    ['Cambios por sincronizar', String(await contarPendientesSync())]
  ];
  const clase = (v) => (/^(No|Bloqueadas|Denegada)/.test(v) ? 'no' : /Sin decidir|Se preguntara|Registrado|evento/.test(v) ? 'parcial' : 'si');
  $('tablaCapacidades').innerHTML = filas
    .map(([k, v]) => `<tr><td>${k}</td><td class="${clase(v)}">${v}</td></tr>`)
    .join('');
}

// ---------------- Utilidades ----------------
function toast(texto) {
  const t = $('toast');
  t.textContent = texto;
  t.hidden = false;
  clearTimeout(t._temporizador);
  t._temporizador = setTimeout(() => { t.hidden = true; }, 3500);
}
