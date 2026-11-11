/* เรียก Apps Script API — Api.call('stock.init', {...}) คืนค่า data หรือ throw Error (err.code = 'PIN' | 'OFFLINE' | 'SETUP') */
(function () {
  'use strict';
  function pin() { try { return localStorage.getItem('apiPin') || ''; } catch (_) { return ''; } }
  function err(msg, code) { var e = new Error(msg); e.code = code || ''; return e; }
  window.Api = {
    pin: pin,
    setPin: function (p) { try { localStorage.setItem('apiPin', p); } catch (_) {} },
    clearPin: function () { try { localStorage.removeItem('apiPin'); } catch (_) {} },
    ready: function () { return !!(window.APP_CONFIG && APP_CONFIG.API_URL); },
    call: function (action, params, timeoutMs) {
      if (!this.ready()) return Promise.reject(err('ยังไม่ได้ตั้งลิงก์ API ใน config.js', 'SETUP'));
      if (!navigator.onLine) return Promise.reject(err('ไม่มีเน็ต', 'OFFLINE'));
      var body = Object.assign({ action: action, pin: pin() }, params || {});
      var ctl = window.AbortController ? new AbortController() : null;
      var timer = setTimeout(function () { if (ctl) ctl.abort(); }, timeoutMs || 30000);
      return fetch(APP_CONFIG.API_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },   // text/plain = ไม่ติด CORS preflight
        body: JSON.stringify(body),
        redirect: 'follow',
        signal: ctl ? ctl.signal : undefined
      }).then(function (r) { return r.json(); }).then(function (j) {
        clearTimeout(timer);
        if (!j.ok) throw err(j.error || 'เกิดข้อผิดพลาด', j.code);
        return j.data;
      }, function (e) {
        clearTimeout(timer);
        if (e && e.code) throw e;
        throw err('เชื่อมต่อไม่ได้ (เน็ตไม่ดี?)', 'OFFLINE');
      });
    }
  };
})();
