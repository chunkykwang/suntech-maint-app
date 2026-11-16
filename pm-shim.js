/*
 * PM checklist — ตัวแทน google.script.run ของแอป v0 ให้ทำงานแบบ offline
 *  - รายการตรวจ / เครื่อง / แผน (pm.init) เก็บในเครื่อง เปิดได้ตอนไม่มีเน็ต แล้วอัปเดตเบื้องหลังเมื่อมีเน็ต
 *  - รูป Hint / Equipment / Consumption โหลดเก็บในเครื่องล่วงหน้า (IndexedDB)
 *  - กดส่งผล = เข้าคิวในเครื่องก่อน (รวมรูปถ่าย) แล้วส่งเองเมื่อมีเน็ต — เซิร์ฟเวอร์กันส่งซ้ำด้วย Submit ID
 * ใช้คู่กับ config.js / store.js / api.js
 */
(function () {
  'use strict';
  var K_INIT = 'pm.init', K_OUT = 'pm.outbox', K_ANS = 'pm.answered', K_PROG = 'pm.prog:', K_IMG = 'pm.img:';
  var OUTBOX = [], syncing = false, newData = null;
  var ready = Store.get(K_OUT).then(function (v) { OUTBOX = Array.isArray(v) ? v : []; }, function () { OUTBOX = []; });

  function $(id) { return document.getElementById(id); }
  function saveOut() { return Store.set(K_OUT, OUTBOX).catch(function () {}); }
  function keyOfMeta(m) { return [m.month, m.machine, m.period, m.job].join('|'); }
  function online() { return navigator.onLine && Api.ready(); }

  /* ---------- PIN ---------- */
  var pinWait = null;
  function askPin(msg) {
    if (pinWait) return pinWait;
    pinWait = new Promise(function (resolve) {
      $('pinWrap').hidden = false; $('pinErr').textContent = msg || ''; $('pinIn').value = ''; $('pinIn').focus();
      $('pinForm').onsubmit = function (e) {
        e.preventDefault(); var p = $('pinIn').value.trim(); if (!p) return;
        Api.setPin(p); $('pinOk').disabled = true;
        Api.call('ping').then(function () { done(); }, function (er) {
          $('pinOk').disabled = false;
          if (er.code === 'PIN') { Api.clearPin(); $('pinErr').textContent = er.message; } else done();
        });
      };
      $('pinLater').onclick = done;
      function done() { $('pinWrap').hidden = true; $('pinOk').disabled = false; pinWait = null; resolve(); }
    });
    return pinWait;
  }
  function call(action, params, timeout) {
    var go = function () { return Api.call(action, params, timeout); };
    var first = (!Api.pin() && online()) ? askPin() .then(go) : go();
    return first.catch(function (er) {
      if (er.code !== 'PIN') throw er;
      Api.clearPin();
      return askPin(er.message).then(go);
    });
  }

  /* ---------- รวมผลที่รอส่งในเครื่องเข้ากับข้อมูลจากเซิร์ฟเวอร์ ---------- */
  function rowAns(r) {
    return { v: r[1] ? 'OK' : (r[2] ? 'NG' : (r[5] ? 'NA' : '')), note: r[3] || '', fixed: !!r[4],
             res: r[7] === undefined || r[7] === null ? '' : String(r[7]), unit: r[8] || '' };
  }
  function queuedFor(key) {
    var out = {};
    OUTBOX.forEach(function (q) {
      if (keyOfMeta(q.payload.meta) !== key) return;
      q.payload.rows.forEach(function (r) { var a = rowAns(r); if (a.v) out[String(r[0])] = a; });
    });
    return out;
  }
  function withQueuedProgress(d) {
    var prog = Object.assign({}, d.progress || {});
    var byKey = {};
    OUTBOX.forEach(function (q) {
      var k = keyOfMeta(q.payload.meta);
      byKey[k] = (byKey[k] || 0) + q.payload.rows.filter(function (r) { return r[1] || r[2] || r[5]; }).length;
    });
    Object.keys(byKey).forEach(function (k) { prog[k] = (prog[k] || 0) + byKey[k]; });
    return Object.assign({}, d, { progress: prog });
  }

  /* ---------- รูปเก็บในเครื่อง ---------- */
  function complete(res) {
    return res && res.images && res.images.length && !(res.missing && res.missing.length) && !(res.errors && res.errors.length);
  }
  function getImages(kind, names) {
    var k = K_IMG + kind + '|' + names;
    return Store.get(k).then(function (hit) {
      if (hit) return hit;
      if (!online()) throw new Error('ยังไม่มีรูปนี้ในเครื่อง (ต้องเปิดตอนมีเน็ตก่อน 1 ครั้ง)');
      return call('pm.images', { kind: kind, names: names }, 60000).then(function (res) {
        if (complete(res)) Store.set(k, res).catch(function () {});
        return res;
      });
    });
  }
  function imageJobs(items) {
    var seen = {}, jobs = [];
    var add = function (kind, n) { n = String(n || '').trim(); if (!n || seen[kind + '|' + n]) return; seen[kind + '|' + n] = 1; jobs.push([kind, n]); };
    (items || []).forEach(function (it) {
      add('hint', it.hintImg);
      (it.equipment || []).forEach(function (n) { add('equipment', n); });
      (it.consumption || []).forEach(function (n) { add('consumption', n); });
    });
    return jobs;
  }
  var preloading = false;
  function preload(items, force) {
    if (preloading) return;
    var jobs = imageJobs(items);
    if (!jobs.length) { setImg(''); return; }
    preloading = true;
    var have = 0, i = 0, todo = [];
    Promise.all(jobs.map(function (j) {
      var k = K_IMG + j[0] + '|' + j[1];
      return (force ? Promise.resolve(null) : Store.get(k)).then(function (v) { if (v) have++; else todo.push(j); }, function () { todo.push(j); });
    })).then(function () {
      var total = jobs.length, failed = 0;
      setImg(have + '/' + total);
      if (!todo.length || !online()) { preloading = false; setImg(have + '/' + total, have < total); return; }
      function next() {
        if (i >= todo.length) { preloading = false; setImg(have + '/' + total, have < total); return; }
        var j = todo[i++];
        call('pm.images', { kind: j[0], names: j[1] }, 60000).then(function (res) {
          if (complete(res)) return Store.set(K_IMG + j[0] + '|' + j[1], res).then(function () { have++; });
          failed++;                                         // ไม่พบรูปบางรูปใน Drive — ข้าม (เปิดดูตอนมีเน็ตได้)
        }).catch(function (er) { failed++; if (er.code === 'OFFLINE') i = todo.length; })
          .then(function () { setImg(have + '/' + total); next(); });
      }
      next(); next();                                       // โหลดพร้อมกัน 2 รายการ
    });
  }

  /* ---------- คิวส่งผล ---------- */
  function flush() {
    if (syncing || !OUTBOX.length || !online() || !Api.pin()) { render(); return Promise.resolve(); }
    syncing = true; render();
    var q = OUTBOX[0];
    return Api.call('pm.submit', { payload: q.payload }, 120000).then(function (r) {
      OUTBOX.shift(); return saveOut().then(function () { q.result = r; });
    }, function (er) {
      if (er.code === 'PIN') { Api.clearPin(); syncing = false; render(); askPin(er.message).then(flush); throw er; }
      if (er.code !== 'OFFLINE') { q.err = er.message; OUTBOX.push(OUTBOX.shift()); saveOut(); }   // ข้อมูลไม่ผ่าน: ไว้ท้ายคิว ให้ผู้ใช้ดู
      throw er;
    }).then(function () {
      syncing = false; render();
      if (OUTBOX.length && !OUTBOX[0].err) return flush();
    }, function () { syncing = false; render(); });
  }

  /* ---------- แถบสถานะ ---------- */
  var imgTxt = '', imgWarn = false;
  function setImg(t, warn) { imgTxt = t; imgWarn = !!warn; render(); }
  function render() {
    var net = $('pmNet'); if (!net) return;
    var on = navigator.onLine;
    net.textContent = on ? 'ออนไลน์' : 'ออฟไลน์'; net.className = 'pmpill' + (on ? '' : ' off');
    var q = $('pmQueue'), errs = OUTBOX.filter(function (x) { return x.err; }).length;
    q.hidden = !OUTBOX.length;
    q.textContent = syncing ? 'กำลังส่ง...' : ('รอส่ง ' + OUTBOX.length + (errs ? ' (มีปัญหา ' + errs + ')' : ''));
    q.className = 'pmpill wait' + (errs ? ' bad' : '');
    var im = $('pmImg'); im.hidden = !imgTxt; im.textContent = 'รูปในเครื่อง ' + imgTxt + (preloading ? ' ...' : '');
    im.className = 'pmpill' + (imgWarn ? ' wait' : '');
    $('pmNew').hidden = !newData;
  }
  function openQueue() {
    var box = $('pmQList'); box.innerHTML = '';
    if (!OUTBOX.length) box.innerHTML = '<p class="pmnote">ไม่มีรายการรอส่ง</p>';
    OUTBOX.forEach(function (q, idx) {
      var m = q.payload.meta, d = document.createElement('div'); d.className = 'pmq' + (q.err ? ' bad' : '');
      var t = document.createElement('div');
      t.textContent = m.month + ' · ' + m.machine + ' · ' + m.period + ' ' + m.job + ' · ' + q.payload.rows.length + ' ข้อ · ' + m.name;
      d.appendChild(t);
      if (q.err) {
        var e = document.createElement('div'); e.className = 'pmerr'; e.textContent = 'ส่งไม่ผ่าน: ' + q.err; d.appendChild(e);
        var b = document.createElement('button'); b.type = 'button'; b.className = 'pmbtn'; b.textContent = 'ลองส่งใหม่';
        b.onclick = function () { delete q.err; OUTBOX.splice(idx, 1); OUTBOX.unshift(q); saveOut().then(flush); openQueue(); };
        var del = document.createElement('button'); del.type = 'button'; del.className = 'pmbtn ghost'; del.textContent = 'ลบรายการนี้';
        del.onclick = function () {
          if (!confirm('ลบรายการนี้ออกจากคิว? ผลตรวจชุดนี้จะไม่ถูกส่ง')) return;
          OUTBOX.splice(idx, 1); saveOut().then(render); openQueue();
        };
        d.appendChild(b); d.appendChild(del);
      }
      box.appendChild(d);
    });
    $('pmQWrap').hidden = false;
  }

  /* ---------- ตัวแทนฟังก์ชันฝั่งเซิร์ฟเวอร์ ---------- */
  var IMPL = {
    getAppData: function () {
      return ready.then(function () { return Store.get(K_INIT).catch(function () { return null; }); }).then(function (cached) {
        var net = online() ? call('pm.init', {}, 60000).then(function (d) {
          d.loadedAt = Date.now();
          return Store.set(K_INIT, d).catch(function () {}).then(function () { return d; });
        }) : Promise.reject(Object.assign(new Error('ไม่มีเน็ต และยังไม่เคยโหลดข้อมูลเก็บไว้ในเครื่อง'), { code: 'OFFLINE' }));
        if (cached) {
          net.then(function (d) {
            var a = JSON.stringify([d.items, d.machines, d.plan]), b = JSON.stringify([cached.items, cached.machines, cached.plan]);
            if (a !== b) { newData = d; render(); }
            preload(d.items);
          }, function () { preload(cached.items); });
          setLoaded(cached.loadedAt);
          return withQueuedProgress(cached);
        }
        return net.then(function (d) { setLoaded(d.loadedAt); preload(d.items); return withQueuedProgress(d); });
      });
    },
    getProgress: function (key) {
      return ready.then(function () {
        var srv = online()
          ? call('pm.progress', { key: key }, 15000).then(function (m) { Store.set(K_PROG + key, m).catch(function () {}); return m; })
              .catch(function () { return Store.get(K_PROG + key); })
          : Store.get(K_PROG + key);
        return srv.then(function (m) { return Object.assign({}, m || {}, queuedFor(key)); });
      });
    },
    getAnswered: function (keys) {
      return ready.then(function () {
        return Store.get(K_ANS).catch(function () { return null; }).then(function (cache) {
          cache = cache || {};
          var srv = online() ? call('pm.answered', { keys: keys }, 15000).then(function (m) {
            (keys || []).forEach(function (k) { cache[k] = (m || {})[k] || []; });
            Store.set(K_ANS, cache).catch(function () {});
            return cache;
          }).catch(function () { return cache; }) : Promise.resolve(cache);
          return srv.then(function (c) {
            var out = {};
            (keys || []).forEach(function (k) {
              var s = {}; (c[k] || []).forEach(function (n) { s[String(n)] = 1; });
              Object.keys(queuedFor(k)).forEach(function (n) { s[n] = 1; });
              if (Object.keys(s).length) out[k] = Object.keys(s);
            });
            return out;
          });
        });
      });
    },
    getImages: getImages,
    getHintImages: function (ids) { return getImages('hint', ids); },
    checkAdmin: function (pw) {
      if (!online()) return Promise.reject(new Error('ต้องมีเน็ตเพื่อตรวจรหัส admin'));
      return call('pm.admin', { pw: pw }, 20000);
    },
    saveResults: function (payload) {
      return ready.then(function () {
        payload.meta = payload.meta || {};
        payload.meta.id = payload.meta.id || ('S' + Date.now());
        payload.meta.id += '-' + Math.random().toString(36).slice(2, 7);      // ไม่ซ้ำแม้กดส่ง 2 เครื่องพร้อมกัน
        var photos = payload.rows.filter(function (r) { return r[6]; }).length;
        OUTBOX.push({ id: payload.meta.id, at: Date.now(), payload: payload });
        return saveOut().then(function () {
          var res = { count: payload.rows.length, photos: photos, queued: true };
          if (!online()) { render(); return res; }
          var wait = new Promise(function (r) { setTimeout(r, 25000); });
          return Promise.race([flush(), wait]).then(function () {
            var still = OUTBOX.some(function (q) { return q.id === payload.meta.id; });
            res.queued = still;
            return res;
          });
        });
      });
    }
  };

  function setLoaded(t) {
    var el = $('pmLoaded'); if (!el || !t) return;
    var d = new Date(t), p = function (n) { return (n < 10 ? '0' : '') + n; };
    el.textContent = 'ข้อมูล ' + p(d.getDate()) + '/' + p(d.getMonth() + 1) + ' ' + p(d.getHours()) + ':' + p(d.getMinutes());
  }

  function runner(ok, fail) {
    var o = {
      withSuccessHandler: function (f) { return runner(f, fail); },
      withFailureHandler: function (f) { return runner(ok, f); }
    };
    Object.keys(IMPL).forEach(function (name) {
      o[name] = function () {
        var args = arguments;
        Promise.resolve().then(function () { return IMPL[name].apply(null, args); })
          .then(function (r) { if (ok) ok(r); }, function (e) { if (fail) fail(e); else console.error(e); });
      };
    });
    return o;
  }
  window.google = { script: { run: runner(null, null) } };

  /* ---------- ปุ่มในแถบสถานะ ---------- */
  document.addEventListener('DOMContentLoaded', function () {
    $('pmQueue').onclick = openQueue;
    $('pmQClose').onclick = function () { $('pmQWrap').hidden = true; };
    $('pmQSync').onclick = function () { OUTBOX.forEach(function (q) { delete q.err; }); saveOut().then(flush); $('pmQWrap').hidden = true; };
    $('pmImgRe').onclick = function () {
      if (!online()) { alertBox('ต้องมีเน็ตเพื่อโหลดรูปใหม่'); return; }
      Store.get(K_INIT).then(function (d) { if (d) preload(d.items, true); });
      $('pmQWrap').hidden = true;
    };
    $('pmImg').onclick = openQueue;
    $('pmNew').onclick = function () {
      if (confirm('โหลดข้อมูลใหม่? คำตอบที่ยังไม่ส่งยังอยู่ แต่รูปที่ถ่ายไว้แล้วยังไม่ส่งต้องถ่ายใหม่')) location.reload();
    };
    render();
  });
  function alertBox(t) { var x = $('toast'); if (!x) return; x.textContent = t; x.style.display = 'block'; setTimeout(function () { x.style.display = 'none'; }, 2800); }
  window.addEventListener('online', function () { render(); ready.then(flush); Store.get(K_INIT).then(function (d) { if (d) preload(d.items); }); });
  window.addEventListener('offline', render);
  ready.then(function () { render(); flush(); });
  setInterval(function () { if (OUTBOX.length && !OUTBOX[0].err) flush(); }, 60000);
})();
