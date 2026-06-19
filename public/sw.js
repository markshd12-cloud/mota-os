/* Service Worker — Web Push de lembretes do Jarvis.
   Recebe o push do servidor e mostra a notificação do sistema, mesmo com a aba
   do Jarvis fechada (desde que o navegador esteja rodando em segundo plano). */

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

self.addEventListener("push", (event) => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch (_) { data = {}; }

  const title = data.title || "⏰ Lembrete";
  const options = {
    body: data.body || "",
    tag: data.tag || "reminder",
    renotify: true,
    requireInteraction: true, // mantém o aviso na tela até o usuário interagir
    vibrate: [200, 100, 200, 100, 200],
    data: { url: data.url || "/notifications" },
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || "/notifications";
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((list) => {
      for (const c of list) {
        if ("focus" in c) { c.navigate(url); return c.focus(); }
      }
      if (self.clients.openWindow) return self.clients.openWindow(url);
    })
  );
});
