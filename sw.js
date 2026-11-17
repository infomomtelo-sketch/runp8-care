// Title22 phone alerts — service worker.
//
// Its whole job: receive a Web Push message and put a notification on
// the phone's lock screen, like a text message. Tapping the
// notification opens the app (focusing an already-open window when
// there is one).
//
// Payloads are JSON: { title, body, url, tag }. By product rule an
// alert NEVER names a resident or a medication — lock screens are
// public surfaces; the detail lives behind sign-in, in the app.
// The defaults below exist so a malformed payload still shows
// something honest instead of a blank notification.

self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('push', (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch (e) {
    data = {};
  }
  const title = typeof data.title === 'string' && data.title ? data.title : 'Title22';
  const body = typeof data.body === 'string' ? data.body : 'Something needs your attention in Title22.';
  const url = typeof data.url === 'string' && data.url.startsWith('/') ? data.url : '/';
  const tag = typeof data.tag === 'string' && data.tag ? data.tag : 'title22-alert';
  event.waitUntil(
    self.registration.showNotification(title, {
      body,
      tag,
      icon: '/icon-192.png',
      badge: '/icon-192.png',
      data: { url },
    })
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const target = (event.notification.data && event.notification.data.url) || '/';
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windows) => {
      for (const win of windows) {
        if (win.url.includes(self.location.origin) && 'focus' in win) {
          if ('navigate' in win) {
            win.navigate(target).catch(() => {});
          }
          return win.focus();
        }
      }
      return self.clients.openWindow(target);
    })
  );
});
