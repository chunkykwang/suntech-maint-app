/* Suntech Maintenance App v1 — app shell (ยังไม่มีฟังก์ชันงานจริง ใช้ทดสอบการติดตั้งและ offline) */
(function () {
  'use strict';
  var $ = function (id) { return document.getElementById(id); };

  /* ---------- สถานะเน็ต ---------- */
  function paintNet() {
    var on = navigator.onLine;
    $('net').textContent = on ? 'ออนไลน์' : 'ออฟไลน์';
    $('net').classList.toggle('off', !on);
  }
  window.addEventListener('online', paintNet);
  window.addEventListener('offline', paintNet);
  paintNet();

  /* ---------- ทดสอบเก็บข้อมูลในเครื่อง ---------- */
  function getN() { try { return Number(localStorage.getItem('tapN') || 0); } catch (_) { return 0; } }
  function setN(n) { try { localStorage.setItem('tapN', String(n)); } catch (_) {} $('tapN').textContent = n; }
  setN(getN());
  $('btnTap').onclick = function () { setN(getN() + 1); };
  $('btnReset').onclick = function () { setN(0); };
  if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(function () {});

  /* ---------- ติดตั้งเป็นแอป ---------- */
  var standalone = window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
  var isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent);
  var box = $('install'), deferred = null;
  if (standalone) {
    $('ok1').textContent = '✓';
  } else if (isIOS) {
    box.hidden = false;
    box.innerHTML = 'iPhone: กดปุ่ม <b>แชร์</b> (สี่เหลี่ยมมีลูกศรขึ้น) ใน Safari → <b>เพิ่มไปยังหน้าจอโฮม</b> แล้วเปิดแอปจากไอคอนที่หน้าจอ';
  } else {
    box.hidden = false;
    box.innerHTML = 'Android: เปิดเมนู ⋮ ของ Chrome → <b>ติดตั้งแอป</b> หรือ <b>เพิ่มลงในหน้าจอหลัก</b>';
  }
  window.addEventListener('beforeinstallprompt', function (e) {
    e.preventDefault(); deferred = e;
    box.hidden = false;
    box.innerHTML = '<button type="button" id="btnInstall">ติดตั้งแอปลงเครื่อง</button>';
    $('btnInstall').onclick = function () { deferred.prompt(); deferred = null; };
  });
  window.addEventListener('appinstalled', function () { $('ok1').textContent = '✓'; box.hidden = true; });

  /* ---------- service worker + อัปเดต ---------- */
  if (!('serviceWorker' in navigator)) { $('ver').textContent = 'เบราว์เซอร์นี้ไม่รองรับโหมด offline'; return; }
  navigator.serviceWorker.register('sw.js').then(function (reg) {
    function ask() { if (reg.active) reg.active.postMessage('version'); }
    if (reg.waiting) showUpdate(reg.waiting);
    reg.addEventListener('updatefound', function () {
      var w = reg.installing;
      w.addEventListener('statechange', function () {
        if (w.state === 'installed' && navigator.serviceWorker.controller) showUpdate(w);
      });
    });
    navigator.serviceWorker.ready.then(function () { $('ok2').textContent = '✓'; ask(); });
    setInterval(function () { if (navigator.onLine) reg.update().catch(function () {}); }, 30 * 60 * 1000);
  });
  navigator.serviceWorker.addEventListener('message', function (e) {
    if (e.data && e.data.version) $('ver').textContent = 'version ' + e.data.version;
  });
  var reloading = false;
  navigator.serviceWorker.addEventListener('controllerchange', function () {
    if (reloading) return; reloading = true; location.reload();
  });
  function showUpdate(worker) {
    $('update').hidden = false;
    $('btnUpdate').onclick = function () { worker.postMessage('skipWaiting'); };
  }
})();
