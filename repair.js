/* แจ้งซ่อม — v1 offline
 * ผู้ใช้เข้าสู่ระบบที่หน้าแรก (session.js) -> เมนู
 *   1 ใบแจ้งซ่อมใหม่   2 งานรอปิด (งานที่ admin จ่ายให้ตัวเอง)   3 ใบแจ้งซ่อมที่ส่งแล้ว   4 จ่ายงาน (เฉพาะ admin)
 * รายชื่อช่าง/เครื่อง/Sector เก็บในเครื่อง (Store 'repair.init'), งานรอปิด ('repair.jobs')
 * ใบแจ้งซ่อม/การจ่ายงาน เข้าคิว 'repair.outbox' แล้วส่งเองเมื่อมีเน็ต — ส่งซ้ำไม่บันทึกซ้ำ (submitId)
 * ใบที่ส่งแล้ว 30 ใบล่าสุดเก็บใน 'repair.sent' (ข้อมูลทั้งใบ + ข้อความ LINE + ลิงก์รูป)
 * ลิงก์ไฟล์ใน Drive มาจาก repair.init (sheetUrl) — ไม่ใส่ ID ไฟล์ไว้ใน repo
 * admin เห็นใบแจ้งซ่อมทุกใบ (ทุกคน ทุกเครื่อง) จาก action 'repair.list' เก็บในเครื่องที่ 'repair.all' ไว้ดูตอน offline
 */
