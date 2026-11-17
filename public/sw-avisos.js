// Avisos do Leciona no service worker: mostra a notificação enviada pelo servidor
// (connector/avisosPush.ts) e abre o app na tela certa ao tocar nela.
// Carregado pelo service worker gerado no build (vite.config.ts, workbox.importScripts).

self.addEventListener('push', event => {
  let aviso = {};
  try { aviso = event.data ? event.data.json() : {}; } catch (e) { /* mensagem sem conteúdo */ }
  event.waitUntil(self.registration.showNotification(aviso.titulo || 'Leciona', {
    body: aviso.texto || '',
    tag: aviso.marca || 'leciona',
    renotify: true,
    icon: '/icon-192.png',
    badge: '/icon-192.png',
    data: { destino: aviso.destino || '' }
  }));
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  const destino = (event.notification.data && event.notification.data.destino) || '';
  event.waitUntil((async () => {
    const janelas = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const aberta = janelas.find(j => new URL(j.url).origin === self.location.origin);
    if (aberta) {
      aberta.postMessage({ tipo: 'leciona-abrir', destino });
      return aberta.focus();
    }
    return self.clients.openWindow(destino ? `/?abrir=${encodeURIComponent(destino)}` : '/');
  })());
});
