// Service worker dell'app campo = il worker di Angular (cache della shell) + le notifiche push.
//
// Il push arriva SENZA payload (nessun dato dell'azienda sul servizio push del browser): qui si
// mostra un testo generico, poi l'utente apre l'app, che rilegge il giro online. Il worker di
// Angular ignora i push senza dati, quindi i due non si pestano i piedi.
importScripts('./ngsw-worker.js');

self.addEventListener('push', (event) => {
  event.waitUntil(
    self.registration.showNotification('WasteFlow campo', {
      body: 'Il tuo giro è cambiato. Apri l’app per vedere le novità.',
      icon: '/campo/icone/192.png',
      badge: '/campo/icone/192.png',
      // Lo stesso tag: un nuovo avviso sostituisce quello non ancora letto.
      tag: 'giro',
      data: { url: '/campo/' },
    }),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const destinazione = new URL('/campo/', self.location.origin).href;
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((finestre) => {
      const aperta = finestre.find((f) => f.url.startsWith(destinazione));
      return aperta ? aperta.focus() : self.clients.openWindow(destinazione);
    }),
  );
});
