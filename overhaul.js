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

  var INIT = null, D = null, OUTBOX = [], SENT = [], syncing = false, CUR_SLOT = '';

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
    window.scrollTo(0, 0);
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
      fillLists(); fillValues(); paint(); renderSent(); window.scrollTo(0, 0);
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
        SENT.unshift({ id: r.id, sn: r.sn, tech: r.tech, date: r.date, at: r.sub, result: res.result || '', kpa: r.vals.kpa || '' });
        SENT = SENT.slice(0, 20);
        return Promise.all([Store.set('overhaul.outbox', OUTBOX), Store.set('overhaul.sent', SENT)]).then(function () {
          syncing = false; paint(); renderSent();
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
  function renderSent() {
    var rows = OUTBOX.map(function (r) { return { id: r.id, sn: r.sn, date: r.date, wait: true }; }).concat(SENT);
    $('sentBox').hidden = !rows.length;
    $('sent').innerHTML = rows.map(function (r) {
      return '<div class="item' + (r.wait ? ' wait' : '') + '"><div class="top"><b>' + esc(r.id) + '</b><span class="st">' + (r.wait ? 'รอส่ง' : 'ส่งแล้ว') + '</span></div>' +
        '<div class="meta">S/N ' + esc(r.sn) + ' · ' + esc(r.date) + (r.kpa ? ' · ' + esc(r.kpa) + ' kPa' : '') + (r.result ? ' · ' + esc(r.result) : '') + '</div></div>';
    }).join('');
  }

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

  Promise.all([Store.get('overhaul.init'), Store.get('overhaul.draft'), Store.get('overhaul.outbox'), Store.get('overhaul.sent')]).then(function (r) {
    INIT = r[0] || null; D = r[1] || newDraft(); OUTBOX = r[2] || []; SENT = r[3] || [];
    D.vals = D.vals || {}; D.photos = D.photos || {};
    buildForm(); fillLists(); fillValues(); renderGuide(); renderSent(); paint(); tab(TAB);
    $('loading').hidden = true;
    refresh(); sync();
  }, function (er) {
    $('loading').hidden = true; $('guide').innerHTML = '<div class="errbox">เปิดที่เก็บข้อมูลในเครื่องไม่ได้: ' + esc(er && er.message) + '</div>';
  });
})();
