/* แจ้งซ่อม — v1 offline
 * ผู้ใช้เข้าสู่ระบบที่หน้าแรก (session.js) -> เมนู
 *   1 ใบแจ้งซ่อมใหม่   2 งานรอปิด (งานที่ admin จ่ายให้ตัวเอง)   3 ใบแจ้งซ่อมที่ส่งแล้ว   4 จ่ายงาน (เฉพาะ admin)
 * รายชื่อช่าง/เครื่อง/Sector เก็บในเครื่อง (Store 'repair.init'), งานรอปิด ('repair.jobs')
 * ใบแจ้งซ่อม/การจ่ายงาน เข้าคิว 'repair.outbox' แล้วส่งเองเมื่อมีเน็ต — ส่งซ้ำไม่บันทึกซ้ำ (submitId)
 * ใบที่ส่งแล้ว 30 ใบล่าสุดเก็บใน 'repair.sent' (ข้อมูลทั้งใบ + ข้อความ LINE + ลิงก์รูป)
 * ลิงก์ไฟล์ใน Drive มาจาก repair.init (sheetUrl) — ไม่ใส่ ID ไฟล์ไว้ใน repo
 * ทุกคนเห็นใบแจ้งซ่อมทุกใบ (ทุกคน ทุกเครื่อง) จาก action 'repair.list' ตามช่วงวันที่ เก็บในเครื่องที่ 'repair.all' ไว้ดูตอน offline
 * กดส่งรายงาน -> ไปหน้าแชร์ข้อความ LINE ก่อน (v-share)
 */
