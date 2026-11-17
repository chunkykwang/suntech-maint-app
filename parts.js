/* Stock part system — Part list (ทุกคน, ใช้ได้ตอนไม่มีเน็ต) / Part registration (admin, ต้องต่อเน็ตเพื่อบันทึก)
 * ข้อมูล: part.list (เก็บในเครื่อง 'parts.list'), part.reg (admin), รูป part ใช้ร่วมกับหน้านับ stock ('stock.photos')
 * ราคา / supplier มาเฉพาะ part.reg (admin) — Part list ไม่มีราคา
 */
(function () {
  'use strict';
  var $ = function (id) { return document.getElementById(id); };
  var D = null, R = null, PHOTOS = {}, PHOTO_REQ = {}, VIEW = 'home', MODE = 'wait';
  var F = null;                                   // ฟอร์ม: {part, req, data, photo}
  var PHOTO_MAX_KB = 60, CATS = ['0', 'Repair', 'TG', 'N/A'], CLSS = ['Normal', 'PSM'], PLANTS = ['SU1', 'SU2', 'SU3'];
  var ADMIN = Session.isAdmin();

  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function uniq(a) { var o = []; a.forEach(function (x) { if (x && o.indexOf(x) < 0) o.push(x); }); return o; }
  function toast(t) { var el = document.createElement('div'); el.className = 'toast'; el.textContent = t; document.body.appendChild(el); setTimeout(function () { el.remove(); }, 3000); }
  function showErr(m) { $('error').hidden = !m; $('error').textContent = m || ''; }
  function opt(v, t) { return '<option value="' + esc(v) + '">' + esc(t == null ? v : t) + '</option>'; }

  /* ---------- สถานะ / PIN ---------- */
  function paint() {
    var on = navigator.onLine;
    $('net').textContent = on ? 'ออนไลน์' : 'ออฟไลน์'; $('net').className = 'pill' + (on ? '' : ' off');
    $('asof').textContent = D && D.loadedAt ? 'ข้อมูล ' + D.loadedAt.slice(5) : '';
    $('whoName').textContent = ADMIN ? 'admin' : Session.user();
    $('tReg').classList.toggle('locked', !ADMIN);
    $('lockIco').hidden = ADMIN;
    $('regSub').textContent = ADMIN ? 'Wait approve · Incomplete data · แก้ข้อมูล part' : 'เฉพาะ admin';
    var w = R ? R.requests.length : 0;
    $('waitCnt').hidden = !ADMIN || !w; $('waitCnt').textContent = w;
  }
  window.addEventListener('online', function () { paint(); refreshList(); });
  window.addEventListener('offline', paint);

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
  function acall(a, p, t) { return call(a, Object.assign({ adminPw: Session.adminPw() }, p || {}), t); }

  /* ---------- โหลดข้อมูล ---------- */
  function boot() {
    Promise.all([Store.get('parts.list'), Store.get('stock.photos')]).then(function (r) {
      if (r[0]) D = r[0];
      PHOTOS = r[1] || {};
      paint();
      if (!Api.pin() && navigator.onLine) askPin().then(refreshList); else refreshList();
      if (ADMIN) refreshReg(true);
    });
  }
  function refreshList() {
    if (!navigator.onLine || !Api.ready()) { if (!D && VIEW === 'list') showErr('ยังไม่มีข้อมูลในเครื่อง — เปิดตอนมีเน็ตอย่างน้อย 1 ครั้ง'); return Promise.resolve(); }
    return call('part.list', {}, 60000).then(function (d) {
      D = d; Store.set('parts.list', d); showErr(''); paint();
      if (VIEW === 'list') renderList();
    }, function (er) { if (!D) showErr('โหลดรายการ part ไม่ได้: ' + er.message); });
  }
  function refreshReg(quiet) {
    if (!ADMIN) return Promise.resolve();
    if (!navigator.onLine) { if (!quiet) showErr('ต้องต่อเน็ตเพื่อเปิด Part registration'); return Promise.resolve(); }
    if (!quiet) { $('loading').hidden = false; }
    return acall('part.reg', {}, 60000).then(function (d) {
      R = d; $('loading').hidden = true; showErr(''); paint();
      if (VIEW === 'reg') renderReg();
    }, function (er) { $('loading').hidden = true; if (!quiet) showErr('โหลดข้อมูลไม่ได้: ' + er.message); });
  }

  /* ---------- รูป ---------- */
  function picHtml(p) {
    var src = p.photo && PHOTOS[p.photo];
    return '<div class="pic" data-photo="' + esc(p.photo) + '">' + (src ? '<img alt="" src="' + src + '">' : (p.photo ? 'รูปยังไม่โหลด' : 'ไม่มีรูป')) + '</div>';
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
      if (ps.length > need.length) loadPhotos(ps);
    }, function () { need.forEach(function (id) { delete PHOTO_REQ[id]; }); });
  }

  /* ---------- slicer ---------- */
  function typeLabel(L, t) { var m = (L.machines || []).filter(function (x) { return x.type === t; })[0]; return m ? m.label : t; }
  function modelLabel(m) { var a = m.split('|'); return a.length > 1 ? a[0] + ' ' + a[1] : m; }
  function fillSlicers(L, parts, g, t, m) {
    var keep = function (el, html) { var v = el.value; el.innerHTML = html; if ([].some.call(el.options, function (o) { return o.value === v; })) el.value = v; };
    var groups = uniq(parts.map(function (p) { return p.group; })).sort();
    keep($(g), opt('', 'ทั้งหมด') + groups.map(function (x) { return opt(x); }).join('') + opt('-', '(ยังไม่มี group)'));
    var types = uniq([].concat.apply([], parts.map(function (p) { return p.types; }))).sort();
    keep($(t), opt('', 'ทั้งหมด') + types.map(function (x) { return opt(x, typeLabel(L, x)); }).join(''));
    var tv = $(t).value;
    var models = uniq([].concat.apply([], parts.map(function (p) { return p.models; }))).filter(function (x) { return !tv || x.split('|')[0] === tv; }).sort();
    keep($(m), opt('', 'ทั้งหมด') + models.map(function (x) { return opt(x, modelLabel(x)); }).join(''));
  }
  function sliced(parts, q, g, t, m) {
    q = $(q).value.trim().toLowerCase(); g = $(g).value; t = $(t).value; m = $(m).value;
    return parts.filter(function (p) {
      if (g === '-' ? p.group : (g && p.group !== g)) return false;
      if (t && p.types.indexOf(t) < 0) return false;
      if (m && p.models.indexOf(m) < 0) return false;
      return !q || [p.id, p.name, p.model, p.desc, p.brand].join(' ').toLowerCase().indexOf(q) >= 0;
    });
  }
  function minTags(p) {
    return PLANTS.filter(function (pl) { return p['min' + pl] !== '' && p['min' + pl] != null; })
      .map(function (pl) { return '<span class="tag min">' + pl + ' min ' + esc(p['min' + pl]) + '</span>'; }).join('');
  }

  /* ---------- Part list ---------- */
  function renderList() {
    if (!D) { $('list').innerHTML = ''; return; }
    fillSlicers(D, D.parts, 'fGroup', 'fType', 'fModel');
    var ps = sliced(D.parts, 'q', 'fGroup', 'fType', 'fModel');
    $('listHint').textContent = ps.length + ' จาก ' + D.parts.length + ' รายการ';
    $('list').innerHTML = ps.length ? '' : '<div class="empty">ไม่พบ part</div>';
    ps.slice(0, 300).forEach(function (p) {
      var b = document.createElement('button'); b.type = 'button'; b.className = 'pcard';
      b.innerHTML = picHtml(p) + '<div><div class="nm">' + esc(p.name) + '</div><div class="md">' + esc([p.model, p.brand].filter(Boolean).join(' · ')) + '</div>' +
        '<div class="tags"><span class="tag">' + esc(p.id) + '</span>' + (p.group ? '<span class="tag g">' + esc(p.group) + '</span>' : '') +
        p.types.map(function (t) { return '<span class="tag">' + esc(typeLabel(D, t)) + '</span>'; }).join('') + minTags(p) + '</div></div>';
      b.onclick = function () { openDetail(p); };
      $('list').appendChild(b);
    });
    loadPhotos(ps.slice(0, 300));
  }
  ['q', 'fGroup', 'fType', 'fModel'].forEach(function (id) { $(id).addEventListener(id === 'q' ? 'input' : 'change', renderList); });

  function openDetail(p) {
    var src = p.photo && PHOTOS[p.photo];
    var row = function (k, v) { return v ? '<span>' + k + '</span><b>' + esc(v) + '</b>' : ''; };
    $('detailBox').innerHTML = (src ? '<img class="big" alt="" src="' + src + '">' : '') +
      '<h2 style="margin:10px 0 2px">' + esc(p.name) + '</h2><div class="mu">' + esc(p.id) + '</div>' +
      '<div class="kv">' + row('Model', p.model) + row('Description', p.desc) + row('Brand', p.brand) + row('Unit', p.unit) +
      row('Group', p.group) + row('Machine type', p.types.map(function (t) { return typeLabel(D, t); }).join(', ')) +
      row('Machine model', p.models.map(modelLabel).join(', ')) + row('Sector', p.sectors.join(', ')) +
      row('Min stock', PLANTS.filter(function (pl) { return p['min' + pl] !== ''; }).map(function (pl) { return pl + ': ' + p['min' + pl]; }).join(' · ')) +
      row('Stock class', p.cls) + row('Category', p.category) + '</div>' +
      (ADMIN ? '<button type="button" class="btn primary" id="dEdit">แก้ข้อมูล part</button> ' : '') +
      '<button type="button" class="btn" id="dClose">ปิด</button>';
    $('detail').hidden = false;
    $('dClose').onclick = function () { $('detail').hidden = true; };
    if ($('dEdit')) $('dEdit').onclick = function () {
      $('detail').hidden = true;
      var full = R && R.parts.filter(function (x) { return x.id === p.id; })[0];
      if (!full) { toast('กำลังโหลดข้อมูล admin…'); refreshReg().then(function () { var f = R && R.parts.filter(function (x) { return x.id === p.id; })[0]; if (f) openForm(f); }); return; }
      openForm(full);
    };
  }
  $('detail').addEventListener('click', function (e) { if (e.target === $('detail')) $('detail').hidden = true; });

  /* ---------- Part registration ---------- */
  function missing(p) {
    var m = [];
    if (!p.photo) m.push('รูป');
    if (!p.category || p.category === '0') m.push('Category');
    if (!p.group) m.push('Group');
    if (!p.types.length) m.push('Machine type');
    if (!p.models.length) m.push('Machine model');
    if (!p.sectors.length) m.push('Sector');
    if (!PLANTS.some(function (pl) { return p['min' + pl] !== ''; })) m.push('Min');
    return m;
  }
  function incParts() { return R.parts.filter(function (p) { return String(p.include).toUpperCase() === 'Y' && missing(p).length; }); }
  function partById(id) { return R.parts.filter(function (p) { return p.id === id; })[0]; }

  document.querySelectorAll('.seg button').forEach(function (b) {
    b.onclick = function () {
      MODE = b.dataset.mode;
      document.querySelectorAll('.seg button').forEach(function (x) { x.setAttribute('aria-selected', String(x === b)); });
      renderReg();
    };
  });
  ['rq', 'rGroup', 'rType', 'rModel'].forEach(function (id) { $(id).addEventListener(id === 'rq' ? 'input' : 'change', renderReg); });
  $('bRegReload').onclick = function () { refreshReg(); };

  function confTag(c) { c = String(c || '').toLowerCase(); return '<span class="tag ' + (c === 'high' ? 'hi' : c === 'medium' ? 'md' : 'lo') + '">' + esc(c ? c[0].toUpperCase() + c.slice(1) : '-') + '</span>'; }
  function sugRows(s) {
    var L = R, out = [];
    var add = function (k, v) { if (v !== undefined && v !== '' && !(Array.isArray(v) && !v.length)) out.push('<span>' + k + '</span><b>' + esc(Array.isArray(v) ? v.join(', ') : v) + '</b>'); };
    add('Group', s.group); add('Machine type', (s.types || []).map(function (t) { return typeLabel(L, t); }));
    add('Machine model', (s.models || []).map(modelLabel)); add('Sector', s.sectors); add('Brand', s.brand); add('Supplier', s.supplier); add('Category', s.category);
    return out.join('');
  }

  function renderReg() {
    if (!R) { $('regList').innerHTML = '<div class="empty">' + (navigator.onLine ? 'กำลังโหลด…' : 'ต้องต่อเน็ตเพื่อเปิด Part registration') + '</div>'; return; }
    var inc = incParts();
    $('nWait').textContent = '(' + R.requests.length + ')'; $('nInc').textContent = '(' + inc.length + ')';
    var base = MODE === 'wait' ? R.requests.map(function (q) { return partById(q.partId); }).filter(Boolean) : MODE === 'inc' ? inc : R.parts;
    fillSlicers(R, base, 'rGroup', 'rType', 'rModel');
    var ps = sliced(base, 'rq', 'rGroup', 'rType', 'rModel'), show = {};
    ps.forEach(function (p) { show[p.id] = 1; });
    var box = $('regList'); box.innerHTML = '';
    $('bulk').hidden = true;
    if (MODE === 'wait') {
      var reqs = R.requests.filter(function (q) { return show[q.partId]; });
      var hi = reqs.filter(function (q) { return String(q.confidence).toLowerCase() === 'high'; });
      $('bulk').hidden = !hi.length; $('bulkTxt').textContent = 'Confidence High ' + hi.length + ' จาก ' + reqs.length + ' รายการ';
      $('bApproveHigh').onclick = function () { approveHigh(hi); };
      $('regHint').textContent = reqs.length + ' รายการที่ระบบแนะนำ รอ admin ตัดสินใจ';
      if (!reqs.length) box.innerHTML = '<div class="empty">ไม่มีรายการรอ approve</div>';
      reqs.forEach(function (q) {
        var p = partById(q.partId), d = document.createElement('div'); d.className = 'req';
        d.innerHTML = '<div class="top"><b>' + esc(p.name) + ' <span class="mu">' + esc(p.id) + (p.model ? ' · ' + esc(p.model) : '') + '</span></b>' + confTag(q.confidence) + '</div>' +
          '<div class="why">' + esc(q.reason) + '</div><div class="sg">' + sugRows(q.suggested) + '</div>' +
          '<div class="acts"><button type="button" class="btn primary sm" data-a="ok">Approve</button><button type="button" class="btn sm" data-a="edit">แก้ก่อน</button><button type="button" class="btn sm" data-a="no">Reject</button></div>';
        d.querySelector('[data-a=ok]').onclick = function (e) { decide(q, 'approve', null, e.target); };
        d.querySelector('[data-a=no]').onclick = function (e) { if (confirm('Reject ข้อมูลแนะนำของ ' + p.id + '?')) decide(q, 'reject', null, e.target); };
        d.querySelector('[data-a=edit]').onclick = function () { openForm(p, q); };
        box.appendChild(d);
      });
      return;
    }
    $('regHint').textContent = MODE === 'inc' ? ps.length + ' part (ใช้ในแอป) ที่ข้อมูลยังไม่ครบ' : ps.length + ' จาก ' + R.parts.length + ' part · แตะเพื่อแก้';
    if (!ps.length) box.innerHTML = '<div class="empty">ไม่มีรายการ</div>';
    ps.slice(0, 300).forEach(function (p) {
      var b = document.createElement('button'); b.type = 'button'; b.className = 'pcard';
      var miss = missing(p);
      b.innerHTML = picHtml(p) + '<div><div class="nm">' + esc(p.name) + '</div><div class="md">' + esc([p.model, p.brand].filter(Boolean).join(' · ')) + '</div>' +
        '<div class="tags"><span class="tag">' + esc(p.id) + '</span>' + (String(p.include).toUpperCase() === 'Y' ? '' : '<span class="tag">ไม่ใช้ในแอป</span>') +
        (p.group ? '<span class="tag g">' + esc(p.group) + '</span>' : '') + minTags(p) +
        (MODE === 'inc' ? miss.map(function (m) { return '<span class="tag miss">ขาด ' + m + '</span>'; }).join('') : '') + '</div></div>';
      b.onclick = function () { openForm(p); };
      box.appendChild(b);
    });
    loadPhotos(ps.slice(0, 300));
  }

  function decide(q, decision, changes, btn) {
    if (!navigator.onLine) { toast('ต้องต่อเน็ตเพื่อบันทึก'); return Promise.resolve(); }
    if (btn) btn.disabled = true;
    return acall('part.decide', { reqId: q.reqId, decision: decision, changes: changes }, 60000).then(function (r) {
      toast(q.partId + ': ' + r.status);
      return refreshReg(true).then(function () { renderReg(); refreshList(); });
    }, function (er) { if (btn) btn.disabled = false; toast('บันทึกไม่ได้: ' + er.message); });
  }
  function approveHigh(list) {
    if (!navigator.onLine) { toast('ต้องต่อเน็ตเพื่อบันทึก'); return; }
    if (!confirm('Approve ' + list.length + ' รายการที่ Confidence High?')) return;
    $('bApproveHigh').disabled = true;
    acall('part.approveHigh', { reqIds: list.map(function (q) { return q.reqId; }) }, 120000).then(function (r) {
      $('bApproveHigh').disabled = false;
      toast('Approve แล้ว ' + r.approved.length + ' รายการ');
      refreshReg(true).then(function () { renderReg(); refreshList(); });
    }, function (er) { $('bApproveHigh').disabled = false; toast('บันทึกไม่ได้: ' + er.message); });
  }

  /* ---------- ฟอร์ม ---------- */
  var FIELDS = ['name', 'model', 'desc', 'brand', 'unit', 'price', 'supplier', 'category', 'cls', 'include', 'group', 'types', 'models', 'sectors', 'minSU1', 'minSU2', 'minSU3'];
  var INPUTS = { name: 'iName', model: 'iModel', desc: 'iDesc', brand: 'iBrand', unit: 'iUnit', price: 'iPrice', supplier: 'iSupplier' };
  function clone(o) { return JSON.parse(JSON.stringify(o)); }

  function openForm(p, req) {
    var data = {};
    FIELDS.forEach(function (k) { data[k] = clone(p[k] == null ? (/s$/.test(k) && k !== 'cls' ? [] : '') : p[k]); });
    var sug = req ? req.suggested || {} : {};
    Object.keys(sug).forEach(function (k) { if (k in data) data[k] = clone(sug[k]); });
    data.include = 'Y';                           // approve / บันทึกแล้ว = ขึ้นแอป (เลือก "ไม่ใช้" เองได้)
    F = { part: p, req: req || null, data: data, sug: sug, photo: null, kb: 0 };
    $('fTitle').textContent = (req ? 'ตรวจข้อมูลแนะนำ ' : 'แก้ข้อมูล ') + p.id;
    $('sugBox').hidden = !req;
    if (req) $('sugBox').innerHTML = '<b>ข้อมูลที่ระบบแนะนำ</b> ' + confTag(req.confidence) + '<br>' + esc(req.reason) + '<br><span class="mu">ช่องที่มีกรอบสีส้ม = ค่าที่แนะนำ แก้ได้ก่อนกดบันทึก</span>';
    $('bReject').hidden = !req;
    $('bSave').textContent = req ? 'Approve' : 'บันทึก';
    Object.keys(INPUTS).forEach(function (k) { $(INPUTS[k]).value = data[k] || ''; });
    var brands = uniq(R.parts.map(function (x) { return x.brand; })).filter(function (b) { return b && b !== '-'; }).sort();
    $('brandList').innerHTML = brands.map(function (b) { return opt(b); }).join('');
    $('unitList').innerHTML = uniq(R.parts.map(function (x) { return x.unit; })).sort().map(function (b) { return opt(b); }).join('');
    var src = p.photo && PHOTOS[p.photo];
    $('pv').innerHTML = src ? '<img alt="" src="' + src + '">' : (p.photo ? 'มีรูปแล้ว (ยังไม่โหลด)' : 'ไม่มีรูป');
    $('pvInfo').textContent = 'รูปจะย่อเหลือไม่เกิน ' + PHOTO_MAX_KB + ' KB ก่อนส่ง';
    $('pasteZone').hidden = true;
    renderFormChips();
    show('form');
  }

  function chipRow(box, items, isOn, onTap, sugKey) {
    var el = $(box); el.innerHTML = '';
    items.forEach(function (it) {
      var b = document.createElement('button'); b.type = 'button'; b.className = 'chip';
      var v = Array.isArray(it) ? it[0] : it, t = Array.isArray(it) ? it[1] : it;
      b.textContent = t; b.setAttribute('aria-pressed', String(isOn(v)));
      if (sugKey && F.sug[sugKey] !== undefined && [].concat(F.sug[sugKey]).indexOf(v) >= 0) b.classList.add('sug');
      b.onclick = function () { onTap(v); renderFormChips(); };
      el.appendChild(b);
    });
  }
  function toggle(arr, v) { var i = arr.indexOf(v); if (i >= 0) arr.splice(i, 1); else arr.push(v); }
  function renderFormChips() {
    var d = F.data, L = R;
    chipRow('cCat', CATS, function (v) { return d.category === v; }, function (v) { d.category = v; }, 'category');
    chipRow('cCls', CLSS, function (v) { return d.cls === v; }, function (v) { d.cls = d.cls === v ? '' : v; });
    chipRow('cInc', [['Y', 'ใช้'], ['N', 'ไม่ใช้']], function (v) { return String(d.include).toUpperCase() === v; }, function (v) { d.include = v; });
    chipRow('cGroup', L.groups, function (v) { return d.group === v; }, function (v) { d.group = d.group === v ? '' : v; }, 'group');
    chipRow('cType', L.machines.map(function (m) { return [m.type, m.label]; }), function (v) { return d.types.indexOf(v) >= 0; }, function (v) {
      toggle(d.types, v);
      if (d.types.indexOf(v) < 0) d.models = d.models.filter(function (m) { return m.split('|')[0] !== v; });
    }, 'types');
    var models = [];
    L.machines.forEach(function (m) { if (d.types.indexOf(m.type) >= 0) m.models.forEach(function (x) { models.push([m.type + '|' + x, m.type + ' ' + x]); }); });
    d.models.forEach(function (m) { if (!models.some(function (x) { return x[0] === m; })) models.push([m, modelLabel(m)]); });
    if (models.length) chipRow('cModel', models, function (v) { return d.models.indexOf(v) >= 0; }, function (v) { toggle(d.models, v); }, 'models');
    else $('cModel').innerHTML = '<span class="mu">' + (d.types.length ? 'type นี้ยังไม่มีรายการ model' : 'เลือก Machine type ก่อน') + '</span>';
    var secs = L.sectors.filter(function (s) { return !s.type || d.types.indexOf(s.type) >= 0; }).map(function (s) { return s.name; });
    d.sectors.forEach(function (s) { if (secs.indexOf(s) < 0) secs.push(s); });
    chipRow('cSector', uniq(secs), function (v) { return d.sectors.indexOf(v) >= 0; }, function (v) { toggle(d.sectors, v); }, 'sectors');
    $('newSectorType').innerHTML = opt('', 'ใช้ร่วมทุก type') + L.machines.map(function (m) { return opt(m.type, m.label); }).join('');
    if (d.types.length === 1) $('newSectorType').value = d.types[0];
    renderMins();
  }
  function renderMins() {
    var d = F.data, box = $('mins'); box.innerHTML = '';
    PLANTS.forEach(function (pl) {
      var k = 'min' + pl, on = d[k] !== '' && d[k] != null;
      var row = document.createElement('div'); row.className = 'minrow';
      row.innerHTML = '<b>' + pl + '</b><div class="chips"><button type="button" class="chip" data-on="1" aria-pressed="' + on + '">ใช้</button><button type="button" class="chip" data-on="0" aria-pressed="' + !on + '">ไม่ใช้</button></div>' +
        '<div class="step' + (on ? '' : ' off') + '"><button type="button" data-d="-1" aria-label="ลด">−</button><input inputmode="numeric" value="' + esc(on ? d[k] : '') + '" aria-label="Min ' + pl + '"><button type="button" data-d="1" aria-label="เพิ่ม">+</button></div>';
      var inp = row.querySelector('input');
      row.querySelectorAll('[data-on]').forEach(function (b) { b.onclick = function () { d[k] = b.dataset.on === '1' ? (on ? d[k] : '0') : ''; renderMins(); }; });
      row.querySelectorAll('[data-d]').forEach(function (b) { b.onclick = function () { d[k] = String(Math.max(0, (Number(d[k]) || 0) + Number(b.dataset.d))); inp.value = d[k]; }; });
      inp.addEventListener('input', function () { d[k] = inp.value.replace(/[^\d.]/g, '') || '0'; });
      box.appendChild(row);
    });
  }
  Object.keys(INPUTS).forEach(function (k) { $(INPUTS[k]).addEventListener('input', function () { if (F) F.data[k] = $(INPUTS[k]).value; }); });

  function addToList(kind) {
    var name = $(kind === 'group' ? 'newGroup' : 'newSector').value.trim();
    if (!name) return;
    if (!navigator.onLine) { toast('ต้องต่อเน็ตเพื่อเพิ่ม'); return; }
    var p = kind === 'group' ? acall('part.addGroup', { name: name }) : acall('part.addSector', { name: name, type: $('newSectorType').value });
    p.then(function (L) {
      R.groups = L.groups; R.sectors = L.sectors;
      if (kind === 'group') { F.data.group = name; $('newGroup').value = ''; } else { F.data.sectors.push(name); $('newSector').value = ''; }
      renderFormChips(); toast('เพิ่ม "' + name + '" แล้ว');
    }, function (er) { toast(er.message); });
  }
  $('bAddGroup').onclick = function () { addToList('group'); };
  $('bAddSector').onclick = function () { addToList('sector'); };

  /* ---- รูป: ย่อเป็น JPEG ไม่เกิน PHOTO_MAX_KB (ลด quality ก่อน แล้วค่อยลดขนาดภาพ) ---- */
  function kb(u) { return Math.round((u.length - u.indexOf(',') - 1) * 0.75 / 1024); }
  function compress(blob) {
    return new Promise(function (ok, no) {
      var img = new Image(), url = URL.createObjectURL(blob);
      img.onload = function () {
        URL.revokeObjectURL(url);
        var sides = [1600, 1280, 1024, 800, 640, 480], best = '';
        for (var i = 0; i < sides.length; i++) {
          var s = Math.min(1, sides[i] / Math.max(img.width, img.height)), c = document.createElement('canvas');
          c.width = Math.round(img.width * s); c.height = Math.round(img.height * s);
          var g = c.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height); g.drawImage(img, 0, 0, c.width, c.height);
          for (var q = 0.85; q >= 0.6; q -= 0.05) { var u = c.toDataURL('image/jpeg', q); best = u; if (kb(u) <= PHOTO_MAX_KB) return ok(u); }
          if (s < 1 && i === sides.length - 1) break;
        }
        ok(best);
      };
      img.onerror = function () { URL.revokeObjectURL(url); no(new Error('เปิดรูปไม่ได้')); };
      img.src = url;
    });
  }
  function usePhoto(blob) {
    if (!blob || !/^image\//.test(blob.type)) { toast('ไม่ใช่ไฟล์รูป'); return; }
    compress(blob).then(function (u) {
      F.photo = u; F.kb = kb(u);
      $('pv').innerHTML = '<img alt="" src="' + u + '"><span class="kb">' + F.kb + ' KB</span>';
      $('pasteZone').hidden = true;
    }, function (e) { toast(e.message); });
  }
  ['fCam', 'fGal'].forEach(function (id) { $(id).addEventListener('change', function () { var f = $(id).files[0]; $(id).value = ''; if (f) usePhoto(f); }); });
  $('bPaste').onclick = function () {
    if (navigator.clipboard && navigator.clipboard.read) {
      navigator.clipboard.read().then(function (items) {
        for (var i = 0; i < items.length; i++) {
          var t = items[i].types.filter(function (x) { return /^image\//.test(x); })[0];
          if (t) return items[i].getType(t).then(usePhoto);
        }
        toast('ใน clipboard ไม่มีรูป');
      }).catch(function () { $('pasteZone').hidden = false; $('pasteZone').focus(); });
    } else { $('pasteZone').hidden = false; $('pasteZone').focus(); }
  };
  document.addEventListener('paste', function (e) {
    if (VIEW !== 'form' || !F) return;
    var items = (e.clipboardData && e.clipboardData.items) || [];
    for (var i = 0; i < items.length; i++) if (/^image\//.test(items[i].type)) { e.preventDefault(); usePhoto(items[i].getAsFile()); return; }
    if (e.target === $('pasteZone')) { e.preventDefault(); toast('ใน clipboard ไม่มีรูป'); }
  });

  function changesOf() {
    var ch = {}, p = F.part;
    FIELDS.forEach(function (k) {
      var a = JSON.stringify(F.data[k] == null ? '' : F.data[k]), b = JSON.stringify(p[k] == null ? (Array.isArray(F.data[k]) ? [] : '') : p[k]);
      if (a !== b) ch[k] = F.data[k];
    });
    return ch;
  }
  $('bSave').onclick = function () {
    if (!navigator.onLine) { toast('ต้องต่อเน็ตเพื่อบันทึก'); return; }
    var ch = changesOf(), p = F.part, req = F.req;
    if (!Object.keys(ch).length && !F.photo && !req) { toast('ไม่มีอะไรเปลี่ยน'); return; }
    $('bSave').disabled = true; $('saveHint').textContent = 'กำลังบันทึก…';
    var step = F.photo ? acall('part.photo', { partId: p.id, data: F.photo }, 90000).then(function (r) { PHOTOS[r.photo] = F.photo; Store.set('stock.photos', PHOTOS); })
                       : Promise.resolve();
    step.then(function () {
      if (req) return acall('part.decide', { reqId: req.reqId, decision: 'approve', changes: ch }, 60000);
      if (Object.keys(ch).length) return acall('part.save', { partId: p.id, changes: ch }, 60000);
    }).then(function () {
      $('bSave').disabled = false; $('saveHint').textContent = 'ต้องต่อเน็ตเพื่อบันทึก';
      toast('บันทึก ' + p.id + ' แล้ว');
      return refreshReg(true).then(function () { show('reg'); refreshList(); });
    }, function (er) { $('bSave').disabled = false; $('saveHint').textContent = 'ต้องต่อเน็ตเพื่อบันทึก'; toast('บันทึกไม่ได้: ' + er.message); });
  };
  $('bReject').onclick = function () { if (F.req && confirm('Reject ข้อมูลแนะนำของ ' + F.part.id + '?')) decide(F.req, 'reject', null, $('bReject')).then(function () { show('reg'); }); };
  $('fBack').onclick = function () { show(R ? 'reg' : 'list'); };

  /* ---------- views ---------- */
  function show(v) {
    VIEW = v;
    ['home', 'list', 'reg', 'form'].forEach(function (x) { $('v-' + x).hidden = x !== v; });
    $('title').textContent = v === 'home' ? 'Stock part system' : v === 'list' ? 'Part list' : 'Part registration';
    showErr('');
    if (v === 'list') { if (!D) refreshList(); renderList(); }
    if (v === 'reg') { renderReg(); if (!R) refreshReg(); }
    window.scrollTo(0, 0);
    paint();
  }
  document.querySelectorAll('[data-go]').forEach(function (b) {
    b.onclick = function () {
      if (b.dataset.go === 'reg' && !ADMIN) { toast('Part registration เข้าได้เฉพาะ admin'); return; }
      show(b.dataset.go);
    };
  });
  document.querySelectorAll('[data-home]').forEach(function (b) { b.onclick = function () { show('home'); }; });

  boot();
})();
