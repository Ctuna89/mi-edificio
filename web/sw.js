/* Service worker de Mi Edificio: solo notificaciones push (no guarda nada en caché). */
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', e => e.waitUntil(self.clients.claim()));

// El cuerpo llega desde la Edge Function "push": { titulo, cuerpo, url }
self.addEventListener('push', e => {
  let d = {};
  try { d = e.data.json(); } catch (_) { d = { cuerpo: e.data ? e.data.text() : '' }; }
  e.waitUntil(self.registration.showNotification(d.titulo || 'Mi Edificio', {
    body: d.cuerpo || '', icon: 'icon.svg', badge: 'icon.svg', data: { url: d.url || '#inicio' },
  }));
});

// Al tocar la notificación: enfocar la app abierta (y llevarla a la vista) o abrirla
self.addEventListener('notificationclick', e => {
  e.notification.close();
  const hash = String((e.notification.data && e.notification.data.url) || '#inicio');
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(cs => {
    const c = cs.find(x => x.url.startsWith(self.registration.scope));
    if (c) { c.postMessage({ ir: hash }); return c.focus(); }
    return self.clients.openWindow(self.registration.scope + hash);
  }));
});
