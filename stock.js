/* นับ stock part — v1 offline
 * ข้อมูล part / ยอดเดือนก่อน เก็บไว้ในเครื่อง (Store 'stock.init') ใช้ได้ตอนไม่มีเน็ต
 * ผลนับเข้าคิวในเครื่อง (Store 'stock.outbox') แล้วส่งเองเมื่อมีเน็ต — ส่งซ้ำไม่บันทึกซ้ำ (submitId)
 */
(function () {
  'use strict';
  var $ = function (id) { return document.getElementById(id); };
  var D = null;                       // ข้อมูลจาก stock.init
  var OUTBOX = [];                    // [{submitId, countedAt, name, items:[{line,part,qty,note}]}]
  var LINE = 'SU1', CLS = 'Normal', R_LINE = 'ALL', R_CLS = 'ALL';
  var ENTRY = {};                     // "SU1|P001" -> {qty, note}
  var PHOTOS = {}, PHOTO_REQ = {};
  var RV = null, syncing = false;

  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function ls(k, v) { try { if (v === undefined) return localStorage.getItem(k) || ''; localStorage.setItem(k, v); } catch (_) { return ''; } }
  function uniq(a) { var o = []; a.forEach(function (x) { if (x && o.indexOf(x) < 0) o.push(x); }); return o; }
  function lineName(code) { var l = ((D && D.lines) || []).filter(function (x) { return x.code === code; })[0]; return l ? l.name : code; }
  function toast(t) { var el = document.createElement('div'); el.className = 'toast'; el.textContent = t; document.body.appendChild(el); setTimeout(function () { el.remove(); }, 2800); }
  function showErr(m) { var el = $('error'); el.hidden = !m; el.textContent = m || ''; }
  function nowStr() {
    var d = new Date(), p = function (n) { return String(n).padStart(2, '0'); };
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + ' ' + p(d.getHours()) + ':' + p(d.getMinutes()) + ':' + p(d.getSeconds());
  }
  function newId() { return 'M' + Date.now().toString(36).toUpperCase() + Math.random().toString(36).slice(2, 6).toUpperCase(); }

  /* ---------- สถานะเน็ต / คิว ---------- */
  function paintStatus() {
    var on = navigator.onLine;
    $('net').textContent = on ? 'ออนไลน์' : 'ออฟไลน์';
    $('net').className = 'pill' + (on ? '' : ' off');
    var n = OUTBOX.reduce(function (a, b) { return a + b.items.length; }, 0);
    $('pending').hidden = !n;
    $('pending').textContent = 'รอส่ง ' + n + ' รายการ';
    $('bSync').hidden = !n || !on;
    $('asof').textContent = D && D._at ? 'ข้อมูล ณ ' + D._at.slice(5, 16) : '';
  }
  window.addEventListener('online', function () { paintStatus(); sync(); refresh(); });
  window.addEventListener('offline', paintStatus);
  $('bSync').onclick = function () { sync(true); };

  /* ---------- PIN ---------- */
  function askPin(msg) {
    return new Promise(function (resolve) {
      $('pinWrap').hidden = false; $('pinErr').textContent = msg || ''; $('pinIn').value = ''; $('pinIn').focus();
      $('pinForm').onsubmit = function (e) {
        e.preventDefault();
        var p = $('pinIn').value.trim(); if (!p) return;
        Api.setPin(p); $('pinOk').disabled = true;
        Api.call('ping').then(function () { $('pinWrap').hidden = true; $('pinOk').disabled = false; resolve(); },
          function (er) { $('pinOk').disabled = false; if (er.code === 'PIN') { Api.clearPin(); $('pinErr').textContent = er.message; } else { $('pinWrap').hidden = true; resolve(); } });
      };
    });
  }
  function call(action, params, t) {
    return Api.call(action, params, t).catch(function (er) {
      if (er.code === 'PIN') { Api.clearPin(); return askPin(er.message).then(function () { return Api.call(action, params, t); }); }
      throw er;
    });
  }

  /* ---------- โหลดข้อมูล ---------- */
  function boot() {
    $('name').value = ls('stockName');
    $('name').addEventListener('change', function () { ls('stockName', this.value.trim()); });
    LINE = ls('stockLine') || 'SU1'; CLS = ls('stockCls') || 'Normal';
    Promise.all([Store.get('stock.init'), Store.get('stock.outbox'), Store.get('stock.photos')]).then(function (r) {
      OUTBOX = r[1] || []; PHOTOS = r[2] || {};
      if (r[0]) use(r[0]);
      paintStatus();
      var go = function () { refresh(); sync(); };
      if (!Api.ready()) { if (!D) { $('loading').hidden = true; showErr('ยังไม่ได้ตั้งลิงก์ API (config.js)'); } return; }
      if (!Api.pin() && navigator.onLine) askPin().then(go); else go();
      if (!D && !navigator.onLine) { $('loading').hidden = true; showErr('ยังไม่มีข้อมูลในเครื่อง — เปิดหน้านี้ตอนมีเน็ตอย่างน้อย 1 ครั้ง'); }
    });
    setInterval(function () { if (navigator.onLine) sync(); }, 60000);
  }
  function refresh() {
    if (!navigator.onLine || !Api.ready()) return;
    call('stock.init').then(function (d) {
      d._at = nowStr();
      Store.set('stock.init', d);
      use(d);
    }, function (er) { if (!D) { $('loading').hidden = true; showErr('โหลดข้อมูลไม่ได้: ' + er.message); } });
  }
  function use(d) {
    var first = !D; D = d; $('loading').hidden = true; showErr('');
    var classes = uniq(D.parts.map(function (p) { return p.cls; }));
    if (classes.indexOf(CLS) < 0) CLS = classes[0];
    buildChips('lineChips', D.lines.map(function (l) { return [l.code, l.name]; }), function () { return LINE; }, function (v) { LINE = v; ls('stockLine', v); renderList(); });
    buildChips('clsChips', classes.map(function (c) { return [c, c]; }), function () { return CLS; }, function (v) { CLS = v; ls('stockCls', v); renderList(); });
    paintStatus();
    if (first) show('count'); else if (!$('v-count').hidden) renderList();
  }
  function buildChips(id, opts, get, set) {
    var box = $(id); box.innerHTML = '';
    opts.forEach(function (o) {
      var b = document.createElement('button'); b.type = 'button'; b.className = 'chip'; b.dataset.v = o[0];
      b.textContent = o[1]; b.setAttribute('aria-pressed', String(get() === o[0]));
      b.onclick = function () { set(o[0]); [].forEach.call(box.children, function (c) { c.setAttribute('aria-pressed', String(c.dataset.v === get())); }); };
      box.appendChild(b);
    });
  }

  /* ---------- รายการนับ ---------- */
  function pendingFor(k) {
    var hit = null;
    OUTBOX.forEach(function (o) { o.items.forEach(function (it) { if (it.line + '|' + it.part === k) hit = { qty: it.qty, at: o.countedAt }; }); });
    return hit;
  }
  function visibleParts() {
    var q = $('q').value.trim().toLowerCase();
    return D.parts.filter(function (p) {
      if (p.lines.indexOf(LINE) < 0 || p.cls !== CLS) return false;
      return !q || (p.id + ' ' + p.name + ' ' + p.model + ' ' + p.desc + ' ' + p.brand).toLowerCase().indexOf(q) >= 0;
    });
  }
  function renderList() {
    var ps = visibleParts(), box = $('list'), done = 0;
    box.innerHTML = '';
    if (!ps.length) box.innerHTML = '<div class="empty">ไม่มี part ใน ' + esc(lineName(LINE)) + ' / ' + esc(CLS) + '</div>';
    ps.forEach(function (p) {
      var k = LINE + '|' + p.id, c = D.counts[k] || {}, e = ENTRY[k], pend = pendingFor(k);
      if (c.cur || pend) done++;
      var card = document.createElement('div');
      card.className = 'card' + (e && e.qty !== '' ? ' entered' : pend ? ' pending' : c.cur ? ' done' : '');
      var last = c.last ? '<div class="last">Last month stock: ' + esc(c.last.qty) + ' ' + esc(p.unit) + ' <span style="font-weight:400">(' + esc(c.last.month) + ')</span></div>'
                        : '<div class="last none">ยังไม่มียอดนับเดือนก่อน</div>';
      var cur = c.cur ? '<div class="cur">✓ เดือนนี้นับแล้ว ' + esc(c.cur.qty) + ' โดย ' + esc(c.cur.by) + ' · ' + esc(String(c.cur.at).slice(5, 16)) + '</div>' : '';
      var pd = pend ? '<div class="pend">⏳ รอส่ง ' + esc(pend.qty) + ' (นับ ' + esc(pend.at.slice(5, 16)) + ')</div>' : '';
      var src = p.photo && PHOTOS[p.photo];
      card.innerHTML =
        '<div class="pic" data-photo="' + esc(p.photo) + '">' + (src ? '<img alt="" src="' + src + '">' : (p.photo ? 'รูปยังไม่โหลด' : 'ไม่มีรูป')) + '</div>' +
        '<div><div class="nm">' + esc(p.name) + '</div><div class="md">' + esc([p.model, p.desc].filter(Boolean).join(' · ')) + '</div>' +
        '<div class="meta"><span class="tag">' + esc(p.id) + '</span>' + (p.brand ? '<span class="tag">' + esc(p.brand) + '</span>' : '') + (p.sect ? '<span class="tag">' + esc(p.sect) + '</span>' : '') + '</div>' +
        last + cur + pd + '</div>' +
        '<div class="qty"><input type="number" inputmode="numeric" min="0" step="1" placeholder="Confirm qty" aria-label="จำนวนที่นับ ' + esc(p.name) + '" value="' + esc(e ? e.qty : '') + '">' +
        '<button type="button" data-a="10">+10</button><button type="button" data-a="1">+1</button><button type="button" data-a="clear">Clear</button></div>' +
        '<div class="unit">หน่วย: ' + esc(p.unit || '-') + '</div>';
      var inp = card.querySelector('input');
      inp.addEventListener('input', function () { setEntry(k, inp.value); });
      card.querySelectorAll('.qty button').forEach(function (b) {
        b.onclick = function () {
          var a = b.dataset.a, v = inp.value === '' ? 0 : Number(inp.value) || 0;
          inp.value = a === 'clear' ? '' : String(v + Number(a));
          setEntry(k, inp.value);
          card.className = 'card' + (inp.value !== '' ? ' entered' : pend ? ' pending' : c.cur ? ' done' : '');
        };
      });
      box.appendChild(card);
    });
    $('countHint').textContent = lineName(LINE) + ' / ' + CLS + ' · ' + ps.length + ' รายการ · เดือนนี้ (' + D.month + ') นับแล้ว ' + done + ' รายการ';
    loadPhotos(ps);
    updateFooter();
  }
  function setEntry(k, v) {
    v = String(v).trim();
    if (v === '') delete ENTRY[k]; else { ENTRY[k] = ENTRY[k] || { note: '' }; ENTRY[k].qty = v; }
    updateFooter();
  }
  function updateFooter() {
    var n = Object.keys(ENTRY).length;
    $('fInfo').textContent = n ? ('กรอกแล้ว ' + n + ' รายการ') : 'ยังไม่ได้กรอก';
    $('bNext').disabled = !n;
    $('hNext').hidden = !n || $('v-count').hidden; $('hNext').textContent = 'Confirm (' + n + ')';
  }
  function loadPhotos(ps) {
    if (!navigator.onLine || !Api.pin()) return;
    var need = ps.map(function (p) { return p.photo; }).filter(function (id) { return id && !PHOTOS[id] && !PHOTO_REQ[id]; }).slice(0, 20);
    if (!need.length) return;
    need.forEach(function (id) { PHOTO_REQ[id] = 1; });
    call('stock.photos', { ids: need }).then(function (m) {
      Object.keys(m).forEach(function (id) {
        if (m[id]) PHOTOS[id] = m[id];
        document.querySelectorAll('.pic[data-photo="' + id + '"]').forEach(function (el) { el.innerHTML = m[id] ? '<img alt="" src="' + m[id] + '">' : 'ไม่มีรูป'; });
      });
      Store.set('stock.photos', PHOTOS);
    }, function () { need.forEach(function (id) { delete PHOTO_REQ[id]; }); });
  }
  $('q').addEventListener('input', renderList);
  $('bCancel').onclick = function () { if (Object.keys(ENTRY).length && confirm('ล้างยอดที่กรอกไว้ทั้งหมด?')) { ENTRY = {}; renderList(); } };

  /* ---------- ยืนยัน ---------- */
  $('bNext').onclick = function () {
    if (!$('name').value.trim()) { toast('กรอกชื่อผู้นับก่อน'); $('name').focus(); return; }
    var byId = {}; D.parts.forEach(function (p) { byId[p.id] = p; });
    var groups = {};
    Object.keys(ENTRY).forEach(function (k) { var l = k.split('|')[0]; (groups[l] = groups[l] || []).push(k); });
    var box = $('confList'); box.innerHTML = '';
    Object.keys(groups).sort().forEach(function (l) {
      var h = document.createElement('div'); h.className = 'gh'; h.textContent = lineName(l) + ' · ' + groups[l].length + ' รายการ'; box.appendChild(h);
      var wrap = document.createElement('div'); wrap.className = 'conf';
      groups[l].forEach(function (k) {
        var p = byId[k.split('|')[1]], e = ENTRY[k], c = D.counts[k] || {}, last = c.last ? Number(c.last.qty) : null, q = Number(e.qty);
        var diff = last === null || isNaN(last) ? '<span class="d eq">ใหม่</span>' :
          (q - last > 0 ? '<span class="d up">+' + (q - last) + '</span>' : (q - last < 0 ? '<span class="d down">' + (q - last) + '</span>' : '<span class="d eq">เท่าเดิม</span>'));
        var row = document.createElement('div'); row.className = 'crow';
        row.innerHTML = '<div><div class="n">' + esc(p.name) + '</div><div class="md">' + esc(p.id + ' · ' + (p.model || '')) + '</div></div>' +
          '<div class="v">' + (last === null ? '—' : esc(last)) + ' → <b>' + esc(e.qty) + '</b> ' + esc(p.unit) + '<br>' + diff + '</div>' +
          (c.cur || pendingFor(k) ? '<div class="md" style="grid-column:1/-1;color:var(--warn)">เดือนนี้มียอดนับแล้ว (จะแทนที่ด้วยยอดใหม่)</div>' : '') +
          '<input placeholder="หมายเหตุ (ถ้ามี)" value="' + esc(e.note) + '">';
        row.querySelector('input').oninput = function () { e.note = this.value; };
        wrap.appendChild(row);
      });
      box.appendChild(wrap);
    });
    show('confirm');
  };
  $('hNext').onclick = function () { $('bNext').click(); };
  $('bBack').onclick = function () { show('count'); };
  $('bSend').onclick = function () {
    var batch = {
      submitId: newId(), countedAt: nowStr(), name: $('name').value.trim(),
      items: Object.keys(ENTRY).map(function (k) { var s = k.split('|'); return { line: s[0], part: s[1], qty: ENTRY[k].qty, note: ENTRY[k].note || '' }; })
    };
    OUTBOX.push(batch);
    Store.set('stock.outbox', OUTBOX).then(function () {
      ENTRY = {};
      toast(navigator.onLine ? 'บันทึกแล้ว กำลังส่ง…' : 'บันทึกในเครื่องแล้ว จะส่งเมื่อมีเน็ต');
      show('count'); paintStatus(); sync();
    });
  };

  /* ---------- ส่งคิว ---------- */
  function sync(manual) {
    if (syncing || !OUTBOX.length || !navigator.onLine || !Api.ready() || !Api.pin()) return;
    syncing = true;
    var b = OUTBOX[0];
    call('stock.submit', { payload: b }, 60000).then(function (r) {
      OUTBOX = OUTBOX.filter(function (x) { return x.submitId !== b.submitId; });
      return Store.set('stock.outbox', OUTBOX).then(function () {
        syncing = false; paintStatus();
        toast(r.duplicate ? 'ชุดนี้ส่งไปแล้ว' : 'ส่งแล้ว ' + r.saved + ' รายการ');
        if (OUTBOX.length) sync(); else refresh();
      });
    }, function (er) {
      syncing = false; paintStatus();
      if (manual || er.code !== 'OFFLINE') toast('ยังส่งไม่ได้: ' + er.message);
    });
  }

  /* ---------- Review ---------- */
  function loadReview(month) {
    var key = 'stock.review:' + month;
    var paint = function (d, note) {
      RV = d; $('reviewNote').textContent = note || '';
      $('month').innerHTML = d.months.map(function (m) { return '<option' + (m === d.month ? ' selected' : '') + '>' + esc(m) + '</option>'; }).join('');
      buildChips('rLineChips', [['ALL', 'ทุก line']].concat(D.lines.map(function (l) { return [l.code, l.name]; })), function () { return R_LINE; }, function (v) { R_LINE = v; renderReview(); });
      buildChips('rClsChips', [['ALL', 'ทุก class']].concat(uniq(D.parts.map(function (p) { return p.cls; })).map(function (c) { return [c, c]; })), function () { return R_CLS; }, function (v) { R_CLS = v; renderReview(); });
      renderReview();
    };
    $('reviewTable').innerHTML = '<div class="empty">กำลังโหลด…</div>';
    Store.get(key).then(function (cached) {
      if (cached) paint(cached, 'ข้อมูล ณ ' + cached._at + (navigator.onLine ? ' (กำลังอัปเดต…)' : ' — ออฟไลน์'));
      if (!navigator.onLine) { if (!cached) $('reviewTable').innerHTML = '<div class="empty">ออฟไลน์ — ยังไม่มีข้อมูล Review ในเครื่อง</div>'; return; }
      call('stock.review', { month: month }).then(function (d) {
        d._at = nowStr(); Store.set(key, d); paint(d, '');
      }, function (er) { if (!cached) $('reviewTable').innerHTML = '<div class="empty">โหลดไม่ได้: ' + esc(er.message) + '</div>'; });
    });
  }
  $('month').onchange = function () { loadReview(this.value); };
  function renderReview() {
    var rows = [];
    RV.parts.forEach(function (p) {
      if (R_CLS !== 'ALL' && p.cls !== R_CLS) return;
      p.lines.forEach(function (l) { if (R_LINE !== 'ALL' && l !== R_LINE) return; var c = RV.counts[l + '|' + p.id] || {}; rows.push({ p: p, l: l, cur: c.cur, last: c.last }); });
    });
    var counted = rows.filter(function (r) { return r.cur; }), changed = counted.filter(function (r) { return r.last && Number(r.cur.qty) !== Number(r.last.qty); });
    $('kpis').innerHTML = '<div class="kpi"><b>' + counted.length + '/' + rows.length + '</b><span>นับแล้ว</span></div>' +
      '<div class="kpi"><b>' + (rows.length - counted.length) + '</b><span>ยังไม่นับ</span></div>' +
      '<div class="kpi"><b>' + changed.length + '</b><span>ยอดต่างจากเดือนก่อน</span></div>';
    rows.sort(function (a, b) { return (a.cur ? 0 : 1) - (b.cur ? 0 : 1) || a.l.localeCompare(b.l) || a.p.name.localeCompare(b.p.name); });
    if (!rows.length) { $('reviewTable').innerHTML = '<div class="empty">ไม่มีรายการ</div>'; return; }
    $('reviewTable').innerHTML = '<table><thead><tr><th>Part</th><th>Line</th><th class="r">เดือนก่อน</th><th class="r">เดือนนี้</th><th>ผู้นับ / สถานะ</th></tr></thead><tbody>' +
      rows.map(function (r) {
        var d = '';
        if (r.cur && r.last) { var x = Number(r.cur.qty) - Number(r.last.qty); d = x > 0 ? ' <span class="d up">+' + x + '</span>' : (x < 0 ? ' <span class="d down">' + x + '</span>' : ''); }
        return '<tr class="' + (r.cur ? '' : 'miss') + '"><td><b>' + esc(r.p.name) + '</b><div class="md">' + esc(r.p.id + ' · ' + (r.p.model || '')) + '</div>' + (r.cur && r.cur.note ? '<div class="md">📝 ' + esc(r.cur.note) + '</div>' : '') + '</td>' +
          '<td>' + esc(lineName(r.l)) + '</td><td class="r">' + (r.last ? esc(r.last.qty) : '—') + '</td>' +
          '<td class="r">' + (r.cur ? '<b>' + esc(r.cur.qty) + '</b>' + d : 'ยังไม่นับ') + '</td>' +
          '<td>' + (r.cur ? esc(r.cur.by) + '<br><span class="st">' + esc(r.cur.status || 'Submitted') + '</span>' : '') + '</td></tr>';
      }).join('') + '</tbody></table>';
  }

  /* ---------- views ---------- */
  function show(v) {
    $('v-count').hidden = v !== 'count'; $('v-confirm').hidden = v !== 'confirm'; $('v-review').hidden = v !== 'review';
    $('fCount').hidden = v !== 'count'; $('fConfirm').hidden = v !== 'confirm';
    $('t-count').setAttribute('aria-selected', String(v !== 'review'));
    $('t-review').setAttribute('aria-selected', String(v === 'review'));
    if (v === 'count') renderList(); else $('hNext').hidden = true;
    if (v === 'review') loadReview(D.month);
    window.scrollTo(0, 0);
  }
  $('t-count').onclick = function () { if (D) show('count'); };
  $('t-review').onclick = function () { if (D) show('review'); };

  boot();
})();
