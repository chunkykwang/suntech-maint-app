/* Other › Report : Overhaul Vacuum pump KRF15A — v1 offline
 * แท็บ "หน้าแนะนำ" (ข้อความจากเซิร์ฟเวอร์ เก็บในเครื่อง 'overhaul.init') / แท็บ "ลง report"
 * ร่างที่กรอกค้างเก็บในเครื่องอัตโนมัติ ('overhaul.draft') — ถอดวันนี้ ทดสอบพรุ่งนี้ก็กรอกต่อได้
 * กดส่ง -> เข้าคิว ('overhaul.outbox') แล้วส่งเมื่อมีเน็ต (submitId กันส่งซ้ำ)
 */
(function () {
  'use strict';
  var $ = function (id) { return document.getElementById(id); };
  var esc = function (s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); };
  if (!Session.require()) return;

  /* รายการในฟอร์ม — kind: bac = รูปก่อน + รูปหลัง + comment, ptc = รูป + ความหนา + comment, p = รูป */
  var SECTIONS = [
    { t: 'สภาพของ pump (ตอนถอด)', note: 'ถ่ายรูป "ก่อน" ตั้งแต่ก่อนล้าง เพราะสภาพตอนนั้นใช้หา root cause', items: [
      { k: 'vane', label: 'Vane', kind: 'bac', hint: 'แหว่ง / แตก / สึกไม่เท่ากัน · ใส่ขนาดที่วัดได้ใน comment' },
      { k: 'brg', label: 'Bearing', kind: 'bac', hint: 'ฝืด / มีเสียง / มีผง vane / สนิม' },
      { k: 'ch', label: 'ห้อง pump', kind: 'bac', hint: 'ใช้ scotch brite ขัดทำความสะอาด · ดูรอยขูด ร่อง คราบคาร์บอน สนิม ความชื้น' }] },
    { t: 'Liner', note: 'ใส่ความหนารวมที่ใช้จริง (mm) และจำนวนแผ่น/ฝั่งใน comment', items: [
      { k: 'l20', label: 'Liner 0.2', kind: 'ptc' }, { k: 'l10', label: 'Liner 0.1', kind: 'ptc' },
      { k: 'l05', label: 'Liner 0.05', kind: 'ptc' }, { k: 'l03', label: 'Liner 0.03', kind: 'ptc' }] },
    { t: 'ใบพัด / เพลา / ไส้กรอง', items: [
      { k: 'imp', label: 'สภาพใบพัด', kind: 'p' },
      { k: 'sh', label: 'เพลา (ทำความสะอาด)', kind: 'bac' },
      { k: 'flt', label: 'ไส้กรองอากาศ (ทำความสะอาด)', kind: 'bac', hint: 'ปริมาณผงสีดำ / ตัน / เปียกหรือมีคราบเคมี' }] },
    { t: 'ภาพตอนประกอบ', items: [
      { k: 'as_vane', label: 'Vane ใส่เข้าใน cylinder ห้อง pump', kind: 'p1' },
      { k: 'as_brg', label: 'Bearing', kind: 'p1' },
      { k: 'as_done', label: 'รูปประกอบเสร็จ', kind: 'p1' }] }
  ];
  // รายชื่อช่องรูปทั้งหมด (ใช้นับความครบ)
  var PHOTO_KEYS = ['plate'];
  SECTIONS.forEach(function (s) { s.items.forEach(function (it) {
    if (it.kind === 'bac') PHOTO_KEYS.push(it.k + '_b', it.k + '_a');
    else if (it.kind === 'ptc' || it.kind === 'p') PHOTO_KEYS.push(it.k + '_p');
    else PHOTO_KEYS.push(it.k);
  }); });
  var PHOTO_LABEL = {};

  var INIT = null, D = null, OUTBOX = [], HIST = { rows: [], at: '' }, syncing = false, CUR_SLOT = '', SUB = 'menu', DET = null, histLoading = false;

  /* ---------- เน็ต / PIN ---------- */
  function paint() {
    var on = navigator.onLine;
    $('net').textContent = on ? 'ออนไลน์' : 'ออฟไลน์'; $('net').classList.toggle('off', !on);
    $('pending').hidden = !OUTBOX.length; $('pending').textContent = 'รอส่ง ' + OUTBOX.length;
    $('bSync').hidden = !OUTBOX.length || !on;
  }
  window.addEventListener('online', function () { paint(); sync(); refresh(); });
  window.addEventListener('offline', paint);
  $('bSync').onclick = function () { sync(true); };
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
  var tt;
  function toast(m) { var t = $('toast'); t.textContent = m; t.classList.add('on'); clearTimeout(tt); tt = setTimeout(function () { t.classList.remove('on'); }, 3500); }

  /* ---------- แท็บ ---------- */
  var TAB = 'guide';
  try { TAB = localStorage.getItem('oh_tab') || 'guide'; } catch (_) {}
  function tab(t) {
    TAB = t; try { localStorage.setItem('oh_tab', t); } catch (_) {}
    document.querySelectorAll('.tabs button').forEach(function (b) { b.setAttribute('aria-selected', String(b.dataset.tab === t)); });
    $('v-guide').hidden = t !== 'guide'; $('v-report').hidden = t !== 'report';
    if (t === 'report') sub(SUB === 'detail' && !DET ? 'menu' : SUB); else window.scrollTo(0, 0);
  }

  /* ---------- เมนูย่อยของ report: menu / form / hist / detail ---------- */
  function sub(v) {
    SUB = v;
    ['menu', 'form', 'hist', 'detail'].forEach(function (k) { $('r-' + k).hidden = k !== v; });
    if (v === 'menu') paintMenu();
    if (v === 'hist') { renderHist(); loadHist(); }
    if (v === 'detail') renderDetail();
    window.scrollTo(0, 0);
  }
  document.querySelectorAll('[data-sub]').forEach(function (b) { b.onclick = function () { sub(b.dataset.sub); }; });
  function paintMenu() {
    var got = D ? PHOTO_KEYS.filter(function (k) { return D.photos[k]; }).length : 0;
    $('mForm').textContent = D && (D.sn || got || Object.keys(D.vals).length) ? 'มีใบที่กรอกค้าง: ' + D.id + (D.sn ? ' · S/N ' + D.sn : '') : 'เริ่มใบใหม่ · กรอกค้างไว้ได้';
    var n = HIST.rows.length + OUTBOX.length;
    $('mHist').textContent = n ? n + ' ใบ' + (OUTBOX.length ? ' (รอส่ง ' + OUTBOX.length + ')' : '') : 'งานที่ส่งแล้ว · ดูรายละเอียด · Export PDF';
  }
  document.querySelectorAll('.tabs button').forEach(function (b) { b.onclick = function () { tab(b.dataset.tab); }; });

  /* ---------- หน้าแนะนำ ---------- */
  function renderGuide() {
    if (!INIT || !INIT.guide) {
      $('guide').innerHTML = '<div class="empty">' + (navigator.onLine ? 'กำลังโหลด…' : 'ยังไม่มีข้อมูลในเครื่อง — เปิดหน้านี้ตอนมีเน็ตอย่างน้อย 1 ครั้ง') + '</div>';
      return;
    }
    $('guide').innerHTML = INIT.guide.map(function (g) {
      var h = '<section class="card' + (g.warn ? ' gwarn' : '') + '"><h2>' + esc(g.h) + '</h2>';
      if (g.note) h += '<p class="gnote">' + esc(g.note) + '</p>';
      if (g.list) h += '<ul class="glist">' + g.list.map(function (x) { return '<li>' + esc(x) + '</li>'; }).join('') + '</ul>';
      if (g.table) h += '<div class="gtbl">' + g.table.slice(1).map(function (r) {
        return '<div class="gr"><b>' + esc(r[0]) + '</b><span>' + esc(r[1]) + '</span></div>';
      }).join('') + '</div>';
      return h + '</section>';
    }).join('') + '<p class="note">อัปเดตข้อมูลล่าสุด ' + esc(INIT.at || '') + '</p>';
  }

  /* ---------- ฟอร์ม ---------- */
  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function now() { var d = new Date(); return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) + ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes()); }
  function newDraft() {
    var d = new Date();
    return { id: 'OH-' + String(d.getFullYear()).slice(2) + pad(d.getMonth() + 1) + pad(d.getDate()) + '-' + pad(d.getHours()) + pad(d.getMinutes()) + pad(d.getSeconds()),
             submitId: 'oh' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8),
             tech: Session.user() === Session.ADMIN ? '' : Session.user(), date: now().slice(0, 10), sn: '', vals: {}, photos: {} };
  }
  var saveT;
  function flush() { if (saveT) { clearTimeout(saveT); saveT = 0; Store.set('overhaul.draft', D).catch(function () {}); } }
  function save() { clearTimeout(saveT); saveT = setTimeout(flush, 300); paintProgress(); }
  window.addEventListener('pagehide', flush);
  document.addEventListener('visibilitychange', function () { if (document.hidden) flush(); });

  function slot(key, label) {
    PHOTO_LABEL[key] = label;
    return '<div class="slot" data-slot="' + key + '"><div class="sl">' + esc(label) + '</div><div class="sp" id="sp_' + key + '"></div></div>';
  }
  function txt(key, label, ph) { return '<div class="f"><label for="v_' + key + '">' + esc(label) + '</label><textarea id="v_' + key + '" data-v="' + key + '" rows="2" placeholder="' + esc(ph || '') + '"></textarea></div>'; }
  function num(key, label, unit, ph) {
    return '<div class="f"><label for="v_' + key + '">' + esc(label) + '</label><div class="unit"><input id="v_' + key + '" data-v="' + key + '" inputmode="decimal" placeholder="' + esc(ph || '') + '" autocomplete="off"><span>' + esc(unit) + '</span></div></div>';
  }

  function buildForm() {
    var h = '';
    SECTIONS.forEach(function (s, si) {
      h += '<section class="card"><h2><span class="n">' + (si + 2) + '</span>' + esc(s.t) + '</h2>';
      if (s.note) h += '<p class="gnote">' + esc(s.note) + '</p>';
      s.items.forEach(function (it) {
        if (it.kind === 'p1') { h += '<div class="item1">' + slot(it.k, it.label) + '</div>'; return; }
        h += '<div class="part"><h3>' + esc(it.label) + '</h3>' + (it.hint ? '<p class="hint">' + esc(it.hint) + '</p>' : '');
        if (it.kind === 'bac') h += '<div class="slots">' + slot(it.k + '_b', 'ก่อน') + slot(it.k + '_a', 'หลัง') + '</div>' + txt(it.k + '_c', 'Comment');
        if (it.kind === 'ptc') h += '<div class="slots">' + slot(it.k + '_p', 'รูปสภาพ') + '</div>' + num(it.k + '_t', 'ความหนา', 'mm', 'เช่น 0.2') + txt(it.k + '_c', 'Comment');
        if (it.kind === 'p') h += '<div class="slots">' + slot(it.k + '_p', 'รูปสภาพ') + '</div>';
        h += '</div>';
      });
      h += '</section>';
    });
    // ผู้ทดสอบ
    var n = SECTIONS.length + 2;
    h += '<section class="card"><h2><span class="n">' + n + '</span>ทดสอบหลัง overhaul (Blank-off)</h2>' +
      '<p class="gnote">ผ่าน ≥ 75 kPa (เป้าหมาย ≥ 80, สเปก 84) · กระแส ≤ 2.29 A ต่อเฟส · วัดอุณหภูมิหลังเดินเครื่อง 30–60 นาที</p>' +
      '<div class="row">' + num('kpa', 'แรงดูด (Blank-off vacuum)', 'kPa', '≥ 75') + num('temp', 'อุณหภูมิตัว pump', '°C') + '</div>' +
      '<div class="row3">' + num('a1', 'กระแส L1', 'A') + num('a2', 'กระแส L2', 'A') + num('a3', 'กระแส L3', 'A') + '</div>' +
      '<div class="f"><span class="lb">เสียง</span><div class="seg2" role="radiogroup" aria-label="เสียง">' +
      '<button type="button" role="radio" data-noise="ปกติ">ปกติ</button><button type="button" role="radio" data-noise="ไม่ปกติ">ไม่ปกติ</button></div></div>' +
      '<div id="verdict" class="verdict" aria-live="polite"></div>' + txt('note', 'หมายเหตุ', 'เช่น ตำแหน่งที่ถอดมา / อาการก่อนส่งซ่อม') + '</section>';
    $('sections').innerHTML = h;

    document.querySelectorAll('[data-slot]').forEach(function (el) { paintSlot(el.dataset.slot); });
    document.querySelectorAll('[data-v]').forEach(function (el) {
      el.addEventListener('input', function () { D.vals[el.dataset.v] = el.value; save(); if (/^(kpa|a\d|temp)$/.test(el.dataset.v)) verdict(); });
    });
    document.querySelectorAll('[data-noise]').forEach(function (b) {
      b.onclick = function () { D.vals.noise = D.vals.noise === b.dataset.noise ? '' : b.dataset.noise; paintNoise(); save(); verdict(); };
    });
  }
  function paintSlot(key) {
    var box = $('sp_' + key), d = D.photos[key];
    box.innerHTML = d
      ? '<img src="' + d + '" alt="' + esc(PHOTO_LABEL[key]) + '" data-zoom="' + key + '"><button type="button" class="rx" data-rx="' + key + '" aria-label="ลบรูป ' + esc(PHOTO_LABEL[key]) + '">&times;</button>'
      : '<div class="add"><button type="button" class="btn sm" data-cam="' + key + '">ถ่ายรูป</button><button type="button" class="btn sm ghost" data-gal="' + key + '">เลือกรูป</button></div>';
    var b;
    if ((b = box.querySelector('[data-cam]'))) b.onclick = function () { CUR_SLOT = key; $('fCam').click(); };
    if ((b = box.querySelector('[data-gal]'))) b.onclick = function () { CUR_SLOT = key; $('fGal').click(); };
    if ((b = box.querySelector('[data-rx]'))) b.onclick = function () { if (confirm('ลบรูป "' + PHOTO_LABEL[key] + '" ?')) { delete D.photos[key]; paintSlot(key); save(); } };
    if ((b = box.querySelector('[data-zoom]'))) b.onclick = function () { $('lbImg').src = d; $('lb').hidden = false; };
  }
  $('lb').onclick = function () { $('lb').hidden = true; $('lbImg').src = ''; };
  function paintNoise() {
    document.querySelectorAll('[data-noise]').forEach(function (b) { b.setAttribute('aria-checked', String(D.vals.noise === b.dataset.noise)); });
  }
  function fillValues() {
    $('tech').value = D.tech; $('date').value = D.date; $('sn').value = D.sn; $('rid').textContent = D.id;
    document.querySelectorAll('[data-v]').forEach(function (el) { el.value = D.vals[el.dataset.v] || ''; });
    PHOTO_KEYS.forEach(paintSlot); paintNoise(); verdict(); snInfo(); paintProgress();
  }

  function n(x) { var v = parseFloat(String(x || '').replace(',', '.')); return isNaN(v) ? null : v; }
  function verdict() {
    var v = D.vals, out = [], kpa = n(v.kpa);
    if (kpa != null) out.push(kpa >= 80 ? ['ok', 'Vacuum ' + kpa + ' kPa — ผ่าน (ถึงเป้าหมาย)'] : kpa >= 75 ? ['ok', 'Vacuum ' + kpa + ' kPa — ผ่าน (ต่ำกว่าเป้าหมาย 80)'] : ['bad', 'Vacuum ' + kpa + ' kPa — ไม่ผ่าน (ต้อง ≥ 75)']);
    var a = ['a1', 'a2', 'a3'].map(function (k) { return n(v[k]); }).filter(function (x) { return x != null; });
    if (a.length) {
      var mx = Math.max.apply(null, a), mn = Math.min.apply(null, a);
      if (mx > 2.29) out.push(['bad', 'กระแสสูงสุด ' + mx + ' A — เกิน 2.29 A']);
      else out.push(['ok', 'กระแสไม่เกิน 2.29 A']);
      if (a.length === 3 && mn > 0 && (mx - mn) / mn > 0.1) out.push(['warn', 'กระแส 3 เฟสต่างกัน ' + Math.round((mx - mn) / mn * 100) + '% (ควรไม่เกิน ~10%)']);
    }
    if (v.noise === 'ไม่ปกติ') out.push(['bad', 'เสียงไม่ปกติ']);
    $('verdict').innerHTML = out.map(function (o) { return '<div class="vd ' + o[0] + '">' + esc(o[1]) + '</div>'; }).join('');
  }
  function snInfo() {
    var s = (D.sn || '').trim().toUpperCase(), m = null;
    if (INIT && INIT.sns) INIT.sns.forEach(function (x) { if (x.sn.toUpperCase() === s) m = x; });
    $('snInfo').textContent = !s ? '' : m ? 'สถานะ: ' + (m.status || '-') + (m.loc ? ' · ' + m.loc : '') : (INIT && INIT.sns && INIT.sns.length ? 'ไม่พบ S/N นี้ในแท็บ pumps — ตรวจตัวสะกด (เช่น KI ↔ K1)' : '');
    $('snInfo').className = 'note' + (s && !m && INIT && INIT.sns && INIT.sns.length ? ' warnt' : '');
  }
  function paintProgress() {
    var got = PHOTO_KEYS.filter(function (k) { return D.photos[k]; }).length;
    $('prog').textContent = 'รูป ' + got + '/' + PHOTO_KEYS.length + (D.vals.kpa ? ' · มีผลทดสอบแล้ว' : ' · ยังไม่มีผลทดสอบ');
  }
  function fillLists() {
    var techs = (INIT && INIT.techs) || [], me = Session.user();
    if (me && me !== Session.ADMIN && techs.indexOf(me) < 0) techs = [me].concat(techs);
    if (D.tech && techs.indexOf(D.tech) < 0) techs = techs.concat([D.tech]);
    $('tech').innerHTML = '<option value="">— เลือกช่าง —</option>' + techs.map(function (t) { return '<option>' + esc(t) + '</option>'; }).join('');
    $('tech').value = D.tech;
    $('snList').innerHTML = ((INIT && INIT.sns) || []).map(function (x) { return '<option value="' + esc(x.sn) + '">' + esc(x.status || '') + '</option>'; }).join('');
  }

  $('tech').onchange = function () { D.tech = $('tech').value; save(); };
  $('date').oninput = function () { D.date = $('date').value; save(); };
  $('sn').oninput = function () { D.sn = $('sn').value.trim(); snInfo(); save(); };

  // รูป: ย่อเหลือไม่เกิน ~60 KB
  var PHOTO_MAX_KB = 60, PHOTO_MAX_PX = 1280;
  function kb(u) { return Math.round((u.length - u.indexOf(',') - 1) * 0.75 / 1024); }
  function compress(file) {
    return new Promise(function (ok, no) {
      var img = new Image(), u = URL.createObjectURL(file);
      img.onload = function () {
        URL.revokeObjectURL(u);
        var side = Math.min(PHOTO_MAX_PX, Math.max(img.width, img.height)), d = '';
        for (var r = 0; r < 6; r++) {
          var s = side / Math.max(img.width, img.height), c = document.createElement('canvas');
          c.width = Math.round(img.width * s); c.height = Math.round(img.height * s);
          c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
          for (var q = 0.72; q >= 0.4; q -= 0.08) { d = c.toDataURL('image/jpeg', q); if (kb(d) <= PHOTO_MAX_KB) return ok(d); }
          side = Math.round(side * 0.8);
        }
        ok(d);
      };
      img.onerror = function () { URL.revokeObjectURL(u); no(new Error('read')); };
      img.src = u;
    });
  }
  function onFile(e) {
    var f = e.target.files && e.target.files[0], key = CUR_SLOT; e.target.value = '';
    if (!f || !key) return;
    compress(f).then(function (d) { D.photos[key] = d; paintSlot(key); save(); }, function () { toast('อ่านรูปไม่ได้'); });
  }
  $('fCam').onchange = onFile; $('fGal').onchange = onFile;

  /* ---------- ส่ง ---------- */
  $('bSubmit').onclick = function () {
    D.tech = $('tech').value; D.date = $('date').value; D.sn = $('sn').value.trim();
    var miss = [];
    if (!D.tech) miss.push('ชื่อช่าง'); if (!D.date) miss.push('วันที่'); if (!D.sn) miss.push('S/N');
    if (miss.length) { toast('กรอกให้ครบ: ' + miss.join(', ')); $('sec1').scrollIntoView({ behavior: 'smooth' }); return; }
    var noPic = PHOTO_KEYS.filter(function (k) { return !D.photos[k]; }).length;
    var warn = [];
    if (noPic) warn.push('ยังไม่มีรูป ' + noPic + ' รายการ');
    if (!D.vals.kpa) warn.push('ยังไม่มีค่า Blank-off vacuum');
    if (warn.length && !confirm(warn.join('\n') + '\n\nส่ง report ทั้งอย่างนี้เลยไหม?')) return;
    var r = Object.assign({}, D, { sub: now(), vals: Object.assign({}, D.vals), photos: Object.assign({}, D.photos) });
    OUTBOX.push(r);
    Store.set('overhaul.outbox', OUTBOX).then(function () {
      D = newDraft(); return Store.set('overhaul.draft', D);
    }).then(function () {
      fillLists(); fillValues(); paint(); sub('hist');
      toast(navigator.onLine ? 'กำลังส่ง ' + r.id + '…' : 'เก็บ ' + r.id + ' ไว้ในเครื่อง จะส่งเมื่อมีเน็ต');
      sync(true);
    });
  };
  $('bClear').onclick = function () {
    if (!confirm('ล้างข้อมูลที่กรอกไว้ทั้งหมด แล้วเริ่มใบใหม่?')) return;
    D = newDraft(); Store.set('overhaul.draft', D); fillLists(); fillValues();
  };

  function sync(manual) {
    if (syncing || !OUTBOX.length || !navigator.onLine || !Api.ready()) return;
    var go = function () {
      syncing = true; paint();
      var r = OUTBOX[0];
      call('overhaul.submit', { payload: r }, 180000).then(function (res) {
        OUTBOX = OUTBOX.filter(function (x) { return x.submitId !== r.submitId; });
        return Store.set('overhaul.outbox', OUTBOX).then(function () {
          syncing = false; paint();
          if (DET && DET.local && DET.submitId === r.submitId) { DET = null; if (SUB === 'detail') sub('hist'); }
          loadHist(true);
          toast(res.duplicate ? r.id + ' ส่งไปแล้วก่อนหน้า' : 'ส่ง ' + r.id + ' แล้ว' + (res.result ? ' · ' + res.result : ''));
          if (OUTBOX.length) sync();
        });
      }, function (er) {
        syncing = false; paint();
        if (manual || er.code !== 'OFFLINE') toast('ยังส่งไม่ได้: ' + er.message);
      });
    };
    if (!Api.pin()) askPin().then(go); else go();
  }
  /* ---------- ประวัติ ---------- */
  function loadHist(force) {
    if (histLoading || !navigator.onLine || !Api.ready()) { if (SUB === 'hist') renderHist(); return; }
    histLoading = true; if (SUB === 'hist') renderHist();
    var go = function () {
      call('overhaul.list', {}, 60000).then(function (d) {
        histLoading = false; HIST = d || { rows: [], at: '' }; Store.set('overhaul.list', HIST).catch(function () {});
        if (SUB === 'hist') renderHist(); if (SUB === 'menu') paintMenu();
      }, function (er) { histLoading = false; if (SUB === 'hist') { renderHist(); toast('โหลดประวัติไม่ได้: ' + er.message); } });
    };
    if (!Api.pin()) askPin().then(go); else go();
  }
  function allRows() {
    var local = OUTBOX.map(function (r) { return { id: r.id, sn: r.sn, tech: r.tech, date: r.date, sub: r.sub, vals: r.vals, photos: r.photos, local: true, submitId: r.submitId }; });
    return local.concat(HIST.rows || []);
  }
  function resCls(t) { return /^Pass/.test(t || '') ? 'ok' : /^Fail/.test(t || '') ? 'bad' : ''; }
  function renderHist() {
    var q = ($('hq').value || '').trim().toUpperCase();
    var rows = allRows().filter(function (r) { return !q || (r.sn + ' ' + r.id + ' ' + r.tech).toUpperCase().indexOf(q) >= 0; });
    $('histInfo').textContent = histLoading ? 'กำลังโหลด…' : HIST.at ? 'ข้อมูล ณ ' + HIST.at + (navigator.onLine ? '' : ' (ออฟไลน์)') : (navigator.onLine ? '' : 'ยังไม่มีข้อมูลในเครื่อง — เปิดตอนมีเน็ต 1 ครั้ง');
    $('hist').innerHTML = rows.length ? rows.map(function (r, i) {
      var res = r.local ? 'รอส่ง' : (r.result || '-');
      return '<button type="button" class="item rowbtn' + (r.local ? ' wait' : '') + '" data-i="' + i + '"><div class="top"><b>S/N ' + esc(r.sn) + '</b>' +
        '<span class="st ' + (r.local ? '' : resCls(r.result)) + '">' + esc(res.replace(/ \(.*/, '')) + '</span></div>' +
        '<div class="meta">' + esc(r.id) + ' · ' + esc(r.date) + ' · ' + esc(r.tech) + (r.vals && r.vals.kpa ? ' · ' + esc(r.vals.kpa) + ' kPa' : '') + '</div></button>';
    }).join('') : '<div class="empty">' + (histLoading ? 'กำลังโหลด…' : 'ยังไม่มี report') + '</div>';
    $('hist').querySelectorAll('[data-i]').forEach(function (b) { b.onclick = function () { DET = rows[+b.dataset.i]; sub('detail'); }; });
  }
  $('hq').addEventListener('input', renderHist);
  $('bHistReload').onclick = function () { if (!navigator.onLine) return toast('ไม่มีเน็ต — แสดงข้อมูลที่เก็บในเครื่อง'); loadHist(true); };

  /* ---------- รายละเอียด ---------- */
  function photoSrc(r, key) { return r.local ? r.photos[key] || '' : ''; }
  function dPhoto(r, key, cap) {
    var has = r.local ? !!r.photos[key] : !!r.photos[key];
    return '<figure class="dph"><figcaption>' + esc(cap) + '</figcaption>' + (has
      ? '<div class="dimg" data-pk="' + key + '">' + (photoSrc(r, key) ? '<img src="' + photoSrc(r, key) + '" alt="' + esc(cap) + '">' : '<span>กำลังโหลดรูป…</span>') + '</div>'
      : '<div class="dimg none"><span>ไม่มีรูป</span></div>') + '</figure>';
  }
  function dText(label, v) { return '<div class="dtx"><span>' + esc(label) + '</span>' + esc(v || '-') + '</div>'; }
  function renderDetail() {
    var r = DET; if (!r) return;
    var v = r.vals || {};
    var h = '<section class="card"><h2>S/N ' + esc(r.sn) + '</h2>' +
      '<div class="info"><div><span>Report ID</span><b>' + esc(r.id) + '</b></div><div><span>ช่าง</span><b>' + esc(r.tech) + '</b></div>' +
      '<div><span>วันที่</span><b>' + esc(r.date) + '</b></div><div><span>ส่งเมื่อ</span><b>' + esc(r.local ? 'ยังไม่ส่ง (รอเน็ต)' : r.sub) + '</b></div></div>' +
      (r.result ? '<div class="vd ' + resCls(r.result) + '">ผล: ' + esc(r.result) + '</div>' : '') +
      '<div class="dgrid">' + dPhoto(r, 'plate', 'รูป plate') + '</div></section>';
    SECTIONS.forEach(function (s) {
      h += '<section class="card"><h2>' + esc(s.t) + '</h2>';
      if (s.items[0].kind === 'p1') { h += '<div class="dgrid">' + s.items.map(function (it) { return dPhoto(r, it.k, it.label); }).join('') + '</div></section>'; return; }
      s.items.forEach(function (it) {
        h += '<div class="part"><h3>' + esc(it.label) + '</h3><div class="dgrid">';
        if (it.kind === 'bac') h += dPhoto(r, it.k + '_b', 'ก่อน') + dPhoto(r, it.k + '_a', 'หลัง');
        else h += dPhoto(r, it.k + '_p', 'รูปสภาพ');
        h += '</div>';
        if (it.kind === 'ptc') h += dText('ความหนา', v[it.k + '_t'] ? v[it.k + '_t'] + ' mm' : '');
        if (it.kind !== 'p') h += dText('Comment', v[it.k + '_c']);
        h += '</div>';
      });
      h += '</section>';
    });
    h += '<section class="card"><h2>ทดสอบหลัง overhaul</h2>' +
      dText('Blank-off vacuum', v.kpa ? v.kpa + ' kPa' : '') + dText('กระแส L1 / L2 / L3', [v.a1, v.a2, v.a3].some(Boolean) ? [v.a1, v.a2, v.a3].map(function (x) { return x || '-'; }).join(' / ') + ' A' : '') +
      dText('เสียง', v.noise) + dText('อุณหภูมิ', v.temp ? v.temp + ' °C' : '') + dText('หมายเหตุ', v.note) + '</section>';
    $('detail').innerHTML = h;
    $('bPdf').disabled = !!r.local;
    $('pdfNote').textContent = r.local ? 'report นี้ยังไม่ได้ส่ง — ส่งเข้าระบบก่อนจึง export PDF ได้ (ใช้ปุ่มพิมพ์ได้)' : 'สร้าง PDF จากข้อมูลในระบบ (ต้องมีเน็ต) และเก็บสำเนาไว้ใน Drive';
    $('pdfLink').hidden = true;
    $('detail').querySelectorAll('.dimg img').forEach(function (im) { im.onclick = function () { $('lbImg').src = im.src; $('lb').hidden = false; }; });
    if (!r.local) loadDetailPhotos(r);
  }
  function loadDetailPhotos(r) {
    var keys = Object.keys(r.photos || {}), i = 0;
    function put(key, d) {
      var box = $('detail').querySelector('[data-pk="' + key + '"]'); if (!box || DET !== r) return;
      box.innerHTML = d ? '<img src="' + d + '" alt="">' : '<span>' + (navigator.onLine ? 'โหลดรูปไม่ได้' : 'รูปยังไม่ได้โหลด (ต้องมีเน็ต)') + '</span>';
      var im = box.querySelector('img'); if (im) im.onclick = function () { $('lbImg').src = d; $('lb').hidden = false; };
    }
    function next() {
      if (i >= keys.length || DET !== r) return;
      var key = keys[i++], id = r.photos[key];
      Store.get('oh.photo:' + id).then(function (d) {
        if (d) { put(key, d); return next(); }
        if (!navigator.onLine || !Api.pin()) { put(key, ''); return next(); }
        call('overhaul.photo', { id: id }, 60000).then(function (x) { Store.set('oh.photo:' + id, x.data).catch(function () {}); put(key, x.data); next(); },
          function () { put(key, ''); next(); });
      });
    }
    next(); next();                                       // โหลดพร้อมกัน 2 รูป
  }
  $('bPdf').onclick = function () {
    var r = DET; if (!r || r.local) return;
    if (!navigator.onLine) return toast('ต้องมีเน็ตเพื่อสร้าง PDF');
    var b = $('bPdf'); b.disabled = true; b.textContent = 'กำลังสร้าง PDF…';
    call('overhaul.pdf', { id: r.id }, 180000).then(function (x) {
      b.disabled = false; b.textContent = 'Export PDF';
      var bin = atob(x.data), u8 = new Uint8Array(bin.length);
      for (var k = 0; k < bin.length; k++) u8[k] = bin.charCodeAt(k);
      var blob = new Blob([u8], { type: 'application/pdf' });
      if (x.url) { $('pdfLink').href = x.url; $('pdfLink').hidden = false; }
      var file = null; try { file = new File([blob], x.name, { type: 'application/pdf' }); } catch (_) {}
      if (file && navigator.canShare && navigator.canShare({ files: [file] }) && /iPhone|iPad|Android/i.test(navigator.userAgent)) {
        navigator.share({ files: [file], title: x.name }).catch(function () {});
      } else {
        var a = document.createElement('a'), u = URL.createObjectURL(blob);
        a.href = u; a.download = x.name; document.body.appendChild(a); a.click(); a.remove();
        setTimeout(function () { URL.revokeObjectURL(u); }, 10000);
      }
      toast('สร้าง ' + x.name + ' แล้ว');
    }, function (er) { b.disabled = false; b.textContent = 'Export PDF'; toast('สร้าง PDF ไม่ได้: ' + er.message); });
  };
  $('bPrint').onclick = function () { window.print(); };

  /* ---------- โหลด ---------- */
  function refresh() {
    if (!navigator.onLine || !Api.ready()) return;
    var go = function () {
      call('overhaul.init', {}, 60000).then(function (d) {
        INIT = d; Store.set('overhaul.init', d).catch(function () {});
        renderGuide(); fillLists(); snInfo();
      }, function (er) { if (!INIT) $('guide').innerHTML = '<div class="errbox">โหลดหน้าแนะนำไม่ได้: ' + esc(er.message) + '</div>'; });
    };
    if (!Api.pin()) askPin().then(go); else go();
  }

  Promise.all([Store.get('overhaul.init'), Store.get('overhaul.draft'), Store.get('overhaul.outbox'), Store.get('overhaul.list')]).then(function (r) {
    INIT = r[0] || null; D = r[1] || newDraft(); OUTBOX = r[2] || []; HIST = r[3] || { rows: [], at: '' };
    D.vals = D.vals || {}; D.photos = D.photos || {};
    buildForm(); fillLists(); fillValues(); renderGuide(); paint(); tab(TAB);
    $('loading').hidden = true;
    refresh(); sync(); loadHist();
  }, function (er) {
    $('loading').hidden = true; $('guide').innerHTML = '<div class="errbox">เปิดที่เก็บข้อมูลในเครื่องไม่ได้: ' + esc(er && er.message) + '</div>';
  });
})();
