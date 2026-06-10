const CACHE = 'inner-shelter-v8';
const ASSETS = ['./index.html', './styles.css', './app.js', './config.js', './manifest.json', './icon.svg'];
const BREATH_AUDIO = [
  './audio/breath/prep_0.mp3', './audio/breath/prep_1.mp3',
  './audio/breath/in_0.mp3', './audio/breath/in_1.mp3',
  './audio/breath/hold_0.mp3', './audio/breath/hold_1.mp3',
  './audio/breath/out_0.mp3', './audio/breath/out_1.mp3',
  './audio/breath/done_0.mp3', './audio/breath/done_1.mp3',
  './audio/breath/sos_0.mp3', './audio/breath/sos_1.mp3', './audio/breath/sos_2.mp3'
];

function fetchTimeout(req, ms) {
  return Promise.race([
    fetch(req),
    new Promise(function (_, reject) {
      setTimeout(function () { reject(new Error('timeout')); }, ms);
    })
  ]);
}

self.addEventListener('install', function (e) {
  e.waitUntil(
    caches.open(CACHE).then(function (c) {
      return Promise.allSettled(ASSETS.concat(BREATH_AUDIO).map(function (a) { return c.add(a); }));
    })
  );
  self.skipWaiting();
});

self.addEventListener('activate', function (e) {
  e.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.filter(function (k) { return k !== CACHE; }).map(function (k) { return caches.delete(k); }));
    })
  );
  self.clients.claim();
});

self.addEventListener('fetch', function (e) {
  if (e.request.method !== 'GET') return;
  var url = new URL(e.request.url);
  if (url.pathname.indexOf('/api/') === 0) return;
  if (url.origin !== self.location.origin) return;

  e.respondWith(
    fetchTimeout(e.request, 8000).catch(function () {
      return caches.match(e.request);
    }).then(function (res) {
      if (res && res.ok) {
        var clone = res.clone();
        caches.open(CACHE).then(function (c) { c.put(e.request, clone); });
      }
      return res || caches.match('./index.html');
    })
  );
});
