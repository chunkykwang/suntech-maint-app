/*
 * Service worker — เก็บตัวแอปไว้ในเครื่อง เพื่อให้เปิดได้แม้ไม่มีเน็ต
 * เปลี่ยน VERSION ทุกครั้งที่แก้ไฟล์ในรายการ SHELL เพื่อให้เครื่องผู้ใช้ได้เวอร์ชันใหม่
 * (ข้อมูลจาก Google Sheets จะไม่ถูก cache ที่นี่ — จะเก็บใน IndexedDB ของแอปแทน)
 */
const VERSION = 'v1.0.0-stock.2';
const CACHE = 'suntech-maint-' + VERSION;
const SHELL = [
  './',
  './index.html',
  './app.css',
  './app.js',
  './manifest.webmanifest',
  './photo-test.html',
  './stock.html',
  './stock.css',
  './stock.js',
  './config.js',
  './store.js',
  './api.js',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/maskable-512.png',
  './icons/apple-touch-icon.png'
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('suntech-maint-') && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// หน้าแอปส่งข้อความมาเมื่อผู้ใช้กด "อัปเดต"
self.addEventListener('message', (e) => {
  if (e.data === 'skipWaiting') self.skipWaiting();
  if (e.data === 'version' && e.source) e.source.postMessage({ version: VERSION });
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;          // API / Google ไม่ผ่าน cache นี้
  if (url.pathname.indexOf('/test-img/') >= 0) return;      // รูปทดสอบ: ให้หน้า photo-test เก็บเองใน IndexedDB

  // หน้า HTML: ลองเน็ตก่อน (ได้ของใหม่) ถ้าไม่มีเน็ตใช้ของในเครื่อง
  if (req.mode === 'navigate') {
    e.respondWith(
      fetch(req).then((res) => {
        if (res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(req, copy)); }
        return res;
      }).catch(() => caches.match(req, { ignoreSearch: true })
        .then((hit) => hit || caches.match(url.pathname.endsWith('/') ? './' : './index.html')))
    );
    return;
  }

  // ไฟล์อื่น (css/js/รูป): ใช้ของในเครื่องก่อน เร็วและใช้ได้ตอน offline
  e.respondWith(
    caches.match(req).then((hit) => hit || fetch(req).then((res) => {
      if (res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(req, copy)); }
      return res;
    }))
  );
});
