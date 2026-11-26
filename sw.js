/*
 * Service worker — เก็บตัวแอปไว้ในเครื่อง เพื่อให้เปิดได้แม้ไม่มีเน็ต
 * เปลี่ยน VERSION ทุกครั้งที่แก้ไฟล์ในรายการ SHELL และเปลี่ยน ?v= ในหน้า HTML ให้ตรงกัน
 * มีเน็ต = โหลดไฟล์ใหม่จากเซิร์ฟเวอร์ (รอไม่เกิน 4 วินาที) / ไม่มีเน็ตหรือช้า = ใช้ของในเครื่อง
 * ทำให้ไฟล์ HTML กับ JS เป็นเวอร์ชันเดียวกันเสมอ (เคยค้างเพราะหน้าใหม่ไปเจอ JS เก่าในเครื่อง)
 * (ข้อมูลจาก Google Sheets จะไม่ถูก cache ที่นี่ — จะเก็บใน IndexedDB ของแอปแทน)
 */
const VERSION = 'v1.0.0-manual.19';
const CACHE = 'suntech-maint-' + VERSION;
const SHELL = [
  './',
  './index.html',
  './app.css',
  './app.js',
  './manifest.webmanifest',
  './pm.html',
  './pm-shim.js',
  './pump.html',
  './repair.html',
  './repair.css',
  './repair.js',
  './parts.html',
  './parts.css',
  './parts.js',
  './stock.html',
  './stock.css',
  './stock.js',
  './other.html',
  './overhaul.html',
  './overhaul.css',
  './overhaul.js',
  './manual.html',
  './manual.css',
  './manual.js',
  './config.js',
  './store.js',
  './api.js',
  './session.js',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/maskable-512.png',
  './icons/apple-touch-icon.png'
];

self.addEventListener('install', (e) => {
  // cache: 'reload' = ดึงจากเซิร์ฟเวอร์จริง ไม่เอาของเก่าใน cache ของเบราว์เซอร์
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL.map((u) => new Request(u, { cache: 'reload' })))).then(() => self.skipWaiting()));
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

  // ไฟล์อื่น (css/js/รูป): ลองเน็ตก่อน (ไม่เกิน 4 วินาที) ถ้าไม่ได้ใช้ของในเครื่อง
  e.respondWith(
    netFirst(req).catch(() => caches.match(req, { ignoreSearch: true })
      .then((hit) => hit || Response.error()))
  );
});

function netFirst(req) {
  if (!navigator.onLine) return Promise.reject(new Error('offline'));
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('slow')), 4000);
    fetch(req).then((res) => {
      clearTimeout(t);
      if (!res.ok) return reject(new Error('http ' + res.status));
      const copy = res.clone(), url = new URL(req.url);
      caches.open(CACHE).then((c) => c.put(url.origin + url.pathname, copy));   // เก็บแบบไม่มี ?v= ให้ใช้ตอน offline ได้
      resolve(res);
    }, (err) => { clearTimeout(t); reject(err); });
  });
}
