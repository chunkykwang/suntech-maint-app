/* Suntech Maintenance App v1 — หน้าแรก: เข้าสู่ระบบ (เลือกชื่อ, admin ใส่รหัส) แล้วไปเมนู */
(function () {
  'use strict';
  var $ = function (id) { return document.getElementById(id); };
  var ADMIN = Session.ADMIN, USERS = [];

  /* ---------- สถานะเน็ต ---------- */
  function paintNet() {
    var on = navigator.onLine;
    $('net').textContent = on ? 'ออนไลน์' : 'ออฟไลน์';
    $('net').classList.toggle('off', !on);
  }
  window.addEventListener('online', function () { paintNet(); loadUsers(); });
  window.addEventListener('offline', paintNet);
  paintNet();
  if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(function () {});

  /* ---------- PIN ของเครื่อง ---------- */
  function askPin(msg) {
    return new Promise(function (resolve) {
      $('pinWrap').hidden = false; $('pinErr').textContent = msg || ''; $('pinIn').value = ''; $('pinIn').focus();
      $('pinForm').onsubmit = function (e) {
        e.preventDefault(); var p = $('pinIn').value.trim(); if (!p) return;
        Api.setPin(p); $('pinOk').disabled = true;
        Api.call('ping').then(function () { $('pinWrap').hidden = true; $('pinOk').disabled = false; resolve(); },
          function (er) { $('pinOk').disabled = false; if (er.code === 'PIN') { Api.clearPin(); $('pinErr').textContent = er.message; } else { $('pinWrap').hidden = true; resolve(); } });
      };
    });
  }
  function call(a, p, t) {
    return Api.call(a, p, t).catch(function (er) {
      if (er.code === 'PIN') { Api.clearPin(); return askPin(er.message).then(function () { return Api.call(a, p, t); }); }
      throw er;
    });
  }

  /* ---------- รายชื่อผู้ใช้ (จากข้อมูลแจ้งซ่อม เก็บในเครื่องไว้ใช้ตอน offline) ---------- */
  function fillUsers() {
    var sel = $('user'), cur = sel.value;
    sel.innerHTML = '<option value="">— เลือกชื่อ —</option>' +
      USERS.map(function (t) { return '<option>' + String(t).replace(/[&<>"]/g, '') + '</option>'; }).join('') +
      '<option value="' + ADMIN + '">admin (หัวหน้างาน)</option>';
    if (cur) sel.value = cur;
    $('lnote').textContent = USERS.length ? 'ช่างเลือกชื่อแล้วเข้าได้เลย · admin ต้องใส่รหัสและต้องมีเน็ตตอนเข้า'
      : 'ยังไม่มีรายชื่อช่างในเครื่อง — เปิดหน้านี้ตอนมีเน็ตอย่างน้อย 1 ครั้ง';
  }
  function loadUsers() {
    Store.get('repair.init').then(function (d) {
      if (d && d.techs && !USERS.length) { USERS = d.techs; fillUsers(); }
    }).catch(function () {});
    if (!navigator.onLine || !Api.ready()) return;
    var go = function () {
      $('lnote').textContent = 'กำลังโหลดรายชื่อช่าง…';
      call('repair.init', {}, 30000).then(function (d) {
        Store.set('repair.init', d).catch(function () {});
        USERS = (d && d.techs) || []; fillUsers();
      }, function (er) {
        // แสดงสาเหตุ + แตะเพื่อลองใหม่ (เดิมเงียบ ทำให้ดูเหมือนไม่มีรายชื่อ)
        if (!USERS.length) {
          $('lnote').innerHTML = '';
          var t = document.createElement('span');
          t.textContent = 'โหลดรายชื่อช่างไม่ได้: ' + (er && er.message || er) + ' ';
          var b = document.createElement('button'); b.type = 'button'; b.className = 'ghost'; b.textContent = 'ลองใหม่';
          b.onclick = loadUsers;
          $('lnote').appendChild(t); $('lnote').appendChild(b);
        }
      });
    };
    if (!Api.pin()) askPin().then(go); else go();
  }

  /* ---------- เข้าสู่ระบบ ---------- */
  function show() {
    var u = Session.user(), inn = !!u && (u !== ADMIN || Session.isAdmin());
    $('v-login').hidden = inn; $('v-menu').hidden = !inn;
    $('whoBar').hidden = !inn; $('whoName').textContent = u === ADMIN ? 'admin (หัวหน้างาน)' : u;
    $('sub').textContent = inn ? 'เลือกงานที่ต้องการ' : 'เข้าสู่ระบบก่อนใช้งาน';
  }
  $('user').addEventListener('change', function () {
    $('apwF').hidden = $('user').value !== ADMIN; $('lerr').textContent = ''; $('apw').value = '';
  });
  $('v-login').addEventListener('submit', function (e) {
    e.preventDefault();
    var u = $('user').value;
    if (!u) { $('lerr').textContent = 'กรุณาเลือกชื่อ'; $('user').focus(); return; }
    if (u !== ADMIN) { Session.set(u); show(); return; }
    var pw = $('apw').value.trim();
    if (!pw) { $('lerr').textContent = 'กรุณาใส่รหัส admin'; $('apw').focus(); return; }
    if (!navigator.onLine) { $('lerr').textContent = 'ต้องมีเน็ตเพื่อตรวจรหัส admin'; return; }
    $('bLogin').disabled = true; $('lerr').textContent = '';
    call('repair.admin', { adminPw: pw }, 20000).then(function () {
      $('bLogin').disabled = false; $('apw').value = ''; Session.set(ADMIN, pw); show();
    }, function (er) { $('bLogin').disabled = false; $('lerr').textContent = er.message || 'ตรวจรหัสไม่ได้'; });
  });
  $('bLogout').onclick = function () {
    Session.clear(); $('user').value = ''; $('apwF').hidden = true; show();
  };
  show(); fillUsers(); loadUsers();

  /* ---------- ติดตั้งเป็นแอป ---------- */
  var standalone = window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
  var isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent);
  var box = $('install'), deferred = null;
  if (!standalone) {
    box.hidden = false;
    box.innerHTML = isIOS ? 'ติดตั้งลง iPhone: กด <b>แชร์</b> ใน Safari → <b>เพิ่มไปยังหน้าจอโฮม</b>'
      : 'ติดตั้งลงเครื่อง: เมนู ⋮ ของ Chrome → <b>ติดตั้งแอป</b> หรือ <b>เพิ่มลงในหน้าจอหลัก</b>';
  }
  window.addEventListener('beforeinstallprompt', function (e) {
    e.preventDefault(); deferred = e;
    box.hidden = false;
    box.innerHTML = '<button type="button" id="btnInstall">ติดตั้งแอปลงเครื่อง</button>';
    $('btnInstall').onclick = function () { deferred.prompt(); deferred = null; };
  });
  window.addEventListener('appinstalled', function () { box.hidden = true; });

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
    navigator.serviceWorker.ready.then(ask);
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
