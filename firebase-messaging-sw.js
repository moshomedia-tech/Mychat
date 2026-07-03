/* ════════════════════════════════════════════════════════════════
   MyChat — Firebase Messaging Service Worker
   ════════════════════════════════════════════════════════════════
   SETUP (one-time):
   1. Deploy THIS FILE to the root of your web server alongside index.html
      e.g. https://yoursite.com/firebase-messaging-sw.js
   2. In Firebase Console → Project Settings → Cloud Messaging → Web push certificates
      Generate a key pair and copy the VAPID public key.
      (No code change needed — the SW uses Firestore directly, no VAPID required.)
   3. iOS users must add the app to their Home Screen for push to work:
      Safari → Share ⬆ → "Add to Home Screen"  (iOS 16.4+)
   ═══════════════════════════════════════════════════════════════ */

importScripts("https://www.gstatic.com/firebasejs/10.12.2/firebase-app-compat.js");
importScripts("https://www.gstatic.com/firebasejs/10.12.2/firebase-messaging-compat.js");
importScripts("https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore-compat.js");

/* ── Same Firebase config as index.html ── */
const _swConfig = {
  apiKey:            "AIzaSyAfhYugodvq175puhrKbw0PQGphSgXCTmc",
  authDomain:        "mychat-da583.firebaseapp.com",
  projectId:         "mychat-da583",
  storageBucket:     "mychat-da583.appspot.com",
  messagingSenderId: "586531573897",
  appId:             "1:586531573897:web:f484b12d253c332452f658"
};

firebase.initializeApp(_swConfig);
const _swMessaging = firebase.messaging();
const _swDb        = firebase.firestore();

/* ── Optional: handle server-sent FCM pushes (if you add Cloud Functions later) ── */
_swMessaging.onBackgroundMessage(payload => {
  const n = payload.notification || {};
  return self.registration.showNotification(n.title || "Incoming call", {
    body:     n.body  || "Tap to answer",
    icon:     "https://cdn-icons-png.flaticon.com/512/2462/2462719.png",
    badge:    "https://cdn-icons-png.flaticon.com/512/2462/2462719.png",
    tag:      payload.data?.callId ? "call-" + payload.data.callId : "mychat-call",
    renotify: true,
    vibrate:  [400, 150, 400, 150, 400],
    data:     payload.data || {}
  });
});

/* ════════════════════════════════════════
   FIRESTORE CALL LISTENER
   Works when the app is backgrounded (iOS PWA + Android PWA).
   The main app sends SW_SET_USER when the user logs in.
════════════════════════════════════════ */
let _swUsername  = null;
let _swUnsub     = null;
let _seenCalls   = new Set();

function _startCallWatch() {
  if (_swUnsub) { try { _swUnsub(); } catch(_) {} _swUnsub = null; }
  if (!_swUsername) return;

  try {
    const ref = _swDb.collection("calls")
      .where("callee",  "==", _swUsername)
      .where("status",  "==", "ringing");

    _swUnsub = ref.onSnapshot(snap => {
      snap.docChanges().forEach(change => {
        if (change.type !== "added") return;
        const id   = change.doc.id;
        if (_seenCalls.has(id)) return;
        _seenCalls.add(id);

        const d      = change.doc.data();
        const caller = d.caller || "Someone";
        const type   = d.type   || "voice";
        const emoji  = type === "video" ? "📹" : "📞";

        self.registration.showNotification(`${emoji} Incoming ${type} call`, {
          body:     `${caller} is calling — tap to answer`,
          icon:     "https://cdn-icons-png.flaticon.com/512/2462/2462719.png",
          badge:    "https://cdn-icons-png.flaticon.com/512/2462/2462719.png",
          tag:      "call-" + id,
          renotify: true,
          silent:   false,
          vibrate:  [300, 100, 300, 100, 300, 100, 300],
          data:     { callId: id, caller, type }
        });

        /* Auto-close notification when call stops ringing */
        const unsubDoc = _swDb.collection("calls").doc(id).onSnapshot(ds => {
          const status = (ds.exists ? ds.data() : {}).status;
          if (status && status !== "ringing") {
            self.registration.getNotifications({ tag: "call-" + id })
              .then(ns => ns.forEach(n => n.close()))
              .catch(() => {});
            _seenCalls.delete(id);
            try { unsubDoc(); } catch(_) {}
          }
        });
      });
    }, () => {});
  } catch(e) {}
}

/* ── Messages from the main app tab ── */
self.addEventListener("message", ev => {
  if (!ev.data) return;
  if (ev.data.type === "SW_SET_USER") {
    _swUsername = ev.data.username || null;
    _seenCalls.clear();
    _startCallWatch();
  } else if (ev.data.type === "SW_CLEAR_USER") {
    _swUsername = null;
    _seenCalls.clear();
    if (_swUnsub) { try { _swUnsub(); } catch(_) {} _swUnsub = null; }
  }
});

/* ── Notification tap: open / focus the app ── */
self.addEventListener("notificationclick", ev => {
  ev.notification.close();
  ev.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then(list => {
      for (const c of list) {
        if ("focus" in c) return c.focus();
      }
      return self.clients.openWindow(self.registration.scope);
    })
  );
});
