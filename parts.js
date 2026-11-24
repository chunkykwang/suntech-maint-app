/* Stock part system — Part list (ทุกคน, ใช้ได้ตอนไม่มีเน็ต) / Part registration (admin, ต้องต่อเน็ตเพื่อบันทึก)
 * ข้อมูล: part.list (เก็บในเครื่อง 'parts.list'), part.reg (admin), รูป part ใช้ร่วมกับหน้านับ stock ('stock.photos')
 * ราคา / supplier มาเฉพาะ part.reg (admin) — Part list ไม่มีราคา
 */
(function () {
  'use strict';
  var $ = function (id) { return document.getElementById(id); };
  var D = null, R = null, PHOTOS = {}, PHOTO_REQ = {}, VIEW = 'home', MODE = 'nag';
  var REQ_MODES = ['nag', 'sna', 'quick', 'merge', 'new', 'edit'];
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
    var w = R ? REQ_MODES.reduce(function (n, k) { return n + reqsOf(k).length; }, 0) : 0;
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
  // R6: แสดง Name · Brand · Model คู่กันเสมอ / R7: tag ตาม Manage type
  function lbl(p) { return [p.name, p.brand, p.model].map(function (x) { return String(x || '').trim(); }).filter(function (x) { return x && x !== '-'; }).join(' · '); }
  function manTag(m) {
    if (!m) return '';
    var c = m === 'Control' ? 'ctl' : m === 'Uncontrol' ? 'unc' : 'na';
    return '<span class="tag man ' + c + '">' + esc(m) + '</span>';
  }
  function ohTags(p) {
    if (!p.onhand) return '';
    return PLANTS.filter(function (pl) { return p.onhand[pl] && p['min' + pl] !== ''; }).map(function (pl) {
      var o = p.onhand[pl], low = p['min' + pl] !== '' && o.qty < Number(p['min' + pl]);
      return '<span class="tag ' + (low ? 'miss' : 'oh') + '">' + pl + ' คงเหลือ ' + o.qty + '</span>';
    }).join('');
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
      b.innerHTML = picHtml(p) + '<div><div class="nm">' + esc(lbl(p)) + '</div>' + (p.desc ? '<div class="md">' + esc(p.desc) + '</div>' : '') +
        '<div class="tags"><span class="tag">' + esc(p.id) + '</span>' + manTag(p.manage) + (p.group ? '<span class="tag g">' + esc(p.group) + '</span>' : '') +
        p.types.map(function (t) { return '<span class="tag">' + esc(typeLabel(D, t)) + '</span>'; }).join('') + minTags(p) + ohTags(p) + '</div></div>';
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
      '<h2 style="margin:10px 0 2px">' + esc(lbl(p)) + '</h2><div class="mu">' + esc(p.id) + ' ' + manTag(p.manage) + '</div>' +
      '<div class="kv">' + row('Model', p.model) + row('Description', p.desc) + row('Brand', p.brand) + row('Unit', p.unit) +
      row('Group', p.group) + row('Machine type', p.types.map(function (t) { return typeLabel(D, t); }).join(', ')) +
      row('Machine model', p.models.map(modelLabel).join(', ')) + row('Sector', p.sectors.join(', ')) +
      row('Min stock', PLANTS.filter(function (pl) { return p['min' + pl] !== ''; }).map(function (pl) { return pl + ': ' + p['min' + pl]; }).join(' · ')) +
      row('คงเหลือ (ประมาณ)', p.onhand ? PLANTS.filter(function (pl) { return p.onhand[pl]; }).map(function (pl) {
        var o = p.onhand[pl]; return pl + ': ' + o.qty + (o.count !== null ? ' (นับ ' + o.count + (o.received ? ' + รับเข้า ' + o.received : '') + ')' : ' (รับเข้า ยังไม่เคยนับ)');
      }).join(' · ') : '') +
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

  function confTag(c) { c = String(c || '').toLowerCase(); return c ? '<span class="tag ' + (c === 'high' ? 'hi' : c === 'medium' ? 'md' : 'lo') + '">' + esc(c[0].toUpperCase() + c.slice(1)) + '</span>' : ''; }
  function sugRows(s) {
    var L = R, out = [];
    var add = function (k, v) { if (v !== undefined && v !== '' && !(Array.isArray(v) && !v.length)) out.push('<span>' + k + '</span><b>' + esc(Array.isArray(v) ? v.join(', ') : v) + '</b>'); };
    add('Group', s.group); add('Machine type', (s.types || []).map(function (t) { return typeLabel(L, t); }));
    add('Machine model', (s.models || []).map(modelLabel)); add('Sector', s.sectors); add('Brand', s.brand); add('Supplier', s.supplier);
    add('Category', s.category); add('Manage type', s.manage); add('Stock class', s.cls);
    return out.join('');
  }
  /* แยกรายการรอ approve ตาม bucket (GG 24 Nov 2026: NA_GROUP / SUGGEST_NA / QUICK / MERGE / NEW) */
  var BUCKET = { nag: 'NA_GROUP', sna: 'SUGGEST_NA', quick: 'QUICK', merge: 'MERGE', new: 'NEW' };
  function reqsOf(kind) {
    return R.requests.filter(function (q) {
      if (BUCKET[kind]) return q.bucket === BUCKET[kind];
      if (kind === 'edit') return q.type === 'Edit existing' && partById(q.partId) && Object.keys(q.suggested || {}).length;
      return false;
    });
  }
  function isRcpt(q) { return q.type === 'Receipt'; }
  // part ใน Parts หรือที่ยังอยู่ใน Wait_Approve_Parts
  function partAny(id) { return partById(id) || (R.wait || []).filter(function (p) { return p.id === id; })[0]; }
  var CATE_MAP = { REPR: 'Repair', TG: 'TG' };
  function plainDetail(q) { return String(q.detail || '').replace(/^\s*[A-Z]{2,5}\s*:\s*/, ''); }
  // part ใหม่ / รายการจาก PO: ใช้ข้อมูลที่แนะนำ + Detail ต้นทาง
  function pseudo(q) {
    var s = q.suggested || {}, r = isRcpt(q);
    return { id: q.sugPartId || q.partId, name: s.name || '', model: s.model || '', brand: s.brand || '', desc: s.desc || (r ? plainDetail(q) : ''),
             unit: s.unit || '', price: r ? String(s.price == null ? '' : s.price) : '', supplier: r ? s.sup || '' : s.supplier || '',
             category: r ? CATE_MAP[q.itemCate] || '' : s.category || '',
             types: r ? [] : s.types || [], models: r ? [] : s.models || [], sectors: r ? [] : s.sectors || [], group: r ? '' : s.group || '',
             manage: r ? '' : s.manage || q.manage || '', cls: '', minSU1: '', minSU2: '', minSU3: '', photo: '', include: 'Y' };
  }
  function money(n) { n = Number(n); return isNaN(n) ? '' : n.toLocaleString('en-US', { maximumFractionDigits: 2 }); }
  // ข้อมูลรับเข้าจาก PO (เห็นเฉพาะหน้า admin)
  function rcptLine(q) {
    var g = q.suggested || {};
    var a = [g.plant, g.date, g.po ? 'PO ' + g.po + (g.seq ? ' #' + g.seq : '') : '', g.inv ? 'Inv ' + g.inv : '',
             g.rq != null ? 'รับ ' + money(g.rq) + (g.oq != null && g.oq !== g.rq ? '/' + money(g.oq) : '') + ' ' + (g.unit || '') : '',
             g.price != null ? money(g.price) + ' ' + (g.cur || '') + (g.amt != null ? ' (รวม ' + money(g.amt) + ')' : '') : '', g.sup].filter(Boolean);
    return '<div class="rc">' + a.map(esc).join(' · ') + (g.acc ? '<br><span class="mu">' + esc(g.acc) + (g.bud ? ' · ' + esc(g.bud) : '') + '</span>' : '') + '</div>';
  }
  function reqTitle(q) {
    if (isRcpt(q)) { var t = plainDetail(q); return t ? (t.length > 70 ? t.slice(0, 68) + '…' : t) : q.reqId; }
    var p = q.type === 'Edit existing' ? partById(q.partId) : pseudo(q);
    return lbl(p || {}) || q.detail || q.partId;
  }
  function srcInfo(q) {
    var out = [];
    if (q.detail) out.push('<div class="src">' + esc(q.detail) + '</div>');
    if (isRcpt(q)) out.push(rcptLine(q));
    var m = [];
    if (q.itemCate) m.push('ITEM CATE ' + esc(q.itemCate));
    if (q.receipts && q.receipts.length) m.push('Receipts ' + q.receipts.length + ' แถว');
    if (q.reqId) m.push(esc(q.reqId));
    if (m.length) out.push('<div class="mu">' + m.join(' · ') + '</div>');
    return out.join('');
  }

  function renderReg() {
    if (!R) { $('regList').innerHTML = '<div class="empty">' + (navigator.onLine ? 'กำลังโหลด…' : 'ต้องต่อเน็ตเพื่อเปิด Part registration') + '</div>'; return; }
    var inc = incParts();
    REQ_MODES.forEach(function (k) { var n = k === 'new' ? pendGroups(reqsOf('new')).length : reqsOf(k).length; $('n_' + k).textContent = n ? '(' + n + ')' : ''; });
    $('n_inc').textContent = '(' + inc.length + ')';
    var box = $('regList'); box.innerHTML = '';
    $('bulk').hidden = true;
    var reqMode = REQ_MODES.indexOf(MODE) >= 0;
    $('regSlicers').hidden = reqMode && MODE !== 'edit';
    if (reqMode) return renderReqs(box);
    var base = MODE === 'inc' ? inc : R.parts;
    fillSlicers(R, base, 'rGroup', 'rType', 'rModel');
    var ps = sliced(base, 'rq', 'rGroup', 'rType', 'rModel');
    $('regHint').textContent = MODE === 'inc' ? ps.length + ' part (ใช้ในแอป) ที่ข้อมูลยังไม่ครบ' : ps.length + ' จาก ' + R.parts.length + ' part · แตะเพื่อแก้';
    if (!ps.length) box.innerHTML = '<div class="empty">ไม่มีรายการ</div>';
    ps.slice(0, 300).forEach(function (p) {
      var b = document.createElement('button'); b.type = 'button'; b.className = 'pcard';
      var miss = missing(p);
      b.innerHTML = picHtml(p) + '<div><div class="nm">' + esc(lbl(p)) + '</div>' +
        '<div class="tags"><span class="tag">' + esc(p.id) + '</span>' + manTag(p.manage) + (String(p.include).toUpperCase() === 'Y' ? '' : '<span class="tag">ไม่ใช้ในแอป</span>') +
        (p.group ? '<span class="tag g">' + esc(p.group) + '</span>' : '') + minTags(p) +
        (MODE === 'inc' ? miss.map(function (m) { return '<span class="tag miss">ขาด ' + m + '</span>'; }).join('') : '') + '</div></div>';
      b.onclick = function () { openForm(p); };
      box.appendChild(b);
    });
    loadPhotos(ps.slice(0, 300));
  }

  // แถว NEW ที่เป็นชิ้นเดียวกัน (PEND เดียวกัน) รวมเป็นการ์ดเดียว
  function pendGroups(reqs) {
    var g = {}, order = [];
    reqs.forEach(function (q) { var k = q.sugPartId || q.partId || q.reqId; if (!g[k]) { g[k] = []; order.push(k); } g[k].push(q); });
    return order.map(function (k) { return { key: k, reqs: g[k] }; });
  }
  function targetLine(id) {
    var t = partAny(id);
    return '<div class="match">→ <b>' + esc(id || '?') + '</b> ' + esc(t ? lbl(t) : '(ไม่พบใน Parts / Wait_Approve_Parts)') + ' ' + manTag(t && t.manage) +
      (t && t.wait ? ' <span class="tag md">อยู่ใน Wait_Approve_Parts — จะย้ายเข้า Parts</span>' : '') + '</div>';
  }
  function renderReqs(box) {
    var q0 = $('rq').value.trim().toLowerCase();
    var reqs = reqsOf(MODE).filter(function (q) { return !q0 || [q.partId, q.reqId, reqTitle(q), q.detail, q.sugPartId, q.itemCate, (q.suggested || {}).sup, (q.suggested || {}).po].join(' ').toLowerCase().indexOf(q0) >= 0; });
    var hints = { nag: 'ITEM CATE OFFI / OTHE / MISC — ไม่ออก Part ID ไม่บวก stock · เอาติ๊กออกได้ก่อนกด Confirm',
                  sna: 'GG เสนอว่าไม่เกี่ยวกับงานซ่อม → N/A · เอาติ๊กออกได้ก่อนกด Confirm',
                  quick: 'ข้อความตรงกับ part เดิม — ตรวจคู่ที่จับได้ แล้วยืนยันทีละหลายแถว',
                  merge: 'ใกล้เคียง part เดิม — เทียบแล้วเลือก Merge / New / Reject',
                  new: 'ไม่พบใน DB — ลงทะเบียน part ใหม่ (แถวที่ PEND เดียวกันรวมเป็นการ์ดเดียว)',
                  edit: 'ข้อมูลที่ระบบแนะนำให้ part ที่มีอยู่แล้ว' };
    var groups = MODE === 'new' ? pendGroups(reqs) : null;
    $('regHint').textContent = (groups ? groups.length + ' part (' + reqs.length + ' แถว)' : reqs.length + ' รายการ') + ' · ' + hints[MODE];
    if (!reqs.length) { box.innerHTML = '<div class="empty">ไม่มีรายการรอ approve</div>'; return; }
    var multi = MODE === 'nag' || MODE === 'sna' || MODE === 'quick';

    if (MODE === 'edit') {
      var hi = reqs.filter(function (q) { return String(q.confidence).toLowerCase() === 'high'; });
      $('bulk').hidden = !hi.length; $('bulkTxt').textContent = 'Confidence High ' + hi.length + ' จาก ' + reqs.length + ' รายการ';
      $('bulkBtn').textContent = 'Approve ทั้งหมดที่ Confidence High';
      $('bulkBtn').onclick = function () { approveHigh(hi); };
    }
    if (multi) {
      $('bulk').hidden = false;
      var sel = function () { return [].slice.call(box.querySelectorAll('input[data-sel]:checked')).map(function (x) { return reqs[+x.dataset.sel]; }); };
      var cnt = function () { var n = sel().length; $('bulkBtn').textContent = (MODE === 'quick' ? 'ยืนยันที่เลือก' : 'Confirm N/A ทั้งกลุ่ม') + ' (' + n + ')'; $('bulkBtn').disabled = !n; };
      $('bulkTxt').innerHTML = '<label class="selall"><input type="checkbox" id="selAll" checked> เลือกทั้งหมด</label>';
      $('bulkBtn').onclick = function () { decideMany(sel(), MODE === 'quick' ? 'approve' : 'na'); };
      setTimeout(function () {
        $('selAll').onchange = function () { box.querySelectorAll('input[data-sel]').forEach(function (x) { x.checked = $('selAll').checked; }); cnt(); };
        box.querySelectorAll('input[data-sel]').forEach(function (x) { x.onchange = cnt; });
        cnt();
      });
    }

    if (groups) {
      groups.forEach(function (gr) {
        var q = gr.reqs[0], d = document.createElement('div'); d.className = 'req';
        d.innerHTML = '<div class="top"><b>' + esc(gr.key) + ' · ' + esc(reqTitle(q)) + '</b>' + (gr.reqs.length > 1 ? '<span class="tag md">' + gr.reqs.length + ' แถว</span>' : '') + '</div>' +
          gr.reqs.map(function (x) { return srcInfo(x); }).join('<hr class="sep">') + (q.reason ? '<div class="why">' + esc(q.reason) + '</div>' : '') +
          '<div class="acts"><button type="button" class="btn primary sm" data-a="new">ลงทะเบียน part ใหม่</button><button type="button" class="btn sm" data-a="merge">Merge กับ part เดิม</button><button type="button" class="btn sm" data-a="no">Reject</button></div>';
        var on = function (a, fn) { d.querySelector('[data-a=' + a + ']').onclick = fn; };
        on('new', function () { openForm(pseudo(q), q, true, gr.reqs); });
        on('merge', function () { openMerge(q, gr.reqs); });
        on('no', function (e) { if (confirm('Reject ' + gr.key + ' (' + gr.reqs.length + ' แถว)? GG จะไม่เสนอรายการนี้ซ้ำ')) decide(q, 'reject', null, e.target, '', gr.reqs); });
        box.appendChild(d);
      });
      return;
    }

    reqs.forEach(function (q, i) {
      var d = document.createElement('div'); d.className = 'req';
      var top = '<div class="top"><b>' + (multi ? '<input type="checkbox" data-sel="' + i + '" checked aria-label="เลือก"> ' : '') +
        esc(reqTitle(q)) + '</b>' + (q.itemCate ? '<span class="tag">' + esc(q.itemCate) + '</span>' : '') + confTag(q.confidence) + '</div>';
      var body = '', acts = '';
      if (MODE === 'edit') {
        var p = partById(q.partId);
        body = '<div class="mu">' + esc(p.id) + ' ' + manTag(p.manage) + '</div><div class="why">' + esc(q.reason) + '</div><div class="sg">' + sugRows(q.suggested) + '</div>';
        acts = '<button type="button" class="btn primary sm" data-a="ok">Approve</button><button type="button" class="btn sm" data-a="edit">แก้ก่อน</button><button type="button" class="btn sm" data-a="no">Reject</button>';
      } else if (MODE === 'quick') {
        body = srcInfo(q) + targetLine(q.sugPartId);
        acts = '<button type="button" class="btn sm" data-a="merge">เปลี่ยน Part ID</button><button type="button" class="btn sm" data-a="no">Reject</button>';
      } else if (MODE === 'merge') {
        var t = partAny(q.sugPartId);
        body = '<div class="cmp"><div><span class="mu">part เดิม</span>' + (t ? '<b>' + esc(t.id) + '</b> ' + esc(lbl(t)) + ' ' + manTag(t.manage) +
            (t.desc ? '<div class="mu">' + esc(t.desc) + '</div>' : '') + (t.wait ? '<div><span class="tag md">อยู่ใน Wait_Approve_Parts</span></div>' : '') : '<b>' + esc(q.sugPartId || '?') + '</b> (ไม่พบ)') +
          '</div><div><span class="mu">ข้อความใหม่</span>' + srcInfo(q) + '</div></div>' + (q.reason ? '<div class="why">' + esc(q.reason) + '</div>' : '');
        acts = '<button type="button" class="btn primary sm" data-a="mok"' + (t ? '' : ' disabled') + '>Merge → ' + esc(q.sugPartId || '?') + '</button>' +
          '<button type="button" class="btn sm" data-a="merge">เลือก part อื่น</button><button type="button" class="btn sm" data-a="new">New</button><button type="button" class="btn sm" data-a="no">Reject</button>';
      } else {                                   // nag / sna
        body = srcInfo(q) + (MODE === 'sna' && q.reason ? '<div class="why">' + esc(q.reason) + '</div>' : '');
        acts = '<button type="button" class="btn sm" data-a="new">ไม่ใช่ N/A → ลงทะเบียน</button><button type="button" class="btn sm" data-a="merge">Merge</button><button type="button" class="btn sm" data-a="no">Reject</button>';
      }
      d.innerHTML = top + body + '<div class="acts">' + acts + '</div>';
      var on = function (a, fn) { var b = d.querySelector('[data-a=' + a + ']'); if (b) b.onclick = fn; };
      on('ok', function (e) { decide(q, 'approve', null, e.target); });
      on('edit', function () { openForm(partById(q.partId), q); });
      on('new', function () { openForm(pseudo(q), q, true, [q]); });
      on('merge', function () { openMerge(q); });
      on('mok', function (e) { if (confirm('Merge "' + reqTitle(q) + '" เข้ากับ ' + q.sugPartId + '?')) decide(q, 'merge', null, e.target, q.sugPartId); });
      on('no', function (e) { if (confirm('Reject "' + reqTitle(q) + '"? รายการนี้จะไม่ถูกเสนอซ้ำ')) decide(q, 'reject', null, e.target); });
      box.appendChild(d);
    });
  }

  function decide(q, decision, changes, btn, target, group) {
    if (!navigator.onLine) { toast('ต้องต่อเน็ตเพื่อบันทึก'); return Promise.reject(new Error('offline')); }
    if (btn) btn.disabled = true;
    var args = { reqId: q.reqId, decision: decision, changes: changes, target: target || '' };
    if (group && group.length) args.reqIds = group.map(function (x) { return x.reqId; });
    return acall('part.decide', args, 120000).then(function (r) {
      if (r.failed && r.failed.length) showErr(r.failed.join('\n'));
      toast((r.partId || q.partId || q.reqId) + ': ' + r.status + (r.created != null ? ' · Receipts ใหม่ ' + r.created + (r.reused ? ' · ซ้ำ ' + r.reused : '') : ''));
      return refreshReg(true).then(function () { renderReg(); refreshList(); return r; });
    }, function (er) { if (btn) btn.disabled = false; toast('บันทึกไม่ได้: ' + er.message); throw er; });
  }
  function decideMany(list, decision) {
    if (!list.length) { toast('ยังไม่ได้เลือกรายการ'); return; }
    if (!navigator.onLine) { toast('ต้องต่อเน็ตเพื่อบันทึก'); return; }
    if (!confirm((decision === 'na' ? 'ยืนยันเป็น N/A ' : 'ยืนยัน ') + list.length + ' รายการ?')) return;
    $('bulkBtn').disabled = true;
    acall('part.decideMany', { reqIds: list.map(function (q) { return q.reqId; }), decision: decision }, 120000).then(function (r) {
      $('bulkBtn').disabled = false;
      toast('ยืนยันแล้ว ' + r.done.length + ' รายการ' + (r.failed.length ? ' · ไม่ผ่าน ' + r.failed.length : ''));
      if (r.failed.length) showErr(r.failed.join('\n'));
      refreshReg(true).then(function () { renderReg(); refreshList(); });
    }, function (er) { $('bulkBtn').disabled = false; toast('บันทึกไม่ได้: ' + er.message); });
  }
  function approveHigh(list) {
    if (!navigator.onLine) { toast('ต้องต่อเน็ตเพื่อบันทึก'); return; }
    if (!confirm('Approve ' + list.length + ' รายการที่ Confidence High?')) return;
    $('bulkBtn').disabled = true;
    acall('part.approveHigh', { reqIds: list.map(function (q) { return q.reqId; }) }, 120000).then(function (r) {
      $('bulkBtn').disabled = false;
      toast('Approve แล้ว ' + r.approved.length + ' รายการ');
      refreshReg(true).then(function () { renderReg(); refreshList(); });
    }, function (er) { $('bulkBtn').disabled = false; toast('บันทึกไม่ได้: ' + er.message); });
  }

  /* ---------- Merge: เลือก Part ID เดิม (คำแนะนำ หรือค้นหา) ---------- */
  var MQ = null, MG = null;
  function openMerge(q, group) {
    MQ = q; MG = group || null;
    $('mTitle').textContent = 'Merge: ' + reqTitle(q);
    $('mSrc').innerHTML = srcInfo(q);
    $('mq').value = '';
    renderMerge();
    $('merge').hidden = false; $('mq').focus();
  }
  function renderMerge() {
    var t = $('mq').value.trim().toLowerCase(), q = MQ, box = $('mList'); box.innerHTML = '';
    var list = R.parts.concat(isRcpt(q) ? R.wait || [] : []).filter(function (p) { return !t || [p.id, p.name, p.brand, p.model, p.desc].join(' ').toLowerCase().indexOf(t) >= 0; });
    if (!t && q.sugPartId) list.sort(function (a, b) { return (b.id === q.sugPartId) - (a.id === q.sugPartId); });
    list.slice(0, 40).forEach(function (p) {
      var b = document.createElement('button'); b.type = 'button'; b.className = 'mrow';
      b.innerHTML = '<b>' + esc(p.id) + '</b> ' + esc(lbl(p)) + ' ' + manTag(p.manage) + (p.id === q.sugPartId ? ' <span class="tag md">แนะนำ</span>' : '') +
        (p.wait ? ' <span class="tag">Wait_Approve_Parts</span>' : '');
      b.onclick = function () {
        if (!confirm('รวม "' + reqTitle(q) + '"' + (MG && MG.length > 1 ? ' (' + MG.length + ' แถว)' : '') + ' เข้ากับ ' + p.id + ' ' + lbl(p) + '?')) return;
        decide(q, 'merge', null, b, p.id, MG).then(function () { $('merge').hidden = true; }, function () {});
      };
      box.appendChild(b);
    });
    if (!list.length) box.innerHTML = '<div class="empty">ไม่พบ part</div>';
  }
  $('mq').addEventListener('input', renderMerge);
  $('mClose').onclick = function () { $('merge').hidden = true; };
  $('merge').addEventListener('click', function (e) { if (e.target === $('merge')) $('merge').hidden = true; });

  /* ---------- ฟอร์ม ---------- */
  var FIELDS = ['name', 'model', 'desc', 'brand', 'unit', 'price', 'supplier', 'category', 'cls', 'manage', 'include', 'group', 'types', 'models', 'sectors', 'minSU1', 'minSU2', 'minSU3'];
  var INPUTS = { name: 'iName', model: 'iModel', desc: 'iDesc', brand: 'iBrand', unit: 'iUnit', price: 'iPrice', supplier: 'iSupplier' };
  function clone(o) { return JSON.parse(JSON.stringify(o)); }

  function openForm(p, req, isNew, group) {
    var data = {};
    FIELDS.forEach(function (k) { data[k] = clone(p[k] == null ? (/s$/.test(k) && k !== 'cls' ? [] : '') : p[k]); });
    var sug = req ? req.suggested || {} : {};
    Object.keys(sug).forEach(function (k) { if (k in data) data[k] = clone(sug[k]); });
    data.include = 'Y';                           // approve / บันทึกแล้ว = ขึ้นแอป (เลือก "ไม่ใช้" เองได้)
    if (req && isRcpt(req)) { sug = {}; data = {}; FIELDS.forEach(function (k) { data[k] = clone(p[k] == null ? (/s$/.test(k) && k !== 'cls' ? [] : '') : p[k]); }); data.include = 'Y'; }
    F = { part: p, req: req || null, data: data, sug: sug, photo: null, kb: 0, isNew: !!isNew, group: group || null };
    $('fTitle').textContent = isNew ? 'ลงทะเบียน part ใหม่ (' + p.id + ')' : (req ? 'ตรวจข้อมูลแนะนำ ' : 'แก้ข้อมูล ') + p.id;
    $('sugBox').hidden = !req;
    if (req) $('sugBox').innerHTML = (isNew ? '<b>ข้อมูลจาก PO</b> ' : '<b>ข้อมูลที่ระบบแนะนำ</b> ') + confTag(req.confidence) +
      (group && group.length > 1 ? group.map(srcInfo).join('<hr class="sep">') + '<div class="mu">ลงทะเบียนครั้งเดียว ใช้กับทั้ง ' + group.length + ' แถว</div>' : srcInfo(req)) +
      (req.reason ? '<div>' + esc(req.reason) + '</div>' : '') + '<span class="mu">ช่องที่มีกรอบสีส้ม = ค่าที่แนะนำ แก้ได้ก่อนกด Approve' +
      (isNew ? ' · ต้องเลือก Manage type · Part ID จริงออกตอน Approve' : '') + '</span>';
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
    chipRow('cCls', CLSS, function (v) { return d.cls === v; }, function (v) { d.cls = d.cls === v ? '' : v; }, 'cls');
    chipRow('cMan', ['Control', 'Uncontrol', 'N/A'], function (v) { return d.manage === v; }, function (v) { d.manage = d.manage === v ? '' : v; }, 'manage');
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
    var ch = F.isNew ? clone(F.data) : changesOf(), p = F.part, req = F.req, photo = F.photo;
    if (F.isNew) {
      if (!F.data.manage) { toast('เลือก Manage type ก่อน (Control / Uncontrol / N/A)'); $('cMan').scrollIntoView({ block: 'center' }); return; }
      if (F.data.manage !== 'N/A' && !String(F.data.name || '').trim()) { toast('กรอก Name ก่อน'); $('iName').focus(); return; }
    }
    if (!Object.keys(ch).length && !photo && !req) { toast('ไม่มีอะไรเปลี่ยน'); return; }
    $('bSave').disabled = true; $('saveHint').textContent = 'กำลังบันทึก…';
    var upPhoto = function (pid) {
      if (!photo) return Promise.resolve();
      return acall('part.photo', { partId: pid, data: photo }, 90000).then(function (r) { PHOTOS[r.photo] = photo; Store.set('stock.photos', PHOTOS); });
    };
    var pidDone = p.id;
    (F.isNew
      ? acall('part.decide', Object.assign({ reqId: req.reqId, decision: 'approve', changes: ch }, F.group ? { reqIds: F.group.map(function (x) { return x.reqId; }) } : {}), 120000)
          .then(function (r) {
            if (r.failed && r.failed.length) showErr(r.failed.join('\n'));
            pidDone = r.partId || (r.manage === 'N/A' ? 'N/A (ไม่ออก Part ID)' : p.id);
            return r.partId ? upPhoto(r.partId) : null;
          })
      : upPhoto(p.id).then(function () {
          if (req) return acall('part.decide', { reqId: req.reqId, decision: 'approve', changes: ch }, 60000);
          if (Object.keys(ch).length) return acall('part.save', { partId: p.id, changes: ch }, 60000);
        })
    ).then(function () {
      $('bSave').disabled = false; $('saveHint').textContent = 'ต้องต่อเน็ตเพื่อบันทึก';
      toast('บันทึก ' + pidDone + ' แล้ว');
      return refreshReg(true).then(function () { show('reg'); refreshList(); });
    }, function (er) { $('bSave').disabled = false; $('saveHint').textContent = 'ต้องต่อเน็ตเพื่อบันทึก'; toast('บันทึกไม่ได้: ' + er.message); });
  };
  $('bReject').onclick = function () { if (F.req && confirm('Reject "' + reqTitle(F.req) + '"?')) decide(F.req, 'reject', null, $('bReject'), '', F.group).then(function () { show('reg'); }, function () {}); };
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