(function () {
  'use strict';
  if (!Session.require()) return;
  var $ = function (id) { return document.getElementById(id); };
  var OTHER = 'อื่นๆ (ระบุ)', ADMIN = Session.ADMIN;
  var M = null, OUTBOX = [], SENT = [], JOBS = [], photos = { p1: null, p2: null }, syncing = false;
  var USER = Session.user(), MODE = 'new', JOB = null, VIEW = '', DETAIL = null;
  var ALL = [], ALL_AT = '', ALL_ERR = '', ALL_LOADING = false;   // admin: ใบแจ้งซ่อมทุกใบจากเซิร์ฟเวอร์ (repair.list)

  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function pad(n) { return String(n).padStart(2, '0'); }
  function opt(v, t) { return '<option value="' + esc(v) + '">' + esc(t == null ? v : t) + '</option>'; }
  function ls(k, v) { try { if (v === undefined) return localStorage.getItem(k) || ''; if (v === null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch (_) { return ''; } }
  var tt; function toast(m) { var e = $('toast'); e.textContent = m; e.classList.add('on'); clearTimeout(tt); tt = setTimeout(function () { e.classList.remove('on'); }, 2600); }
  function uniq(a) { var o = []; a.forEach(function (x) { if (x && o.indexOf(x) < 0) o.push(x); }); return o; }
  function isAdmin() { return USER === ADMIN; }
  function today() { var n = new Date(); return n.getFullYear() + '-' + pad(n.getMonth() + 1) + '-' + pad(n.getDate()); }
  function stamp() { var n = new Date(); return { d: today(), hms: pad(n.getHours()) + pad(n.getMinutes()) + pad(n.getSeconds()), hm: pad(n.getHours()) + ':' + pad(n.getMinutes()) }; }
  function newSid(p) { return p + Date.now().toString(36).toUpperCase() + Math.random().toString(36).slice(2, 6).toUpperCase(); }

  /* ---------- สถานะ ---------- */
  function paint() {
    var on = navigator.onLine;
    $('net').textContent = on ? 'ออนไลน์' : 'ออฟไลน์'; $('net').className = 'pill' + (on ? '' : ' off');
    $('pending').hidden = !OUTBOX.length; $('pending').textContent = 'รอส่ง ' + OUTBOX.length;
    $('bSync').hidden = !OUTBOX.length || !on;
    $('whoBar').hidden = !USER; $('whoName').textContent = isAdmin() ? 'admin (หัวหน้างาน)' : USER;
    var n = myJobs().length;
    $('jobsCnt').hidden = !n; $('jobsCnt').textContent = n;
    $('jobsSub').textContent = isAdmin() ? 'งานที่จ่ายแล้วยังไม่ปิด (ทุกคน)' : 'งานที่ admin จ่ายให้';
    $('tAssign').hidden = !isAdmin();
  }
  window.addEventListener('online', function () { paint(); sync(); refresh(); });
  window.addEventListener('offline', paint);
  $('bSync').onclick = function () { sync(true); };

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

  /* ---------- โหลดข้อมูล ---------- */
  function boot() {
    Promise.all([Store.get('repair.init'), Store.get('repair.outbox'), Store.get('repair.sent'), Store.get('repair.jobs')]).then(function (r) {
      OUTBOX = r[1] || []; SENT = r[2] || []; JOBS = r[3] || [];
      Store.get('repair.all').then(function (a) { if (a && a.rows) { ALL = a.rows; ALL_AT = a.at || ''; } }).catch(function () {});
      if (r[0]) use(r[0]);
      paint();
      var go = function () { refresh(); sync(); };
      if (!Api.ready()) { if (!M) fail('ยังไม่ได้ตั้งลิงก์ API (config.js)'); return; }
      if (!Api.pin() && navigator.onLine) askPin().then(go); else go();
      if (!M && !navigator.onLine) fail('ยังไม่มีข้อมูลในเครื่อง — เปิดหน้านี้ตอนมีเน็ตอย่างน้อย 1 ครั้ง');
    });
    setInterval(function () { if (navigator.onLine) { sync(); refreshJobs(); } }, 60000);
  }
  function fail(m) { $('loading').hidden = true; $('error').hidden = false; $('error').textContent = m; }
  function refresh() {
    if (!navigator.onLine || !Api.ready()) return;
    call('repair.init').then(function (d) { Store.set('repair.init', d); use(d); }, function (er) { if (!M) fail('โหลดข้อมูลไม่ได้: ' + er.message); });
    refreshJobs();
  }
  function refreshJobs() {
    if (!navigator.onLine || !Api.ready() || !Api.pin()) return Promise.resolve();
    return call('repair.jobs').then(function (j) {
      JOBS = j || []; Store.set('repair.jobs', JOBS); paint(); if (VIEW === 'jobs') renderJobs();
    }, function () {});
  }
  function use(d) {
    var first = !M; M = d;
    $('loading').hidden = true; $('error').hidden = true;
    var tech = $('tech').value, mt = $('mtype').value, eq = $('eq').value;
    $('tech').innerHTML = opt('', '— เลือกช่าง —') + M.techs.map(function (t) { return opt(t); }).join('');
    if (M.techs.indexOf(tech) >= 0) $('tech').value = tech;
    $('mtype').innerHTML = opt('', '— เลือกประเภท —') + uniq(M.machines.map(function (m) { return m.type; })).map(function (t) { return opt(t); }).join('');
    if (mt) { $('mtype').value = mt; onType(); if (eq) { $('eq').value = eq; onEq(); } }
    paintDrive();
    if (first) show('menu');
  }

  /* ---------- ผู้ใช้ ---------- */
  $('bWho').onclick = function () {
    if (OUTBOX.length && !confirm('ยังมี ' + OUTBOX.length + ' รายการรอส่ง (จะส่งต่อเองเมื่อเข้าใช้งานใหม่) ออกจากระบบ?')) return;
    Session.logout();
  };
  function driveUrl() { return M && (M.sheetUrl || M.driveUrl || M.fileUrl) || ''; }
  function paintDrive() {
    var u = driveUrl();
    document.querySelectorAll('[data-drive]').forEach(function (el) {
      el.innerHTML = u ? '<a class="btn ghost" href="' + esc(u) + '" target="_blank" rel="noopener">&#128196; เปิดไฟล์แจ้งซ่อมใน Google Drive</a>'
        : '<span class="note">ลิงก์ไฟล์ใน Google Drive จะแสดงเมื่อมีเน็ตและเซิร์ฟเวอร์ส่งลิงก์มา</span>';
    });
  }

  /* ---------- เมนู ---------- */
  document.querySelectorAll('[data-go]').forEach(function (b) {
    b.onclick = function () {
      var g = b.dataset.go;
      if (g === 'new' || g === 'assign') openForm(g); else show(g);
    };
  });
  document.querySelectorAll('[data-menu]').forEach(function (b) { b.onclick = function () { show('menu'); }; });

  /* ---------- ฟอร์ม (3 แบบ: new = ใบใหม่ / assign = จ่ายงาน / close = ปิดงานที่ได้รับ) ---------- */
  function openForm(mode, job) {
    if (!M) return;
    MODE = mode; JOB = job || null;
    resetForm();
    $('date').value = today();
    var assign = mode === 'assign', close = mode === 'close';
    $('frmTitle').textContent = assign ? 'จ่ายงาน' : close ? 'ปิดงาน ' + job.jobId : 'ใบแจ้งซ่อมใหม่';
    $('techL').innerHTML = (assign ? 'มอบหมายให้' : 'ชื่อช่าง') + ' <span class="req">*</span>';
    $('t1L').innerHTML = assign ? 'เวลารับแจ้ง <span class="opt">(ไม่บังคับ)</span>' : 'เวลาเริ่ม <span class="req">*</span>';
    $('t2F').hidden = assign; $('down').hidden = assign; $('s3').hidden = assign;
    $('go').textContent = assign ? 'จ่ายงาน' : close ? 'ส่งปิดงาน' : 'ส่งรายงาน';
    $('hint').textContent = assign ? 'กรอกส่วนที่ 1–2 แล้วกดจ่ายงาน ช่างจะเห็นในเมนู "งานรอปิด"'
      : 'ช่องที่มี * ต้องกรอก · รูปไม่บังคับ · ไม่มีเน็ตก็ส่งได้ ระบบเก็บไว้แล้วส่งเอง';
    // ชื่อช่าง: ช่างล็อกเป็นชื่อตัวเอง / admin เลือกได้ / ปิดงาน = ผู้ได้รับมอบหมาย
    var lockTech = close || !isAdmin();
    $('tech').value = close ? job.tech : (isAdmin() ? '' : USER);
    $('tech').disabled = lockTech; $('tech').classList.toggle('ro', lockTech);
    ['mtype', 'eq'].forEach(function (i) { $(i).classList.toggle('ro', close); });
    $('pb').readOnly = close; $('pb').classList.toggle('ro', close);
    $('jobBox').hidden = !close;
    if (close) {
      $('jobBox').innerHTML = '<b>' + esc(job.jobId) + '</b> · admin จ่ายงานเมื่อ ' + esc(job.at || '') + '<br>กรอกเวลาเสร็จงาน และส่วนที่ 3 ผลการตรวจและแก้ไข แล้วกดส่งปิดงาน';
      if (job.date) $('date').value = job.date;
      $('t1').value = job.t1 || '';
      $('mtype').value = job.type; onType(); $('eq').value = job.eq; onEq();
      $('pb').value = job.pb;
    }
    $('mtype').disabled = close; $('eq').disabled = close || !$('mtype').value;
    showDown();
    show('form');
  }

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
    $('eq').disabled = !t || MODE === 'close';
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
    var need = MODE === 'assign' ? ['tech', 'date', 'mtype', 'eq', 'pb']
      : ['tech', 'date', 't1', 't2', 'mtype', 'eq', 'pb', 'sec', 'cause', 'reason', 'sol'];
    need.forEach(function (id) {
      var el = $(id), bad = !String(el.value).trim(); setErr(el, bad ? 'กรุณากรอกช่องนี้' : ''); if (bad && !first) first = el;
    });
    if (MODE !== 'assign') {
      if ($('sec').value === OTHER) { var el = $('secOther'), bad = !el.value.trim(); setErr(el, bad ? 'กรุณาระบุ Sector' : ''); if (bad && !first) first = el; }
      if (!first && mins() === 0) { setErr($('t2'), 'เวลาเริ่มกับเวลาเสร็จต้องไม่เท่ากัน'); first = $('t2'); }
    }
    if (first) { first.focus(); first.scrollIntoView({ block: 'center' }); }
    return !first;
  }
  function collect() {
    var m = M.machines.filter(function (x) { return x.eq === $('eq').value; })[0], d = $('date').value, mm = mins(), s = stamp();
    return {
      submitId: newSid('R'),
      id: 'RR-' + d.slice(2, 4) + d.slice(5, 7) + d.slice(8, 10) + '-' + s.hms,
      sub: s.d + ' ' + s.hm,
      tech: $('tech').value, date: d, t1: $('t1').value, t2: $('t2').value, mins: mm, hr: (mm / 60).toFixed(2),
      type: m.type, eq: m.eq, desc: m.desc, site: m.site, model: m.model, sn: m.sn,
      pb: $('pb').value.trim(), sec: $('sec').value === OTHER ? $('secOther').value.trim() : $('sec').value,
      cause: $('cause').value.trim(), reason: $('reason').value.trim(), sol: $('sol').value.trim(),
      p1: photos.p1 || '', p2: photos.p2 || '', jobId: JOB ? JOB.jobId : ''
    };
  }
  function collectAssign() {
    var m = M.machines.filter(function (x) { return x.eq === $('eq').value; })[0], s = stamp();
    return {
      kind: 'assign', submitId: newSid('J'), jobId: 'J-' + s.d.slice(2).replace(/-/g, '') + '-' + s.hms,
      at: s.d + ' ' + s.hm, by: ADMIN, tech: $('tech').value, date: $('date').value, t1: $('t1').value,
      type: m.type, eq: m.eq, desc: m.desc, pb: $('pb').value.trim()
    };
  }
  function lineText(r, links) {
    var d = r.date.split('-');
    return ['[แจ้งซ่อม] ' + r.id].concat(r.jobId ? ['งาน: ' + r.jobId] : [], ['ช่าง: ' + r.tech, 'วันที่: ' + d[2] + '/' + d[1] + '/' + d[0] + '  เวลา ' + r.t1 + ' - ' + r.t2,
      'Downtime: ' + r.hr + ' ชม. (' + r.mins + ' นาที)', '', 'เครื่อง: ' + r.eq, r.desc, 'Model ' + r.model + (r.sn ? ' | S/N ' + r.sn : ''), '',
      'ปัญหาที่ได้รับแจ้ง: ' + r.pb, 'Sector: ' + r.sec, 'Cause: ' + r.cause, 'Reason: ' + r.reason, 'Solution: ' + r.sol])
      .concat(links && links.p1 ? ['รูปปัญหา: ' + links.p1] : [], links && links.p2 ? ['รูปหลังแก้ไข: ' + links.p2] : []).join('\n');
  }
  function assignText(j) {
    var d = j.date.split('-');
    return ['[จ่ายงาน] ' + j.jobId, 'มอบหมายให้: ' + j.tech, 'วันที่: ' + d[2] + '/' + d[1] + '/' + d[0] + (j.t1 ? '  รับแจ้ง ' + j.t1 : ''),
      'เครื่อง: ' + j.eq, j.desc, 'ปัญหาที่ได้รับแจ้ง: ' + j.pb].join('\n');
  }

  $('frm').addEventListener('submit', function (ev) {
    ev.preventDefault(); if (!validate()) return;
    var item, msg;
    if (MODE === 'assign') {
      item = collectAssign();
      remember({ submitId: item.submitId, id: item.jobId, eq: item.eq, at: item.at, text: assignText(item), hasPhoto: false, sent: false, rec: item });
      msg = 'จ่ายงานให้ ' + item.tech + ' แล้ว';
    } else {
      item = collect();
      remember({ submitId: item.submitId, id: item.id, eq: item.eq, at: item.sub, text: lineText(item, {}), hasPhoto: !!(item.p1 || item.p2), sent: false, rec: slim(item), links: {} });
      msg = MODE === 'close' ? 'ปิดงาน ' + item.jobId + ' แล้ว' : 'บันทึกแล้ว';
    }
    $('go').disabled = true;
    OUTBOX.push(item);
    Store.set('repair.outbox', OUTBOX).then(function () {
      $('go').disabled = false;
      toast(msg + (navigator.onLine ? ' กำลังส่ง…' : ' — เก็บในเครื่อง จะส่งเมื่อมีเน็ต'));
      resetForm(); paint(); show(item.kind === 'assign' ? 'jobs' : 'list'); sync();
    }, function (e) { OUTBOX.pop(); $('go').disabled = false; toast('บันทึกในเครื่องไม่ได้: ' + e.message); });
  });
  function resetForm() {
    ['pb', 'cause', 'reason', 'sol', 'secOther', 't1', 't2'].forEach(function (i) { $(i).value = ''; });
    ['x1', 'x2'].forEach(function (i) { if (!$(i).hidden) $(i).click(); });
    $('mtype').value = ''; onType();
    document.querySelectorAll('[aria-invalid]').forEach(function (el) { setErr(el, ''); });
    showDown();
  }

  /* ---------- งานรอปิด ---------- */
  function closedLocally() {   // งานที่ส่งปิดจากเครื่องนี้แล้ว (ยังอยู่ในคิว หรือเซิร์ฟเวอร์ยังไม่อัปเดต)
    var s = {};
    OUTBOX.forEach(function (x) { if (x.jobId && x.kind !== 'assign') s[x.jobId] = 1; });
    return s;
  }
  function allJobs() {
    var done = closedLocally(), have = {};
    var L = JOBS.filter(function (j) { have[j.jobId] = 1; return !done[j.jobId]; });
    OUTBOX.forEach(function (x) { if (x.kind === 'assign' && !have[x.jobId]) L.push(Object.assign({ queued: true }, x)); });
    return L;
  }
  function myJobs() {
    if (!USER) return [];
    return allJobs().filter(function (j) { return isAdmin() || j.tech === USER; });
  }
  function renderJobs() {
    var L = myJobs();
    $('jobsNote').textContent = isAdmin() ? 'งานที่จ่ายแล้วยังไม่ปิดของทุกคน · admin ยกเลิกงานที่จ่ายผิดได้ (ต้องมีเน็ต)'
      : 'งานที่ admin จ่ายให้ ' + USER + ' · กด "ปิดงาน" เพื่อกรอกผลการตรวจและแก้ไข';
    if (!L.length) { $('jobs').innerHTML = '<div class="empty">ไม่มีงานรอปิด</div>'; return; }
    $('jobs').innerHTML = L.map(function (j, i) {
      return '<div class="job"><div class="top"><b>' + esc(j.jobId) + ' · ' + esc(j.eq) + '</b>' +
        '<span class="st">' + (j.queued ? 'รอส่งจากเครื่องนี้' : 'รอปิด') + '</span></div>' +
        '<div class="meta">' + esc(j.desc || '') + '</div>' +
        '<div class="meta">มอบหมายให้ <b>' + esc(j.tech) + '</b> · ' + esc(j.date) + (j.t1 ? ' ' + esc(j.t1) : '') + '</div>' +
        '<div class="pb">' + esc(j.pb) + '</div><div class="acts">' +
        (j.queued ? '' : '<button type="button" class="btn pri" data-close="' + i + '">ปิดงาน</button>') +
        (isAdmin() && !j.queued ? '<button type="button" class="btn ghost" data-cancel="' + i + '">ยกเลิกงาน</button>' : '') +
        '</div></div>';
    }).join('');
    $('jobs').querySelectorAll('[data-close]').forEach(function (b) { b.onclick = function () { openForm('close', L[b.dataset.close]); }; });
    $('jobs').querySelectorAll('[data-cancel]').forEach(function (b) {
      b.onclick = function () {
        var j = L[b.dataset.cancel];
        if (!navigator.onLine) { toast('ต้องมีเน็ตเพื่อยกเลิกงาน'); return; }
        if (!confirm('ยกเลิกงาน ' + j.jobId + ' (' + j.eq + ' ของ ' + j.tech + ')?')) return;
        b.disabled = true;
        call('repair.cancel', { adminPw: Session.adminPw(), jobId: j.jobId }, 30000).then(function () {
          JOBS = JOBS.filter(function (x) { return x.jobId !== j.jobId; }); Store.set('repair.jobs', JOBS);
          paint(); renderJobs(); toast('ยกเลิก ' + j.jobId + ' แล้ว');
        }, function (er) { b.disabled = false; toast('ยกเลิกไม่ได้: ' + er.message); });
      };
    });
  }

  /* ---------- ใบที่ส่ง ---------- */
  function remember(item) {
    SENT = SENT.filter(function (x) { return x.submitId !== item.submitId; });
    SENT.unshift(item); SENT = SENT.slice(0, 30);
    return Store.set('repair.sent', SENT);
  }
  function slim(r) { var o = Object.assign({}, r); o.hasP1 = !!r.p1; o.hasP2 = !!r.p2; delete o.p1; delete o.p2; return o; }
  /* admin: ใบแจ้งซ่อมทุกใบจาก Repair_Log */
  var COLS = { 'Report ID': 'id', 'Submitted at': 'sub', 'Technician': 'tech', 'Date': 'date', 'Start time': 't1', 'Finish time': 't2',
    'Downtime (hr)': 'hr', 'Machine type': 'type', 'Equipment No.': 'eq', 'Description': 'desc', 'Site': 'site', 'Model': 'model',
    'Serial no.': 'sn', 'Problem reported': 'pb', 'Sector': 'sec', 'Cause of problem': 'cause', 'Reason': 'reason', 'Solution': 'sol',
    'Submit ID': 'submitId', 'Job ID': 'jobId' };
  function fromServer(o) {
    var r = {};
    Object.keys(COLS).forEach(function (h) { r[COLS[h]] = o[h] == null ? '' : String(o[h]); });
    var hr = parseFloat(r.hr); r.hr = isNaN(hr) ? '' : hr.toFixed(2); r.mins = isNaN(hr) ? '' : Math.round(hr * 60);
    var L = { p1: o['Photo - problem'] || '', p2: o['Photo - solution'] || '' };
    r.hasP1 = !!L.p1; r.hasP2 = !!L.p2;
    return { submitId: r.submitId || r.id, id: r.id, eq: r.eq, at: r.sub, sent: true, rec: r, links: L, text: lineText(r, L), server: true };
  }
  function loadAll(force) {
    if (!isAdmin() || ALL_LOADING) return;
    if (!navigator.onLine) { ALL_ERR = 'ออฟไลน์ — แสดงข้อมูลที่โหลดไว้ล่าสุด'; if (VIEW === 'list') renderList(); return; }
    if (!force && ALL_AT && Date.now() - ALL_AT.t < 60000) return;
    ALL_LOADING = true; if (VIEW === 'list') renderList();
    call('repair.list', { adminPw: Session.adminPw(), limit: 300 }, 60000).then(function (rows) {
      ALL = (rows || []).map(fromServer); ALL_AT = { t: Date.now(), s: stamp().d + ' ' + stamp().hm }; ALL_ERR = '';
      Store.set('repair.all', { rows: ALL, at: ALL_AT }).catch(function () {});
    }, function (er) {
      ALL_ERR = /action|ไม่รู้จัก|unknown/i.test(er.message || '') ? 'เซิร์ฟเวอร์ยังไม่รองรับการดูทุกใบ (repair.list) — ต้องเพิ่มโค้ดใน Apps Script'
        : er.code === 'ADMIN' ? 'รหัส admin ใช้ไม่ได้ — ออกจากระบบแล้วเข้าเป็น admin ใหม่' : 'โหลดใบทั้งหมดไม่ได้: ' + er.message;
    }).then(function () { ALL_LOADING = false; if (VIEW === 'list') renderList(); if (VIEW === 'detail') renderDetail(); });
  }
  function listItems() {
    if (!isAdmin()) return SENT;
    var seen = {}, out = [];
    SENT.forEach(function (s) { if (!s.sent) { out.push(s); seen[s.submitId] = 1; seen[s.id] = 1; } });   // รอส่งจากเครื่องนี้ ขึ้นก่อน
    ALL.forEach(function (s) { if (!seen[s.submitId] && !seen[s.id]) { out.push(s); seen[s.submitId] = 1; seen[s.id] = 1; } });
    SENT.forEach(function (s) { if (!seen[s.submitId] && !seen[s.id]) out.push(s); });                     // จ่ายงาน / ใบที่ยังไม่อยู่ในรายการเซิร์ฟเวอร์
    return out;
  }
  function renderList() {
    var box = $('list'), adm = isAdmin();
    $('listNote').textContent = adm ? 'admin: ใบแจ้งซ่อมทุกใบของทุกคน (300 ใบล่าสุด) · แตะที่ใบเพื่อดูรายละเอียดและคัดลอกข้อความ LINE'
      : 'ใบที่ทำจากเครื่องนี้ 30 ใบล่าสุด · แตะที่ใบเพื่อดูรายละเอียดและคัดลอกข้อความ LINE';
    $('admBar').hidden = !adm;
    if (adm) $('admStat').textContent = ALL_LOADING ? 'กำลังโหลดใบทั้งหมด…' : ALL_ERR ? ALL_ERR : ALL_AT ? 'อัปเดตล่าสุด ' + ALL_AT.s + ' · ' + ALL.length + ' ใบ' : '';
    var q = ($('q').value || '').trim().toLowerCase(), L = listItems();
    var F = !q ? L : L.filter(function (s) { var r = s.rec || {}; return [s.id, s.eq, r.tech, r.desc, r.pb, r.date, r.sec, r.jobId].join(' ').toLowerCase().indexOf(q) >= 0; });
    if (!L.length) { box.innerHTML = '<div class="empty">' + (adm && ALL_LOADING ? 'กำลังโหลด…' : 'ยังไม่มีใบแจ้งซ่อม') + '</div>'; return; }
    if (!F.length) { box.innerHTML = '<div class="empty">ไม่พบใบที่ตรงกับ “' + esc(q) + '”</div>'; return; }
    box.innerHTML = F.map(function (s) {
      var wait = !s.sent, r = s.rec || {}, asg = r.kind === 'assign';
      return '<button type="button" class="item rowbtn' + (wait ? ' wait' : '') + '" data-open="' + esc(s.submitId) + '">' +
        '<div class="top"><b>' + esc(s.id) + '</b><span class="st">' + (asg ? 'จ่ายงาน · ' : '') + (wait ? 'รอส่ง' + (s.hasPhoto ? ' (มีรูป)' : '') : 'ส่งแล้ว') + '</span></div>' +
        '<div class="meta">' + esc(s.eq) + (r.desc ? ' · ' + esc(r.desc) : '') + '</div>' +
        '<div class="meta">' + esc(r.tech || '') + (r.date ? ' · วันที่ ' + esc(r.date) : '') + (r.jobId ? ' · ' + esc(r.jobId) : '') + '</div>' +
        (r.pb ? '<div class="pbl">' + esc(r.pb) + '</div>' : '') + '</button>';
    }).join('');
    box.querySelectorAll('[data-open]').forEach(function (b) {
      b.onclick = function () { DETAIL = b.dataset.open; show('detail'); };
    });
  }
  $('q').addEventListener('input', function () { renderList(); });
  $('bReload').onclick = function () { loadAll(true); };
  function val(label, v, full) {
    return '<div class="f' + (full ? ' full' : '') + '"><label>' + esc(label) + '</label><div class="val">' + (v ? esc(v) : '<span class="opt">—</span>') + '</div></div>';
  }
  function picBox(label, link, local, had) {
    var inner = local ? '<img src="' + local + '" alt="' + esc(label) + '">'
      : '<div class="ph">' + (had ? 'รูปอยู่ใน Drive' : 'ไม่มีรูป') + '</div>';
    var act = link ? '<a class="btn ghost" href="' + esc(link) + '" target="_blank" rel="noopener">เปิดรูปใน Drive</a>'
      : had && local ? '<span class="note">รอส่งเข้า Drive</span>' : '';
    return '<div class="f"><label>' + esc(label) + '</label><div class="pic">' + inner + act + '</div></div>';
  }
  function renderDetail() {
    var s = listItems().filter(function (x) { return x.submitId === DETAIL; })[0], box = $('detail');
    if (!s) { show('list'); return; }
    var r = s.rec, asg = r && r.kind === 'assign', q = OUTBOX.filter(function (x) { return x.submitId === s.submitId; })[0] || {}, L = s.links || {};
    $('dTitle').textContent = s.id;
    var st = '<div class="dstat' + (s.sent ? '' : ' wait') + '">' + (asg ? 'จ่ายงาน · ' : '') + (s.sent ? 'ส่งเข้า Drive แล้ว' : 'รอส่ง — จะส่งเองเมื่อมีเน็ต') + (s.at ? ' · ' + esc(s.at) : '') + '</div>';
    var html = st;
    if (!r) {
      html += '<section class="card"><p class="note">ใบนี้ทำก่อนอัปเดต จึงมีแค่ข้อความ LINE</p></section>';
    } else {
      var d = (r.date || '').split('-'), dd = d.length === 3 ? d[2] + '/' + d[1] + '/' + d[0] : r.date;
      html += '<section class="card"><h2><span class="n">1</span>ข้อมูลงาน</h2>' +
        (r.jobId ? '<div class="jobbox"><b>' + esc(r.jobId) + '</b>' + (asg ? ' · admin จ่ายงาน' : ' · ปิดงานที่ได้รับมอบหมาย') + '</div>' : '') +
        '<div class="row">' + val(asg ? 'มอบหมายให้' : 'ชื่อช่าง', r.tech) + val('วันที่', dd) + '</div>' +
        '<div class="row">' + val(asg ? 'เวลารับแจ้ง' : 'เวลาเริ่ม', r.t1) + (asg ? '' : val('เวลาเสร็จงาน', r.t2)) + '</div>' +
        (asg || r.hr == null ? '' : '<div class="down"><b>' + esc(r.hr) + '</b>ชม. เครื่องหยุด (' + esc(r.mins) + ' นาที)</div>') + '</section>';
      html += '<section class="card"><h2><span class="n">2</span>เครื่องจักร</h2>' +
        '<div class="row">' + val('Machine type', r.type) + val('หมายเลขเครื่อง', r.eq) + '</div>' +
        '<div class="info"><div><span>Description</span><b>' + esc(r.desc || '—') + '</b></div><div><span>Site</span><b>' + esc(r.site || '—') + '</b></div>' +
        '<div><span>Model</span><b>' + esc(r.model || '—') + '</b></div><div><span>Serial no.</span><b>' + esc(r.sn || '—') + '</b></div></div>' +
        val('ปัญหาที่ได้รับแจ้ง', r.pb) + '</section>';
      if (!asg) html += '<section class="card"><h2><span class="n">3</span>ผลการตรวจและแก้ไข</h2>' +
        val('Sector (ส่วนของเครื่อง)', r.sec) + val('Cause of problem', r.cause) +
        picBox('Picture of problem', L.p1, q.p1, r.hasP1) +
        val('Reason', r.reason) + val('Solution', r.sol) +
        picBox('Picture of solution', L.p2, q.p2, r.hasP2) + '</section>';
    }
    html += '<section class="card"><h2>ข้อความสำหรับ LINE</h2><div class="lbox"><textarea id="dText" readonly aria-label="ข้อความสำหรับ LINE">' + esc(s.text) + '</textarea></div><div class="acts">' +
      '<button type="button" class="btn line" id="dCopy">คัดลอกข้อความ</button>' +
      (navigator.share ? '<button type="button" class="btn ghost" id="dShare">แชร์ไป LINE</button>' : '') + '</div></section>';
    box.innerHTML = html;
    var ta = $('dText'); ta.style.height = 'auto'; ta.style.height = (ta.scrollHeight + 4) + 'px';
    $('dCopy').onclick = function () {
      (navigator.clipboard ? navigator.clipboard.writeText(s.text) : Promise.reject()).then(function () { toast('คัดลอกแล้ว วางใน LINE ได้เลย'); },
        function () { var t = $('dText'); t.focus(); t.select(); try { document.execCommand('copy'); toast('คัดลอกแล้ว วางใน LINE ได้เลย'); } catch (_) { toast('กดค้างที่ข้อความแล้วเลือกคัดลอก'); } });
    };
    if ($('dShare')) $('dShare').onclick = function () { navigator.share({ text: s.text }).catch(function () {}); };
  }
  $('bBackList').onclick = function () { show('list'); };

  /* ---------- ส่งคิว ---------- */
  function sync(manual) {
    if (syncing || !OUTBOX.length || !navigator.onLine || !Api.ready() || !Api.pin()) return;
    syncing = true;
    var r = OUTBOX[0], assign = r.kind === 'assign';
    var req = assign ? call('repair.assign', { adminPw: Session.adminPw(), payload: r }, 60000)
                     : call('repair.submit', { payload: r }, 120000);
    req.then(function (res) {
      OUTBOX = OUTBOX.filter(function (x) { return x.submitId !== r.submitId; });
      return Store.set('repair.outbox', OUTBOX).then(function () {
        return assign
          ? remember({ submitId: r.submitId, id: r.jobId, eq: r.eq, at: r.at, text: assignText(r), hasPhoto: false, sent: true, rec: r })
          : remember({ submitId: r.submitId, id: r.id, eq: r.eq, at: r.sub, text: lineText(r, res.links || {}), hasPhoto: !!(r.p1 || r.p2), sent: true, rec: slim(r), links: res.links || {} });
      }).then(function () {
        if (assign && !JOBS.some(function (j) { return j.jobId === r.jobId; })) JOBS.push({ jobId: r.jobId, at: r.at, by: r.by, tech: r.tech, date: r.date, t1: r.t1, type: r.type, eq: r.eq, desc: r.desc, pb: r.pb });
        if (!assign && r.jobId) JOBS = JOBS.filter(function (j) { return j.jobId !== r.jobId; });
        if (!assign && isAdmin()) { ALL_AT = ''; if (VIEW === 'list' || VIEW === 'detail') setTimeout(function () { loadAll(true); }, 0); }
        Store.set('repair.jobs', JOBS);
        syncing = false; paint(); if (VIEW === 'list') renderList(); if (VIEW === 'detail') renderDetail(); if (VIEW === 'jobs') renderJobs();
        var id = assign ? r.jobId : r.id;
        toast(res.duplicate ? id + ' ส่งไปแล้วก่อนหน้า' : assign ? 'ส่งงาน ' + id + ' ให้ ' + r.tech + ' แล้ว' : 'ส่ง ' + id + ' เข้า Drive แล้ว');
        if (OUTBOX.length) sync();
      });
    }, function (er) {
      syncing = false; paint();
      if (er.code === 'ADMIN') toast('รหัส admin ใช้ไม่ได้ — ออกจากระบบแล้วเข้าเป็น admin ใหม่ งานที่จ่ายยังรอส่งอยู่');
      else if (manual || er.code !== 'OFFLINE') toast('ยังส่งไม่ได้: ' + er.message);
    });
  }

  /* ---------- views ---------- */
  function show(v) {
    VIEW = v;
    $('v-menu').hidden = v !== 'menu';
    $('frm').hidden = v !== 'form'; $('v-list').hidden = v !== 'list'; $('v-jobs').hidden = v !== 'jobs'; $('v-detail').hidden = v !== 'detail';
    if (v === 'list') { renderList(); loadAll(); }
    if (v === 'detail') renderDetail();
    if (v === 'jobs') { renderJobs(); refreshJobs(); }
    paint();
    window.scrollTo(0, 0);
  }

  boot();
})();
