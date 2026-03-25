# 🧮 Kru Pug — ศูนย์รวมสื่อคณิตศาสตร์

> ระบบ Education Platform ครบวงจร สำหรับครู นักเรียน และผู้ปกครอง

## 🚀 ฟีเจอร์หลัก

| ฟีเจอร์ | รายละเอียด |
|---------|-----------|
| 🎓 **พอร์ทัลนักเรียน** | Dashboard, AI Chat, แบบทดสอบ, ความก้าวหน้า |
| 📝 **แบบทดสอบ** | สร้างข้อสอบ, AI QuizGen, ส่งคะแนนผ่าน LINE |
| 🎮 **Math Arena** | เกมคณิตศาสตร์ 4 ประเภท (บวก ลบ คูณ หาร) |
| 📊 **Admin Dashboard** | Chart.js กราฟ, จัดการนักเรียน/ครู/ห้องเรียน |
| 📅 **ตารางสอน** | Calendar รายสัปดาห์ + Google Meet ลิงก์ |
| ✅ **เช็คชื่อ** | QR Code + เช็คชื่อออนไลน์ |
| 👨‍👩‍👧 **ผู้ปกครอง** | ดูคะแนน/เข้าเรียนลูก |
| 💬 **แชท** | Socket.io real-time chat |
| 📄 **ใบรายงานผล** | PDF Report Card |
| 🏆 **Badge System** | เหรียญรางวัลอัตโนมัติ |
| 📋 **Excel Export** | ดาวน์โหลดข้อมูลเป็น .xlsx |

## 🛠️ เทคโนโลยี

- **Backend:** Node.js, Express, Socket.io
- **Database:** MySQL (Railway)
- **Frontend:** HTML5, CSS3, JavaScript, Chart.js
- **Security:** bcrypt, helmet, rate-limit, XSS protection
- **PWA:** Service Worker, manifest.json

## ⚙️ Installation

```bash
# Clone
git clone https://github.com/paopaonyapi-creator/KruPoengMangClone.git
cd KruPoengMangClone

# Install
npm install

# ตั้งค่า Environment Variables
cp .env.example .env
# แก้ไข .env ใส่ค่าที่ต้องการ

# Run
npm start
# หรือ
node server.js
```

## 🔐 Environment Variables

| ตัวแปร | คำอธิบาย | ค่าเริ่มต้น |
|--------|---------|-----------|
| `DB_HOST` | MySQL Host | localhost |
| `DB_USER` | MySQL User | root |
| `DB_PASS` | MySQL Password | - |
| `DB_NAME` | MySQL Database | krupug_db |
| `ADMIN_PASSWORD` | Admin Login | admin1234 |
| `JWT_SECRET` | JWT Secret Key | auto-generate |
| `OPENROUTER_API_KEY` | OpenRouter AI API | - |
| `TELEGRAM_BOT_TOKEN` | Telegram Bot Token | - |
| `TELEGRAM_CHAT_ID` | Telegram Chat ID | - |
| `LINE_CHANNEL_ACCESS_TOKEN` | LINE Messaging API | - |

## 📁 โครงสร้างไฟล์

```
KruPoengMangClone/
├── server.js          # Backend API (Express + Socket.io)
├── index.html         # Landing page
├── index.css          # Global styles (glassmorphism)
├── app.js             # Frontend JS (landing page)
├── student.html       # Student portal
├── admin.html         # Admin panel
├── admin.js           # Admin JS
├── quiz.html          # Quiz system
├── game.html          # Math Arena game
├── calendar.html      # Teaching schedule
├── attendance.html    # Attendance check
├── checkin.html       # QR Check-in
├── teacher.html       # Teacher portal
├── parent.html        # Parent portal
├── sw.js              # Service Worker (PWA)
├── manifest.json      # PWA manifest
├── i18n.js            # ภาษา TH/EN
└── uploads/           # File uploads
```

## 🔒 Security Features

- ✅ **bcrypt** password hashing
- ✅ **helmet** HTTP headers
- ✅ **rate-limit** 10 attempts / 15 min
- ✅ **XSS** sanitization
- ✅ **JWT** admin authentication
- ✅ **CORS** enabled

## 📊 API Endpoints

### Public
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/content/:type` | ดึงเนื้อหา |
| POST | `/api/student/login` | Student login |
| POST | `/api/parent/login` | Parent login |
| GET | `/api/school/info` | School info |

### Student (Auth)
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/student/dashboard` | Dashboard stats |
| POST | `/api/student/forgot-password` | Request reset |
| POST | `/api/student/reset-password` | Reset password |
| GET | `/api/student/report-pdf/:id` | PDF Report Card |
| GET | `/api/student/badges/:id` | View badges |

### Admin (Auth)
| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/auth/login` | Admin login |
| GET | `/api/admin/analytics/quiz-scores` | Quiz charts |
| GET | `/api/admin/export/students` | Export students |
| GET | `/api/admin/export/quiz-results` | Export results |
| POST | `/api/admin/seed` | Seed demo data |
| POST | `/api/admin/seed-quizzes` | Seed quizzes |

### Game
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/game/math/question` | Get math question |
| POST | `/api/game/math/score` | Submit score |
| GET | `/api/game/math/leaderboard` | Leaderboard |

## 🚀 Deploy

ระบบ deploy บน **Railway** ด้วยคำสั่ง:
```bash
railway up
```

## 📝 License

MIT License — ครูพัก (Pug) คณิตศาสตร์
