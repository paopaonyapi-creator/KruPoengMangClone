# 🎓 Kru Pug Hub — ศูนย์รวมสื่อคณิตศาสตร์

[![Deploy on Railway](https://img.shields.io/badge/Deploy-Railway-blueviolet)](https://railway.app)
[![Node.js](https://img.shields.io/badge/Node.js-18+-green)](https://nodejs.org)
[![License](https://img.shields.io/badge/license-MIT-blue)](LICENSE)

> ระบบบริหารจัดการห้องเรียนคณิตศาสตร์ครบวงจร สำหรับ **ครูพัก** — ออกแบบมาเพื่อครูไทยโดยเฉพาะ

## ✨ ฟีเจอร์หลัก

| ฟีเจอร์ | รายละเอียด |
|---------|-----------|
| 📝 **แบบทดสอบออนไลน์** | สร้างข้อสอบ 4 ตัวเลือก + ตั้งเวลา + ตรวจอัตโนมัติ |
| 🎓 **พอร์ทัลนักเรียน** | Dashboard, EXP, Level, Badges, Analytics |
| 👨‍👩‍👧 **พอร์ทัลผู้ปกครอง** | ดูผลการเรียน + ประวัติเช็คชื่อ + เหรียญรางวัล |
| 📱 **QR Code เช็คชื่อ** | ครูสร้าง QR → นักเรียนสแกนเช็คชื่อ |
| 🤖 **AI Tutor** | ถามคณิตศาสตร์ได้ตลอด (OpenRouter API) |
| 💬 **Real-time Chat** | ห้องแชทพร้อม Emoji Picker + Socket.IO |
| 📊 **Admin Dashboard** | สถิติ, กราฟ, จัดการข้อมูล, Export CSV |
| 📅 **ปฏิทินกิจกรรม** | ตารางสอน + กิจกรรมรายสัปดาห์ |
| 🔔 **แจ้งเตือน** | Telegram + LINE Notify |
| 🌙 **Dark/Light Mode** | สลับธีมได้ |
| 🌐 **สองภาษา** | ไทย / English |
| 📱 **PWA** | ติดตั้งเป็น App บนมือถือ |

## 🚀 Getting Started

### Prerequisites
- Node.js 18+
- MySQL (optional — มี Demo mode fallback)

### Installation

```bash
# Clone
git clone https://github.com/paopaonyapi-creator/KruPoengMangClone.git
cd KruPoengMangClone

# Install dependencies
npm install

# Setup environment
cp .env.example .env
# แก้ไข .env ตามต้องการ

# Run
npm start
# หรือ
node server.js
```

### Environment Variables (.env)

```env
PORT=3000
DB_HOST=localhost
DB_USER=root
DB_PASSWORD=
DB_NAME=krupug
ADMIN_USER=admin
ADMIN_PASS=pugadmin2024
OPENROUTER_API_KEY=your_key_here
TELEGRAM_BOT_TOKEN=your_bot_token
TELEGRAM_CHAT_ID=your_chat_id
LINE_NOTIFY_TOKEN=your_line_token
```

> 💡 **ไม่มี MySQL?** ไม่ต้องห่วง! ระบบจะใช้ Demo Data อัตโนมัติ

## 📁 Project Structure

```
KruPoengMangClone/
├── server.js          # Express + Socket.IO server
├── index.html         # หน้าหลัก
├── admin.html         # Admin Dashboard
├── student.html       # พอร์ทัลนักเรียน
├── parent.html        # พอร์ทัลผู้ปกครอง
├── quiz.html          # ระบบแบบทดสอบ
├── calendar.html      # ปฏิทินกิจกรรม
├── checkin.html       # หน้าเช็คชื่อ QR Code
├── index.css          # Global styles
├── i18n.js            # Internationalization
├── sw.js              # Service Worker (PWA)
├── manifest.json      # PWA manifest
└── .env               # Environment variables
```

## 🔐 Demo Credentials

| Portal | ID | Password/Code |
|--------|-----|---------|
| 🔐 Admin | `admin` | `pugadmin2024` |
| 🎓 นักเรียน | ID อะไรก็ได้ | `1234` |
| 👨‍👩‍👧 ผู้ปกครอง | ID อะไรก็ได้ | `PARENT01` |

## 🛠️ Tech Stack

- **Backend**: Node.js, Express, Socket.IO
- **Database**: MySQL (optional)
- **Frontend**: Vanilla JS, CSS3 (Glassmorphism)
- **AI**: OpenRouter API
- **Notifications**: Telegram Bot, LINE Notify
- **Charts**: Chart.js
- **PDF**: jsPDF
- **QR Code**: qrcode
- **Security**: Helmet, bcryptjs, XSS sanitize, Rate limiting

## 📄 License

MIT License — Made with ❤️ by Kru Pug
