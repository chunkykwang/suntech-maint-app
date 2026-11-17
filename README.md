# Suntech Maintenance App (v1)

แอปงานซ่อมบำรุงสำหรับช่าง (PM checklist, Vacuum pump monitor, นับ stock part)
ติดตั้งลงมือถือ / tablet ได้ และเปิดใช้งานได้แม้สัญญาณเน็ตไม่ดี

- หน้าเว็บ (ไฟล์ใน repo นี้) อยู่บน GitHub Pages
- ข้อมูลจริงอยู่ใน Google Sheets / Drive เข้าถึงผ่าน Apps Script API เท่านั้น
- **ห้ามใส่รหัสผ่าน, token, ID ของ Google Sheet หรือข้อมูลจัดซื้อ (PAIS) ลงใน repo นี้** — repo เป็น public

## โครงไฟล์
| ไฟล์ | หน้าที่ |
|---|---|
| `index.html` / `app.css` / `app.js` | หน้าแรก: เข้าสู่ระบบ (เลือกชื่อ, admin ใส่รหัส) → เมนู |
| `session.js` | ผู้ใช้ที่เข้าสู่ระบบ ใช้ร่วมทุกหน้า (หน้าย่อยกลับไปหน้าแรกถ้ายังไม่ได้เข้าสู่ระบบ) |
| `manifest.webmanifest` + `icons/` | ข้อมูลสำหรับติดตั้งเป็นแอป |
| `config.js` | ลิงก์ API (Apps Script Web app) — ห้ามใส่ PIN |
| `api.js` / `store.js` | เรียก API / เก็บข้อมูลและคิวรอส่งในเครื่อง (IndexedDB) |
| `stock.html` / `stock.js` / `stock.css` | นับ stock part (offline ได้) |
| `repair.html` / `repair.js` / `repair.css` | แจ้งซ่อม: ใบใหม่ / งานรอปิด / ใบแจ้งซ่อมที่ส่งแล้ว (ดูรายละเอียดทั้งใบ) / จ่ายงาน (admin) · offline ได้ · ลิงก์ไฟล์ Drive มาจาก `sheetUrl` ใน `repair.init` · admin เห็นทุกใบจาก action `repair.list` |
| `pm.html` / `pm-shim.js` | PM checklist: หน้าเดิมของ v0 + ตัวเก็บข้อมูล/รูปในเครื่อง + คิวรอส่งผล (offline ได้) |
| `parts.html` / `parts.js` / `parts.css` | Stock part system: Part list (ทุกคน, offline ได้) / Part registration (admin) |
| `pump.html` | Vacuum pump monitor (ดูอย่างเดียว, offline ได้, ไม่มีข้อมูล PAIS) |
| `sw.js` | เก็บตัวแอปไว้ในเครื่องให้เปิดได้ตอน offline — **เปลี่ยน `VERSION` ทุกครั้งที่แก้ไฟล์** |

## สถานะ
- [x] App shell: ติดตั้งได้ + เปิด offline ได้
- [x] Apps Script API (ต้องมี PIN ของเครื่อง) — โค้ดฝั่ง Apps Script อยู่ใน Google ไม่อยู่ใน repo นี้
- [x] นับ stock part (offline + คิวรอส่ง + กันส่งซ้ำ) — รอใส่ลิงก์ API ใน config.js
- [x] แจ้งซ่อม (offline + รูปเข้าคิว + กันส่งซ้ำ) — ข้อมูลเครื่อง/Sector แก้ที่ SMM_Repair_DB
- [x] Vacuum pump monitor (ข้อมูลเก็บในเครื่อง, แตะอัปเดตเมื่อมีข้อมูลใหม่)
- [x] PM checklist (รายการตรวจจาก Checklist_by_Type, แผนจาก Schedule + Plan, รูปโหลดเก็บในเครื่อง, คิวรอส่ง + กันส่งซ้ำ)
