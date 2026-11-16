/* ผู้ใช้ที่เข้าสู่ระบบ (ใช้ร่วมทุกหน้า) — เลือกชื่อที่หน้าแรก, admin ต้องใส่รหัส (ตรวจที่เซิร์ฟเวอร์)
 * Session.user() / Session.isAdmin() / Session.adminPw() / Session.set(u, pw) / Session.logout()
 * Session.require() — หน้าย่อยเรียกตอนเริ่ม ถ้ายังไม่ได้เข้าสู่ระบบจะกลับไปหน้าแรก
 */
(function () {
  'use strict';
  var ADMIN = 'admin', K_USER = 'app_user', K_PW = 'app_adminPw';
  function ls(k, v) {
    try {
      if (v === undefined) return localStorage.getItem(k) || '';
      if (v === null) localStorage.removeItem(k); else localStorage.setItem(k, v);
    } catch (_) { return ''; }
    return '';
  }
  // ย้ายจากของเดิมที่เลือกผู้ใช้ในหน้าแจ้งซ่อม
  if (!ls(K_USER) && ls('rr_user') && (ls('rr_user') !== ADMIN || ls('rr_adminPw'))) {
    ls(K_USER, ls('rr_user')); if (ls('rr_adminPw')) ls(K_PW, ls('rr_adminPw'));
  }
  ls('rr_user', null); ls('rr_adminPw', null);

  window.Session = {
    ADMIN: ADMIN,
    user: function () { return ls(K_USER); },
    isAdmin: function () { return ls(K_USER) === ADMIN && !!ls(K_PW); },
    adminPw: function () { return ls(K_PW); },
    set: function (u, pw) { ls(K_USER, u); ls(K_PW, u === ADMIN ? pw : null); },
    clear: function () { ls(K_USER, null); ls(K_PW, null); },
    logout: function () { this.clear(); location.href = './'; },
    require: function () {
      var u = ls(K_USER);
      if (!u || (u === ADMIN && !ls(K_PW))) { location.replace('./'); return false; }
      return true;
    }
  };
})();
