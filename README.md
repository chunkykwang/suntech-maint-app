# Suntech Maintenance App (v1)

แอปงานซ่อมบำรุงสำหรับช่าง (PM checklist, Vacuum pump monitor, นับ stock part)
ติดตั้งลงมือถือ / tablet ได้ และเปิดใช้งานได้แม้สัญญาณเน็ตไม่ดี

- หน้าเว็บ (ไฟล์ใน repo นี้) อยู่บน GitHub Pages
- ข้อมูลจริงอยู่ใน Google Sheets / Drive เข้าถึงผ่าน Apps Script API เท่านั้น
- **ห้ามใส่รหัสผ่าน, token, ID ของ Google Sheet หรือข้อมูลจัดซื้อ (PAIS) ลงใน repo นี้** — repo เป็น public

## โครงไฟล์
| ไฟล์ | หน้าที่ |
|---|---|
| `index.html` / `app.css` / `app.js` | หน้าแอป |
| `manifest.webmanifest` + `icons/` | ข้อมูลสำหรับติดตั้งเป็นแอป |
| `sw.js` | เก็บตัวแอปไว้ในเครื่องให้เปิดได้ตอน offline — **เปลี่ยน `VERSION` ทุกครั้งที่แก้ไฟล์** |

## สถานะ
- [x] App shell: ติดตั้งได้ + เปิด offline ได้
- [ ] Apps Script API (ต้องมี PIN ของเครื่อง)
- [ ] นับ stock part
- [ ] Vacuum pump monitor
- [ ] PM checklist