(function () {
  'use strict';
  if (!Session.require()) return;
  var $ = function (id) { return document.getElementById(id); };
  var OTHER = 'อื่นๆ (ระบุ)', ADMIN = Session.ADMIN;
  var M = null, OUTBOX = [], SENT = [], JOBS = [], photos = { p1: null, p2: null }, syncing = false;
  var MAN = null, MANP = Promise.resolve(), MAN_OUT = [], manSyncing = false, MAN_CUR = null, URLQ = null, PENDING_R = '';   // Machine Manual (ใช้ร่วมกับ manual.html)
  var USER = Session.user(), MODE = 'new', JOB = null, VIEW = '', DETAIL = null, LAST_ASSIGN = null, REFS = [];
  var ALL = [], ALL_AT = '', ALL_ERR = '', ALL_LOADING = false, ALL_RANGE = '';   // ใบแจ้งซ่อมทุกใบจากเซิร์ฟเวอร์ (repair.list)
  var SHARE = null;   // submitId ของใบที่เพิ่งส่ง (หน้าแชร์)

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
      Store.get('repair.all').then(function (a) { if (a && a.rows) { ALL = a.rows; ALL_AT = a.at || ''; ALL_RANGE = a.range || ''; } }).catch(function () {});
      MANP = Promise.all([Store.get('manual.db'), Store.get('manual.outbox')]).then(function (x) { MAN = x[0] || null; MAN_OUT = x[1] || []; if (MAN_CUR) paintAlm(); }).catch(function () {});
      try { URLQ = new URLSearchParams(location.search); } catch (_) { URLQ = null; }
      var hm = location.hash.match(/^#r=([\w-]+)/); if (hm) PENDING_R = hm[1];
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
    call('manual.init', {}, 60000).then(function (d) { MAN = d; Store.set('manual.db', d).catch(function () {}); if (MAN_CUR !== null) paintAlm(); if (VIEW === 'detail') renderDetail(); }, function () {});
    refreshJobs();
  }
  function refreshJobs() {
    if (!navigator.onLine || !Api.ready() || !Api.pin()) return Promise.resolve();
    return call('repair.jobs').then(function (j) {
      JOBS = j || []; Store.set('repair.jobs', JOBS); paint(); if (VIEW === 'jobs') renderJobs(); prefetchRefs();
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
    if (first) {
      show('menu');
      if (URLQ && URLQ.get('new') === '1') fromManual();
      else if (PENDING_R) { show('list'); }
    }
  }
  // เปิดจาก Machine Manual: repair.html?new=1&eq=…&alarm=…&unit=…&step=…&io=…&cause=…&action=…
  function fromManual() {
    var q = URLQ, m = M.machines.filter(function (x) { return x.eq === q.get('eq'); })[0];
    openForm('new');
    MANP.then(function () { fromManual2(q, m); });
  }
  function fromManual2(q, m) {
    if (m) { $('mtype').value = m.type; onType(); $('eq').value = m.eq; onEq(); }
    if (q.get('cause')) $('cause').value = q.get('cause');
    if (q.get('action')) $('sol').value = q.get('action');
    if (MAN_CUR) {
      if (q.get('unit')) $('maUnit').value = q.get('unit');
      fillAlmSelects();
      $('maAlarm').value = q.get('alarm') || ''; onAlarm();
      $('maStep').value = q.get('step') || ''; $('maIo').value = q.get('io') || '';
    }
    try { history.replaceState(null, '', location.pathname); } catch (_) {}
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
  function openForm(mode, job, presetTech) {
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
    $('tech').value = close ? job.tech : (isAdmin() ? (presetTech || '') : USER);
    $('tech').disabled = lockTech; $('tech').classList.toggle('ro', lockTech);
    ['mtype', 'eq'].forEach(function (i) { $(i).classList.toggle('ro', close); });
    $('pb').readOnly = close; $('pb').classList.toggle('ro', close);
    $('jobBox').hidden = !close;
    REFS = []; paintRefs();
    $('refF').hidden = !(assign || (close && job.refs && job.refs.length) || (close && job.localRefs && job.localRefs.length));
    $('refBtns').hidden = !assign;
    $('refL').innerHTML = assign ? 'รูปตัวอย่างหน้างาน <span class="opt">(ไม่บังคับ · สูงสุด 3 รูป)</span>' : 'รูปตัวอย่างหน้างาน (จาก admin)';
    if (close && !$('refF').hidden) fillRefs($('refs'), job);
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
    paintAlm();
    if (!m) { $('info').hidden = true; return; }
    $('info').hidden = false;
    $('info').innerHTML = '<div><span>Description</span><b>' + esc(m.desc) + '</b></div><div><span>Site</span><b>' + esc(m.site) + '</b></div>' +
      '<div><span>Model</span><b>' + esc(m.model) + '</b></div><div><span>Serial no.</span><b>' + esc(m.sn || '—') + '</b></div>';
  }
  $('mtype').addEventListener('change', onType);
  $('eq').addEventListener('change', onEq);

  /* ---------- Machine Manual: เลือก alarm code ในใบแจ้งซ่อม ---------- */
  function norm(x) { return String(x || '').toLowerCase().replace(/[^a-z0-9]/g, ''); }
  // เครื่องนี้มีคู่มือไหม: machine_no = Equipment No. ก่อน ไม่มีค่อยจับคู่จากชื่อรุ่น (เช่น "HT-LEM 32" = "HT-LEM32")
  function manFor(eq) {
    if (!MAN || !eq) return null;
    var mc = (MAN.machine || []).filter(function (x) { return x.machine_no === eq; })[0];
    if (mc) return { model_id: mc.model_id, machine_id: mc.machine_id };
    var m = M.machines.filter(function (x) { return x.eq === eq; })[0];
    var md = m && (MAN.model || []).filter(function (x) { return norm(x.model) && norm(x.model) === norm(m.model); })[0];
    return md ? { model_id: md.model_id, machine_id: '' } : null;
  }
  function manRows(t) { return ((MAN && MAN[t]) || []).filter(function (r) { return MAN_CUR && r.model_id === MAN_CUR.model_id; }); }
  function manUnits() {
    var md = (MAN.model || []).filter(function (x) { return MAN_CUR && x.model_id === MAN_CUR.model_id; })[0];
    var u = String((md && md.units_per_machine) || '').match(/No\.\s?\d+/gi);
    return u ? u.map(function (x) { return x.replace(/\s/g, ''); }) : [];
  }
  function almLabel(a) { return a ? (a.code && a.code !== '-' ? 'Code ' + a.code + ' ' : '') + a.screen_text : ''; }
  function paintAlm() {
    var show = MODE !== 'assign' && !!$('eq').value;
    MAN_CUR = show ? manFor($('eq').value) : null;
    $('almBox').hidden = !MAN_CUR;
    if (!MAN_CUR) return;
    var u = manUnits();
    $('maUnit').innerHTML = u.length ? u.map(function (x) { return opt(x); }).join('') : opt('', '-');
    $('maAlarm').innerHTML = opt('', '— ไม่มี alarm / ไม่ระบุ —') + manRows('alarm_code').slice().sort(function (a, b) { return (+a.sort || 99) - (+b.sort || 99); })
      .map(function (a) { return opt(a.alarm_id, almLabel(a)); }).join('');
    $('almLink').href = 'manual.html?eq=' + encodeURIComponent($('eq').value);
    fillAlmSelects(); onAlarm();
  }
  function fillAlmSelects() {
    var u = $('maUnit').value, i = manUnits().indexOf(u), last = '';
    var st = $('maStep').value, io = $('maIo').value;
    $('maStep').innerHTML = opt('', '— ไม่ระบุ —') + manRows('cycle_step').map(function (s) {
      var g = s.process !== last ? (last ? '</optgroup>' : '') + '<optgroup label="' + esc(s.process) + '">' : ''; last = s.process;
      return g + opt(s.step_id, s.seq + '. ' + s.step_th + ' (' + ((i === 1 ? s.mr_no2 : s.mr_no1) || '') + ')');
    }).join('') + (last ? '</optgroup>' : '');
    $('maIo').innerHTML = opt('', '— ไม่ระบุ —') + manRows('io_point').filter(function (r) { return !u || !r.unit || r.unit.indexOf(u) >= 0; })
      .map(function (r) { return opt(r.io_id, r.symbol + ' – ' + r.name_th + ' (' + r.address + ')'); }).join('');
    $('maStep').value = st; $('maIo').value = io;
  }
  function onAlarm() {
    var a = manRows('alarm_code').filter(function (x) { return x.alarm_id === $('maAlarm').value; })[0];
    $('almMore').hidden = !a;
    $('almTip').textContent = a ? 'สาเหตุ: ' + a.cause + (a.check_points ? '\nจุดตรวจ: ' + a.check_points : '') : '';
    if (a && !$('pb').readOnly && !$('pb').value.trim()) $('pb').value = 'Alarm ' + almLabel(a) + ($('maUnit').value ? ' (' + $('maUnit').value + ')' : '');
  }
  $('maUnit').addEventListener('change', function () { fillAlmSelects(); });
  $('maAlarm').addEventListener('change', onAlarm);
  // บันทึก alarm ลงคิวของ Machine Manual (ส่ง manual.log) พร้อมเลขใบแจ้งซ่อม
  function queueAlarm(item) {
    if (!MAN_CUR || $('almBox').hidden || !$('maAlarm').value) return null;
    var a = { submit_id: 'mr' + item.submitId, machine_id: MAN_CUR.machine_id, equipment_no: item.eq, model_id: MAN_CUR.model_id, site: item.site,
              unit: $('maUnit').value, date: item.date, time: item.t1, alarm_id: $('maAlarm').value, stalled_step_id: $('maStep').value, faulty_io_id: $('maIo').value,
              cause: item.cause, action: item.sol, recorded_by: item.tech, note: 'จากใบแจ้งซ่อม', repair_id: item.id };
    MAN_OUT.push(a); Store.set('manual.outbox', MAN_OUT).catch(function () {});
    var al = almOf(item); if (al) item.almTxt = al.txt;
    return a;
  }
  function syncMan() {
    if (manSyncing || !MAN_OUT.length || !navigator.onLine || !Api.ready() || !Api.pin()) return;
    manSyncing = true;
    var a = MAN_OUT[0];
    call('manual.log', { payload: a }, 60000).then(function (res) {
      MAN_OUT = MAN_OUT.filter(function (x) { return x.submit_id !== a.submit_id; });
      if (MAN && res.machine_id && !(MAN.machine || []).some(function (x) { return x.machine_id === res.machine_id; })) (MAN.machine = MAN.machine || []).push({ machine_id: res.machine_id, model_id: a.model_id, machine_no: a.equipment_no, location: a.site || '', status: 'Active' });
      if (MAN && !res.duplicate) { MAN.alarm_log = [Object.assign({ log_id: res.log_id }, a, { machine_id: res.machine_id || a.machine_id })].concat(MAN.alarm_log || []); Store.set('manual.db', MAN).catch(function () {}); }
      return Store.set('manual.outbox', MAN_OUT).then(function () { manSyncing = false; if (MAN_OUT.length) syncMan(); });
    }, function () { manSyncing = false; });
  }
  function almOf(r) {
    if (!r) return null;
    var hit = MAN_OUT.filter(function (x) { return x.repair_id === r.id; })[0] || ((MAN && MAN.alarm_log) || []).filter(function (x) { return x.repair_id === r.id; })[0];
    if (!hit) return null;
    var f = function (t, k, v) { return ((MAN && MAN[t]) || []).filter(function (x) { return x[k] === v; })[0]; };
    var al = f('alarm_code', 'alarm_id', hit.alarm_id), st = hit.stalled_step_id && f('cycle_step', 'step_id', hit.stalled_step_id), io = hit.faulty_io_id && f('io_point', 'io_id', hit.faulty_io_id);
    return { log: hit, txt: [almLabel(al) || hit.alarm_id, hit.unit, st ? 'Step ' + st.seq + '. ' + st.step_th : '', io ? 'Sensor ' + io.symbol + ' ' + io.name_th : ''].filter(Boolean).join(' · ') };
  }
  $('sec').addEventListener('change', function () { $('secOtherF').hidden = $('sec').value !== OTHER; });

  // ย่อรูปก่อนเก็บ/ส่ง: ไม่เกิน ~60 KB ต่อรูป (เดิม ~200 KB) — ลดคุณภาพก่อน ถ้ายังใหญ่ค่อยลดขนาดภาพ
  var PHOTO_MAX_KB = 60, PHOTO_MAX_PX = 1280;
  function compress(file) {
    return new Promise(function (ok, no) {
      var img = new Image(), u = URL.createObjectURL(file);
      img.onload = function () {
        URL.revokeObjectURL(u);
        var side = Math.min(PHOTO_MAX_PX, Math.max(img.width, img.height)), d = '';
        for (var round = 0; round < 6; round++) {
          var s = side / Math.max(img.width, img.height), c = document.createElement('canvas');
          c.width = Math.round(img.width * s); c.height = Math.round(img.height * s);
          c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
          for (var q = 0.72; q >= 0.4; q -= 0.08) {
            d = c.toDataURL('image/jpeg', q);
            if (kb(d) <= PHOTO_MAX_KB) return ok(d);
          }
          side = Math.round(side * 0.8);
        }
        ok(d);
      };
      img.onerror = function () { URL.revokeObjectURL(u); no(new Error('read')); };
      img.src = u;
    });
  }
  function kb(dataUrl) { return Math.round((dataUrl.length - dataUrl.indexOf(',') - 1) * 0.75 / 1024); }

  /* ---------- รูปตัวอย่างหน้างาน (จ่ายงาน) ---------- */
  function refHtml(src, i, removable) {
    return '<div class="ref">' + (src ? '<img src="' + src + '" alt="รูปตัวอย่างหน้างาน ' + (i + 1) + '" data-zoom>' : 'รูปยังไม่โหลด<br>(ต้องมีเน็ต)') +
      (removable ? '<button type="button" class="rx" data-rx="' + i + '" aria-label="ลบรูป">&times;</button>' : '') + '</div>';
  }
  function paintRefs() {
    $('refs').innerHTML = REFS.map(function (d, i) { return refHtml(d, i, true); }).join('');
    $('refBtns').hidden = REFS.length >= 3;
    $('refs').querySelectorAll('[data-rx]').forEach(function (b) { b.onclick = function () { REFS.splice(+b.dataset.rx, 1); paintRefs(); }; });
  }
  ['rfc', 'rfg'].forEach(function (inp) {
    $(inp).addEventListener('change', function () {
      var files = Array.prototype.slice.call($(inp).files, 0, 3 - REFS.length);
      $(inp).value = '';
      files.reduce(function (p, f) {
        return p.then(function () { return compress(f).then(function (d) { if (REFS.length < 3) REFS.push(d); paintRefs(); }); });
      }, Promise.resolve()).catch(function () { toast('เปิดรูปบางรูปไม่ได้ ลองรูปอื่น'); });
    });
  });
  document.addEventListener('click', function (e) {
    var t = e.target;
    if (t && t.hasAttribute && t.hasAttribute('data-zoom')) { $('lbImg').src = t.src; $('lb').hidden = false; }
  });
  $('lbX').onclick = function () { $('lb').hidden = true; $('lbImg').src = ''; };
  $('lb').addEventListener('click', function (e) { if (e.target === $('lb')) $('lbX').onclick(); });

  // รูปของงานจากเซิร์ฟเวอร์ (fileId) เก็บในเครื่อง ช่างเปิดดูหน้างานได้แม้ไม่มีเน็ต
  var refLoading = {};
  function refImgs(j) {   // คืน Promise<[dataUrl|'']>
    if (j.localRefs && j.localRefs.length) return Promise.resolve(j.localRefs);
    if (j.refs && j.refs.length && /^data:/.test(j.refs[0])) return Promise.resolve(j.refs);   // งานที่ยังรอส่ง
    return Promise.all((j.refs || []).map(function (id) {
      return Store.get('repair.ref:' + id).then(function (d) { return d || fetchRef(id); }, function () { return fetchRef(id); });
    }));
  }
  function fetchRef(id) {
    if (!navigator.onLine || !Api.pin()) return Promise.resolve('');
    if (!refLoading[id]) refLoading[id] = call('repair.jobPhoto', { id: id }, 60000).then(function (r) {
      return Store.set('repair.ref:' + id, r.data).then(function () { return r.data; });
    }).catch(function () { delete refLoading[id]; return ''; });
    return refLoading[id];
  }
  function fillRefs(box, j, cb) {
    refImgs(j).then(function (L) { box.innerHTML = L.map(function (d, i) { return refHtml(d, i, false); }).join(''); if (cb) cb(); });
  }
  function prefetchRefs() { myJobs().forEach(function (j) { (j.refs || []).forEach(function (id) { if (!/^data:/.test(id)) Store.get('repair.ref:' + id).then(function (d) { if (!d) fetchRef(id); }); }); }); }

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
      type: m.type, eq: m.eq, desc: m.desc, pb: $('pb').value.trim(), refs: REFS.slice()
    };
  }
  function noRefs(o) { var c = Object.assign({}, o); delete c.refs; delete c.apw; return c; }
  function lineText(r, links) {
    var d = r.date.split('-');
    return ['[แจ้งซ่อม] ' + r.id].concat(r.jobId ? ['งาน: ' + r.jobId] : [], ['ช่าง: ' + r.tech, 'วันที่: ' + d[2] + '/' + d[1] + '/' + d[0] + '  เวลา ' + r.t1 + ' - ' + r.t2,
      'Downtime: ' + r.hr + ' ชม. (' + r.mins + ' นาที)', '', 'เครื่อง: ' + r.eq, r.desc, 'Model ' + r.model + (r.sn ? ' | S/N ' + r.sn : ''), '',
      'ปัญหาที่ได้รับแจ้ง: ' + r.pb].concat(r.almTxt ? ['Alarm: ' + r.almTxt] : [], ['Sector: ' + r.sec, 'Cause: ' + r.cause, 'Reason: ' + r.reason, 'Solution: ' + r.sol]))
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
      item.apw = Session.adminPw();          // เก็บรหัส admin ไว้กับงานในเครื่องนี้ — ส่งได้แม้เปลี่ยนผู้ใช้เป็นช่างก่อนมีเน็ต
      remember({ submitId: item.submitId, id: item.jobId, eq: item.eq, at: item.at, text: assignText(item), hasPhoto: !!(item.refs && item.refs.length), sent: false, rec: noRefs(item) });
      msg = 'จ่ายงานให้ ' + item.tech + ' แล้ว';
    } else {
      item = collect();
      queueAlarm(item);
      remember({ submitId: item.submitId, id: item.id, eq: item.eq, at: item.sub, text: lineText(item, {}), hasPhoto: !!(item.p1 || item.p2), sent: false, rec: slim(item), links: {} });
      msg = MODE === 'close' ? 'ปิดงาน ' + item.jobId + ' แล้ว' : 'บันทึกแล้ว';
    }
    $('go').disabled = true;
    OUTBOX.push(item);
    Store.set('repair.outbox', OUTBOX).then(function () {
      $('go').disabled = false;
      toast(msg + (navigator.onLine ? ' กำลังส่ง…' : ' — เก็บในเครื่อง จะส่งเมื่อมีเน็ต'));
      LAST_ASSIGN = item.kind === 'assign' ? item : null;
      resetForm(); paint();
      if (item.kind === 'assign') show('jobs'); else { SHARE = item.submitId; show('share'); }
      sync();
    }, function (e) { OUTBOX.pop(); $('go').disabled = false; toast('บันทึกในเครื่องไม่ได้: ' + e.message); });
  });
  function resetForm() {
    ['pb', 'cause', 'reason', 'sol', 'secOther', 't1', 't2'].forEach(function (i) { $(i).value = ''; });
    ['x1', 'x2'].forEach(function (i) { if (!$(i).hidden) $(i).click(); });
    REFS = []; paintRefs();
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
    // หลังกดจ่ายงาน: แจ้งผล + ปุ่มจ่ายงานหัวข้อใหม่ (ไม่ต้องกลับไปเมนู)
    $('bNewJob').hidden = !isAdmin();
    $('assignOk').hidden = !(isAdmin() && LAST_ASSIGN);
    if (isAdmin() && LAST_ASSIGN) {
      $('assignOkTxt').textContent = '✓ จ่ายงาน ' + LAST_ASSIGN.jobId + ' (' + LAST_ASSIGN.eq + ') ให้ ' + LAST_ASSIGN.tech + ' แล้ว';
      $('bAgainSame').textContent = 'จ่ายงานให้ ' + LAST_ASSIGN.tech + ' อีก';
    }
    $('jobsNote').textContent = isAdmin() ? 'งานที่จ่ายแล้วยังไม่ปิดของทุกคน · admin ยกเลิกงานที่จ่ายผิดได้ (ต้องมีเน็ต)'
      : 'งานที่ admin จ่ายให้ ' + USER + ' · กด "ปิดงาน" เพื่อกรอกผลการตรวจและแก้ไข';
    if (!L.length) { $('jobs').innerHTML = '<div class="empty">ไม่มีงานรอปิด</div>'; return; }
    $('jobs').innerHTML = L.map(function (j, i) {
      return '<div class="job"><div class="top"><b>' + esc(j.jobId) + ' · ' + esc(j.eq) + '</b>' +
        '<span class="st">' + (j.queued ? 'รอส่งจากเครื่องนี้' : 'รอปิด') + '</span></div>' +
        (j.queued ? '<div class="meta">งานนี้ยังไม่ขึ้นระบบ — ช่างจะกดปิดงานได้หลังส่งสำเร็จ' + (j.apw || isAdmin() ? '' : ' (ต้องเข้าเป็น admin ในเครื่องนี้เพื่อส่ง)') + '</div>' : '') +
        '<div class="meta">' + esc(j.desc || '') + '</div>' +
        '<div class="meta">มอบหมายให้ <b>' + esc(j.tech) + '</b> · ' + esc(j.date) + (j.t1 ? ' ' + esc(j.t1) : '') + '</div>' +
        '<div class="pb">' + esc(j.pb) + '</div>' +
        ((j.refs && j.refs.length) || (j.localRefs && j.localRefs.length) ? '<div class="refs" data-refs="' + i + '"></div>' : '') +
        '<div class="acts">' +
        (j.queued ? '' : '<button type="button" class="btn pri" data-close="' + i + '">ปิดงาน</button>') +
        (isAdmin() && !j.queued ? '<button type="button" class="btn ghost" data-cancel="' + i + '">ยกเลิกงาน</button>' : '') +
        '</div></div>';
    }).join('');
    $('jobs').querySelectorAll('[data-refs]').forEach(function (b) { fillRefs(b, L[b.dataset.refs]); });
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
  /* ตัวกรอง: วันที่ (ดึงจากเซิร์ฟเวอร์ตามช่วง) / Machine type / หมายเลขเครื่อง (กรองในเครื่อง) */
  function addDays(n) { var d = new Date(); d.setDate(d.getDate() - n); return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
  function rangeKey() { return ($('fFrom').value || '') + '~' + ($('fTo').value || ''); }
  function loadAll(force) {
    if (ALL_LOADING) return;
    var key = rangeKey();
    if (!navigator.onLine) { ALL_ERR = ALL_RANGE && ALL_RANGE !== key ? 'ออฟไลน์ — ข้อมูลในเครื่องเป็นช่วง ' + ALL_RANGE.replace('~', ' ถึง ') : 'ออฟไลน์ — แสดงข้อมูลที่โหลดไว้ล่าสุด'; if (VIEW === 'list') renderList(); return; }
    if (!force && ALL_AT && ALL_RANGE === key && Date.now() - ALL_AT.t < 60000) return;
    ALL_LOADING = true; if (VIEW === 'list') renderList();
    call('repair.list', { from: $('fFrom').value, to: $('fTo').value, limit: 2000 }, 90000).then(function (rows) {
      ALL = (rows || []).map(fromServer); ALL_AT = { t: Date.now(), s: stamp().d + ' ' + stamp().hm }; ALL_ERR = ''; ALL_RANGE = key;
      Store.set('repair.all', { rows: ALL, at: ALL_AT, range: key }).catch(function () {});
    }, function (er) {
      ALL_ERR = /action|ไม่รู้จัก|unknown/i.test(er.message || '') ? 'เซิร์ฟเวอร์ยังไม่รองรับการดูทุกใบ (repair.list) — วาง RepairJobPhoto.gs ตัวล่าสุดแล้ว New version'
        : 'โหลดใบทั้งหมดไม่ได้: ' + er.message;
    }).then(function () { ALL_LOADING = false; if (VIEW === 'list') renderList(); if (VIEW === 'detail') renderDetail(); });
  }
  function listItems() {
    var seen = {}, out = [];
    SENT.forEach(function (s) { if (!s.sent) { out.push(s); seen[s.submitId] = 1; seen[s.id] = 1; } });   // รอส่งจากเครื่องนี้ ขึ้นก่อน
    ALL.forEach(function (s) { if (!seen[s.submitId] && !seen[s.id]) { out.push(s); seen[s.submitId] = 1; seen[s.id] = 1; } });
    SENT.forEach(function (s) { if (!seen[s.submitId] && !seen[s.id]) out.push(s); });                     // จ่ายงาน / ใบที่ยังไม่อยู่ในรายการเซิร์ฟเวอร์
    return out;
  }
  function fillFilters(L) {
    var t = $('fType'), e = $('fEq'), tv = t.value, ev = e.value;
    var types = uniq(L.map(function (s) { return (s.rec || {}).type; }).concat(M ? M.machines.map(function (m) { return m.type; }) : [])).sort();
    t.innerHTML = opt('', 'ทั้งหมด') + types.map(function (x) { return opt(x); }).join(''); t.value = types.indexOf(tv) >= 0 ? tv : '';
    var eqs = uniq(L.filter(function (s) { return !t.value || (s.rec || {}).type === t.value; }).map(function (s) { return s.eq; })
      .concat(M ? M.machines.filter(function (m) { return !t.value || m.type === t.value; }).map(function (m) { return m.eq; }) : [])).sort();
    e.innerHTML = opt('', 'ทั้งหมด') + eqs.map(function (x) { return opt(x); }).join(''); e.value = eqs.indexOf(ev) >= 0 ? ev : '';
  }
  function paintRangeChips() {
    var f = $('fFrom').value, t = $('fTo').value;
    document.querySelectorAll('[data-range]').forEach(function (b) { b.setAttribute('aria-pressed', String(t === today() && f === addDays(+b.dataset.range))); });
  }
  function saveFilters() { ls('rep_f', JSON.stringify({ from: $('fFrom').value, to: $('fTo').value, type: $('fType').value, eq: $('fEq').value })); }
  (function initFilters() {
    var f = {}; try { f = JSON.parse(ls('rep_f') || '{}'); } catch (_) {}
    $('fFrom').value = f.from != null ? f.from : addDays(30); $('fTo').value = f.to != null ? f.to : '';
    $('fType').innerHTML = opt(f.type || '', f.type || 'ทั้งหมด'); $('fEq').innerHTML = opt(f.eq || '', f.eq || 'ทั้งหมด');
    var dt;
    ['fFrom', 'fTo'].forEach(function (id) { $(id).addEventListener('change', function () { saveFilters(); renderList(); clearTimeout(dt); dt = setTimeout(function () { loadAll(true); }, 400); }); });
    $('fType').addEventListener('change', function () { $('fEq').value = ''; saveFilters(); renderList(); });
    $('fEq').addEventListener('change', function () { saveFilters(); renderList(); });
    document.querySelectorAll('[data-range]').forEach(function (b) { b.onclick = function () { $('fFrom').value = addDays(+b.dataset.range); $('fTo').value = ''; saveFilters(); renderList(); loadAll(true); }; });
    $('fClear').onclick = function () { $('fFrom').value = addDays(30); $('fTo').value = ''; $('fType').value = ''; $('fEq').value = ''; $('q').value = ''; saveFilters(); renderList(); loadAll(true); };
  })();
  function itemDate(s) { var r = s.rec || {}; return r.date || String(s.at || '').slice(0, 10); }
  function renderList() {
    var box = $('list');
    $('listNote').textContent = 'ใบแจ้งซ่อมทุกใบของทุกคน · แตะที่ใบเพื่อดูรายละเอียดและแชร์ข้อความ LINE';
    $('admStat').textContent = ALL_LOADING ? 'กำลังโหลดใบแจ้งซ่อม…' : ALL_ERR ? ALL_ERR : ALL_AT ? 'อัปเดตล่าสุด ' + ALL_AT.s : '';
    var q = ($('q').value || '').trim().toLowerCase(), L = listItems();
    fillFilters(L); paintRangeChips();
    var fr = $('fFrom').value, to = $('fTo').value, ty = $('fType').value, eq = $('fEq').value;
    var F = L.filter(function (s) {
      var r = s.rec || {}, d = itemDate(s);
      if (fr && d && d < fr) return false;
      if (to && d && d > to) return false;
      if (ty && r.type !== ty) return false;
      if (eq && s.eq !== eq) return false;
      return !q || [s.id, s.eq, r.tech, r.desc, r.pb, r.date, r.sec, r.cause, r.jobId].join(' ').toLowerCase().indexOf(q) >= 0;
    });
    $('fCount').textContent = F.length + ' ใบ';
    if (!L.length) { box.innerHTML = '<div class="empty">' + (ALL_LOADING ? 'กำลังโหลด…' : 'ยังไม่มีใบแจ้งซ่อมในช่วงนี้') + '</div>'; return; }
    if (!F.length) { box.innerHTML = '<div class="empty">' + (ALL_LOADING ? 'กำลังโหลด…' : 'ไม่พบใบที่ตรงกับตัวกรอง') + '</div>'; return; }
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
    if (PENDING_R) {                       // เปิดจาก Machine Manual: repair.html#r=<Report ID>
      var hit = listItems().filter(function (x) { return x.id === PENDING_R; })[0];
      if (hit) { PENDING_R = ''; DETAIL = hit.submitId; try { history.replaceState(null, '', location.pathname); } catch (_) {} show('detail'); }
      else if (!ALL_LOADING) { $('admStat').textContent = 'ไม่พบใบ ' + PENDING_R + ' ในช่วงวันที่ที่เลือก — ขยายช่วงวันที่แล้วลองใหม่'; PENDING_R = ''; }
    }
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
        val('ปัญหาที่ได้รับแจ้ง', r.pb) + (function () {
          var al = almOf(r); if (!al) return '';
          return '<a class="almlink" href="manual.html?eq=' + encodeURIComponent(r.eq) + '&log=' + encodeURIComponent(al.log.log_id || '') + '">&#128214; Alarm: <b>' + esc(al.txt) + '</b>' +
            (al.log.log_id ? ' <span class="note">(' + esc(al.log.log_id) + ')</span>' : ' <span class="note">(รอส่ง)</span>') + '</a>';
        })() + '</section>';
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
  function sync(manual, tries) {
    syncMan();
    if (syncing || !OUTBOX.length || !navigator.onLine || !Api.ready() || !Api.pin()) return;
    tries = tries || 0;
    if (tries >= OUTBOX.length) return;                 // ลองครบทุกรายการแล้วในรอบนี้
    syncing = true;
    var r = OUTBOX[0], assign = r.kind === 'assign';
    var send = Object.assign({}, r); delete send.apw;
    var req = assign ? call('repair.assign', { adminPw: r.apw || Session.adminPw(), payload: send }, 60000)
                     : call('repair.submit', { payload: send }, 120000);
    req.then(function (res) {
      OUTBOX = OUTBOX.filter(function (x) { return x.submitId !== r.submitId; });
      return Store.set('repair.outbox', OUTBOX).then(function () {
        return assign
          ? remember({ submitId: r.submitId, id: r.jobId, eq: r.eq, at: r.at, text: assignText(r), hasPhoto: !!(r.refs && r.refs.length), sent: true, rec: noRefs(r) })
          : remember({ submitId: r.submitId, id: r.id, eq: r.eq, at: r.sub, text: lineText(r, res.links || {}), hasPhoto: !!(r.p1 || r.p2), sent: true, rec: slim(r), links: res.links || {} });
      }).then(function () {
        if (assign && !JOBS.some(function (j) { return j.jobId === r.jobId; })) JOBS.push({ jobId: r.jobId, at: r.at, by: r.by, tech: r.tech, date: r.date, t1: r.t1, type: r.type, eq: r.eq, desc: r.desc, pb: r.pb, localRefs: r.refs || [] });
        if (!assign && r.jobId) JOBS = JOBS.filter(function (j) { return j.jobId !== r.jobId; });
        if (!assign) { ALL_AT = ''; if (VIEW === 'list' || VIEW === 'detail') setTimeout(function () { loadAll(true); }, 0); }
        Store.set('repair.jobs', JOBS);
        syncing = false; paint(); if (VIEW === 'list') renderList(); if (VIEW === 'detail') renderDetail(); if (VIEW === 'jobs') renderJobs(); if (VIEW === 'share') renderShare();
        var id = assign ? r.jobId : r.id;
        toast(res.duplicate ? id + ' ส่งไปแล้วก่อนหน้า' : assign ? 'ส่งงาน ' + id + ' ให้ ' + r.tech + ' แล้ว' : 'ส่ง ' + id + ' เข้า Drive แล้ว');
        if (OUTBOX.length) sync();
      });
    }, function (er) {
      syncing = false; paint();
      if (er.code === 'ADMIN') toast('ส่งงานที่จ่าย ' + r.jobId + ' ไม่ได้: ต้องเข้าเป็น admin ในเครื่องนี้ 1 ครั้งเพื่อส่ง');
      else if (manual || er.code !== 'OFFLINE') toast('ยังส่งไม่ได้: ' + er.message);
      // รายการนี้ส่งไม่ได้ (ไม่ใช่เพราะไม่มีเน็ต) -> ย้ายไปท้ายคิว ให้รายการอื่นส่งต่อได้
      if (er.code !== 'OFFLINE' && OUTBOX.length > 1) {
        OUTBOX.push(OUTBOX.shift()); Store.set('repair.outbox', OUTBOX);
        sync(manual, tries + 1);
      }
    });
  }

  /* ---------- หน้าแชร์หลังกดส่ง ---------- */
  function copyText(t, ta) {
    (navigator.clipboard ? navigator.clipboard.writeText(t) : Promise.reject()).then(function () { toast('คัดลอกแล้ว วางใน LINE ได้เลย'); },
      function () { ta.focus(); ta.select(); try { document.execCommand('copy'); toast('คัดลอกแล้ว วางใน LINE ได้เลย'); } catch (_) { toast('กดค้างที่ข้อความแล้วเลือกคัดลอก'); } });
  }
  function renderShare() {
    var s = SENT.filter(function (x) { return x.submitId === SHARE; })[0];
    if (!s) { show('list'); return; }
    var r = s.rec || {}, hasPic = r.hasP1 || r.hasP2;
    $('shStat').innerHTML = '<b>' + esc(s.id) + '</b> — ' + (s.sent ? 'ส่งเข้าระบบแล้ว' : navigator.onLine ? 'กำลังส่งเข้าระบบ…' : 'เก็บในเครื่องแล้ว จะส่งเองเมื่อมีเน็ต');
    $('shNote').textContent = hasPic && !s.sent ? 'ลิงก์รูปจะขึ้นในข้อความหลังส่งเข้าระบบเสร็จ — ถ้าต้องการลิงก์รูป รอสักครู่ก่อนแชร์' : 'กดแชร์ไป LINE หรือคัดลอกไปวางในกลุ่ม';
    var ta = $('shText'); ta.value = s.text; ta.style.height = 'auto'; ta.style.height = (ta.scrollHeight + 4) + 'px';
    $('shShare').hidden = !navigator.share;
    $('shShare').onclick = function () { navigator.share({ text: s.text }).catch(function () {}); };
    $('shCopy').onclick = function () { copyText(s.text, ta); };
    $('shDetail').onclick = function () { DETAIL = s.submitId; show('detail'); };
  }
  $('shNew').onclick = function () { openForm('new'); };

  /* ---------- views ---------- */
  $('bNewJob').onclick = function () { LAST_ASSIGN = null; openForm('assign'); };
  $('bAgain').onclick = function () { LAST_ASSIGN = null; openForm('assign'); };
  $('bAgainSame').onclick = function () { var t = LAST_ASSIGN && LAST_ASSIGN.tech; LAST_ASSIGN = null; openForm('assign', null, t); };

  function show(v) {
    if (v !== 'jobs') LAST_ASSIGN = null;
    VIEW = v;
    $('v-menu').hidden = v !== 'menu';
    $('frm').hidden = v !== 'form'; $('v-list').hidden = v !== 'list'; $('v-jobs').hidden = v !== 'jobs'; $('v-detail').hidden = v !== 'detail'; $('v-share').hidden = v !== 'share';
    if (v === 'list') { renderList(); loadAll(); }
    if (v === 'detail') renderDetail();
    if (v === 'share') renderShare();
    if (v === 'jobs') { renderJobs(); refreshJobs(); }
    paint();
    window.scrollTo(0, 0);
  }

  boot();
})();
