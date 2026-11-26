/* Machine Manual — v1 offline
 * เลือก Machine type > Model > เครื่อง → แท็บ Alarm code / Cycle step / I/O / เอกสาร / Alarm log
 * ข้อมูลทุกตารางมาจาก "Machine Manual DB" (action manual.init) เก็บในเครื่องที่ 'manual.db' ไว้ดูตอน offline
 * บันทึก alarm → คิว 'manual.outbox' แล้วส่ง manual.log เมื่อมีเน็ต (submit_id กันส่งซ้ำ)
 */
(function () {
  'use strict';
  var $ = function (id) { return document.getElementById(id); };
  var esc = function (s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); };
  if (!Session.require()) return;

  var DB = null, OUTBOX = [], SEL = {}, TAB = 'alarm', ALARM = '', STEP_UNIT = '', IO_UNIT = '', IO_TYPE = '', VIEW = 'pick', syncing = false;
  function ls(k, v) { try { if (v === undefined) return localStorage.getItem(k); localStorage.setItem(k, v); } catch (_) { return null; } }
  try { SEL = JSON.parse(ls('man_sel') || '{}') || {}; } catch (_) { SEL = {}; }
  TAB = ls('man_tab') || 'alarm';
  var FRESH = false, URLQ = null; try { URLQ = new URLSearchParams(location.search); } catch (_) {}
  // เปิดจากใบแจ้งซ่อม: manual.html?eq=<Equipment No.>&log=<log_id>
  function applyUrl() {
    if (!URLQ || !DB) return;
    var eq = URLQ.get('eq'), mc = eq && T('machine').filter(function (m) { return m.machine_no === eq; })[0];
    if (!mc && !FRESH) return;                                  // รอข้อมูลล่าสุดจากเซิร์ฟเวอร์ก่อน (เครื่องที่เพิ่งเพิ่มจากใบแจ้งซ่อม)
    if (mc) { var md = byId('model', 'model_id', mc.model_id); SEL = { type: md ? md.type_id : '', model: mc.model_id, machine: mc.machine_id }; saveSel(); }
    if (URLQ.get('log')) TAB = 'log';
    URLQ = null; try { history.replaceState(null, '', location.pathname); } catch (_) {}
  }

  /* ---------- เน็ต / PIN / toast ---------- */
  function paint() {
    var on = navigator.onLine;
    $('net').textContent = on ? 'ออนไลน์' : 'ออฟไลน์'; $('net').classList.toggle('off', !on);
    $('pending').hidden = !OUTBOX.length; $('pending').textContent = 'รอส่ง ' + OUTBOX.length;
    $('bSync').hidden = !OUTBOX.length || !on;
    $('asof').textContent = DB && DB.at ? 'ข้อมูล ' + DB.at : '';
  }
  window.addEventListener('online', function () { paint(); sync(); load(); });
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
  function pad(n) { return (n < 10 ? '0' : '') + n; }

  /* ---------- ข้อมูล ---------- */
  function T(name) { return (DB && DB[name]) || []; }
  function byId(name, key, id) { return T(name).filter(function (r) { return r[key] === id; })[0]; }
  function curType() { return byId('machine_type', 'type_id', SEL.type); }
  function curModel() { return byId('model', 'model_id', SEL.model); }
  function curMachine() { return byId('machine', 'machine_id', SEL.machine); }
  function ofModel(name) { return T(name).filter(function (r) { return r.model_id === SEL.model; }); }
  function units() {
    var m = curModel(), u = String((m && m.units_per_machine) || '').match(/No\.\s?\d+/gi);
    return u ? u.map(function (x) { return x.replace(/\s/g, ''); }) : [];
  }
  function machLabel(mc) { return mc ? (mc.machine_no || mc.machine_id) + (mc.location ? ' · ' + mc.location : '') : ''; }
  function alarmLabel(a) { return a ? (a.code && a.code !== '-' ? 'Code ' + a.code + ' ' : '') + a.screen_text : ''; }
  function ioById(id) { return byId('io_point', 'io_id', id); }
  function stepById(id) { return byId('cycle_step', 'step_id', id); }
  function saveSel() { ls('man_sel', JSON.stringify(SEL)); }

  /* ---------- เลือก type > model > เครื่อง ---------- */
  function show(v) {
    VIEW = v;
    ['pick', 'machine', 'form'].forEach(function (k) { $('v-' + k).hidden = k !== v; });
    $('mTabs').hidden = v !== 'machine';
    $('hTitle').textContent = v === 'pick' ? 'Machine Manual' : (curModel() ? curModel().model : 'Machine Manual') + (v === 'form' ? ' · บันทึก alarm' : '');
    window.scrollTo(0, 0);
  }
  function renderPick() {
    var types = T('machine_type'), crumbs = [], items = [];
    if (!types.length) { $('pickList').innerHTML = '<div class="empty">ยังไม่มีข้อมูลเครื่อง</div>'; show('pick'); return; }
    if (!SEL.type && types.length === 1) SEL.type = types[0].type_id;
    if (SEL.type && !SEL.model) { var ms = T('model').filter(function (m) { return m.type_id === SEL.type; }); if (ms.length === 1) SEL.model = ms[0].model_id; }
    if (SEL.model && !SEL.machine) { var mcs = T('machine').filter(function (m) { return m.model_id === SEL.model; }); if (mcs.length === 1) SEL.machine = mcs[0].machine_id; }
    if (SEL.machine && curMachine()) { saveSel(); return openMachine(); }
    crumbs.push('<button type="button" data-cr="root">ทุกประเภท</button>');
    if (!SEL.type || !curType()) {
      SEL = {};
      items = types.map(function (t) {
        var n = T('model').filter(function (m) { return m.type_id === t.type_id; }).length;
        return { k: 'type', id: t.type_id, b: t.type_name_th || t.type_name, s: (t.type_name_th ? t.type_name + ' · ' : '') + n + ' รุ่น' };
      });
    } else if (!SEL.model || !curModel()) {
      crumbs.push('<span>›</span><b>' + esc(curType().type_name_th || curType().type_name) + '</b>');
      items = T('model').filter(function (m) { return m.type_id === SEL.type; }).map(function (m) {
        var n = T('machine').filter(function (x) { return x.model_id === m.model_id; }).length;
        return { k: 'model', id: m.model_id, b: m.model, s: [m.description, m.maker, n + ' เครื่อง'].filter(Boolean).join(' · ') };
      });
    } else {
      crumbs.push('<span>›</span><button type="button" data-cr="type">' + esc(curType().type_name_th || curType().type_name) + '</button><span>›</span><b>' + esc(curModel().model) + '</b>');
      items = T('machine').filter(function (m) { return m.model_id === SEL.model; }).map(function (m) {
        return { k: 'machine', id: m.machine_id, b: machLabel(m), s: [m.status, m.note].filter(Boolean).join(' · ') };
      });
    }
    saveSel();
    $('crumbs').innerHTML = crumbs.join('');
    $('pickList').innerHTML = items.length ? items.map(function (it) {
      return '<button type="button" class="tile" data-k="' + it.k + '" data-id="' + esc(it.id) + '"><b>' + esc(it.b) + '</b><small class="sub">' + esc(it.s) + '</small></button>';
    }).join('') : '<div class="empty">ไม่มีรายการ</div>';
    $('pickList').querySelectorAll('[data-k]').forEach(function (b) {
      b.onclick = function () { SEL[b.dataset.k] = b.dataset.id; renderPick(); };
    });
    $('crumbs').querySelectorAll('[data-cr]').forEach(function (b) {
      b.onclick = function () { if (b.dataset.cr === 'root') SEL = {}; else SEL = { type: SEL.type }; SEL.noAuto = 1; renderPickNoAuto(); };
    });
    show('pick');
  }
  // กดย้อนจาก crumbs: ไม่ข้ามระดับที่มีตัวเลือกเดียวอัตโนมัติ
  function renderPickNoAuto() {
    var t = SEL.type;
    var types = T('machine_type');
    var crumbs = ['<button type="button" data-cr="root">ทุกประเภท</button>'], items;
    if (!t) {
      items = types.map(function (x) { return { k: 'type', id: x.type_id, b: x.type_name_th || x.type_name, s: x.type_name }; });
    } else {
      crumbs.push('<span>›</span><b>' + esc(curType().type_name_th || curType().type_name) + '</b>');
      items = T('model').filter(function (m) { return m.type_id === t; }).map(function (m) { return { k: 'model', id: m.model_id, b: m.model, s: m.description || '' }; });
    }
    $('crumbs').innerHTML = crumbs.join('');
    $('pickList').innerHTML = items.map(function (it) {
      return '<button type="button" class="tile" data-k="' + it.k + '" data-id="' + esc(it.id) + '"><b>' + esc(it.b) + '</b><small class="sub">' + esc(it.s) + '</small></button>';
    }).join('');
    $('pickList').querySelectorAll('[data-k]').forEach(function (b) {
      b.onclick = function () {
        if (b.dataset.k === 'type') { SEL = { type: b.dataset.id }; renderPickNoAuto(); return; }
        SEL = { type: SEL.type, model: b.dataset.id };
        var mcs = T('machine').filter(function (m) { return m.model_id === SEL.model; });
        if (mcs.length === 1) { SEL.machine = mcs[0].machine_id; saveSel(); openMachine(); } else renderPick();
      };
    });
    $('crumbs').querySelectorAll('[data-cr]').forEach(function (b) { b.onclick = function () { SEL = {}; renderPickNoAuto(); }; });
    show('pick');
  }

  /* ---------- หน้าเครื่อง ---------- */
  function openMachine() {
    var m = curModel(), mc = curMachine(), u = units();
    if (!STEP_UNIT || u.indexOf(STEP_UNIT) < 0) STEP_UNIT = u[0] || '';
    $('mHead').innerHTML = '<button type="button" class="chg" id="bChg">เปลี่ยนเครื่อง</button><b>' + esc(m.model) + '</b> · ' + esc(machLabel(mc)) +
      '<div class="mu">' + esc([m.description, m.maker ? 'ผู้ผลิต ' + m.maker : '', m.plc ? 'PLC ' + m.plc : '', m.hmi ? 'HMI ' + m.hmi : '', u.length ? u.join(' / ') : ''].filter(Boolean).join(' · ')) + '</div>';
    $('bChg').onclick = function () { SEL = { type: SEL.type, noAuto: 1 }; saveSel(); renderPickNoAuto(); };
    show('machine'); tab(TAB);
  }
  function tab(t) {
    TAB = t; ls('man_tab', t);
    document.querySelectorAll('#mTabs button').forEach(function (b) { b.setAttribute('aria-selected', String(b.dataset.tab === t)); });
    ['alarm', 'step', 'io', 'doc', 'log'].forEach(function (k) { $('t-' + k).hidden = k !== t; });
    ({ alarm: renderAlarms, step: renderSteps, io: renderIos, doc: renderDocs, log: renderLogs })[t]();
  }
  document.querySelectorAll('#mTabs button').forEach(function (b) { b.onclick = function () { tab(b.dataset.tab); window.scrollTo(0, 0); }; });

  function logsOfMachine() {
    var local = OUTBOX.filter(function (r) { return r.machine_id === SEL.machine; }).map(function (r) { return Object.assign({ _wait: true }, r); });
    return local.concat(T('alarm_log').filter(function (r) { return r.machine_id === SEL.machine; }));
  }

  /* Alarm code */
  function renderAlarms() {
    var al = ofModel('alarm_code').slice().sort(function (a, b) { return (+a.sort || 999) - (+b.sort || 999); });
    var cnt = {}; logsOfMachine().forEach(function (r) { cnt[r.alarm_id] = (cnt[r.alarm_id] || 0) + 1; });
    $('codes').innerHTML = al.length ? al.map(function (a) {
      return '<button type="button" data-a="' + esc(a.alarm_id) + '" aria-pressed="' + (a.alarm_id === ALARM) + '" aria-label="' + esc(alarmLabel(a)) + '">' +
        esc(a.code && a.code !== '-' ? a.code : '!') + '<small>' + esc(a.screen_text) + '</small>' + (cnt[a.alarm_id] ? '<span class="cnt">' + cnt[a.alarm_id] + ' ครั้ง</span>' : '') + '</button>';
    }).join('') : '<div class="empty">ยังไม่มี alarm code ของรุ่นนี้</div>';
    $('codes').querySelectorAll('[data-a]').forEach(function (b) {
      b.onclick = function () { ALARM = ALARM === b.dataset.a ? '' : b.dataset.a; renderAlarms(); if (ALARM) $('alarmDetail').scrollIntoView({ behavior: 'smooth', block: 'start' }); };
    });
    renderAlarmDetail();
  }
  function para(title, txt, cls) {
    if (!String(txt || '').trim()) return '';
    var t = String(txt), parts = t.split(/\s(?=\d\)\s)/);
    var body = parts.length > 1 ? '<ol>' + parts.map(function (x) { return '<li>' + esc(x.replace(/^\d\)\s*/, '')) + '</li>'; }).join('') + '</ol>' : '<p>' + esc(t) + '</p>';
    return '<div class="blk' + (cls ? ' ' + cls : '') + '"><h3>' + esc(title) + '</h3>' + body + '</div>';
  }
  function renderAlarmDetail() {
    var a = byId('alarm_code', 'alarm_id', ALARM);
    if (!a) { $('alarmDetail').innerHTML = ''; return; }
    var ios = T('alarm_io').filter(function (r) { return r.alarm_id === a.alarm_id; });
    var hasStep = ios.some(function (r) { return /cycle_step|MR\d/i.test(r.device + ' ' + r.note); });
    var ioHtml = ios.length ? '<div class="blk"><h3>I/O และ device ที่ต้องดู</h3><div class="iotbl">' + ios.map(function (r) {
      var p = r.io_id ? ioById(r.io_id) : null;
      return '<div class="ior"><span class="ad">' + esc(r.device) + '</span><span class="nm">' + esc(r.unit) +
        (p ? ' · <b>' + esc(p.symbol) + '</b> ' + esc(p.name_th) : r.ref_type === 'PLC' ? ' · PLC device' : '') + '</span>' +
        ((p && p.normal_state) || r.note ? '<span class="sm">' + esc([p && p.normal_state ? 'ปกติ: ' + p.normal_state : '', r.note].filter(Boolean).join(' · ')) + '</span>' : '') + '</div>';
    }).join('') + '</div>' + (hasStep ? '<button type="button" class="btn sm" id="goStep" style="margin-top:8px">เปิด Cycle step</button>' : '') + '</div>' : '';
    var cp = ofModel('common_procedure').filter(function (p) { return !p.applies_to || /ทุก|all/i.test(p.applies_to) || p.applies_to.indexOf(a.alarm_id) >= 0 || p.applies_to.indexOf(a.code) >= 0; })
      .sort(function (x, y) { return (+x.seq || 0) - (+y.seq || 0); });
    var n = logsOfMachine().filter(function (r) { return r.alarm_id === a.alarm_id; }).length;
    $('alarmDetail').innerHTML = '<section class="card adet"><h2>' + esc(alarmLabel(a)) + '</h2>' +
      '<div class="scr">' + esc(a.screen_text) + '</div>' + (a.alarm_screen ? '<p class="note">หน้าจอ: ' + esc(a.alarm_screen) + '</p>' : '') +
      para('ผลกับเครื่อง', a.effect) + para('สาเหตุที่เป็นไปได้', a.cause) + para('จุดที่ต้องตรวจ', a.check_points) +
      ioHtml + para('วิธี reset', a.reset_procedure, 'reset') + para('ถ้าเกิดซ้ำ', a.if_recurring, 'warn') +
      (cp.length ? '<div class="blk"><h3>หลังแก้ alarm ทุกครั้ง</h3><ol>' + cp.map(function (p) { return '<li>' + esc(p.step_th) + (p.ref_section ? ' <span class="note">(' + esc(p.ref_section) + ')</span>' : '') + '</li>'; }).join('') + '</ol></div>' : '') +
      (a.ref_section ? '<p class="note">อ้างอิง: ' + esc(a.ref_section) + '</p>' : '') +
      '<div class="acts"><button type="button" class="btn pri" id="bLogThis">บันทึก alarm นี้</button>' +
      (n ? '<button type="button" class="btn ghost" id="bSeeLog">ประวัติ ' + n + ' ครั้ง</button>' : '') + '</div></section>';
    if ($('goStep')) $('goStep').onclick = function () { tab('step'); window.scrollTo(0, 0); };
    $('bLogThis').onclick = function () { openForm(a.alarm_id); };
    if ($('bSeeLog')) $('bSeeLog').onclick = function () { LOG_FILTER = a.alarm_id; tab('log'); window.scrollTo(0, 0); };
  }

  /* Cycle step */
  function unitSeg(box, cur, all, onPick) {
    var opts = (all ? [['', 'ทั้งหมด']] : []).concat(units().map(function (u) { return [u, u]; }));
    if (opts.length < 2) { box.innerHTML = ''; return; }
    box.innerHTML = opts.map(function (o) { return '<button type="button" role="radio" aria-checked="' + (o[0] === cur) + '" data-u="' + esc(o[0]) + '">' + esc(o[1]) + '</button>'; }).join('');
    box.querySelectorAll('[data-u]').forEach(function (b) { b.onclick = function () { onPick(b.dataset.u); }; });
  }
  function stepMr(s, u) { var i = units().indexOf(u); return i === 1 ? s.mr_no2 : s.mr_no1; }
  function stepSensor(s, u) { var i = units().indexOf(u); return i === 1 ? s.sensor_no2 : s.sensor_no1; }
  function renderSteps() {
    unitSeg($('stepUnit'), STEP_UNIT, false, function (u) { STEP_UNIT = u; renderSteps(); });
    var q = ($('sq').value || '').trim().toLowerCase(), last = '';
    var rows = ofModel('cycle_step').filter(function (s) {
      return !q || [s.step_th, s.plc_comment_jp, s.mr_no1, s.mr_no2, s.output_to_check, s.sensor_no1, s.sensor_no2, s.process].join(' ').toLowerCase().indexOf(q) >= 0;
    });
    $('steps').innerHTML = rows.length ? rows.map(function (s) {
      var hd = s.process !== last ? '<h3 class="subh">' + esc(s.process) + '</h3>' : ''; last = s.process;
      var sen = stepSensor(s, STEP_UNIT);
      return hd + '<div class="step"><div class="hd"><span class="sq">' + esc(s.seq) + '.</span><b>' + esc(s.step_th) + '</b><span class="mr">' + esc(stepMr(s, STEP_UNIT)) + '</span></div>' +
        '<div class="jp">' + esc(s.plc_comment_jp) + '</div><div class="kv2">' +
        (s.output_to_check ? '<span>Output</span><b>' + esc(s.output_to_check) + '</b>' : '') + (sen ? '<span>Sensor</span><b>' + esc(sen) + '</b>' : '') + '</div></div>';
    }).join('') : '<div class="empty">ไม่พบ step</div>';
  }
  $('sq').addEventListener('input', renderSteps);

  /* I/O */
  function renderIos() {
    unitSeg($('ioUnit'), IO_UNIT, true, function (u) { IO_UNIT = u; renderIos(); });
    var types = []; ofModel('io_point').forEach(function (r) { if (r.io_type && types.indexOf(r.io_type) < 0) types.push(r.io_type); });
    var tb = $('ioType'); tb.innerHTML = [['', 'ทุกชนิด']].concat(types.map(function (t) { return [t, t]; })).map(function (o) {
      return '<button type="button" role="radio" aria-checked="' + (o[0] === IO_TYPE) + '" data-t="' + esc(o[0]) + '">' + esc(o[1]) + '</button>';
    }).join('');
    tb.querySelectorAll('[data-t]').forEach(function (b) { b.onclick = function () { IO_TYPE = b.dataset.t; renderIos(); }; });
    var q = ($('iq').value || '').trim().toLowerCase();
    var rows = ofModel('io_point').filter(function (r) {
      if (IO_UNIT && r.unit && r.unit.indexOf(IO_UNIT) < 0) return false;
      if (IO_TYPE && r.io_type !== IO_TYPE) return false;
      return !q || [r.address, r.symbol, r.name_th, r.plc_comment_jp, r.io_id].join(' ').toLowerCase().indexOf(q) >= 0;
    });
    $('ios').innerHTML = '<p class="note">' + rows.length + ' จุด</p><div class="iotbl">' + rows.slice(0, 300).map(function (r) {
      return '<div class="ior"><span class="ad">' + esc(r.address) + '</span><span class="nm"><b>' + esc(r.symbol) + '</b> ' + esc(r.name_th) + '</span>' +
        '<span class="sm">' + esc([r.unit, r.io_type, r.normal_state, r.plc_comment_jp].filter(Boolean).join(' · ')) + '</span></div>';
    }).join('') + '</div>';
  }
  $('iq').addEventListener('input', renderIos);

  /* เอกสาร */
  function renderDocs() {
    var rows = ofModel('document');
    $('docs').innerHTML = rows.length ? rows.map(function (d) {
      var url = /^https:\/\//.test(d.drive_url || '') ? d.drive_url : '';
      return (url ? '<a class="doc" href="' + esc(url) + '" target="_blank" rel="noopener">' : '<div class="doc">') +
        '<b>' + esc(d.title || d.file_name) + '</b><div class="mu">' + esc([d.doc_type, d.format, d.language, d.pages_or_version].filter(Boolean).join(' · ')) + '</div>' +
        (d.used_for ? '<div class="mu">ใช้ดู: ' + esc(d.used_for) + '</div>' : '') +
        (url ? '<span class="lk">เปิดไฟล์ใน Drive ↗</span></a>' : '<div class="mu">ยังไม่มีลิงก์ไฟล์ (' + esc(d.file_name) + ')</div></div>');
    }).join('') : '<div class="empty">ยังไม่มีเอกสาร</div>';
  }

  /* Alarm log */
  var LOG_FILTER = '';
  function renderLogs() {
    var rows = logsOfMachine().filter(function (r) { return !LOG_FILTER || r.alarm_id === LOG_FILTER; });
    var cnt = {}; logsOfMachine().forEach(function (r) { cnt[r.alarm_id] = (cnt[r.alarm_id] || 0) + 1; });
    var top = Object.keys(cnt).sort(function (a, b) { return cnt[b] - cnt[a]; });
    $('logStat').innerHTML = (LOG_FILTER ? '<button type="button" class="chipb" id="bLogAll">แสดงทุก alarm</button>' : '') +
      top.slice(0, 5).map(function (id) { var a = byId('alarm_code', 'alarm_id', id); return '<span>' + esc(a ? alarmLabel(a) : id) + ' · ' + cnt[id] + ' ครั้ง</span>'; }).join('');
    if ($('bLogAll')) $('bLogAll').onclick = function () { LOG_FILTER = ''; renderLogs(); };
    $('logs').innerHTML = rows.length ? rows.map(function (r) {
      var a = byId('alarm_code', 'alarm_id', r.alarm_id), st = r.stalled_step_id ? stepById(r.stalled_step_id) : null, io = r.faulty_io_id ? ioById(r.faulty_io_id) : null;
      var miss = a && /TIME-OVER/i.test(a.screen_text) && !st && !io;
      return '<div class="lg' + (r._wait ? ' wait' : '') + '"><div class="hd"><b>' + esc(a ? alarmLabel(a) : r.alarm_id) + '</b><span class="mu">' + esc(r.date) + ' ' + esc(r.time || '') + (r.unit ? ' · ' + esc(r.unit) : '') + (r._wait ? ' · รอส่ง' : '') + '</span></div>' +
        (st ? '<div>Step ที่ค้าง: ' + esc(st.seq + '. ' + st.step_th) + ' <span class="mu">(' + esc(st.process) + ')</span></div>' : '') +
        (io ? '<div>Sensor: <b>' + esc(io.symbol) + '</b> ' + esc(io.name_th) + ' <span class="mu">' + esc(io.address) + '</span></div>' : '') +
        (r.cause ? '<div>สาเหตุ: ' + esc(r.cause) + '</div>' : '') + (r.action ? '<div>แก้ไข: ' + esc(r.action) + '</div>' : '') +
        (miss ? '<div class="miss">ไม่ได้บันทึก step / sensor ที่ค้าง</div>' : '') +
        (r.repair_id ? '<a class="rlink" href="repair.html#r=' + encodeURIComponent(r.repair_id) + '">ใบแจ้งซ่อม ' + esc(r.repair_id) + ' ↗</a>' : '') +
        '<div class="mu">' + esc([r.recorded_by, r.note, r.log_id].filter(Boolean).join(' · ')) + '</div></div>';
    }).join('') : '<div class="empty">ยังไม่มีบันทึก alarm ของเครื่องนี้</div>';
  }
  $('bNewLog').onclick = function () { openForm(LOG_FILTER || ''); };

  /* ---------- ฟอร์มบันทึก ---------- */
  function opt(v, t) { return '<option value="' + esc(v) + '">' + esc(t == null ? v : t) + '</option>'; }
  function fillStepIo() {
    var u = $('lUnit').value;
    var last = '';
    $('lStep').innerHTML = opt('', '— ไม่ระบุ —') + ofModel('cycle_step').map(function (s) {
      var g = s.process !== last ? (last ? '</optgroup>' : '') + '<optgroup label="' + esc(s.process) + '">' : ''; last = s.process;
      return g + opt(s.step_id, s.seq + '. ' + s.step_th + ' (' + (stepMr(s, u) || '') + ')');
    }).join('') + (last ? '</optgroup>' : '');
    $('lIo').innerHTML = opt('', '— ไม่ระบุ —') + ofModel('io_point').filter(function (r) { return !u || !r.unit || r.unit.indexOf(u) >= 0; }).map(function (r) {
      return opt(r.io_id, r.symbol + ' – ' + r.name_th + ' (' + r.address + ')');
    }).join('');
  }
  function openForm(alarmId) {
    var u = units(), d = new Date();
    $('lUnit').innerHTML = u.length ? u.map(function (x) { return opt(x); }).join('') : opt('', '-');
    if (u.indexOf(STEP_UNIT) >= 0) $('lUnit').value = STEP_UNIT;
    $('lAlarm').innerHTML = opt('', '— เลือก alarm —') + ofModel('alarm_code').map(function (a) { return opt(a.alarm_id, alarmLabel(a)); }).join('');
    $('lAlarm').value = alarmId || '';
    $('lDate').value = d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
    $('lTime').value = pad(d.getHours()) + ':' + pad(d.getMinutes()) + ':' + pad(d.getSeconds());
    ['lCause', 'lAction', 'lNote'].forEach(function (k) { $(k).value = ''; });
    $('lWho').textContent = Session.user();
    var eqNo = (curMachine() || {}).machine_no;
    $('bLogRepair').disabled = !eqNo;
    $('repNote').textContent = eqNo ? 'กด "บันทึกพร้อมใบแจ้งซ่อม" = เปิดใบแจ้งซ่อมของ ' + eqNo + ' ที่กรอก alarm ไว้ให้ แล้วบันทึก alarm ตอนส่งใบ (เชื่อมเลขใบให้เอง)'
      : 'เครื่องนี้ยังไม่มีเลขเครื่อง (machine_no) ใน Machine Manual DB จึงเปิดใบแจ้งซ่อมจากที่นี่ไม่ได้ — EE เติม machine_no = Equipment No. ก่อน';
    fillStepIo();
    show('form');
  }
  $('lUnit').onchange = fillStepIo;
  $('bLogRepair').onclick = function () {
    if (!$('lAlarm').value) { toast('เลือก alarm code ก่อน'); $('lAlarm').focus(); return; }
    var q = new URLSearchParams({ new: '1', eq: curMachine().machine_no, alarm: $('lAlarm').value, unit: $('lUnit').value,
      step: $('lStep').value, io: $('lIo').value, cause: $('lCause').value.trim(), action: $('lAction').value.trim() });
    location.href = 'repair.html?' + q.toString();
  };
  $('bCancelLog').onclick = function () { show('machine'); tab(TAB); };
  $('bSaveLog').onclick = function () {
    if (!$('lAlarm').value) { toast('เลือก alarm code ก่อน'); $('lAlarm').focus(); return; }
    if (!$('lDate').value) { toast('ใส่วันที่'); return; }
    var r = { submit_id: 'mn' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8), machine_id: SEL.machine, unit: $('lUnit').value,
              date: $('lDate').value, time: $('lTime').value, alarm_id: $('lAlarm').value, stalled_step_id: $('lStep').value, faulty_io_id: $('lIo').value,
              cause: $('lCause').value.trim(), action: $('lAction').value.trim(), recorded_by: Session.user(), note: $('lNote').value.trim() };
    OUTBOX.push(r);
    Store.set('manual.outbox', OUTBOX).then(function () {
      paint(); LOG_FILTER = ''; show('machine'); tab('log');
      toast(navigator.onLine ? 'กำลังส่ง…' : 'เก็บไว้ในเครื่อง จะส่งเมื่อมีเน็ต');
      sync(true);
    });
  };

  function sync(manual) {
    if (syncing || !OUTBOX.length || !navigator.onLine || !Api.ready()) return;
    var go = function () {
      syncing = true; paint();
      var r = OUTBOX[0];
      call('manual.log', { payload: r }, 60000).then(function (res) {
        OUTBOX = OUTBOX.filter(function (x) { return x.submit_id !== r.submit_id; });
        if (DB && !res.duplicate) DB.alarm_log = [Object.assign({ log_id: res.log_id }, r)].concat(DB.alarm_log || []);
        return Promise.all([Store.set('manual.outbox', OUTBOX), DB ? Store.set('manual.db', DB) : null]).then(function () {
          syncing = false; paint(); toast('บันทึก ' + res.log_id + ' แล้ว');
          if (VIEW === 'machine') tab(TAB);
          if (OUTBOX.length) sync();
        });
      }, function (er) { syncing = false; paint(); if (manual || er.code !== 'OFFLINE') toast('ยังส่งไม่ได้: ' + er.message); });
    };
    if (!Api.pin()) askPin().then(go); else go();
  }

  /* ---------- โหลด ---------- */
  function render() {
    $('loading').hidden = true;
    if (!DB) { $('err').hidden = false; $('err').textContent = navigator.onLine ? 'โหลดข้อมูลคู่มือไม่ได้' : 'ยังไม่มีข้อมูลในเครื่อง — เปิดหน้านี้ตอนมีเน็ตอย่างน้อย 1 ครั้ง'; return; }
    $('err').hidden = true; paint();
    if (VIEW === 'form') return;
    applyUrl();
    if (SEL.machine && curMachine()) openMachine(); else if (SEL.noAuto) renderPickNoAuto(); else renderPick();
  }
  function load() {
    if (!navigator.onLine || !Api.ready()) return;
    var go = function () {
      call('manual.init', {}, 60000).then(function (d) {
        DB = d; FRESH = true; Store.set('manual.db', d).catch(function () {}); render();
      }, function (er) {
        if (!DB) { $('loading').hidden = true; $('err').hidden = false; $('err').textContent = 'โหลดข้อมูลคู่มือไม่ได้: ' + er.message; }
        else toast('อัปเดตข้อมูลไม่ได้: ' + er.message);
      });
    };
    if (!Api.pin()) askPin().then(go); else go();
  }
  Promise.all([Store.get('manual.db'), Store.get('manual.outbox')]).then(function (r) {
    DB = r[0] || null; OUTBOX = r[1] || [];
    if (DB) render(); else if (!navigator.onLine) render();
    paint(); load(); sync();
  }, function () { load(); });
})();
