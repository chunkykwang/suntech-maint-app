/* แจ้งซ่อม — v1 offline
 * รายชื่อช่าง/เครื่อง/Sector เก็บไว้ในเครื่อง (Store 'repair.init')
 * ใบแจ้งซ่อม + รูป (ย่อเป็น JPEG 1600px) เข้าคิว 'repair.outbox' แล้วส่งเองเมื่อมีเน็ต — ส่งซ้ำไม่บันทึกซ้ำ (submitId)
 * ใบที่ส่งแล้ว 30 ใบล่าสุดเก็บใน 'repair.sent' พร้อมข้อความ LINE
 */
(function () {
  'use strict';
  var $ = function (id) { return document.getElementById(id); };
  var OTHER = 'อื่นๆ (ระบุ)';
  var M = null, OUTBOX = [], SENT = [], photos = { p1: null, p2: null }, syncing = false;

  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function pad(n) { return String(n).padStart(2, '0'); }
  function opt(v, t) { return '<option value="' + esc(v) + '">' + esc(t == null ? v : t) + '</option>'; }
  function ls(k, v) { try { if (v === undefined) return localStorage.getItem(k) || ''; localStorage.setItem(k, v); } catch (_) { return ''; } }
  var tt; function toast(m) { var e = $('toast'); e.textContent = m; e.classList.add('on'); clearTimeout(tt); tt = setTimeout(function () { e.classList.remove('on'); }, 2400); }
  function uniq(a) { var o = []; a.forEach(function (x) { if (x && o.indexOf(x) < 0) o.push(x); }); return o; }

  /* ---------- สถานะ ---------- */
  function paint() {
    var on = navigator.onLine;
    $('net').textContent = on ? 'ออนไลน์' : 'ออฟไลน์'; $('net').className = 'pill' + (on ? '' : ' off');
    $('pending').hidden = !OUTBOX.length; $('pending').textContent = 'รอส่ง ' + OUTBOX.length + ' ใบ';
    $('bSync').hidden = !OUTBOX.length || !on;
  }
  window.addEventListener('online', function () { paint(); sync(); refresh(); });
  window.addEventListener('offline', paint);
  $('bSync').onclick = function () { sync(true); };

  /* ---------- PIN ---------- */
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

  /* ---------- โหลดข้อมูล ---------- */
  function boot() {
    Promise.all([Store.get('repair.init'), Store.get('repair.outbox'), Store.get('repair.sent')]).then(function (r) {
      OUTBOX = r[1] || []; SENT = r[2] || [];
      if (r[0]) use(r[0]);
      paint();
      var go = function () { refresh(); sync(); };
      if (!Api.ready()) { if (!M) fail('ยังไม่ได้ตั้งลิงก์ API (config.js)'); return; }
      if (!Api.pin() && navigator.onLine) askPin().then(go); else go();
      if (!M && !navigator.onLine) fail('ยังไม่มีข้อมูลในเครื่อง — เปิดหน้านี้ตอนมีเน็ตอย่างน้อย 1 ครั้ง');
    });
    setInterval(function () { if (navigator.onLine) sync(); }, 60000);
  }
  function fail(m) { $('loading').hidden = true; $('error').hidden = false; $('error').textContent = m; }
  function refresh() {
    if (!navigator.onLine || !Api.ready()) return;
    call('repair.init').then(function (d) { Store.set('repair.init', d); use(d); }, function (er) { if (!M) fail('โหลดข้อมูลไม่ได้: ' + er.message); });
  }
  function use(d) {
    var first = !M; M = d;
    $('loading').hidden = true; $('error').hidden = true;
    var tech = $('tech').value || ls('rr_tech'), mt = $('mtype').value, eq = $('eq').value;
    $('tech').innerHTML = opt('', '— เลือกช่าง —') + M.techs.map(function (t) { return opt(t); }).join('');
    if (M.techs.indexOf(tech) >= 0) $('tech').value = tech;
    $('mtype').innerHTML = opt('', '— เลือกประเภท —') + uniq(M.machines.map(function (m) { return m.type; })).map(function (t) { return opt(t); }).join('');
    if (mt) { $('mtype').value = mt; onType(); if (eq) { $('eq').value = eq; onEq(); } }
    if (first) { var n = new Date(); $('date').value = n.getFullYear() + '-' + pad(n.getMonth() + 1) + '-' + pad(n.getDate()); show('form'); }
  }

  /* ---------- ฟอร์ม ---------- */
  function mins() {
    var a = $('t1').value, b = $('t2').value; if (!a || !b) return null;
    var x = a.split(':').map(Number), y = b.split(':').map(Number), d = (y[0] * 60 + y[1]) - (x[0] * 60 + x[1]);
    return d < 0 ? d + 1440 : d;
  }
  function showDown() { var m = mins(); $('down').innerHTML = m == null ? '' : '<b>' + (m / 60).toFixed(2) + '</b>ชม. เครื่องหยุด (' + m + ' นาที)' + ($('t2').value < $('t1').value ? ' · ข้ามเที่ยงคืน' : ''); }
  ['t1', 't2'].forEach(function (i) { $(i).addEventListener('input', showDown); });
  function onType() {
    var t = $('mtype').value, L = M.machines.filter(function (m) { return m.type === t; });
    $('eq').innerHTML = opt('', t ? '— เลือกหมายเลขเครื่อง —' : '— เลือกประเภทก่อน —') + L.map(function (m) { return opt(m.eq, m.eq + ' · ' + m.desc); }).join('');
    $('eq').disabled = !t;
    var S = (M.sectors[t] || []).concat([OTHER]);
    $('sec').innerHTML = opt('', t ? '— เลือก Sector —' : '— เลือกเครื่องก่อน —') + (t ? S.map(function (s) { return opt(s); }).join('') : '');
    $('sec').disabled = !t; $('secOtherF').hidden = true; $('info').hidden = true;
  }
  function onEq() {
    var m = M.machines.filter(function (x) { return x.eq === $('eq').value; })[0];
    if (!m) { $('info').hidden = true; return; }
    $('info').hidden = false;
    $('info').innerHTML = '<div><span>Description</span><b>' + esc(m.desc) + '</b></div><div><span>Site</span><b>' + esc(m.site) + '</b></div>' +
      '<div><span>Model</span><b>' + esc(m.model) + '</b></div><div><span>Serial no.</span><b>' + esc(m.sn || '—') + '</b></div>';
  }
  $('mtype').addEventListener('change', onType);
  $('eq').addEventListener('change', onEq);
  $('sec').addEventListener('change', function () { $('secOtherF').hidden = $('sec').value !== OTHER; });

  function compress(file) {
    return new Promise(function (ok, no) {
      var img = new Image(), u = URL.createObjectURL(file);
      img.onload = function () {
        var s = Math.min(1, 1600 / Math.max(img.width, img.height)), c = document.createElement('canvas');
        c.width = Math.round(img.width * s); c.height = Math.round(img.height * s);
        c.getContext('2d').drawImage(img, 0, 0, c.width, c.height); URL.revokeObjectURL(u);
        ok(c.toDataURL('image/jpeg', 0.8));
      };
      img.onerror = function () { URL.revokeObjectURL(u); no(new Error('read')); };
      img.src = u;
    });
  }
  [['p1', 'pv1', 'x1'], ['p2', 'pv2', 'x2']].forEach(function (a) {
    var k = a[0], pv = a[1], x = a[2];
    [k + 'c', k + 'g'].forEach(function (inp) {
      $(inp).addEventListener('change', function () {
        var f = $(inp).files[0]; if (!f) return;
        compress(f).then(function (d) {
          photos[k] = d; $(pv).outerHTML = '<img id="' + pv + '" alt="ตัวอย่างรูป" src="' + d + '">'; $(x).hidden = false; $(inp).value = '';
        }, function () { toast('เปิดรูปนี้ไม่ได้ ลองรูปอื่น'); });
      });
    });
    $(x).addEventListener('click', function () { photos[k] = null; $(pv).outerHTML = '<div class="ph" id="' + pv + '">ยังไม่มีรูป</div>'; $(x).hidden = true; });
  });

  function setErr(el, msg) { el.setAttribute('aria-invalid', msg ? 'true' : 'false'); var e = el.parentElement.querySelector('.err'); if (e) e.textContent = msg || ''; }
  function validate() {
    var first = null;
    ['tech', 'date', 't1', 't2', 'mtype', 'eq', 'pb', 'sec', 'cause', 'reason', 'sol'].forEach(function (id) {
      var el = $(id), bad = !String(el.value).trim(); setErr(el, bad ? 'กรุณากรอกช่องนี้' : ''); if (bad && !first) first = el;
    });
    if ($('sec').value === OTHER) { var el = $('secOther'), bad = !el.value.trim(); setErr(el, bad ? 'กรุณาระบุ Sector' : ''); if (bad && !first) first = el; }
    if (!first && mins() === 0) { setErr($('t2'), 'เวลาเริ่มกับเวลาเสร็จต้องไม่เท่ากัน'); first = $('t2'); }
    if (first) { first.focus(); first.scrollIntoView({ block: 'center' }); }
    return !first;
  }
  function collect() {
    var m = M.machines.filter(function (x) { return x.eq === $('eq').value; })[0], d = $('date').value, mm = mins(), n = new Date();
    return {
      submitId: 'R' + Date.now().toString(36).toUpperCase() + Math.random().toString(36).slice(2, 6).toUpperCase(),
      id: 'RR-' + d.slice(2, 4) + d.slice(5, 7) + d.slice(8, 10) + '-' + pad(n.getHours()) + pad(n.getMinutes()) + pad(n.getSeconds()),
      sub: n.getFullYear() + '-' + pad(n.getMonth() + 1) + '-' + pad(n.getDate()) + ' ' + pad(n.getHours()) + ':' + pad(n.getMinutes()),
      tech: $('tech').value, date: d, t1: $('t1').value, t2: $('t2').value, mins: mm, hr: (mm / 60).toFixed(2),
      type: m.type, eq: m.eq, desc: m.desc, site: m.site, model: m.model, sn: m.sn,
      pb: $('pb').value.trim(), sec: $('sec').value === OTHER ? $('secOther').value.trim() : $('sec').value,
      cause: $('cause').value.trim(), reason: $('reason').value.trim(), sol: $('sol').value.trim(),
      p1: photos.p1 || '', p2: photos.p2 || ''
    };
  }
  function lineText(r, links) {
    var d = r.date.split('-');
    return ['[แจ้งซ่อม] ' + r.id, 'ช่าง: ' + r.tech, 'วันที่: ' + d[2] + '/' + d[1] + '/' + d[0] + '  เวลา ' + r.t1 + ' - ' + r.t2,
      'Downtime: ' + r.hr + ' ชม. (' + r.mins + ' นาที)', '', 'เครื่อง: ' + r.eq, r.desc, 'Model ' + r.model + (r.sn ? ' | S/N ' + r.sn : ''), '',
      'ปัญหาที่ได้รับแจ้ง: ' + r.pb, 'Sector: ' + r.sec, 'Cause: ' + r.cause, 'Reason: ' + r.reason, 'Solution: ' + r.sol]
      .concat(links && links.p1 ? ['รูปปัญหา: ' + links.p1] : [], links && links.p2 ? ['รูปหลังแก้ไข: ' + links.p2] : []).join('\n');
  }

  $('frm').addEventListener('submit', function (ev) {
    ev.preventDefault(); if (!validate()) return;
    var r = collect(); ls('rr_tech', r.tech);
    $('go').disabled = true;
    OUTBOX.push(r);
    remember({ submitId: r.submitId, id: r.id, eq: r.eq, at: r.sub, text: lineText(r, {}), hasPhoto: !!(r.p1 || r.p2), sent: false });
    Store.set('repair.outbox', OUTBOX).then(function () {
      $('go').disabled = false;
      toast(navigator.onLine ? 'บันทึกแล้ว กำลังส่ง…' : 'บันทึกในเครื่องแล้ว จะส่งเมื่อมีเน็ต');
      resetForm(); paint(); show('list'); sync();
    }, function (e) { $('go').disabled = false; toast('บันทึกในเครื่องไม่ได้: ' + e.message); });
  });
  function resetForm() {
    ['pb', 'cause', 'reason', 'sol', 'secOther', 't1', 't2'].forEach(function (i) { $(i).value = ''; });
    ['x1', 'x2'].forEach(function (i) { if (!$(i).hidden) $(i).click(); });
    $('mtype').value = ''; onType();
    document.querySelectorAll('[aria-invalid]').forEach(function (el) { setErr(el, ''); });
    showDown();
  }

  /* ---------- ใบที่ส่ง ---------- */
  function remember(item) {
    SENT = SENT.filter(function (x) { return x.submitId !== item.submitId; });
    SENT.unshift(item); SENT = SENT.slice(0, 30);
    return Store.set('repair.sent', SENT);
  }
  function renderList() {
    var box = $('list');
    if (!SENT.length) { box.innerHTML = '<div class="empty">ยังไม่มีใบแจ้งซ่อมจากเครื่องนี้</div>'; return; }
    box.innerHTML = SENT.map(function (s, i) {
      var wait = !s.sent;
      return '<div class="item' + (wait ? ' wait' : '') + '"><div class="top"><b>' + esc(s.id) + ' · ' + esc(s.eq) + '</b>' +
        '<span class="st">' + (wait ? 'รอส่ง' + (s.hasPhoto ? ' (มีรูป)' : '') : 'ส่งแล้ว') + '</span></div>' +
        '<pre>' + esc(s.text) + '</pre><div class="acts">' +
        '<button type="button" class="btn line" data-copy="' + i + '">คัดลอกข้อความ</button>' +
        (navigator.share ? '<button type="button" class="btn ghost" data-share="' + i + '">แชร์ไป LINE</button>' : '') + '</div></div>';
    }).join('');
    box.querySelectorAll('[data-copy]').forEach(function (b) {
      b.onclick = function () {
        var t = SENT[b.dataset.copy].text;
        (navigator.clipboard ? navigator.clipboard.writeText(t) : Promise.reject()).then(function () { toast('คัดลอกแล้ว วางใน LINE ได้เลย'); }, function () { toast('กดค้างที่ข้อความแล้วเลือกคัดลอก'); });
      };
    });
    box.querySelectorAll('[data-share]').forEach(function (b) {
      b.onclick = function () { navigator.share({ text: SENT[b.dataset.share].text }).catch(function () {}); };
    });
  }

  /* ---------- ส่งคิว ---------- */
  function sync(manual) {
    if (syncing || !OUTBOX.length || !navigator.onLine || !Api.ready() || !Api.pin()) return;
    syncing = true;
    var r = OUTBOX[0];
    call('repair.submit', { payload: r }, 120000).then(function (res) {
      OUTBOX = OUTBOX.filter(function (x) { return x.submitId !== r.submitId; });
      return Store.set('repair.outbox', OUTBOX).then(function () {
        return remember({ submitId: r.submitId, id: r.id, eq: r.eq, at: r.sub, text: lineText(r, res.links || {}), hasPhoto: !!(r.p1 || r.p2), sent: true });
      }).then(function () {
        syncing = false; paint(); if (!$('v-list').hidden) renderList();
        toast(res.duplicate ? r.id + ' ส่งไปแล้วก่อนหน้า' : 'ส่ง ' + r.id + ' เข้า Drive แล้ว');
        if (OUTBOX.length) sync();
      });
    }, function (er) {
      syncing = false; paint();
      if (manual || er.code !== 'OFFLINE') toast('ยังส่งไม่ได้: ' + er.message);
    });
  }

  /* ---------- views ---------- */
  function show(v) {
    $('frm').hidden = v !== 'form'; $('v-list').hidden = v !== 'list';
    $('t-form').setAttribute('aria-selected', String(v === 'form')); $('t-list').setAttribute('aria-selected', String(v === 'list'));
    if (v === 'list') renderList();
    window.scrollTo(0, 0);
  }
  $('t-form').onclick = function () { if (M) show('form'); };
  $('t-list').onclick = function () { show('list'); };

  boot();
})();
