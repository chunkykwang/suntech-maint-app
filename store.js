/* ที่เก็บข้อมูลในเครื่อง (IndexedDB) — ใช้แบบ key/value: Store.get(k) / Store.set(k, v) / Store.del(k) */
(function () {
  'use strict';
  var dbp = null;
  function db() {
    if (dbp) return dbp;
    dbp = new Promise(function (res, rej) {
      var r = indexedDB.open('suntech-maint', 1);
      r.onupgradeneeded = function () { r.result.createObjectStore('kv'); };
      r.onsuccess = function () { res(r.result); };
      r.onerror = function () { rej(r.error); };
    });
    return dbp;
  }
  function tx(mode, fn) {
    return db().then(function (d) {
      return new Promise(function (res, rej) {
        var t = d.transaction('kv', mode), s = t.objectStore('kv'), out = fn(s);
        t.oncomplete = function () { res(out && 'result' in out ? out.result : undefined); };
        t.onerror = function () { rej(t.error); };
      });
    });
  }
  window.Store = {
    get: function (k) { return tx('readonly', function (s) { return s.get(k); }); },
    set: function (k, v) { return tx('readwrite', function (s) { s.put(v, k); }); },
    del: function (k) { return tx('readwrite', function (s) { s.delete(k); }); }
  };
})();
