// Push-only service worker. It has no fetch handler, so the app is never served
// from a stale cache. A push only names the slot; the text comes from the status
// the app writes into Cache Storage (keep the names in sync with src/App.jsx).
const STATUS_CACHE = "soccer-status";
const STATUS_URL = "/__reminder-status";

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

function localDateKey(d) {
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

async function readStatus() {
  try {
    const cache = await caches.open(STATUS_CACHE);
    const res = await cache.match(STATUS_URL);
    return res ? await res.json() : null;
  } catch {
    return null;
  }
}

// Midday skips the eating rating: the day is not over yet.
function reminderText(slot, status, today) {
  if (slot === "weekly") return { title: "Dein Wochenreport ist da", body: "Was lief, was fehlt und der Fokus für die neue Woche.", url: "/?report=latest" };
  const title = slot === "evening" ? "Tagesabschluss" : slot === "midday" ? "Zwischenstand" : "Test: Erinnerung aktiv";
  const day = status && status.days && status.days[today];
  if (!day || !Array.isArray(day.open)) return { title, body: "Trag Training, Protein und Ernährung ein." };
  // Social match day: the three rules at noon, a reminder of them in the evening.
  const match = day.social && !day.social.friendly && Array.isArray(day.social.rules) ? day.social : null;
  if (match && slot === "midday") return { title: `Matchtag · Anpfiff ${match.kickoff}`, body: match.rules.join(" · ") + (day.evaluate ? " · Gestern noch auswerten." : "") };
  if (match && slot === "evening") return { title: "Social Match läuft", body: `${match.rules.join(" · ")}. Zu Hause auswerten.` };
  if (day.evaluate && slot === "midday") {
    const rest = day.open.filter((item) => item !== "Ernährung bewerten");
    return { title, body: "Social Match auswerten." + (rest.length ? " Noch offen: " + rest.join(" · ") : "") };
  }
  const open = slot === "midday" ? day.open.filter((item) => item !== "Ernährung bewerten") : day.open;
  if (open.length) return { title, body: "Noch offen: " + open.join(" · ") };
  if (day.open.length) return { title, body: "Gut unterwegs. Am Abend noch die Ernährung bewerten." };
  return { title, body: "Alles eingetragen. Stark." };
}

self.addEventListener("push", (event) => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch { data = {}; }
  event.waitUntil(readStatus().then((status) => {
    const text = reminderText(data.slot, status, localDateKey(new Date()));
    return self.registration.showNotification(text.title, {
      body: text.body, icon: "/icon-192.png?v=2", tag: data.slot === "weekly" ? "soccer-weekly" : "soccer-reminder", data: { url: text.url || "/" },
    });
  }));
});

// An open app is focused (and told to show the report); otherwise the app opens at the URL.
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = event.notification.data?.url || "/";
  event.waitUntil(self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((windows) => {
    for (const win of windows) {
      if (!("focus" in win)) continue;
      if (url.includes("report=")) win.postMessage({ type: "open-report" });
      return win.focus();
    }
    return self.clients.openWindow(url);
  }));
});
