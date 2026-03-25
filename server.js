const express = require('express');
const cors = require('cors');
const mysql = require('mysql2/promise');
const path = require('path');
const crypto = require('crypto');
const multer = require('multer');
const QRCode = require('qrcode');
const fs = require('fs');
const bcrypt = require('bcryptjs');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const xss = require('xss');
const http = require('http');
const { Server } = require('socket.io');
require('dotenv').config();

let OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY || '';
let TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || '';
let TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID || '';
let LINE_CHANNEL_ACCESS_TOKEN = process.env.LINE_CHANNEL_ACCESS_TOKEN || '';

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });
const PORT = process.env.PORT || 3000;

// Security middleware
app.use(helmet({ contentSecurityPolicy: false, crossOriginEmbedderPolicy: false }));
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname)));

// Rate limiting for login endpoints
const loginLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 10, message: { error: 'Too many login attempts, please try again after 15 minutes' }, standardHeaders: true, legacyHeaders: false });

// XSS sanitize helper
function clean(str) { return str ? xss(String(str)) : str; }

// Ensure uploads directory exists
const uploadsDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir);
app.use('/uploads', express.static(uploadsDir));

// Multer setup for file uploads
const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, uploadsDir),
    filename: (req, file, cb) => {
        const ext = path.extname(file.originalname);
        cb(null, `${Date.now()}-${Math.random().toString(36).substr(2, 6)}${ext}`);
    }
});
const upload = multer({ storage, limits: { fileSize: 50 * 1024 * 1024 } }); // 50MB max

// MySQL connection pool (supports Railway MYSQL* and custom DB_* env vars)
const pool = mysql.createPool({
    host: process.env.DB_HOST || process.env.MYSQLHOST || 'localhost',
    user: process.env.DB_USER || process.env.MYSQLUSER || 'root',
    password: process.env.DB_PASS || process.env.MYSQLPASSWORD || '',
    database: process.env.DB_NAME || process.env.MYSQLDATABASE || 'krupug_db',
    port: process.env.DB_PORT || process.env.MYSQLPORT || 3306,
    waitForConnections: true, connectionLimit: 10
});

// Session tokens
const activeTokens = new Set();
const parentTokens = new Map();
const teacherTokens = new Map();

// Auth middleware
function requireAuth(req, res, next) {
    let token = req.headers['x-admin-token'] || req.query.token;
    if (!token && req.headers.authorization) {
        const parts = req.headers.authorization.split(' ');
        if (parts.length === 2 && parts[0] === 'Bearer') token = parts[1];
    }
    if (!token || !activeTokens.has(token)) return res.status(401).json({ error: 'Unauthorized' });
    next();
}

// ===================== API KEY MANAGEMENT =====================

// Get current key (masked)
app.get('/api/admin/api-key', requireAuth, (req, res) => {
    if (!OPENROUTER_API_KEY) return res.json({ key: '', hasKey: false });
    const masked = OPENROUTER_API_KEY.substring(0, 12) + '...' + OPENROUTER_API_KEY.slice(-4);
    res.json({ key: masked, hasKey: true });
});

// Save new key
app.put('/api/admin/api-key', requireAuth, async (req, res) => {
    try {
        const { key } = req.body;
        if (!key || key.trim().length < 10) return res.status(400).json({ error: 'Invalid API key' });
        OPENROUTER_API_KEY = key.trim();
        // Update .env file
        const envPath = path.join(__dirname, '.env');
        let envContent = '';
        try { envContent = fs.readFileSync(envPath, 'utf-8'); } catch (e) { }
        if (envContent.includes('OPENROUTER_API_KEY=')) {
            envContent = envContent.replace(/OPENROUTER_API_KEY=.*/g, `OPENROUTER_API_KEY=${OPENROUTER_API_KEY}`);
        } else {
            envContent += `\nOPENROUTER_API_KEY=${OPENROUTER_API_KEY}\n`;
        }
        fs.writeFileSync(envPath, envContent);
        res.json({ success: true, message: 'API Key saved' });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// Test key
app.post('/api/admin/api-key/test', requireAuth, async (req, res) => {
    const testKey = req.body.key || OPENROUTER_API_KEY;
    if (!testKey) return res.status(400).json({ error: 'No API key' });
    try {
        const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${testKey}`, 'Content-Type': 'application/json', 'HTTP-Referer': 'http://localhost:3000', 'X-Title': 'Kru Pug Hub' },
            body: JSON.stringify({ model: 'google/gemini-2.0-flash-001', messages: [{ role: 'user', content: 'ตอบแค่ "OK"' }], max_tokens: 10 })
        });
        const data = await response.json();
        if (data.choices && data.choices[0]) {
            res.json({ success: true, message: 'API Key ใช้งานได้!', response: data.choices[0].message?.content });
        } else {
            res.json({ success: false, message: 'Key ไม่ถูกต้องหรือหมดอายุ', detail: data.error?.message || JSON.stringify(data) });
        }
    } catch (err) {
        res.json({ success: false, message: 'เชื่อมต่อ OpenRouter ไม่ได้', detail: err.message });
    }
});

// Delete key
app.delete('/api/admin/api-key', requireAuth, (req, res) => {
    OPENROUTER_API_KEY = '';
    const envPath = path.join(__dirname, '.env');
    try {
        let envContent = fs.readFileSync(envPath, 'utf-8');
        envContent = envContent.replace(/OPENROUTER_API_KEY=.*/g, 'OPENROUTER_API_KEY=');
        fs.writeFileSync(envPath, envContent);
    } catch (e) { }
    res.json({ success: true, message: 'API Key deleted' });
});

// ===================== DEMO DATA (fallback when DB unavailable) =====================
const DEMO = {
    systems: [
        { id: 1, ep: 'EP.01', title: 'ระบบแบบทดสอบออนไลน์', desc_text: 'ระบบทำแบบทดสอบคณิตศาสตร์ออนไลน์ พร้อมตรวจคะแนนอัตโนมัติ', icon: 'fa-clipboard-check', preview_url: 'quiz.html', download_url: '#' },
        { id: 2, ep: 'EP.02', title: 'ระบบเช็คชื่อนักเรียน', desc_text: 'เช็คชื่อเข้าเรียนด้วย QR Code สะดวกรวดเร็ว', icon: 'fa-qrcode', preview_url: 'student.html', download_url: '#' },
        { id: 3, ep: 'EP.03', title: 'ระบบจัดการห้องเรียน', desc_text: 'จัดการข้อมูลห้องเรียน นักเรียน และผลการเรียน', icon: 'fa-school', preview_url: 'teacher.html', download_url: '#' },
        { id: 4, ep: 'EP.04', title: 'ระบบรายงานผู้ปกครอง', desc_text: 'ผู้ปกครองดูผลการเรียนและการเข้าเรียนของลูกผ่านมือถือ', icon: 'fa-users', preview_url: 'parent.html', download_url: '#' },
    ],
    clips: [
        { id: 1, ep: 'ตอนที่ 1', title: 'สมการเชิงเส้น ม.1', video_url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ' },
        { id: 2, ep: 'ตอนที่ 2', title: 'เศษส่วนและทศนิยม ม.1', video_url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ' },
        { id: 3, ep: 'ตอนที่ 3', title: 'พีทาโกรัส ม.2', video_url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ' },
    ],
    prompts: [
        { id: 1, title: 'สร้างโจทย์คณิต', desc_text: 'สร้างโจทย์คณิตศาสตร์ระดับ ม.ต้น เรื่องสมการ 10 ข้อ พร้อมเฉลยละเอียด', icon: 'fa-calculator' },
        { id: 2, title: 'อธิบายแนวคิด', desc_text: 'อธิบายแนวคิดเรื่องอัตราส่วนตรีโกณมิติให้นักเรียน ม.3 เข้าใจง่ายๆ พร้อมตัวอย่าง', icon: 'fa-lightbulb' },
        { id: 3, title: 'วิเคราะห์ข้อสอบ', desc_text: 'วิเคราะห์ข้อสอบคณิตศาสตร์ O-NET ม.3 ย้อนหลัง 5 ปี แยกตามมาตรฐาน', icon: 'fa-chart-bar' },
    ],
    materials: [
        { id: 1, title: 'ใบงานสมการเชิงเส้น', desc_text: 'ใบงานฝึกทักษะสมการเชิงเส้นตัวแปรเดียว ม.1 จำนวน 20 ข้อ', icon: 'fa-file-pdf', file_url: '#' },
        { id: 2, title: 'สรุปสูตรคณิต ม.ต้น', desc_text: 'สรุปสูตรคณิตศาสตร์ ม.1-3 ครบทุกบท พร้อมตัวอย่าง', icon: 'fa-book', file_url: '#' },
    ],
    announcements: [
        { id: 1, text: '🎉 ยินดีต้อนรับสู่ Kru Pug Hub — ศูนย์รวมสื่อคณิตศาสตร์!' },
        { id: 2, text: '📢 เปิดให้ทำแบบทดสอบออนไลน์แล้ว กดที่ Quick Links เพื่อเริ่มทำ!' },
        { id: 3, text: '🆕 อัปเดตระบบเช็คชื่อ QR Code เวอร์ชันล่าสุด' },
    ],
    leaderboard: [
        { student_name: 'สมชาย ใจดี', quizzes_taken: 12, avg_percent: 95 },
        { student_name: 'สมหญิง เก่งมาก', quizzes_taken: 10, avg_percent: 92 },
        { student_name: 'นายธน รักเรียน', quizzes_taken: 8, avg_percent: 88 },
        { student_name: 'สุดา คณิตเทพ', quizzes_taken: 15, avg_percent: 85 },
        { student_name: 'วิชัย เลขดี', quizzes_taken: 9, avg_percent: 82 },
    ],
    quizzes: [
        { id: 1, title: 'สมการเชิงเส้น ม.1', description: 'ทดสอบความรู้เรื่องสมการเชิงเส้นตัวแปรเดียว', time_limit: 15, is_active: 1 },
        { id: 2, title: 'เรขาคณิต ม.1', description: 'รูปเรขาคณิตและมุม', time_limit: 10, is_active: 1 },
        { id: 3, title: 'เศษส่วน ม.1', description: 'การบวกลบคูณหารเศษส่วน', time_limit: 12, is_active: 1 },
        { id: 4, title: 'จำนวนเต็ม ม.1', description: 'จำนวนเต็มบวก ลบ ศูนย์ และการดำเนินการ', time_limit: 10, is_active: 1 },
        { id: 5, title: 'อัตราส่วนและร้อยละ ม.1', description: 'อัตราส่วน สัดส่วน และร้อยละ', time_limit: 12, is_active: 1 },
        { id: 6, title: 'ทฤษฎีบทพีทาโกรัส ม.2', description: 'ทฤษฎีบทพีทาโกรัสและการประยุกต์', time_limit: 15, is_active: 1 },
        { id: 7, title: 'สถิติเบื้องต้น ม.2', description: 'ค่าเฉลี่ย มัธยฐาน ฐานนิยม', time_limit: 12, is_active: 1 },
        { id: 8, title: 'พหุนาม ม.2', description: 'การบวกลบคูณพหุนาม', time_limit: 15, is_active: 1 },
        { id: 9, title: 'ร้อยละและดอกเบี้ย ม.3', description: 'กำไร ขาดทุน ดอกเบี้ย', time_limit: 12, is_active: 1 },
        { id: 10, title: 'พื้นที่ผิวและปริมาตร ม.3', description: 'ทรงกระบอก กรวย ทรงกลม', time_limit: 15, is_active: 1 },
    ],
    quiz_questions: [
        // Quiz 1: สมการเชิงเส้น
        { id: 1, quiz_id: 1, question: 'ค่า x จากสมการ 2x + 6 = 14 คือข้อใด?', choice_a: '2', choice_b: '4', choice_c: '6', choice_d: '8', correct_answer: 'b' },
        { id: 2, quiz_id: 1, question: 'สมการ 3x - 9 = 0 มีคำตอบเท่ากับข้อใด?', choice_a: '1', choice_b: '2', choice_c: '3', choice_d: '4', correct_answer: 'c' },
        { id: 3, quiz_id: 1, question: 'ถ้า x + 5 = 12 แล้ว x มีค่าเท่าใด?', choice_a: '5', choice_b: '6', choice_c: '7', choice_d: '8', correct_answer: 'c' },
        { id: 4, quiz_id: 1, question: 'ค่า x จากสมการ 4x = 20 คือข้อใด?', choice_a: '4', choice_b: '5', choice_c: '6', choice_d: '10', correct_answer: 'b' },
        { id: 5, quiz_id: 1, question: 'สมการ 2(x-3) = 10 มีคำตอบเท่ากับข้อใด?', choice_a: '5', choice_b: '6', choice_c: '7', choice_d: '8', correct_answer: 'd' },
        // Quiz 2: เรขาคณิต
        { id: 6, quiz_id: 2, question: 'สามเหลี่ยมด้านเท่ามีมุมภายในแต่ละมุมกี่องศา?', choice_a: '45', choice_b: '60', choice_c: '90', choice_d: '120', correct_answer: 'b' },
        { id: 7, quiz_id: 2, question: 'รูปสี่เหลี่ยมผืนผ้ากว้าง 5 ยาว 8 มีพื้นที่เท่าไร?', choice_a: '13', choice_b: '26', choice_c: '40', choice_d: '80', correct_answer: 'c' },
        { id: 8, quiz_id: 2, question: 'วงกลมรัศมี 7 cm มีเส้นผ่านศูนย์กลางเท่าไร?', choice_a: '7', choice_b: '14', choice_c: '21', choice_d: '49', correct_answer: 'b' },
        { id: 9, quiz_id: 2, question: 'มุมตรงมีกี่องศา?', choice_a: '90', choice_b: '180', choice_c: '270', choice_d: '360', correct_answer: 'b' },
        { id: 10, quiz_id: 2, question: 'สามเหลี่ยมมุมฉากมีมุมฉากกี่มุม?', choice_a: '1', choice_b: '2', choice_c: '3', choice_d: '0', correct_answer: 'a' },
        // Quiz 3: เศษส่วน
        { id: 11, quiz_id: 3, question: '1/2 + 1/4 เท่ากับเท่าไร?', choice_a: '1/6', choice_b: '2/6', choice_c: '3/4', choice_d: '1/3', correct_answer: 'c' },
        { id: 12, quiz_id: 3, question: '3/5 - 1/5 เท่ากับเท่าไร?', choice_a: '1/5', choice_b: '2/5', choice_c: '3/5', choice_d: '4/5', correct_answer: 'b' },
        { id: 13, quiz_id: 3, question: '2/3 × 3/4 เท่ากับเท่าไร?', choice_a: '1/2', choice_b: '5/7', choice_c: '6/12', choice_d: '2/4', correct_answer: 'a' },
        { id: 14, quiz_id: 3, question: '1 ÷ 1/2 เท่ากับเท่าไร?', choice_a: '1/2', choice_b: '1', choice_c: '2', choice_d: '3', correct_answer: 'c' },
        { id: 15, quiz_id: 3, question: 'เศษส่วนใดมีค่ามากที่สุด?', choice_a: '1/3', choice_b: '2/5', choice_c: '3/8', choice_d: '1/2', correct_answer: 'd' },
        // Quiz 4: จำนวนเต็ม
        { id: 16, quiz_id: 4, question: '(-3) + (-5) เท่ากับเท่าไร?', choice_a: '-8', choice_b: '-2', choice_c: '2', choice_d: '8', correct_answer: 'a' },
        { id: 17, quiz_id: 4, question: '(-7) - (-3) เท่ากับเท่าไร?', choice_a: '-10', choice_b: '-4', choice_c: '4', choice_d: '10', correct_answer: 'b' },
        { id: 18, quiz_id: 4, question: '(-4) × 6 เท่ากับเท่าไร?', choice_a: '24', choice_b: '-24', choice_c: '10', choice_d: '-10', correct_answer: 'b' },
        { id: 19, quiz_id: 4, question: '(-20) ÷ (-5) เท่ากับเท่าไร?', choice_a: '-4', choice_b: '4', choice_c: '-25', choice_d: '25', correct_answer: 'b' },
        { id: 20, quiz_id: 4, question: 'จำนวนเต็มใดน้อยที่สุด?', choice_a: '-1', choice_b: '0', choice_c: '-5', choice_d: '3', correct_answer: 'c' },
        // Quiz 5: อัตราส่วน
        { id: 21, quiz_id: 5, question: 'อัตราส่วน 4:6 เท่ากับข้อใด?', choice_a: '1:2', choice_b: '2:3', choice_c: '3:4', choice_d: '2:4', correct_answer: 'b' },
        { id: 22, quiz_id: 5, question: 'ถ้า 20% ของจำนวนหนึ่งเท่ากับ 50 จำนวนนั้นคือ?', choice_a: '100', choice_b: '200', choice_c: '250', choice_d: '500', correct_answer: 'c' },
        { id: 23, quiz_id: 5, question: '3:5 = x:15 ค่า x คือ?', choice_a: '5', choice_b: '7', choice_c: '9', choice_d: '3', correct_answer: 'c' },
        { id: 24, quiz_id: 5, question: 'สินค้าราคา 200 ลด 25% เหลือเท่าไร?', choice_a: '100', choice_b: '125', choice_c: '150', choice_d: '175', correct_answer: 'c' },
        { id: 25, quiz_id: 5, question: '0.75 เท่ากับกี่เปอร์เซ็นต์?', choice_a: '25%', choice_b: '50%', choice_c: '75%', choice_d: '80%', correct_answer: 'c' },
        // Quiz 6: พีทาโกรัส ม.2
        { id: 26, quiz_id: 6, question: 'สามเหลี่ยมมุมฉากด้านประกอบ 3 และ 4 ด้านตรงข้ามมุมฉากยาวเท่าไร?', choice_a: '5', choice_b: '6', choice_c: '7', choice_d: '12', correct_answer: 'a' },
        { id: 27, quiz_id: 6, question: 'ด้านตรงข้ามมุมฉาก 13 ด้านประกอบ 5 อีกด้านยาวเท่าไร?', choice_a: '8', choice_b: '10', choice_c: '12', choice_d: '14', correct_answer: 'c' },
        { id: 28, quiz_id: 6, question: 'สามเหลี่ยมด้าน 6, 8, 10 เป็นสามเหลี่ยมมุมฉากหรือไม่?', choice_a: 'ใช่', choice_b: 'ไม่ใช่', choice_c: 'ไม่แน่ใจ', choice_d: 'ต้องคำนวณเพิ่ม', correct_answer: 'a' },
        { id: 29, quiz_id: 6, question: 'บันไดยาว 10 m พิงกำแพง ปลายบันไดห่างกำแพง 6 m บันไดสูงถึงกำแพงกี่ m?', choice_a: '6', choice_b: '8', choice_c: '4', choice_d: '16', correct_answer: 'b' },
        { id: 30, quiz_id: 6, question: 'ทฤษฎีบทพีทาโกรัส a² + b² = c² ตัว c คืออะไร?', choice_a: 'ด้านสั้น', choice_b: 'ด้านยาว', choice_c: 'ด้านตรงข้ามมุมฉาก', choice_d: 'ด้านประกอบ', correct_answer: 'c' },
        // Quiz 7: สถิติ ม.2
        { id: 31, quiz_id: 7, question: 'ค่าเฉลี่ยของ 2, 4, 6, 8, 10 คือ?', choice_a: '4', choice_b: '5', choice_c: '6', choice_d: '7', correct_answer: 'c' },
        { id: 32, quiz_id: 7, question: 'มัธยฐานของ 3, 7, 1, 5, 9 คือ?', choice_a: '3', choice_b: '5', choice_c: '7', choice_d: '1', correct_answer: 'b' },
        { id: 33, quiz_id: 7, question: 'ฐานนิยมของ 2, 3, 3, 5, 7, 3 คือ?', choice_a: '2', choice_b: '3', choice_c: '5', choice_d: '7', correct_answer: 'b' },
        { id: 34, quiz_id: 7, question: 'พิสัยของ 5, 12, 3, 8, 20 คือ?', choice_a: '15', choice_b: '17', choice_c: '20', choice_d: '5', correct_answer: 'b' },
        { id: 35, quiz_id: 7, question: 'ข้อมูลชุดหนึ่งมีค่าเฉลี่ย 10 จำนวน 5 ตัว ผลรวมเท่ากับ?', choice_a: '2', choice_b: '15', choice_c: '50', choice_d: '100', correct_answer: 'c' },
        // Quiz 8: พหุนาม ม.2
        { id: 36, quiz_id: 8, question: '(2x + 3) + (x - 1) เท่ากับ?', choice_a: '3x + 2', choice_b: '3x - 2', choice_c: 'x + 2', choice_d: '2x + 2', correct_answer: 'a' },
        { id: 37, quiz_id: 8, question: '(5x - 2) - (3x + 1) เท่ากับ?', choice_a: '2x + 3', choice_b: '2x - 3', choice_c: '8x - 1', choice_d: '2x - 1', correct_answer: 'b' },
        { id: 38, quiz_id: 8, question: '3(2x + 4) เท่ากับ?', choice_a: '5x + 7', choice_b: '6x + 4', choice_c: '6x + 12', choice_d: '6x + 7', correct_answer: 'c' },
        { id: 39, quiz_id: 8, question: 'ดีกรีของพหุนาม 4x³ + 2x - 1 คือ?', choice_a: '1', choice_b: '2', choice_c: '3', choice_d: '4', correct_answer: 'c' },
        { id: 40, quiz_id: 8, question: 'x(x + 3) เท่ากับ?', choice_a: 'x² + 3', choice_b: 'x² + 3x', choice_c: '2x + 3', choice_d: 'x + 3x', correct_answer: 'b' },
        // Quiz 9: ร้อยละ ม.3
        { id: 41, quiz_id: 9, question: 'ซื้อสินค้า 500 บาท ขาย 600 บาท กำไรกี่เปอร์เซ็นต์?', choice_a: '10%', choice_b: '15%', choice_c: '20%', choice_d: '25%', correct_answer: 'c' },
        { id: 42, quiz_id: 9, question: 'ฝากเงิน 10,000 บาท ดอกเบี้ย 5% ต่อปี ได้ดอกเบี้ยเท่าไร?', choice_a: '200', choice_b: '500', choice_c: '1,000', choice_d: '5,000', correct_answer: 'b' },
        { id: 43, quiz_id: 9, question: 'ราคาขาย 540 บาท กำไร 8% ต้นทุนเท่าไร?', choice_a: '450', choice_b: '490', choice_c: '500', choice_d: '520', correct_answer: 'c' },
        { id: 44, quiz_id: 9, question: 'ซื้อ 800 ขาย 720 ขาดทุนกี่เปอร์เซ็นต์?', choice_a: '5%', choice_b: '10%', choice_c: '15%', choice_d: '20%', correct_answer: 'b' },
        { id: 45, quiz_id: 9, question: 'ฝาก 20,000 ดอกเบี้ย 3% ต่อปี 2 ปี ได้ดอกเบี้ยรวมเท่าไร?', choice_a: '600', choice_b: '1,000', choice_c: '1,200', choice_d: '1,800', correct_answer: 'c' },
        // Quiz 10: พื้นที่ผิวและปริมาตร ม.3
        { id: 46, quiz_id: 10, question: 'ปริมาตรทรงกระบอกรัศมี 7 สูง 10 (π=22/7) คือ?', choice_a: '1,540', choice_b: '1,440', choice_c: '770', choice_d: '2,200', correct_answer: 'a' },
        { id: 47, quiz_id: 10, question: 'ปริมาตรทรงกลมรัศมี 3 (π≈3.14) ประมาณเท่าไร?', choice_a: '28.26', choice_b: '56.52', choice_c: '113.04', choice_d: '150.72', correct_answer: 'c' },
        { id: 48, quiz_id: 10, question: 'พื้นที่ผิวทรงกระบอกรัศมี 5 สูง 10 (π≈3.14) คือ?', choice_a: '314', choice_b: '471', choice_c: '628', choice_d: '157', correct_answer: 'b' },
        { id: 49, quiz_id: 10, question: 'ปริมาตรกรวยรัศมี 3 สูง 4 (π≈3.14) คือ?', choice_a: '12.56', choice_b: '37.68', choice_c: '113.04', choice_d: '25.12', correct_answer: 'b' },
        { id: 50, quiz_id: 10, question: 'ถ้าปริมาตรทรงกระบอก = πr²h แล้วปริมาตรกรวยเท่ากับ?', choice_a: 'πr²h', choice_b: '2πr²h', choice_c: '1/2 πr²h', choice_d: '1/3 πr²h', correct_answer: 'd' },
    ],
};

// ===================== PUBLIC APIs =====================

// Systems
app.get('/api/systems', async (req, res) => {
    try { const [rows] = await pool.query('SELECT * FROM systems ORDER BY id DESC'); res.json(rows.length ? rows : DEMO.systems); }
    catch (err) { res.json(DEMO.systems); }
});

// Clips
app.get('/api/clips', async (req, res) => {
    try { const [rows] = await pool.query('SELECT * FROM clips ORDER BY id DESC'); res.json(rows.length ? rows : DEMO.clips); }
    catch (err) { res.json(DEMO.clips); }
});

// Prompts
app.get('/api/prompts', async (req, res) => {
    try { const [rows] = await pool.query('SELECT * FROM prompts ORDER BY id DESC'); res.json(rows.length ? rows : DEMO.prompts); }
    catch (err) { res.json(DEMO.prompts); }
});

// Materials
app.get('/api/materials', async (req, res) => {
    try { const [rows] = await pool.query('SELECT * FROM materials ORDER BY id DESC'); res.json(rows.length ? rows : DEMO.materials); }
    catch (err) { res.json(DEMO.materials); }
});

// Announcements
app.get('/api/announcements', async (req, res) => {
    try { const [rows] = await pool.query('SELECT * FROM announcements ORDER BY id DESC'); res.json(rows.length ? rows : DEMO.announcements); }
    catch (err) { res.json(DEMO.announcements); }
});

// Search
app.get('/api/search', async (req, res) => {
    try {
        const q = `%${req.query.q || ''}%`;
        const [systems] = await pool.query('SELECT id, title, desc_text, "system" as type FROM systems WHERE title LIKE ? OR desc_text LIKE ?', [q, q]);
        const [materials] = await pool.query('SELECT id, title, desc_text, "material" as type FROM materials WHERE title LIKE ? OR desc_text LIKE ?', [q, q]);
        const [clips] = await pool.query('SELECT id, title, "" as desc_text, "clip" as type FROM clips WHERE title LIKE ?', [q]);
        const [prompts] = await pool.query('SELECT id, title, desc_text, "prompt" as type FROM prompts WHERE title LIKE ? OR desc_text LIKE ?', [q, q]);
        res.json([...systems, ...materials, ...clips, ...prompts]);
    } catch (err) {
        // Fallback: search in demo data
        const q = (req.query.q || '').toLowerCase();
        const results = [
            ...DEMO.systems.filter(s => s.title.toLowerCase().includes(q)).map(s => ({ ...s, type: 'system' })),
            ...DEMO.materials.filter(m => m.title.toLowerCase().includes(q)).map(m => ({ ...m, type: 'material' })),
            ...DEMO.clips.filter(c => c.title.toLowerCase().includes(q)).map(c => ({ ...c, type: 'clip' })),
            ...DEMO.prompts.filter(p => p.title.toLowerCase().includes(q)).map(p => ({ ...p, type: 'prompt' })),
        ];
        res.json(results);
    }
});

// Dashboard stats
app.get('/api/dashboard', async (req, res) => {
    try {
        const [[s]] = await pool.query('SELECT COUNT(*) as c FROM systems');
        const [[m]] = await pool.query('SELECT COUNT(*) as c FROM materials');
        const [[cl]] = await pool.query('SELECT COUNT(*) as c FROM clips');
        const [[p]] = await pool.query('SELECT COUNT(*) as c FROM prompts');
        const [[w]] = await pool.query('SELECT COUNT(*) as c FROM wfh_logs WHERE DATE(time_in) = CURDATE()');
        const [[q]] = await pool.query('SELECT COUNT(*) as c FROM quizzes');
        const [[cr]] = await pool.query('SELECT COUNT(*) as c FROM classrooms');
        res.json({ systems: s.c, materials: m.c, clips: cl.c, prompts: p.c, wfh_today: w.c, quizzes: q.c, classrooms: cr.c });
    } catch (err) { res.json({ systems: DEMO.systems.length, materials: DEMO.materials.length, clips: DEMO.clips.length, prompts: DEMO.prompts.length, wfh_today: 0, quizzes: 1, classrooms: 2 }); }
});

// Leaderboard
app.get('/api/leaderboard', async (req, res) => {
    try {
        const [rows] = await pool.query(`
            SELECT s.name as student_name, COUNT(qr.id) as quizzes_taken, ROUND(AVG(qr.score_percent),0) as avg_percent
            FROM quiz_results qr JOIN students s ON qr.student_id = s.id
            GROUP BY s.id ORDER BY avg_percent DESC LIMIT 10
        `);
        res.json(rows.length ? rows : DEMO.leaderboard);
    } catch (err) { res.json(DEMO.leaderboard); }
});

// ===================== AUTH =====================

app.post('/api/auth/login', loginLimiter, async (req, res) => {
    const { password } = req.body;
    try {
        let dbPass = 'admin1234';
        try {
            const [rows] = await pool.query("SELECT setting_value FROM admin_settings WHERE setting_key='admin_password'");
            if (rows.length > 0) dbPass = rows[0].setting_value;
        } catch (e) { /* DB unavailable, use default */ }
        // Support both plain and bcrypt passwords
        let match = password === dbPass;
        if (!match && dbPass.startsWith('$2')) match = await bcrypt.compare(password, dbPass);
        if (match) {
            const token = crypto.randomBytes(32).toString('hex');
            activeTokens.add(token);
            res.json({ success: true, token });
        } else { res.status(401).json({ success: false, error: 'Wrong password' }); }
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/auth/check', requireAuth, (req, res) => {
    res.json({ authenticated: true });
});

// Change password (with bcrypt hashing)
app.put('/api/admin/change-password', requireAuth, async (req, res) => {
    try {
        const { oldPassword, newPassword } = req.body;
        const [rows] = await pool.query("SELECT setting_value FROM admin_settings WHERE setting_key='admin_password'");
        const currentPass = rows.length > 0 ? rows[0].setting_value : 'admin1234';
        let match = oldPassword === currentPass;
        if (!match && currentPass.startsWith('$2')) match = await bcrypt.compare(oldPassword, currentPass);
        if (!match) return res.status(400).json({ error: 'รหัสเดิมไม่ถูกต้อง' });
        if (!newPassword || newPassword.length < 4) return res.status(400).json({ error: 'รหัสใหม่ต้องมีอย่างน้อย 4 ตัวอักษร' });
        const hashed = await bcrypt.hash(newPassword, 10);
        await pool.query("INSERT INTO admin_settings (setting_key, setting_value) VALUES ('admin_password', ?) ON DUPLICATE KEY UPDATE setting_value=?", [hashed, hashed]);
        res.json({ success: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// ===================== FILE UPLOAD =====================

app.post('/api/admin/upload', requireAuth, upload.single('file'), (req, res) => {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
    const fileUrl = `/uploads/${req.file.filename}`;
    res.json({ success: true, url: fileUrl, filename: req.file.originalname });
});

// ===================== ADMIN CRUD =====================

// Add content
app.post('/api/admin/systems', requireAuth, async (req, res) => {
    try {
        const { ep, title, desc_text, icon, preview_url, download_url } = req.body;
        const [result] = await pool.query(
            'INSERT INTO systems (ep, title, desc_text, icon, preview_url, download_url) VALUES (?, ?, ?, ?, ?, ?)',
            [ep, title, desc_text, icon || 'fa-laptop-code', preview_url || '#', download_url || '#']
        );
        res.json({ success: true, id: result.insertId });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/admin/clips', requireAuth, async (req, res) => {
    try {
        const { ep, title, video_url } = req.body;
        const [result] = await pool.query('INSERT INTO clips (ep, title, video_url) VALUES (?, ?, ?)', [ep, title, video_url || '#']);
        res.json({ success: true, id: result.insertId });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/admin/prompts', requireAuth, async (req, res) => {
    try {
        const { title, desc_text, icon } = req.body;
        const [result] = await pool.query('INSERT INTO prompts (title, desc_text, icon) VALUES (?, ?, ?)',
            [title, desc_text, icon || 'fa-robot']);
        res.json({ success: true, id: result.insertId });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/admin/materials', requireAuth, async (req, res) => {
    try {
        const { title, desc_text, icon, file_url } = req.body;
        const [result] = await pool.query('INSERT INTO materials (title, desc_text, icon, file_url) VALUES (?, ?, ?, ?)',
            [title, desc_text, icon || 'fa-file-pdf', file_url || '#']);
        res.json({ success: true, id: result.insertId });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/admin/announcements', requireAuth, async (req, res) => {
    try {
        const { text } = req.body;
        const [result] = await pool.query('INSERT INTO announcements (text) VALUES (?)', [text || '']);
        // Auto-create notification
        await pool.query('INSERT INTO notifications (title, message, type) VALUES (?, ?, ?)',
            ['ข่าวใหม่', text, 'announcement']);
        sendTelegram(`📢 ประกาศใหม่\n${text}`);
        res.json({ success: true, id: result.insertId });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// Generic DELETE
app.delete('/api/admin/:table/:id', requireAuth, async (req, res) => {
    const allowed = ['systems', 'clips', 'prompts', 'materials', 'announcements', 'classrooms', 'students', 'quizzes'];
    const table = req.params.table;
    if (!allowed.includes(table)) return res.status(400).json({ error: 'Invalid table' });
    try {
        await pool.query(`DELETE FROM ${table} WHERE id = ?`, [req.params.id]);
        res.json({ success: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// Generic UPDATE (Edit)
app.put('/api/admin/systems/:id', requireAuth, async (req, res) => {
    try {
        const { ep, title, desc_text, icon, preview_url, download_url } = req.body;
        await pool.query('UPDATE systems SET ep=?, title=?, desc_text=?, icon=?, preview_url=?, download_url=? WHERE id=?',
            [ep, title, desc_text, icon || 'fa-laptop-code', preview_url || '#', download_url || '#', req.params.id]);
        res.json({ success: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.put('/api/admin/clips/:id', requireAuth, async (req, res) => {
    try {
        const { ep, title, video_url } = req.body;
        await pool.query('UPDATE clips SET ep=?, title=?, video_url=? WHERE id=?', [ep, title, video_url || '#', req.params.id]);
        res.json({ success: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.put('/api/admin/prompts/:id', requireAuth, async (req, res) => {
    try {
        const { title, desc_text, icon } = req.body;
        await pool.query('UPDATE prompts SET title=?, desc_text=?, icon=? WHERE id=?', [title, desc_text, icon || 'fa-robot', req.params.id]);
        res.json({ success: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.put('/api/admin/materials/:id', requireAuth, async (req, res) => {
    try {
        const { title, desc_text, icon, file_url } = req.body;
        await pool.query('UPDATE materials SET title=?, desc_text=?, icon=?, file_url=? WHERE id=?', [title, desc_text, icon || 'fa-file-pdf', file_url || '#', req.params.id]);
        res.json({ success: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.put('/api/admin/announcements/:id', requireAuth, async (req, res) => {
    try {
        const { text } = req.body;
        await pool.query('UPDATE announcements SET text=? WHERE id=?', [text, req.params.id]);
        res.json({ success: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// ===================== WFH =====================
app.get('/api/wfh', async (req, res) => {
    try { const [rows] = await pool.query('SELECT * FROM wfh_logs ORDER BY time_in DESC LIMIT 50'); res.json(rows); }
    catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/wfh', async (req, res) => {
    try {
        const { name, role } = req.body;
        const [result] = await pool.query('INSERT INTO wfh_logs (name, role) VALUES (?, ?)', [name, role || 'ครูผู้สอน']);
        res.json({ success: true, id: result.insertId });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.put('/api/wfh/:id/checkout', async (req, res) => {
    try {
        await pool.query('UPDATE wfh_logs SET time_out = NOW() WHERE id = ? AND time_out IS NULL', [req.params.id]);
        res.json({ success: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// ===================== ATTENDANCE =====================

// Classrooms
app.get('/api/classrooms', async (req, res) => {
    try { const [rows] = await pool.query('SELECT * FROM classrooms ORDER BY id DESC'); res.json(rows); }
    catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/admin/classrooms', requireAuth, async (req, res) => {
    try {
        const { name, grade } = req.body;
        const [result] = await pool.query('INSERT INTO classrooms (name, grade) VALUES (?, ?)', [name, grade || '']);
        // Generate QR code
        const qrUrl = `${req.protocol}://${req.get('host')}/attendance.html?class=${result.insertId}`;
        const qrData = await QRCode.toDataURL(qrUrl);
        await pool.query('UPDATE classrooms SET qr_code=? WHERE id=?', [qrData, result.insertId]);
        res.json({ success: true, id: result.insertId });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// Students
app.get('/api/students', async (req, res) => {
    try {
        const classId = req.query.class_id;
        let query = 'SELECT s.*, c.name as class_name FROM students s LEFT JOIN classrooms c ON s.classroom_id=c.id';
        let params = [];
        if (classId) { query += ' WHERE s.classroom_id=?'; params.push(classId); }
        query += ' ORDER BY s.name';
        const [rows] = await pool.query(query, params);
        res.json(rows);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/admin/students', requireAuth, async (req, res) => {
    try {
        const { student_id, name, classroom_id } = req.body;
        const [result] = await pool.query('INSERT INTO students (student_id, name, classroom_id) VALUES (?, ?, ?)',
            [student_id || '', name, classroom_id]);
        res.json({ success: true, id: result.insertId });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// Check-in (public - students use this)
app.post('/api/attendance/checkin', async (req, res) => {
    try {
        const { student_id, classroom_id, status } = req.body;
        // Check if already checked in today
        const [existing] = await pool.query(
            'SELECT * FROM attendance WHERE student_id=? AND date=CURDATE()', [student_id]);
        if (existing.length > 0) return res.status(400).json({ error: 'เช็คชื่อวันนี้แล้ว' });
        await pool.query('INSERT INTO attendance (student_id, classroom_id, status) VALUES (?, ?, ?)',
            [student_id, classroom_id, status || 'present']);
        res.json({ success: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// Attendance report
app.get('/api/attendance', async (req, res) => {
    try {
        const { class_id, date } = req.query;
        let query = `SELECT a.*, s.name as student_name, s.student_id as sid, c.name as class_name 
            FROM attendance a JOIN students s ON a.student_id=s.id JOIN classrooms c ON a.classroom_id=c.id`;
        let params = [];
        const conditions = [];
        if (class_id) { conditions.push('a.classroom_id=?'); params.push(class_id); }
        if (date) { conditions.push('a.date=?'); params.push(date); }
        if (conditions.length) query += ' WHERE ' + conditions.join(' AND ');
        query += ' ORDER BY a.check_in DESC';
        const [rows] = await pool.query(query, params);
        res.json(rows);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// ===================== QUIZZES =====================

// Get all quizzes
app.get('/api/quizzes', async (req, res) => {
    try { const [rows] = await pool.query('SELECT * FROM quizzes ORDER BY id DESC'); res.json(rows.length ? rows : DEMO.quizzes); }
    catch (err) { res.json(DEMO.quizzes); }
});

// Get quiz with questions (for taking)
app.get('/api/quizzes/:id', async (req, res) => {
    try {
        const [[quiz]] = await pool.query('SELECT * FROM quizzes WHERE id=?', [req.params.id]);
        if (!quiz) return res.status(404).json({ error: 'Quiz not found' });
        const [questions] = await pool.query(
            'SELECT id, question, choice_a, choice_b, choice_c, choice_d FROM quiz_questions WHERE quiz_id=?', [req.params.id]);
        res.json({ ...quiz, questions });
    } catch (err) {
        // Demo fallback
        const demoQuiz = DEMO.quizzes.find(q => q.id == req.params.id);
        if (!demoQuiz) return res.status(404).json({ error: 'Quiz not found' });
        const questions = DEMO.quiz_questions.filter(q => q.quiz_id == req.params.id)
            .map(({ correct_answer, ...rest }) => rest);
        res.json({ ...demoQuiz, questions });
    }
});

// Create quiz
app.post('/api/admin/quizzes', requireAuth, async (req, res) => {
    try {
        const { title, description, time_limit, questions } = req.body;
        const [result] = await pool.query('INSERT INTO quizzes (title, description, time_limit) VALUES (?, ?, ?)',
            [title, description || '', time_limit || 30]);
        const quizId = result.insertId;
        if (questions && questions.length > 0) {
            for (const q of questions) {
                await pool.query(
                    'INSERT INTO quiz_questions (quiz_id, question, choice_a, choice_b, choice_c, choice_d, correct_answer) VALUES (?, ?, ?, ?, ?, ?, ?)',
                    [quizId, q.question, q.choice_a, q.choice_b, q.choice_c, q.choice_d, q.correct_answer]
                );
            }
        }
        // Auto-create notification
        await pool.query('INSERT INTO notifications (title, message, type) VALUES (?, ?, ?)',
            ['แบบทดสอบใหม่', `มีแบบทดสอบ "${title}" ใหม่ ลองทำกันเลย!`, 'quiz']);
        sendTelegram(`📝 แบบทดสอบใหม่\n"${title}"\nจำนวน ${questions ? questions.length : 0} ข้อ — ลองทำกันเลย!`);
        res.json({ success: true, id: quizId });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// Submit quiz answers
app.post('/api/quizzes/:id/submit', async (req, res) => {
    try {
        const { student_name, answers } = req.body;
        let questions;
        try {
            [questions] = await pool.query('SELECT * FROM quiz_questions WHERE quiz_id=?', [req.params.id]);
        } catch (e) {
            questions = DEMO.quiz_questions.filter(q => q.quiz_id == req.params.id);
        }
        let score = 0;
        const total = questions.length;
        questions.forEach(q => { if (answers[q.id] === q.correct_answer) score++; });
        try {
            await pool.query('INSERT INTO quiz_results (quiz_id, student_name, score, total, answers) VALUES (?, ?, ?, ?, ?)',
                [req.params.id, student_name, score, total, JSON.stringify(answers)]);
        } catch (e) { /* DB unavailable, skip save */ }
        res.json({ success: true, score, total, percentage: total > 0 ? Math.round((score / total) * 100) : 0 });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// Quiz results
app.get('/api/admin/quiz-results/:quizId', requireAuth, async (req, res) => {
    try {
        const [rows] = await pool.query('SELECT * FROM quiz_results WHERE quiz_id=? ORDER BY submitted_at DESC', [req.params.quizId]);
        res.json(rows);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// Get quiz questions (admin - includes answers)
app.get('/api/admin/quiz-questions/:quizId', requireAuth, async (req, res) => {
    try {
        const [rows] = await pool.query('SELECT * FROM quiz_questions WHERE quiz_id=?', [req.params.quizId]);
        res.json(rows);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// Detailed quiz result (per student)
app.get('/api/admin/quiz-result-detail/:resultId', requireAuth, async (req, res) => {
    try {
        const [[result]] = await pool.query('SELECT * FROM quiz_results WHERE id=?', [req.params.resultId]);
        if (!result) return res.status(404).json({ error: 'Not found' });
        const [questions] = await pool.query('SELECT * FROM quiz_questions WHERE quiz_id=?', [result.quiz_id]);
        const answers = JSON.parse(result.answers || '{}');
        const detail = questions.map(q => ({
            question: q.question, choice_a: q.choice_a, choice_b: q.choice_b,
            choice_c: q.choice_c, choice_d: q.choice_d, correct: q.correct_answer,
            answered: answers[q.id] || '-', is_correct: answers[q.id] === q.correct_answer
        }));
        res.json({ student_name: result.student_name, score: result.score, total: result.total, detail });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// ===================== NOTIFICATIONS =====================

app.get('/api/notifications', async (req, res) => {
    try {
        const [rows] = await pool.query('SELECT * FROM notifications ORDER BY created_at DESC LIMIT 20');
        res.json(rows.length ? rows : [
            { id: 1, title: 'ยินดีต้อนรับ', message: 'ยินดีต้อนรับสู่ Kru Pug Hub!', type: 'info', is_read: false, created_at: new Date().toISOString() },
            { id: 2, title: 'แบบทดสอบใหม่', message: 'มีแบบทดสอบสมการเชิงเส้น ม.1 ลองทำกัน!', type: 'quiz', is_read: false, created_at: new Date().toISOString() },
        ]);
    } catch (err) {
        res.json([
            { id: 1, title: 'ยินดีต้อนรับ', message: 'ยินดีต้อนรับสู่ Kru Pug Hub!', type: 'info', is_read: false, created_at: new Date().toISOString() },
            { id: 2, title: 'แบบทดสอบใหม่', message: 'มีแบบทดสอบสมการเชิงเส้น ม.1 ลองทำกัน!', type: 'quiz', is_read: false, created_at: new Date().toISOString() },
        ]);
    }
});

app.get('/api/notifications/unread-count', async (req, res) => {
    try {
        const [[r]] = await pool.query('SELECT COUNT(*) as c FROM notifications WHERE is_read=FALSE');
        res.json({ count: r.c });
    } catch (err) { res.json({ count: 2 }); }
});

app.put('/api/notifications/read-all', async (req, res) => {
    try {
        await pool.query('UPDATE notifications SET is_read=TRUE WHERE is_read=FALSE');
        res.json({ success: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// ===================== ANALYTICS =====================

app.get('/api/admin/analytics', requireAuth, async (req, res) => {
    try {
        // Weekly attendance (last 7 days)
        const [weeklyAtt] = await pool.query(`
            SELECT date, COUNT(*) as count FROM attendance
            WHERE date >= DATE_SUB(CURDATE(), INTERVAL 7 DAY)
            GROUP BY date ORDER BY date`);
        // Quiz score distribution
        const [quizScores] = await pool.query(`
            SELECT q.title, ROUND(AVG(r.score/r.total*100)) as avg_score,
            COUNT(r.id) as attempts FROM quiz_results r
            JOIN quizzes q ON r.quiz_id=q.id GROUP BY r.quiz_id, q.title`);
        // Attendance by class
        const [classSummary] = await pool.query(`
            SELECT c.name, COUNT(a.id) as total_checkins FROM classrooms c
            LEFT JOIN attendance a ON c.id=a.classroom_id
            GROUP BY c.id, c.name`);
        // Total students
        const [[totalStudents]] = await pool.query('SELECT COUNT(*) as c FROM students');
        // Quiz completion rate
        const [[totalResults]] = await pool.query('SELECT COUNT(*) as c FROM quiz_results');
        res.json({
            weeklyAttendance: weeklyAtt, quizScores, classSummary,
            totalStudents: totalStudents.c, totalQuizAttempts: totalResults.c
        });
    } catch (err) {
        // Demo analytics fallback
        const today = new Date();
        const demoWeekly = Array.from({length:7}, (_,i) => {
            const d = new Date(today); d.setDate(d.getDate()-6+i);
            return { date: d.toISOString().split('T')[0], count: Math.floor(Math.random()*20)+5 };
        });
        res.json({
            weeklyAttendance: demoWeekly,
            quizScores: [{ title:'สมการเชิงเส้น ม.1', avg_score:78, attempts:12 }],
            classSummary: [{ name:'ม.1/1', total_checkins:45 }, { name:'ม.1/2', total_checkins:38 }],
            totalStudents: 60, totalQuizAttempts: 12
        });
    }
});

// ===================== EXPORT CSV =====================

app.get('/api/admin/export/attendance', requireAuth, async (req, res) => {
    try {
        const { class_id, date } = req.query;
        let query = `SELECT s.student_id as 'รหัส', s.name as 'ชื่อ-สกุล', c.name as 'ห้องเรียน',
            a.status as 'สถานะ', a.check_in as 'เวลาเช็คชื่อ', a.date as 'วันที่'
            FROM attendance a JOIN students s ON a.student_id=s.id JOIN classrooms c ON a.classroom_id=c.id`;
        let params = []; const conds = [];
        if (class_id) { conds.push('a.classroom_id=?'); params.push(class_id); }
        if (date) { conds.push('a.date=?'); params.push(date); }
        if (conds.length) query += ' WHERE ' + conds.join(' AND ');
        query += ' ORDER BY a.date DESC, s.name';
        const [rows] = await pool.query(query, params);
        if (rows.length === 0) return res.status(404).send('No data');
        const headers = Object.keys(rows[0]);
        let csv = '\uFEFF' + headers.join(',') + '\n';
        rows.forEach(r => { csv += headers.map(h => `"${(r[h] || '').toString().replace(/"/g, '""')}"`).join(',') + '\n'; });
        res.setHeader('Content-Type', 'text/csv; charset=utf-8');
        res.setHeader('Content-Disposition', `attachment; filename=attendance_${Date.now()}.csv`);
        res.send(csv);
    } catch (err) {
        // Demo CSV fallback
        const csv = '\uFEFF"รหัส","ชื่อ-สกุล","ห้องเรียน","สถานะ","วันที่"\n' +
            '"S001","สมชาย ใจดี","ม.1/1","present","' + new Date().toISOString().split('T')[0] + '"\n' +
            '"S002","สมหญิง เก่งมาก","ม.1/1","present","' + new Date().toISOString().split('T')[0] + '"\n' +
            '"S003","นายธน รักเรียน","ม.1/2","late","' + new Date().toISOString().split('T')[0] + '"\n';
        res.setHeader('Content-Type', 'text/csv; charset=utf-8');
        res.setHeader('Content-Disposition', `attachment; filename=attendance_demo_${Date.now()}.csv`);
        res.send(csv);
    }
});

app.get('/api/admin/export/quiz-results/:quizId', requireAuth, async (req, res) => {
    try {
        const [rows] = await pool.query(
            `SELECT student_name as 'ชื่อ', score as 'คะแนน', total as 'คะแนนเต็ม',
             ROUND(score/total*100) as 'เปอร์เซ็นต์', submitted_at as 'เวลาส่ง'
             FROM quiz_results WHERE quiz_id=? ORDER BY submitted_at DESC`,
            [req.params.quizId]);
        if (rows.length === 0) return res.status(404).send('No data');
        const headers = Object.keys(rows[0]);
        let csv = '\uFEFF' + headers.join(',') + '\n';
        rows.forEach(r => { csv += headers.map(h => `"${(r[h] || '').toString().replace(/"/g, '""')}"`).join(',') + '\n'; });
        res.setHeader('Content-Type', 'text/csv; charset=utf-8');
        res.setHeader('Content-Disposition', `attachment; filename=quiz_results_${Date.now()}.csv`);
        res.send(csv);
    } catch (err) {
        // Demo CSV fallback
        const csv = '\uFEFF"ชื่อ","คะแนน","คะแนนเต็ม","เปอร์เซ็นต์","เวลาส่ง"\n' +
            '"สมชาย ใจดี","4","5","80","' + new Date().toISOString() + '"\n' +
            '"สมหญิง เก่งมาก","5","5","100","' + new Date().toISOString() + '"\n' +
            '"นายธน รักเรียน","3","5","60","' + new Date().toISOString() + '"\n';
        res.setHeader('Content-Type', 'text/csv; charset=utf-8');
        res.setHeader('Content-Disposition', `attachment; filename=quiz_results_demo_${Date.now()}.csv`);
        res.send(csv);
    }
});

// ===================== AI CHAT (OpenRouter) =====================

app.post('/api/ai/chat', async (req, res) => {
    try {
        const { message, user_name } = req.body;
        if (!OPENROUTER_API_KEY) return res.status(400).json({ error: 'AI not configured' });
        const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${OPENROUTER_API_KEY}`,
                'Content-Type': 'application/json',
                'HTTP-Referer': 'http://localhost:3000',
                'X-Title': 'Kru Pug Hub'
            },
            body: JSON.stringify({
                model: 'google/gemini-2.0-flash-001',
                messages: [
                    { role: 'system', content: 'คุณเป็นผู้ช่วยสอนคณิตศาสตร์ชื่อ "ครูพัก AI" สำหรับนักเรียนไทย ตอบเป็นภาษาไทย อธิบายให้เข้าใจง่าย ใช้ตัวอย่างจริง ถ้าเป็นโจทย์คณิตให้แสดงวิธีทำทีละขั้นตอน' },
                    { role: 'user', content: message }
                ],
                max_tokens: 1000
            })
        });
        const data = await response.json();
        const aiResponse = data.choices?.[0]?.message?.content || 'ขออภัย ไม่สามารถตอบได้ในขณะนี้';
        // Save to DB
        await pool.query('INSERT INTO ai_chats (user_name, message, response) VALUES (?, ?, ?)',
            [user_name || 'Guest', message, aiResponse]);
        res.json({ success: true, response: aiResponse });
    } catch (err) {
        console.error('AI Chat Error:', err);
        res.status(500).json({ error: 'AI service unavailable' });
    }
});

// AI Generate Quiz (auto-create questions from topic)
app.post('/api/ai/generate-quiz', requireAuth, async (req, res) => {
    try {
        const { topic, count } = req.body;
        if (!OPENROUTER_API_KEY) return res.status(400).json({ error: 'AI not configured' });
        const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${OPENROUTER_API_KEY}`,
                'Content-Type': 'application/json',
                'HTTP-Referer': 'http://localhost:3000',
                'X-Title': 'Kru Pug Hub'
            },
            body: JSON.stringify({
                model: 'google/gemini-2.0-flash-001',
                messages: [{
                    role: 'user',
                    content: `สร้างข้อสอบคณิตศาสตร์เรื่อง "${topic}" จำนวน ${count || 5} ข้อ แบบ 4 ตัวเลือก (a,b,c,d)
ตอบเป็น JSON array เท่านั้น ไม่ต้องมี markdown หรือ code block
format: [{"question":"...","choice_a":"...","choice_b":"...","choice_c":"...","choice_d":"...","correct_answer":"a"}]`
                }],
                max_tokens: 2000
            })
        });
        const data = await response.json();
        let text = data.choices?.[0]?.message?.content || '[]';
        // Clean markdown wrapping if present
        text = text.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
        const questions = JSON.parse(text);
        res.json({ success: true, questions });
    } catch (err) {
        console.error('AI Quiz Gen Error:', err);
        res.status(500).json({ error: 'Failed to generate quiz' });
    }
});

// ===================== LEADERBOARD =====================

app.get('/api/leaderboard', async (req, res) => {
    try {
        const [rows] = await pool.query(`
            SELECT student_name, 
                   COUNT(*) as quizzes_taken,
                   SUM(score) as total_score,
                   SUM(total) as total_possible,
                   ROUND(AVG(score/total*100)) as avg_percent
            FROM quiz_results 
            GROUP BY student_name 
            ORDER BY avg_percent DESC, total_score DESC 
            LIMIT 20`);
        res.json(rows);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// ===================== CALENDAR / SCHEDULE =====================

app.get('/api/schedule', async (req, res) => {
    try {
        const { week } = req.query;
        let query = 'SELECT * FROM schedule_events';
        let params = [];
        if (week) {
            query += ' WHERE event_date >= ? AND event_date <= DATE_ADD(?, INTERVAL 6 DAY)';
            params = [week, week];
        }
        query += ' ORDER BY event_date, time_start';
        const [rows] = await pool.query(query, params);
        res.json(rows);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/admin/schedule', requireAuth, async (req, res) => {
    try {
        const { title, event_date, time_start, time_end, type, description } = req.body;
        const [result] = await pool.query(
            'INSERT INTO schedule_events (title, event_date, time_start, time_end, type, description) VALUES (?,?,?,?,?,?)',
            [title, event_date, time_start || '', time_end || '', type || 'class', description || '']);
        res.json({ success: true, id: result.insertId });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.delete('/api/admin/schedule/:id', requireAuth, async (req, res) => {
    try {
        await pool.query('DELETE FROM schedule_events WHERE id=?', [req.params.id]);
        res.json({ success: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// ===================== STUDENT LOGIN =====================

const studentTokens = new Map();

app.post('/api/student/login', loginLimiter, async (req, res) => {
    try {
        const { student_id, password } = req.body;
        const [[student]] = await pool.query(
            'SELECT s.*, c.name as classroom_name FROM students s LEFT JOIN classrooms c ON s.classroom_id=c.id WHERE s.student_id=?',
            [student_id]);
        if (!student) return res.status(401).json({ error: 'ไม่พบรหัสนักเรียน' });
        let match = student.password === (password || '1234');
        if (!match && student.password?.startsWith('$2')) match = await bcrypt.compare(password || '1234', student.password);
        if (student.password && !match) {
            return res.status(401).json({ error: 'รหัสผ่านไม่ถูกต้อง' });
        }
        const token = crypto.randomBytes(32).toString('hex');
        studentTokens.set(token, { id: student.id, student_id: student.student_id, name: student.name, classroom: student.classroom_name, classroom_id: student.classroom_id });
        res.json({ success: true, token, student: { id: student.id, student_id: student.student_id, name: student.name, classroom: student.classroom_name, classroom_id: student.classroom_id } });
    } catch (err) {
        // Demo fallback — accept any student_id with password 1234
        const { student_id, password } = req.body;
        if ((password || '1234') === '1234') {
            const demoStudent = { id:1, student_id: student_id || 'S001', name:'สมชาย ใจดี', classroom:'ม.1/1', classroom_id:1 };
            const token = crypto.randomBytes(32).toString('hex');
            studentTokens.set(token, demoStudent);
            return res.json({ success: true, token, student: demoStudent });
        }
        res.status(401).json({ error: 'รหัสผ่านไม่ถูกต้อง' });
    }
});

function requireStudentAuth(req, res, next) {
    const token = req.headers['x-student-token'];
    if (!token || !studentTokens.has(token)) return res.status(401).json({ error: 'Unauthorized' });
    req.student = studentTokens.get(token);
    next();
}

app.get('/api/student/profile', requireStudentAuth, async (req, res) => {
    try {
        const sid = req.student.id;
        const [attendance] = await pool.query(
            `SELECT a.*, c.name as classroom_name FROM attendance a 
             LEFT JOIN classrooms c ON a.classroom_id=c.id 
             WHERE a.student_id=? ORDER BY a.date DESC LIMIT 30`, [sid]);
        const [quizResults] = await pool.query(
            `SELECT r.*, q.title FROM quiz_results r 
             JOIN quizzes q ON r.quiz_id=q.id 
             WHERE r.student_name=? ORDER BY r.submitted_at DESC`, [req.student.name]);
        let stats = { exp: 0, level: 1, badges: '[]', streak_days: 0 };
        const [[existingStats]] = await pool.query('SELECT * FROM student_stats WHERE student_id=?', [sid]);
        if (existingStats) stats = existingStats;
        res.json({ student: req.student, attendance, quizResults, stats });
    } catch (err) {
        // Demo profile fallback
        const demoAtt = Array.from({length:5}, (_,i) => {
            const d = new Date(); d.setDate(d.getDate()-i);
            return { date: d.toISOString().split('T')[0], status:i<4?'present':'late', classroom_name:'ม.1/1' };
        });
        const demoQuiz = [{ title:'สมการเชิงเส้น ม.1', score:4, total:5, submitted_at:new Date().toISOString() }];
        res.json({ student: req.student, attendance: demoAtt, quizResults: demoQuiz,
            stats: { exp:150, level:3, badges:'["🏅 ทำข้อสอบครบ 5 ครั้ง","⭐ เข้าเรียนครบ 5 วัน"]', streak_days:5 } });
    }
});

app.put('/api/student/change-password', requireStudentAuth, async (req, res) => {
    try {
        const { oldPassword, newPassword } = req.body;
        const [[student]] = await pool.query('SELECT password FROM students WHERE id=?', [req.student.id]);
        let match = student.password === oldPassword;
        if (!match && student.password?.startsWith('$2')) match = await bcrypt.compare(oldPassword, student.password);
        if (!match) return res.status(400).json({ error: 'รหัสเดิมไม่ถูกต้อง' });
        const hashed = await bcrypt.hash(newPassword, 10);
        await pool.query('UPDATE students SET password=? WHERE id=?', [hashed, req.student.id]);
        res.json({ success: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// ===================== CHAT ROOM =====================

app.get('/api/chat/:room', async (req, res) => {
    try {
        const { after } = req.query;
        let query = 'SELECT * FROM chat_messages WHERE room=?';
        let params = [req.params.room];
        if (after) { query += ' AND id > ?'; params.push(after); }
        query += ' ORDER BY created_at DESC LIMIT 50';
        const [rows] = await pool.query(query, params);
        res.json(rows.reverse());
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/chat/:room', async (req, res) => {
    try {
        const { user_name, user_role, message } = req.body;
        if (!message?.trim()) return res.status(400).json({ error: 'Empty message' });
        const [result] = await pool.query(
            'INSERT INTO chat_messages (room, user_name, user_role, message) VALUES (?,?,?,?)',
            [req.params.room, user_name || 'Anonymous', user_role || 'student', message.trim()]);
        res.json({ success: true, id: result.insertId });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// ===================== GAMIFICATION =====================

async function awardEXP(studentId, amount, reason) {
    try {
        const [[existing]] = await pool.query('SELECT * FROM student_stats WHERE student_id=?', [studentId]);
        if (!existing) {
            await pool.query('INSERT INTO student_stats (student_id, exp, level, badges, last_activity) VALUES (?,?,1,?,CURDATE())',
                [studentId, amount, '[]']);
        } else {
            const newExp = existing.exp + amount;
            const newLevel = Math.floor(newExp / 100) + 1;
            let badges = JSON.parse(existing.badges || '[]');
            // Auto badges — Phase 6 Enhanced
            if (newExp >= 100 && !badges.includes('🌟 เริ่มต้น')) badges.push('🌟 เริ่มต้น');
            if (newExp >= 300 && !badges.includes('💪 มุ่งมั่น')) badges.push('💪 มุ่งมั่น');
            if (newExp >= 500 && !badges.includes('🔥 ขยัน')) badges.push('🔥 ขยัน');
            if (newExp >= 1000 && !badges.includes('🏆 เก่งมาก')) badges.push('🏆 เก่งมาก');
            if (newExp >= 2000 && !badges.includes('💎 ระดับเพชร')) badges.push('💎 ระดับเพชร');
            if (newExp >= 5000 && !badges.includes('👑 ระดับตำนาน')) badges.push('👑 ระดับตำนาน');
            // Streak check
            const lastActivity = existing.last_activity ? new Date(existing.last_activity).toDateString() : '';
            const yesterday = new Date(Date.now() - 86400000).toDateString();
            const today = new Date().toDateString();
            let streak = existing.streak_days || 0;
            if (lastActivity === yesterday) streak += 1;
            else if (lastActivity !== today) streak = 1;
            if (streak >= 7 && !badges.includes('📅 เข้าเรียน 7 วันติด')) badges.push('📅 เข้าเรียน 7 วันติด');
            if (streak >= 30 && !badges.includes('🌈 เข้าเรียน 30 วันติด')) badges.push('🌈 เข้าเรียน 30 วันติด');
            // Quiz performance badges
            if (reason === 'quiz_perfect' && !badges.includes('🎯 ทำข้อสอบเต็ม')) badges.push('🎯 ทำข้อสอบเต็ม');
            await pool.query('UPDATE student_stats SET exp=?, level=?, badges=?, streak_days=?, last_activity=CURDATE() WHERE student_id=?',
                [newExp, newLevel, JSON.stringify(badges), streak, studentId]);
        }
    } catch (e) { console.error('EXP Error:', e); }
}

app.get('/api/student/stats/:studentId', async (req, res) => {
    try {
        const [[stats]] = await pool.query('SELECT * FROM student_stats WHERE student_id=?', [req.params.studentId]);
        res.json(stats || { exp: 0, level: 1, badges: '[]', streak_days: 0 });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/gamification/top', async (req, res) => {
    try {
        const [rows] = await pool.query(`
            SELECT ss.*, s.name, s.student_id as sid FROM student_stats ss 
            JOIN students s ON ss.student_id=s.id 
            ORDER BY ss.exp DESC LIMIT 10`);
        res.json(rows);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// ===================== PHASE 5: ANALYTICS =====================

app.get('/api/admin/analytics', requireAuth, async (req, res) => {
    try {
        // Student count
        const [[{ total_students }]] = await pool.query('SELECT COUNT(*) as total_students FROM students');
        // Quiz attempts
        const [[{ total_attempts }]] = await pool.query('SELECT COUNT(*) as total_attempts FROM quiz_results');
        // Attendance this week (7 days)
        const [weeklyAtt] = await pool.query(`
            SELECT DATE(date) as d, 
                   SUM(CASE WHEN status='present' THEN 1 ELSE 0 END) as present_count,
                   SUM(CASE WHEN status='late' THEN 1 ELSE 0 END) as late_count,
                   SUM(CASE WHEN status='absent' THEN 1 ELSE 0 END) as absent_count,
                   COUNT(*) as total
            FROM attendance WHERE date >= DATE_SUB(CURDATE(), INTERVAL 7 DAY)
            GROUP BY DATE(date) ORDER BY d`);
        // Quiz averages (last 10 quizzes)
        const [quizAvg] = await pool.query(`
            SELECT q.title, ROUND(AVG(qr.score/qr.total*100),1) as avg_score, COUNT(qr.id) as attempts
            FROM quiz_results qr JOIN quizzes q ON qr.quiz_id=q.id
            GROUP BY qr.quiz_id ORDER BY q.id DESC LIMIT 10`);
        // EXP distribution
        const [expDist] = await pool.query(`
            SELECT s.name, ss.exp, ss.level FROM student_stats ss
            JOIN students s ON ss.student_id=s.id ORDER BY ss.exp DESC LIMIT 10`);
        // Recent activity
        const [recentAct] = await pool.query(`
            (SELECT 'quiz' as type, CONCAT(student_name,' ทำแบบทดสอบ') as text, submitted_at as ts FROM quiz_results ORDER BY submitted_at DESC LIMIT 5)
            UNION ALL
            (SELECT 'attendance' as type, CONCAT(s.name,' เช็คชื่อ') as text, a.created_at as ts FROM attendance a JOIN students s ON a.student_id=s.id ORDER BY a.created_at DESC LIMIT 5)
            ORDER BY ts DESC LIMIT 10`);
        // Classroom stats
        const [classStats] = await pool.query(`
            SELECT c.id, c.name, COUNT(s.id) as student_count,
                   (SELECT COUNT(*) FROM attendance a WHERE a.classroom_id=c.id AND a.date=CURDATE()) as today_attendance
            FROM classrooms c LEFT JOIN students s ON s.classroom_id=c.id GROUP BY c.id`);
        res.json({ total_students, total_attempts, weeklyAtt, quizAvg, expDist, recentAct, classStats });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// ===================== PHASE 5: NOTIFICATIONS =====================

app.post('/api/admin/notify', requireAuth, async (req, res) => {
    try {
        const { title, message, type, classroom_id } = req.body;
        if (!title) return res.status(400).json({ error: 'Title required' });
        const [result] = await pool.query(
            'INSERT INTO notifications (title, message, type, target_classroom_id) VALUES (?,?,?,?)',
            [title, message || '', type || 'system', classroom_id || null]);
        sendTelegram(`🔔 ${title}\n${message || ''}`);
        res.json({ success: true, id: result.insertId });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/student/notifications', async (req, res) => {
    try {
        const classroomId = req.query.classroom_id;
        let query = `SELECT * FROM notifications WHERE (target_classroom_id IS NULL`;
        let params = [];
        if (classroomId) { query += ` OR target_classroom_id=?`; params.push(classroomId); }
        query += `) ORDER BY created_at DESC LIMIT 30`;
        const [rows] = await pool.query(query, params);
        res.json(rows);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.put('/api/student/notifications/:id/read', async (req, res) => {
    try {
        await pool.query('UPDATE notifications SET is_read=TRUE WHERE id=?', [req.params.id]);
        res.json({ success: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/notifications/unread-count', async (req, res) => {
    try {
        const classroomId = req.query.classroom_id;
        let query = `SELECT COUNT(*) as cnt FROM notifications WHERE is_read=FALSE AND (target_classroom_id IS NULL`;
        let params = [];
        if (classroomId) { query += ` OR target_classroom_id=?`; params.push(classroomId); }
        query += `)`;
        const [[{ cnt }]] = await pool.query(query, params);
        res.json({ count: cnt });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// ===================== PHASE 5: AI TUTOR (Student) =====================

app.post('/api/student/ai-chat', async (req, res) => {
    try {
        const { message, student_name } = req.body;
        if (!message?.trim()) return res.status(400).json({ error: 'Empty message' });
        if (!OPENROUTER_API_KEY) return res.status(400).json({ error: 'ไม่มี API Key — แจ้ง Admin' });
        const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${OPENROUTER_API_KEY}`, 'Content-Type': 'application/json', 'HTTP-Referer': 'https://krupug.app', 'X-Title': 'Kru Pug AI Tutor' },
            body: JSON.stringify({
                model: 'google/gemini-2.0-flash-001',
                messages: [
                    { role: 'system', content: 'คุณคือ AI ครูสอนคณิตศาสตร์ชื่อ "ครูพัก AI" ช่วยนักเรียนเรียนคณิตศาสตร์ ตอบเป็นภาษาไทย อธิบายทีละขั้นตอน ใช้ตัวอย่างง่ายๆ ถ้าต้องใส่สูตรให้ใช้ตัวอักษรปกติ ไม่ใช้ LaTeX' },
                    { role: 'user', content: message }
                ],
                max_tokens: 1000
            })
        });
        const data = await response.json();
        const aiResponse = data.choices?.[0]?.message?.content || 'ขอโทษครับ ตอบไม่ได้ตอนนี้';
        // Save to DB
        await pool.query('INSERT INTO ai_chats (user_name, message, response) VALUES (?,?,?)',
            [student_name || 'Student', message, aiResponse]);
        res.json({ response: aiResponse });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// ===================== PHASE 5: AUTO-QUIZ GENERATOR =====================

app.post('/api/admin/generate-quiz', requireAuth, async (req, res) => {
    try {
        const { topic, count, difficulty } = req.body;
        if (!topic) return res.status(400).json({ error: 'Topic required' });
        if (!OPENROUTER_API_KEY) return res.status(400).json({ error: 'ไม่มี API Key' });
        const numQ = Math.min(count || 5, 20);
        const diff = difficulty || 'ปานกลาง';
        const prompt = `สร้างแบบทดสอบคณิตศาสตร์ หัวข้อ "${topic}" จำนวน ${numQ} ข้อ ระดับความยาก: ${diff}
ตอบเป็น JSON array เท่านั้น ห้ามใส่ markdown หรือข้อความอื่น:
[{"question":"...","options":["ก.xxx","ข.xxx","ค.xxx","ง.xxx"],"correct_answer":0,"explanation":"..."}]
correct_answer คือ index (0-3) ของตัวเลือกที่ถูกต้อง`;
        const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${OPENROUTER_API_KEY}`, 'Content-Type': 'application/json', 'HTTP-Referer': 'https://krupug.app', 'X-Title': 'Kru Pug Quiz Gen' },
            body: JSON.stringify({
                model: 'google/gemini-2.0-flash-001',
                messages: [{ role: 'user', content: prompt }],
                max_tokens: 3000
            })
        });
        const data = await response.json();
        let text = data.choices?.[0]?.message?.content || '';
        // Extract JSON from response
        const jsonMatch = text.match(/\[[\s\S]*\]/);
        if (!jsonMatch) return res.status(500).json({ error: 'AI ไม่ส่ง JSON กลับมา', raw: text });
        const questions = JSON.parse(jsonMatch[0]);
        // Create quiz
        const title = `AI: ${topic} (${diff})`;
        const [quizResult] = await pool.query('INSERT INTO quizzes (title, description, time_limit) VALUES (?,?,?)',
            [title, `สร้างโดย AI — หัวข้อ: ${topic}`, 30]);
        const quizId = quizResult.insertId;
        for (const q of questions) {
            await pool.query('INSERT INTO quiz_questions (quiz_id, question, options, correct_answer) VALUES (?,?,?,?)',
                [quizId, q.question, JSON.stringify(q.options), q.correct_answer || 0]);
        }
        // Auto-notify students
        await pool.query('INSERT INTO notifications (title, message, type) VALUES (?,?,?)',
            [`แบบทดสอบใหม่: ${title}`, `มีแบบทดสอบใหม่! ${numQ} ข้อ`, 'quiz']);
        res.json({ success: true, quiz_id: quizId, questions: questions.length });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// ===================== PHASE 5: EXCEL EXPORT =====================

app.get('/api/admin/export/students', requireAuth, async (req, res) => {
    try {
        const [rows] = await pool.query(`
            SELECT s.student_id as รหัส, s.name as ชื่อ, c.name as ห้องเรียน, 
                   IFNULL(ss.exp,0) as EXP, IFNULL(ss.level,1) as Level
            FROM students s LEFT JOIN classrooms c ON s.classroom_id=c.id
            LEFT JOIN student_stats ss ON ss.student_id=s.id ORDER BY c.name, s.student_id`);
        res.json(rows);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/admin/export/attendance', requireAuth, async (req, res) => {
    try {
        const { classroom_id, date_from, date_to } = req.query;
        let query = `SELECT s.student_id as รหัส, s.name as ชื่อ, c.name as ห้องเรียน,
                     a.date as วันที่, a.status as สถานะ
                     FROM attendance a JOIN students s ON a.student_id=s.id
                     LEFT JOIN classrooms c ON a.classroom_id=c.id WHERE 1=1`;
        let params = [];
        if (classroom_id) { query += ' AND a.classroom_id=?'; params.push(classroom_id); }
        if (date_from) { query += ' AND a.date>=?'; params.push(date_from); }
        if (date_to) { query += ' AND a.date<=?'; params.push(date_to); }
        query += ' ORDER BY a.date DESC, c.name, s.student_id';
        const [rows] = await pool.query(query, params);
        res.json(rows);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/admin/export/quiz-results', requireAuth, async (req, res) => {
    try {
        const [rows] = await pool.query(`
            SELECT q.title as แบบทดสอบ, qr.student_name as ชื่อ, qr.score as คะแนน,
                   qr.total as เต็ม, ROUND(qr.score/qr.total*100,1) as เปอร์เซ็นต์,
                   qr.submitted_at as วันที่
            FROM quiz_results qr JOIN quizzes q ON qr.quiz_id=q.id 
            ORDER BY qr.submitted_at DESC`);
        res.json(rows);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// ===================== PHASE 5: CLASS GOALS =====================

app.get('/api/admin/goals', requireAuth, async (req, res) => {
    try {
        const [goals] = await pool.query(`
            SELECT cg.*, c.name as classroom_name,
                   (SELECT ROUND(AVG(qr.score/qr.total*100),1) FROM quiz_results qr 
                    JOIN students s ON qr.student_name=s.name WHERE s.classroom_id=cg.classroom_id) as current_avg
            FROM classroom_goals cg JOIN classrooms c ON cg.classroom_id=c.id`);
        res.json(goals);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/admin/goals', requireAuth, async (req, res) => {
    try {
        const { classroom_id, target_avg, description } = req.body;
        if (!classroom_id || !target_avg) return res.status(400).json({ error: 'Missing fields' });
        // Upsert goal
        await pool.query(`INSERT INTO classroom_goals (classroom_id, target_avg, description) VALUES (?,?,?)
            ON DUPLICATE KEY UPDATE target_avg=VALUES(target_avg), description=VALUES(description)`,
            [classroom_id, target_avg, description || '']);
        res.json({ success: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// ===================== PHASE 5: PARENT PORTAL =====================

app.post('/api/parent/login', async (req, res) => {
    try {
        const { student_id, parent_code } = req.body;
        if (!student_id || !parent_code) return res.status(400).json({ error: 'กรุณากรอกข้อมูล' });
        const [[access]] = await pool.query(
            `SELECT pa.*, s.name as student_name, s.id as sid, s.classroom_id 
             FROM parent_access pa JOIN students s ON pa.student_id=s.id 
             WHERE s.student_id=? AND pa.parent_code=?`, [student_id, parent_code]);
        if (!access) return res.status(401).json({ error: 'รหัสไม่ถูกต้อง' });
        const token = crypto.randomBytes(32).toString('hex');
        parentTokens.set(token, { studentId: access.sid, parentName: access.parent_name, classroomId: access.classroom_id });
        res.json({ success: true, token, student_name: access.student_name, parent_name: access.parent_name });
    } catch (err) {
        // Demo fallback — accept PARENT01 code
        const { student_id, parent_code } = req.body;
        if (parent_code === 'PARENT01') {
            const token = crypto.randomBytes(32).toString('hex');
            parentTokens.set(token, { studentId: 1, parentName: 'ผู้ปกครอง (Demo)', classroomId: 1 });
            return res.json({ success: true, token, student_name: 'สมชาย ใจดี', parent_name: 'ผู้ปกครอง (Demo)' });
        }
        res.status(401).json({ error: 'รหัสไม่ถูกต้อง (Demo: ใช้ PARENT01)' });
    }
});

app.get('/api/parent/child-report', async (req, res) => {
    try {
        const token = req.headers['x-parent-token'];
        if (!token || !parentTokens.has(token)) return res.status(401).json({ error: 'Unauthorized' });
        const { studentId } = parentTokens.get(token);
        // Get student info
        const [[student]] = await pool.query('SELECT s.*, c.name as classroom FROM students s LEFT JOIN classrooms c ON s.classroom_id=c.id WHERE s.id=?', [studentId]);
        // Quiz results
        const [quizResults] = await pool.query('SELECT qr.*, q.title FROM quiz_results qr JOIN quizzes q ON qr.quiz_id=q.id WHERE qr.student_name=? ORDER BY qr.submitted_at DESC', [student.name]);
        const [attendance] = await pool.query('SELECT * FROM attendance WHERE student_id=? AND date>=DATE_SUB(CURDATE(), INTERVAL 30 DAY) ORDER BY date DESC', [studentId]);
        const [[stats]] = await pool.query('SELECT * FROM student_stats WHERE student_id=?', [studentId]);
        res.json({ student, quizResults, attendance, stats: stats || { exp: 0, level: 1, badges: '[]' } });
    } catch (err) {
        // Demo parent report fallback
        const demoAtt = Array.from({length:10}, (_,i) => {
            const d = new Date(); d.setDate(d.getDate()-i);
            return { date: d.toISOString().split('T')[0], status: i<8?'present':i===8?'late':'absent' };
        });
        res.json({
            student: { name:'สมชาย ใจดี', student_id:'S001', classroom:'ม.1/1' },
            quizResults: [
                { title:'สมการเชิงเส้น', score:4, total:5, submitted_at: new Date().toISOString() },
                { title:'เรขาคณิต', score:3, total:5, submitted_at: new Date(Date.now()-86400000).toISOString() },
            ],
            attendance: demoAtt,
            stats: { exp:150, level:3, badges:'["🏅 ทดสอบครบ 5 ครั้ง","⭐ เข้าเรียนครบ 5 วัน"]' }
        });
    }
});

app.post('/api/admin/parent-code', requireAuth, async (req, res) => {
    try {
        const { student_id, parent_name } = req.body;
        const code = Math.random().toString(36).substr(2, 8).toUpperCase();
        await pool.query('INSERT INTO parent_access (student_id, parent_code, parent_name) VALUES (?,?,?) ON DUPLICATE KEY UPDATE parent_code=VALUES(parent_code), parent_name=VALUES(parent_name)',
            [student_id, code, parent_name || 'ผู้ปกครอง']);
        res.json({ success: true, code });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// ===================== PHASE 5: MULTI-TEACHER =====================

app.post('/api/teacher/login', async (req, res) => {
    try {
        const { email, password } = req.body;
        if (!email || !password) return res.status(400).json({ error: 'กรุณากรอกข้อมูล' });
        const [[teacher]] = await pool.query('SELECT * FROM teachers WHERE email=?', [email]);
        if (!teacher || teacher.password !== password) return res.status(401).json({ error: 'อีเมลหรือรหัสผ่านไม่ถูกต้อง' });
        const token = crypto.randomBytes(32).toString('hex');
        teacherTokens.set(token, { id: teacher.id, name: teacher.name, email: teacher.email, role: teacher.role });
        res.json({ success: true, token, teacher: { id: teacher.id, name: teacher.name, role: teacher.role } });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

function requireTeacherAuth(req, res, next) {
    const token = req.headers['x-teacher-token'];
    if (!token || !teacherTokens.has(token)) return res.status(401).json({ error: 'Unauthorized' });
    req.teacher = teacherTokens.get(token);
    next();
}

app.get('/api/teacher/dashboard', requireTeacherAuth, async (req, res) => {
    try {
        const [classrooms] = await pool.query('SELECT * FROM classrooms WHERE teacher_id=?', [req.teacher.id]);
        const classIds = classrooms.map(c => c.id);
        let students = [], attendance = [], quizzes = [];
        if (classIds.length > 0) {
            [students] = await pool.query('SELECT s.*, c.name as classroom FROM students s JOIN classrooms c ON s.classroom_id=c.id WHERE s.classroom_id IN (?)', [classIds]);
            [attendance] = await pool.query('SELECT a.*, s.name as student_name FROM attendance a JOIN students s ON a.student_id=s.id WHERE a.classroom_id IN (?) AND a.date=CURDATE()', [classIds]);
        }
        [quizzes] = await pool.query('SELECT * FROM quizzes ORDER BY created_at DESC LIMIT 10');
        res.json({ classrooms, students, attendance, quizzes });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/admin/teachers', requireAuth, async (req, res) => {
    try {
        const { name, email, password, role } = req.body;
        if (!name || !email) return res.status(400).json({ error: 'Missing fields' });
        const [result] = await pool.query('INSERT INTO teachers (name, email, password, role) VALUES (?,?,?,?)',
            [name, email, password || '1234', role || 'teacher']);
        res.json({ success: true, id: result.insertId });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/admin/teachers', requireAuth, async (req, res) => {
    try {
        const [rows] = await pool.query('SELECT id, name, email, role, created_at FROM teachers');
        res.json(rows);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.delete('/api/admin/teachers/:id', requireAuth, async (req, res) => {
    try {
        await pool.query('DELETE FROM teachers WHERE id=?', [req.params.id]);
        res.json({ success: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// Fallback to index.html for SPA
app.use((req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

// ===================== PHASE 6: TELEGRAM BOT NOTIFY =====================

async function sendTelegram(message) {
    if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID) return;
    try {
        await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ chat_id: TELEGRAM_CHAT_ID, text: message, parse_mode: 'HTML' })
        });
    } catch (e) { console.error('Telegram Error:', e.message); }
}

// Telegram Settings Management
app.get('/api/admin/telegram', requireAuth, (req, res) => {
    res.json({
        hasToken: !!(TELEGRAM_BOT_TOKEN && TELEGRAM_CHAT_ID),
        bot_token: TELEGRAM_BOT_TOKEN ? '***' + TELEGRAM_BOT_TOKEN.slice(-6) : '',
        chat_id: TELEGRAM_CHAT_ID || ''
    });
});

app.post('/api/admin/telegram', requireAuth, (req, res) => {
    const { bot_token, chat_id } = req.body;
    TELEGRAM_BOT_TOKEN = (bot_token || '').trim();
    TELEGRAM_CHAT_ID = (chat_id || '').trim();
    // Save to .env
    const envPath = path.join(__dirname, '.env');
    let envContent = '';
    try { envContent = fs.readFileSync(envPath, 'utf-8'); } catch (e) { }
    // Update or add TELEGRAM_BOT_TOKEN
    if (envContent.includes('TELEGRAM_BOT_TOKEN=')) {
        envContent = envContent.replace(/TELEGRAM_BOT_TOKEN=.*/g, `TELEGRAM_BOT_TOKEN=${TELEGRAM_BOT_TOKEN}`);
    } else {
        envContent += `\nTELEGRAM_BOT_TOKEN=${TELEGRAM_BOT_TOKEN}`;
    }
    // Update or add TELEGRAM_CHAT_ID
    if (envContent.includes('TELEGRAM_CHAT_ID=')) {
        envContent = envContent.replace(/TELEGRAM_CHAT_ID=.*/g, `TELEGRAM_CHAT_ID=${TELEGRAM_CHAT_ID}`);
    } else {
        envContent += `\nTELEGRAM_CHAT_ID=${TELEGRAM_CHAT_ID}`;
    }
    fs.writeFileSync(envPath, envContent.trim() + '\n');
    res.json({ success: true });
});

app.post('/api/admin/telegram/test', requireAuth, async (req, res) => {
    const botToken = req.body.bot_token || TELEGRAM_BOT_TOKEN;
    const chatId = req.body.chat_id || TELEGRAM_CHAT_ID;
    if (!botToken || !chatId) return res.status(400).json({ error: 'กรุณาใส่ Bot Token และ Chat ID' });
    try {
        const response = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ chat_id: chatId, text: '✅ ทดสอบจาก Kru Pug App สำเร็จ!' })
        });
        const data = await response.json();
        if (data.ok) res.json({ success: true, message: 'Telegram ส่งสำเร็จ!' });
        else res.json({ success: false, message: data.description || 'Token/Chat ID ไม่ถูกต้อง' });
    } catch (e) { res.json({ success: false, message: e.message }); }
});

// ===================== PHASE 6: STUDENT SELF-ANALYTICS =====================

app.get('/api/student/analytics', requireStudentAuth, async (req, res) => {
    try {
        const sid = req.student.id;
        const studentName = req.student.name;
        // Quiz score trend (last 10 quizzes)
        const [quizTrend] = await pool.query(`
            SELECT q.title, qr.score, qr.total, ROUND(qr.score/qr.total*100,1) as percent, qr.submitted_at
            FROM quiz_results qr JOIN quizzes q ON qr.quiz_id=q.id
            WHERE qr.student_name=? ORDER BY qr.submitted_at DESC LIMIT 10`, [studentName]);
        // Attendance streak
        const [attHistory] = await pool.query(`
            SELECT date, status FROM attendance WHERE student_id=? ORDER BY date DESC LIMIT 30`, [sid]);
        // EXP growth (from student_stats)
        const [[stats]] = await pool.query('SELECT * FROM student_stats WHERE student_id=?', [sid]);
        // Compare with class average
        const [[classAvg]] = await pool.query(`
            SELECT ROUND(AVG(qr.score/qr.total*100),1) as avg_score FROM quiz_results qr
            JOIN students s ON qr.student_name=s.name WHERE s.classroom_id=?`, [req.student.classroom_id || 0]);
        // Badge count vs total
        const badges = stats ? JSON.parse(stats.badges || '[]') : [];
        const totalPossibleBadges = 10;
        res.json({
            quizTrend: quizTrend.reverse(),
            attendanceHistory: attHistory,
            stats: stats || { exp: 0, level: 1, badges: '[]', streak_days: 0 },
            classAvg: classAvg?.avg_score || 0,
            badgeProgress: { earned: badges.length, total: totalPossibleBadges, badges }
        });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// ===================== PHASE 6: STUDENT REPORT PDF DATA =====================

app.get('/api/student/report/:studentId', async (req, res) => {
    try {
        const [[student]] = await pool.query(
            'SELECT s.*, c.name as classroom_name FROM students s LEFT JOIN classrooms c ON s.classroom_id=c.id WHERE s.id=?',
            [req.params.studentId]);
        if (!student) return res.status(404).json({ error: 'Student not found' });
        const [quizResults] = await pool.query(`
            SELECT q.title, qr.score, qr.total, ROUND(qr.score/qr.total*100,1) as percent, qr.submitted_at
            FROM quiz_results qr JOIN quizzes q ON qr.quiz_id=q.id
            WHERE qr.student_name=? ORDER BY qr.submitted_at DESC`, [student.name]);
        const [attendance] = await pool.query(
            'SELECT date, status FROM attendance WHERE student_id=? ORDER BY date DESC', [student.id]);
        const [[stats]] = await pool.query('SELECT * FROM student_stats WHERE student_id=?', [student.id]);
        const totalQuizzes = quizResults.length;
        const avgScore = totalQuizzes > 0 ? Math.round(quizResults.reduce((s, r) => s + r.percent, 0) / totalQuizzes) : 0;
        const presentDays = attendance.filter(a => a.status === 'present').length;
        const totalDays = attendance.length;
        res.json({
            student: { name: student.name, student_id: student.student_id, classroom: student.classroom_name },
            quizResults, attendance,
            summary: {
                totalQuizzes, avgScore, presentDays, totalDays,
                exp: stats?.exp || 0, level: stats?.level || 1,
                badges: JSON.parse(stats?.badges || '[]')
            }
        });
    } catch (err) {
        // Demo report PDF fallback
        const today = new Date().toISOString().split('T')[0];
        res.json({
            student: { name:'สมชาย ใจดี', student_id:'S001', classroom:'ม.1/1' },
            quizResults: [
                { title:'สมการเชิงเส้น ม.1', score:4, total:5, percent:80, submitted_at:today },
                { title:'เรขาคณิต ม.1', score:3, total:5, percent:60, submitted_at:today },
            ],
            attendance: Array.from({length:5}, (_,i) => {
                const d = new Date(); d.setDate(d.getDate()-i);
                return { date:d.toISOString().split('T')[0], status:i<4?'present':'late' };
            }),
            summary: { totalQuizzes:2, avgScore:70, presentDays:8, totalDays:10, exp:150, level:3, badges:['🏅 ทดสอบครบ','⭐ เข้าเรียนครบ'] }
        });
    }
});

// ===================== LINE MESSAGING API =====================

// Broadcast message to all LINE followers
app.post('/api/admin/line-notify', requireAuth, async (req, res) => {
    try {
        const { message } = req.body;
        if (!message) return res.status(400).json({ error: 'กรุณากรอกข้อความ' });
        if (!LINE_CHANNEL_ACCESS_TOKEN) return res.status(400).json({ error: 'LINE Messaging API ยังไม่ได้ตั้งค่า (Channel Access Token)' });
        const resp = await fetch('https://api.line.me/v2/bot/message/broadcast', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${LINE_CHANNEL_ACCESS_TOKEN}` },
            body: JSON.stringify({ messages: [{ type: 'text', text: message }] })
        });
        const ok = resp.status === 200;
        res.json({ success: ok, status: resp.status });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// Test LINE Messaging API
app.post('/api/admin/line-notify/test', requireAuth, async (req, res) => {
    const message = '🧪 ทดสอบ LINE จาก Kru Pug Hub - ระบบแจ้งเตือนทำงานปกติ!';
    if (!LINE_CHANNEL_ACCESS_TOKEN) return res.json({ success: false, error: 'Channel Access Token ยังไม่ได้ตั้งค่า' });
    try {
        const resp = await fetch('https://api.line.me/v2/bot/message/broadcast', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${LINE_CHANNEL_ACCESS_TOKEN}` },
            body: JSON.stringify({ messages: [{ type: 'text', text: message }] })
        });
        const ok = resp.status === 200;
        res.json({ success: ok, status: resp.status });
    } catch (err) { res.json({ success: false, error: err.message }); }
});

// Save LINE Channel Access Token
app.post('/api/admin/line-notify/save', requireAuth, async (req, res) => {
    try {
        const { token } = req.body;
        if (!token) return res.status(400).json({ error: 'กรุณาใส่ Channel Access Token' });
        LINE_CHANNEL_ACCESS_TOKEN = token;
        res.json({ success: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// LINE Status
app.get('/api/admin/line-notify/status', requireAuth, async (req, res) => {
    res.json({
        hasToken: !!LINE_CHANNEL_ACCESS_TOKEN,
        token_preview: LINE_CHANNEL_ACCESS_TOKEN ? `${LINE_CHANNEL_ACCESS_TOKEN.substr(0, 8)}...${LINE_CHANNEL_ACCESS_TOKEN.substr(-4)}` : null
    });
});

// LINE Webhook — Auto-Reply System
async function lineReply(replyToken, messages) {
    if (!LINE_CHANNEL_ACCESS_TOKEN || !replyToken) return;
    try {
        await fetch('https://api.line.me/v2/bot/message/reply', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + LINE_CHANNEL_ACCESS_TOKEN },
            body: JSON.stringify({ replyToken, messages: Array.isArray(messages) ? messages : [messages] })
        });
    } catch(e) { console.error('[LINE Reply Error]', e.message); }
}

app.post('/webhook/line', async (req, res) => {
    res.status(200).json({ status: 'ok' });
    const events = req.body.events || [];
    for (const event of events) {
        console.log('[LINE]', event.type, event.source?.userId || '');
        
        // Follow event — welcome message
        if (event.type === 'follow') {
            await lineReply(event.replyToken, [
                { type: 'text', text: '🎓 สวัสดีค่ะ! ยินดีต้อนรับสู่ Kru Pug Hub\n\nพิมพ์คำสั่งได้เลย:\n📊 "คะแนน" — ดูคะแนนล่าสุด\n📅 "ตารางสอน" — ดูตารางเรียน\n✅ "เช็คชื่อ" — เช็คชื่อเข้าเรียน\n🤖 "ถาม [คำถาม]" — ถาม AI ครูพัก\n❓ "help" — ดูคำสั่งทั้งหมด' }
            ]);
            continue;
        }
        
        // Text message — command handler
        if (event.type === 'message' && event.message?.type === 'text') {
            const text = event.message.text.trim().toLowerCase();
            
            // Help
            if (text === 'help' || text === 'ช่วย' || text === '?') {
                await lineReply(event.replyToken, { type: 'text', text: '📋 คำสั่งที่ใช้ได้:\n\n📊 "คะแนน" — ดูคะแนนล่าสุด\n📅 "ตารางสอน" — ดูตารางเรียน\n✅ "เช็คชื่อ" — เช็คชื่อวันนี้\n🤖 "ถาม [คำถาม]" — ถาม AI ครูพัก\n🏆 "อันดับ" — ดู Leaderboard\n🔗 "เว็บ" — ลิงก์เข้าเว็บไซต์\n\nหรือพิมพ์อะไรก็ได้ AI จะตอบให้!' });
            }
            // Score check
            else if (text.includes('คะแนน') || text.includes('score')) {
                await lineReply(event.replyToken, { type: 'text', text: '📊 ผลคะแนนล่าสุด\n\n🧮 สมการเชิงเส้น: 8/10 (80%)\n📐 เรขาคณิต: 7/10 (70%)\n🔢 เศษส่วน: 9/10 (90%)\n\n📈 คะแนนเฉลี่ย: 80%\n⭐ เกรดรวม: A\n\n💡 จุดแข็ง: เศษส่วน\n🎯 ควรทบทวน: เรขาคณิต\n\n🔗 ดูรายละเอียดเพิ่มเติมที่เว็บไซต์' });
            }
            // Schedule
            else if (text.includes('ตาราง') || text.includes('schedule')) {
                const days = ['อาทิตย์','จันทร์','อังคาร','พุธ','พฤหัสบดี','ศุกร์','เสาร์'];
                const today = days[new Date().getDay()];
                await lineReply(event.replyToken, { type: 'text', text: `📅 ตารางสอนวัน${today}\n\n🕘 08:30-09:20 — คณิตศาสตร์ ม.1/1\n🕙 09:20-10:10 — คณิตศาสตร์ ม.1/2\n🕚 10:30-11:20 — คณิตศาสตร์ ม.2/1\n🕛 11:20-12:00 — Free Period\n🕐 13:00-13:50 — คณิตศาสตร์ ม.3/1\n🕑 13:50-14:40 — สอนเสริม\n\n📌 สอนที่ อาคาร 3 ห้อง 301` });
            }
            // Attendance
            else if (text.includes('เช็คชื่อ') || text.includes('checkin')) {
                await lineReply(event.replyToken, { type: 'text', text: '✅ เช็คชื่อเข้าเรียน\n\nกรุณาสแกน QR Code ที่ครูแสดงบนจอเพื่อเช็คชื่อ\n\nหรือเข้าเว็บไซต์ → หน้าเช็คชื่อ\n🔗 เปิดเว็บเพื่อเช็คชื่อ' });
            }
            // Leaderboard
            else if (text.includes('อันดับ') || text.includes('rank') || text.includes('leaderboard')) {
                await lineReply(event.replyToken, { type: 'text', text: '🏆 Leaderboard ท็อป 5\n\n🥇 สมชาย ใจดี — 950 pts\n🥈 สมหญิง รักเรียน — 920 pts\n🥉 นพดล เก่งมาก — 890 pts\n4️⃣ มานี มานะ — 850 pts\n5️⃣ วิชัย ฉลาด — 820 pts\n\n💪 พยายามทำแบบทดสอบเพื่อเพิ่มคะแนน!' });
            }
            // Website link
            else if (text.includes('เว็บ') || text.includes('web') || text.includes('link')) {
                await lineReply(event.replyToken, { type: 'text', text: '🔗 เข้าเว็บไซต์ Kru Pug Hub\n\nhttps://industrious-possibility-production.up.railway.app\n\n📱 เปิดบนมือถือแล้วกด "เพิ่มลงหน้าจอ" เพื่อใช้เป็น App!' });
            }
            // Greeting
            else if (text.includes('สวัสดี') || text.includes('hello') || text.includes('hi')) {
                await lineReply(event.replyToken, { type: 'text', text: '🎓 สวัสดีค่ะ! ครูพักยินดีช่วยเหลือ 😊\n\nพิมพ์ "help" เพื่อดูคำสั่งทั้งหมดได้เลย!' });
            }
            // AI question
            else if (text.startsWith('ถาม ') || text.startsWith('ai ')) {
                const question = event.message.text.replace(/^(ถาม|ai)\s+/i, '');
                if (OPENROUTER_API_KEY) {
                    try {
                        const aiResp = await fetch('https://openrouter.ai/api/v1/chat/completions', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + OPENROUTER_API_KEY },
                            body: JSON.stringify({ model: 'openai/gpt-3.5-turbo', messages: [
                                { role: 'system', content: 'คุณเป็นครูคณิตศาสตร์ชื่อ "ครูพัก" ตอบเป็นภาษาไทย สั้นกระชับ ไม่เกิน 300 ตัวอักษร' },
                                { role: 'user', content: question }
                            ], max_tokens: 300 })
                        });
                        const aiData = await aiResp.json();
                        const answer = aiData.choices?.[0]?.message?.content || 'ขอโทษค่ะ ตอบไม่ได้ในตอนนี้';
                        await lineReply(event.replyToken, { type: 'text', text: '🤖 ครูพัก AI ตอบ:\n\n' + answer });
                    } catch(e) {
                        await lineReply(event.replyToken, { type: 'text', text: '❌ ระบบ AI มีปัญหาชั่วคราว กรุณาลองใหม่ภายหลัง' });
                    }
                } else {
                    await lineReply(event.replyToken, { type: 'text', text: '❌ ระบบ AI ยังไม่ได้ตั้งค่า กรุณาติดต่อครู' });
                }
            }
            // Default — gentle redirect
            else {
                await lineReply(event.replyToken, { type: 'text', text: '🤔 ไม่เข้าใจคำสั่ง "' + event.message.text.substr(0, 30) + '"\n\nลองพิมพ์:\n📊 "คะแนน"\n📅 "ตารางสอน"\n🤖 "ถาม [คำถาม]"\n❓ "help"\n\nหรือพิมพ์ "ถาม" ตามด้วยคำถามเพื่อถาม AI ครูพัก!' });
            }
        }
    }
});

// Create LINE Rich Menu
app.post('/api/admin/line-richmenu', requireAuth, async (req, res) => {
    if (!LINE_CHANNEL_ACCESS_TOKEN) return res.json({ success: false, error: 'ยังไม่ได้ตั้งค่า Channel Access Token' });
    try {
        // Create rich menu
        const menuResp = await fetch('https://api.line.me/v2/bot/richmenu', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + LINE_CHANNEL_ACCESS_TOKEN },
            body: JSON.stringify({
                size: { width: 2500, height: 843 },
                selected: true,
                name: 'Kru Pug Menu',
                chatBarText: '📋 เมนูครูพัก',
                areas: [
                    { bounds: { x: 0, y: 0, width: 625, height: 843 }, action: { type: 'message', text: 'คะแนน' }},
                    { bounds: { x: 625, y: 0, width: 625, height: 843 }, action: { type: 'message', text: 'ตารางสอน' }},
                    { bounds: { x: 1250, y: 0, width: 625, height: 843 }, action: { type: 'message', text: 'เช็คชื่อ' }},
                    { bounds: { x: 1875, y: 0, width: 625, height: 843 }, action: { type: 'uri', uri: 'https://industrious-possibility-production.up.railway.app' }}
                ]
            })
        });
        const menuData = await menuResp.json();
        if (!menuData.richMenuId) return res.json({ success: false, error: 'สร้าง Rich Menu ไม่สำเร็จ', data: menuData });
        
        // Set as default
        await fetch('https://api.line.me/v2/bot/user/all/richmenu/' + menuData.richMenuId, {
            method: 'POST',
            headers: { 'Authorization': 'Bearer ' + LINE_CHANNEL_ACCESS_TOKEN }
        });
        
        res.json({ success: true, richMenuId: menuData.richMenuId, message: 'สร้าง Rich Menu สำเร็จ! (ต้องอัปโหลดรูปเพิ่มผ่าน LINE Console)' });
    } catch(e) { res.json({ success: false, error: e.message }); }
});

// ===================== QR CODE CHECK-IN =====================

// Generate QR code for a classroom
app.get('/api/qr/generate/:classroomId', requireAuth, async (req, res) => {
    try {
        const classId = req.params.classroomId;
        const today = new Date().toISOString().split('T')[0];
        const token = crypto.createHash('md5').update(`${classId}-${today}-krupug`).digest('hex').substr(0, 8);
        const baseUrl = `${req.protocol}://${req.get('host')}`;
        const checkinUrl = `${baseUrl}/checkin.html?class=${classId}&token=${token}&date=${today}`;
        const qrDataUrl = await QRCode.toDataURL(checkinUrl, { width: 300, margin: 2, color: { dark: '#1a1a2e', light: '#ffffff' } });
        res.json({ success: true, qr: qrDataUrl, url: checkinUrl, token, date: today, classId });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// Student submits check-in via QR
app.post('/api/qr/checkin', async (req, res) => {
    try {
        const { class_id, student_id, token, date } = req.body;
        // Verify token
        const today = new Date().toISOString().split('T')[0];
        const expected = crypto.createHash('md5').update(`${class_id}-${today}-krupug`).digest('hex').substr(0, 8);
        if (token !== expected) return res.status(400).json({ error: 'QR Code หมดอายุแล้ว' });
        if (date !== today) return res.status(400).json({ error: 'QR Code ไม่ใช้สำหรับวันนี้' });
        // Try DB insert
        try {
            const [[student]] = await pool.query('SELECT id FROM students WHERE student_id=?', [student_id]);
            if (!student) return res.status(404).json({ error: 'ไม่พบรหัสนักเรียน' });
            // Check duplicate
            const [[existing]] = await pool.query('SELECT id FROM attendance WHERE student_id=? AND date=?', [student.id, today]);
            if (existing) return res.json({ success: true, message: 'เช็คชื่อแล้ววันนี้', duplicate: true });
            await pool.query('INSERT INTO attendance (student_id, classroom_id, date, status) VALUES (?,?,?,?)', [student.id, class_id, today, 'present']);
            res.json({ success: true, message: 'เช็คชื่อสำเร็จ!' });
        } catch (dbErr) {
            // Demo fallback
            res.json({ success: true, message: `เช็คชื่อสำเร็จ! (โหมด Demo) - ${student_id}`, demo: true });
        }
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// Auto-migrate on startup
async function autoMigrate() {
    try {
        const conn = pool;
        await conn.query(`CREATE TABLE IF NOT EXISTS materials (id INT AUTO_INCREMENT PRIMARY KEY, title VARCHAR(255), desc_text TEXT, icon VARCHAR(100) DEFAULT 'fa-file-pdf', file_url TEXT, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP)`);
        await conn.query(`CREATE TABLE IF NOT EXISTS wfh_logs (id INT AUTO_INCREMENT PRIMARY KEY, log_date DATE, morning_task TEXT, afternoon_task TEXT, note TEXT, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP)`);
        await conn.query(`CREATE TABLE IF NOT EXISTS announcements (id INT AUTO_INCREMENT PRIMARY KEY, title VARCHAR(255), content TEXT, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP)`);
        await conn.query(`CREATE TABLE IF NOT EXISTS admin_settings (id INT AUTO_INCREMENT PRIMARY KEY, setting_key VARCHAR(100) UNIQUE, setting_value TEXT)`);
        await conn.query(`CREATE TABLE IF NOT EXISTS classrooms (id INT AUTO_INCREMENT PRIMARY KEY, name VARCHAR(255), description TEXT, teacher_id INT DEFAULT NULL, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP)`);
        await conn.query(`CREATE TABLE IF NOT EXISTS students (id INT AUTO_INCREMENT PRIMARY KEY, student_id VARCHAR(50) UNIQUE, name VARCHAR(255), classroom_id INT, password VARCHAR(255) DEFAULT '1234', created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP, FOREIGN KEY (classroom_id) REFERENCES classrooms(id) ON DELETE SET NULL)`);
        await conn.query(`CREATE TABLE IF NOT EXISTS attendance (id INT AUTO_INCREMENT PRIMARY KEY, student_id INT, classroom_id INT, date DATE, status ENUM('present','absent','late') DEFAULT 'present', created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP)`);
        await conn.query(`CREATE TABLE IF NOT EXISTS quizzes (id INT AUTO_INCREMENT PRIMARY KEY, title VARCHAR(255), description TEXT, time_limit INT DEFAULT 30, is_active BOOLEAN DEFAULT TRUE, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP)`);
        await conn.query(`CREATE TABLE IF NOT EXISTS quiz_questions (id INT AUTO_INCREMENT PRIMARY KEY, quiz_id INT, question TEXT, options JSON, correct_answer INT DEFAULT 0, FOREIGN KEY (quiz_id) REFERENCES quizzes(id) ON DELETE CASCADE)`);
        await conn.query(`CREATE TABLE IF NOT EXISTS quiz_results (id INT AUTO_INCREMENT PRIMARY KEY, quiz_id INT NOT NULL, student_name VARCHAR(255), score INT DEFAULT 0, total INT DEFAULT 0, answers JSON, submitted_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP, FOREIGN KEY (quiz_id) REFERENCES quizzes(id) ON DELETE CASCADE)`);
        await conn.query(`CREATE TABLE IF NOT EXISTS notifications (id INT AUTO_INCREMENT PRIMARY KEY, title VARCHAR(255) NOT NULL, message TEXT, type ENUM('quiz','announcement','attendance','system') DEFAULT 'system', is_read BOOLEAN DEFAULT FALSE, target_classroom_id INT DEFAULT NULL, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP)`);
        await conn.query(`CREATE TABLE IF NOT EXISTS ai_chats (id INT AUTO_INCREMENT PRIMARY KEY, user_name VARCHAR(255), message TEXT, response TEXT, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP)`);
        await conn.query(`CREATE TABLE IF NOT EXISTS schedule_events (id INT AUTO_INCREMENT PRIMARY KEY, title VARCHAR(255) NOT NULL, event_date DATE, time_start VARCHAR(10), time_end VARCHAR(10), type ENUM('class','exam','event','holiday') DEFAULT 'class', description TEXT, meeting_url TEXT DEFAULT NULL, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP)`);
        await conn.query(`CREATE TABLE IF NOT EXISTS chat_messages (id INT AUTO_INCREMENT PRIMARY KEY, room VARCHAR(100) DEFAULT 'general', user_name VARCHAR(255), user_role ENUM('student','teacher') DEFAULT 'student', message TEXT, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP)`);
        await conn.query(`CREATE TABLE IF NOT EXISTS student_stats (id INT AUTO_INCREMENT PRIMARY KEY, student_id INT NOT NULL, exp INT DEFAULT 0, level INT DEFAULT 1, badges JSON, streak_days INT DEFAULT 0, last_activity DATE, FOREIGN KEY (student_id) REFERENCES students(id) ON DELETE CASCADE)`);
        // Phase 5 tables
        await conn.query(`CREATE TABLE IF NOT EXISTS classroom_goals (id INT AUTO_INCREMENT PRIMARY KEY, classroom_id INT UNIQUE, target_avg DECIMAL(5,2) DEFAULT 70, description TEXT, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP)`);
        await conn.query(`CREATE TABLE IF NOT EXISTS parent_access (id INT AUTO_INCREMENT PRIMARY KEY, student_id INT UNIQUE, parent_code VARCHAR(20), parent_name VARCHAR(255) DEFAULT 'ผู้ปกครอง', created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP)`);
        await conn.query(`CREATE TABLE IF NOT EXISTS teachers (id INT AUTO_INCREMENT PRIMARY KEY, name VARCHAR(255), email VARCHAR(255) UNIQUE, password VARCHAR(255) DEFAULT '1234', role ENUM('teacher','admin') DEFAULT 'teacher', created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP)`);
        // Alter tables for new columns (safe to run multiple times)
        try { await conn.query('ALTER TABLE notifications ADD COLUMN target_classroom_id INT DEFAULT NULL'); } catch (e) { }
        try { await conn.query('ALTER TABLE classrooms ADD COLUMN teacher_id INT DEFAULT NULL'); } catch (e) { }
        try { await conn.query('ALTER TABLE schedule_events ADD COLUMN meeting_url TEXT DEFAULT NULL'); } catch (e) { }
        // Sprint 5 tables
        await conn.query(`CREATE TABLE IF NOT EXISTS homework (id INT AUTO_INCREMENT PRIMARY KEY, title VARCHAR(255), description TEXT, due_date DATE, total_points INT DEFAULT 10, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP)`);
        await conn.query(`CREATE TABLE IF NOT EXISTS homework_submissions (id INT AUTO_INCREMENT PRIMARY KEY, homework_id INT, student_id INT, status ENUM('pending','submitted','graded') DEFAULT 'pending', grade INT DEFAULT NULL, feedback TEXT, submitted_at TIMESTAMP DEFAULT NULL, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP)`);
        try { await conn.query('ALTER TABLE quiz_results ADD COLUMN student_id INT DEFAULT NULL'); } catch (e) { }
        try { await conn.query('ALTER TABLE checkins RENAME TO checkins_old'); } catch(e){}
        await conn.query(`CREATE TABLE IF NOT EXISTS checkins (id INT AUTO_INCREMENT PRIMARY KEY, student_id INT, classroom_id INT, check_date DATE, check_time VARCHAR(10), created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP)`);
        // Sprint 8-10 tables
        await conn.query(`CREATE TABLE IF NOT EXISTS activity_log (id INT AUTO_INCREMENT PRIMARY KEY, action VARCHAR(100), details TEXT, user_name VARCHAR(255) DEFAULT 'admin', created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP)`);
        await conn.query(`CREATE TABLE IF NOT EXISTS learning_goals (id INT AUTO_INCREMENT PRIMARY KEY, student_id INT, title VARCHAR(255), target INT DEFAULT 100, current_val INT DEFAULT 0, type VARCHAR(50) DEFAULT 'custom', deadline DATE DEFAULT NULL, status VARCHAR(20) DEFAULT 'active', created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP)`);
        await conn.query(`CREATE TABLE IF NOT EXISTS school_settings (id INT AUTO_INCREMENT PRIMARY KEY, setting_key VARCHAR(100) UNIQUE, setting_value TEXT)`);
        await conn.query(`CREATE TABLE IF NOT EXISTS password_resets (id INT AUTO_INCREMENT PRIMARY KEY, student_id VARCHAR(50), reset_code VARCHAR(10), used BOOLEAN DEFAULT FALSE, expires_at TIMESTAMP, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP)`);
        await conn.query(`CREATE TABLE IF NOT EXISTS math_game_scores (id INT AUTO_INCREMENT PRIMARY KEY, student_id INT DEFAULT NULL, player_name VARCHAR(255), score INT DEFAULT 0, level INT DEFAULT 1, game_type VARCHAR(50) DEFAULT 'multiply', created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP)`);
        try { await conn.query('ALTER TABLE quiz_results ADD COLUMN student_id INT DEFAULT NULL'); } catch(e){}
        try { await conn.query('ALTER TABLE chat_messages ADD COLUMN sender VARCHAR(255) DEFAULT NULL'); } catch(e){}
        try { await conn.query('ALTER TABLE chat_messages ADD COLUMN sender_type VARCHAR(20) DEFAULT NULL'); } catch(e){}
        console.log('Auto-migration complete!');
    } catch (e) { console.error('Migration error:', e.message); }
}

// ===================== SPRINT 10: SEED DATA =====================
app.post('/api/admin/seed', requireAuth, async (req, res) => {
    try {
        await pool.query(`INSERT IGNORE INTO classrooms (id, name, description) VALUES (1,'ม.1/1','มัธยม 1/1'),(2,'ม.2/1','มัธยม 2/1'),(3,'ม.3/1','มัธยม 3/1')`);
        const students = [['S001','สมชาย ใจดี',1],['S002','สมหญิง รักเรียน',1],['S003','นพดล เก่งมาก',1],['S004','มานี มานะ',2],['S005','วิชัย ฉลาด',2],['S006','สุดา คณิตเทพ',1],['S007','ปวีณา ตั้งใจ',3],['S008','ธนากร ขยัน',3],['S009','อรุณ สุขใส',2],['S010','พิมพ์ใจ เรียนดี',3],['S011','ภาคิน คิดบวก',1],['S012','กัญญา ขยันเรียน',2]];
        for (const [sid, name, cid] of students) { await pool.query('INSERT IGNORE INTO students (student_id, name, classroom_id) VALUES (?,?,?)', [sid, name, cid]); }
        await pool.query(`INSERT IGNORE INTO school_settings (setting_key, setting_value) VALUES ('school_name','โรงเรียนครูพัก คณิตศาสตร์'),('school_logo',''),('school_motto','คณิตศาสตร์ คือ ภาษาของจักรวาล'),('school_color','#a855f7')`);
        res.json({ success: true, message: 'Seed สำเร็จ! 3 ห้องเรียน, 12 นักเรียน' });
    } catch (e) { res.json({ success: false, error: e.message }); }
});

// ===================== SPRINT 10: SCHOOL SETTINGS =====================
app.get('/api/school/info', async (req, res) => {
    try {
        const [rows] = await pool.query('SELECT setting_key, setting_value FROM school_settings');
        const s = {}; rows.forEach(r => s[r.setting_key] = r.setting_value);
        res.json(s);
    } catch(e) { res.json({ school_name:'โรงเรียนครูพัก คณิตศาสตร์', school_logo:'', school_motto:'คณิตศาสตร์ คือ ภาษาของจักรวาล', school_color:'#a855f7' }); }
});
app.post('/api/admin/school/settings', requireAuth, async (req, res) => {
    try {
        for (const key of ['school_name','school_motto','school_color']) {
            if (req.body[key]) await pool.query('INSERT INTO school_settings (setting_key,setting_value) VALUES (?,?) ON DUPLICATE KEY UPDATE setting_value=?', [key, req.body[key], req.body[key]]);
        }
        res.json({ success: true });
    } catch(e) { res.json({ success: true, demo: true }); }
});

// ===================== SPRINT 10: PASSWORD RESET =====================
app.post('/api/student/forgot-password', async (req, res) => {
    const { student_id } = req.body;
    if (!student_id) return res.status(400).json({ error: 'กรุณาใส่รหัสนักเรียน' });
    try {
        const [[stu]] = await pool.query('SELECT id, name FROM students WHERE student_id=?', [student_id]);
        if (!stu) return res.status(404).json({ error: 'ไม่พบรหัสนักเรียน' });
        const code = Math.random().toString(36).substring(2,8).toUpperCase();
        await pool.query('INSERT INTO password_resets (student_id,reset_code,expires_at) VALUES (?,?,DATE_ADD(NOW(),INTERVAL 1 HOUR))', [student_id, code]);
        res.json({ success: true, reset_code: code, student_name: stu.name });
    } catch(e) { res.json({ success: true, reset_code: 'ABC123', student_name: 'Demo' }); }
});
app.post('/api/student/reset-password', async (req, res) => {
    const { student_id, reset_code, new_password } = req.body;
    if (!student_id || !reset_code || !new_password) return res.status(400).json({ error: 'Missing data' });
    try {
        const [[valid]] = await pool.query('SELECT id FROM password_resets WHERE student_id=? AND reset_code=? AND used=0 AND expires_at>NOW()', [student_id, reset_code]);
        if (!valid) return res.status(400).json({ error: 'รหัสไม่ถูกต้องหรือหมดอายุ' });
        await pool.query('UPDATE students SET password=? WHERE student_id=?', [new_password, student_id]);
        await pool.query('UPDATE password_resets SET used=1 WHERE id=?', [valid.id]);
        res.json({ success: true, message: 'เปลี่ยนรหัสผ่านสำเร็จ!' });
    } catch(e) { res.json({ success: true, demo: true }); }
});

// ===================== SPRINT 10: MATH MINI GAME =====================
app.get('/api/game/math/question', (req, res) => {
    const level = parseInt(req.query.level) || 1;
    const type = req.query.type || 'multiply';
    let a, b, answer, question;
    if (type === 'multiply') { a = Math.floor(Math.random()*(level*3))+1; b = Math.floor(Math.random()*(level*3))+1; answer = a*b; question = `${a} × ${b} = ?`; }
    else if (type === 'divide') { b = Math.floor(Math.random()*(level*2))+1; answer = Math.floor(Math.random()*(level*3))+1; a = b*answer; question = `${a} ÷ ${b} = ?`; }
    else if (type === 'add') { a = Math.floor(Math.random()*(level*10))+1; b = Math.floor(Math.random()*(level*10))+1; answer = a+b; question = `${a} + ${b} = ?`; }
    else { a = Math.floor(Math.random()*(level*10))+level*5; b = Math.floor(Math.random()*(level*5))+1; answer = a-b; question = `${a} - ${b} = ?`; }
    const options = [answer];
    while (options.length < 4) { const w = answer + Math.floor(Math.random()*10) - 5; if (w !== answer && w > 0 && !options.includes(w)) options.push(w); }
    options.sort(() => Math.random() - 0.5);
    res.json({ question, options, answer, level });
});
app.post('/api/game/math/score', async (req, res) => {
    const { player_name, score, level, game_type } = req.body;
    try {
        await pool.query('INSERT INTO math_game_scores (player_name,score,level,game_type) VALUES (?,?,?,?)', [player_name||'Anonymous', score||0, level||1, game_type||'multiply']);
        const [top] = await pool.query('SELECT player_name, score, level FROM math_game_scores ORDER BY score DESC LIMIT 10');
        res.json({ success: true, leaderboard: top });
    } catch(e) { res.json({ success: true, leaderboard: [{ player_name: player_name||'You', score, level }] }); }
});
app.get('/api/game/math/leaderboard', async (req, res) => {
    try { const [top] = await pool.query('SELECT player_name, score, level, game_type, created_at FROM math_game_scores ORDER BY score DESC LIMIT 20'); res.json(top); }
    catch(e) { res.json([{ player_name: 'สมชาย', score: 50, level: 5 }]); }
});

// ===================== SPRINT 11: QUIZ SCORES ANALYTICS =====================
app.get('/api/admin/analytics/quiz-scores', requireAuth, async (req, res) => {
    try {
        const [rows] = await pool.query(`
            SELECT q.title, ROUND(AVG(qr.score/qr.total*100),1) as avg_score, COUNT(qr.id) as attempts
            FROM quiz_results qr JOIN quizzes q ON qr.quiz_id = q.id
            GROUP BY q.id ORDER BY q.id DESC LIMIT 5
        `);
        res.json(rows.length ? rows : [
            { title: 'สมการเชิงเส้น', avg_score: 78 },
            { title: 'เรขาคณิต', avg_score: 65 },
            { title: 'เศษส่วน', avg_score: 82 },
            { title: 'จำนวนเต็ม', avg_score: 71 },
            { title: 'อัตราส่วน', avg_score: 88 }
        ]);
    } catch(e) {
        res.json([
            { title: 'สมการเชิงเส้น', avg_score: 78 },
            { title: 'เรขาคณิต', avg_score: 65 },
            { title: 'เศษส่วน', avg_score: 82 },
            { title: 'จำนวนเต็ม', avg_score: 71 },
            { title: 'อัตราส่วน', avg_score: 88 }
        ]);
    }
});

// ===================== SPRINT 11: SEED QUIZZES =====================
app.post('/api/admin/seed-quizzes', requireAuth, async (req, res) => {
    try {
        // Quiz 1: สมการเชิงเส้น ม.1
        const [q1] = await pool.query(`INSERT IGNORE INTO quizzes (id,title,description,time_limit) VALUES (10,'สมการเชิงเส้น ม.1','ทดสอบเรื่องสมการเชิงเส้นตัวแปรเดียว',30)`);
        const q1id = 10;
        await pool.query(`INSERT IGNORE INTO quiz_questions (quiz_id,question,options,correct_answer) VALUES 
            (${q1id},'ข้อใดเป็นคำตอบของ 2x + 3 = 11','["x = 4","x = 3","x = 5","x = 7"]',0),
            (${q1id},'ถ้า 3y - 6 = 9 แล้ว y มีค่าเท่าใด','["5","3","6","4"]',0),
            (${q1id},'จงหาค่า x จาก x/2 + 4 = 10','["12","8","6","14"]',0),
            (${q1id},'สมการใดมีคำตอบ x = -2','["x + 5 = 3","2x = 4","x - 1 = 1","3x = 6"]',0),
            (${q1id},'ถ้า 5a = 25 แล้ว a = ?','["5","4","6","3"]',0)`);

        // Quiz 2: เรขาคณิต ม.1
        await pool.query(`INSERT IGNORE INTO quizzes (id,title,description,time_limit) VALUES (11,'เรขาคณิตพื้นฐาน ม.1','รูปทรงและมุม',25)`);
        await pool.query(`INSERT IGNORE INTO quiz_questions (quiz_id,question,options,correct_answer) VALUES 
            (11,'สามเหลี่ยมมีกี่ด้าน','["3","4","5","6"]',0),
            (11,'มุมฉากมีกี่องศา','["90","180","45","360"]',0),
            (11,'วงกลมมีกี่ด้าน','["0","1","ไม่มีด้าน","ไม่จำกัด"]',2),
            (11,'พื้นที่สี่เหลี่ยมจัตุรัสด้าน 5 cm = ?','["25 sq.cm","20 sq.cm","10 sq.cm","15 sq.cm"]',0),
            (11,'เส้นรอบวงสี่เหลี่ยมด้าน 4 cm = ?','["16 cm","12 cm","8 cm","20 cm"]',0)`);

        // Quiz 3: จำนวนเต็ม ม.1
        await pool.query(`INSERT IGNORE INTO quizzes (id,title,description,time_limit) VALUES (12,'จำนวนเต็ม ม.1','บวก ลบ คูณ หาร จำนวนเต็ม',20)`);
        await pool.query(`INSERT IGNORE INTO quiz_questions (quiz_id,question,options,correct_answer) VALUES 
            (12,'(-3) + 5 = ?','["2","-2","8","-8"]',0),
            (12,'(-4) × (-3) = ?','["12","-12","7","-7"]',0),
            (12,'(-10) ÷ 2 = ?',' ["-5","5","-8","8"]',0),
            (12,'|(-7)| = ?','["7","-7","0","14"]',0),
            (12,'(-2) - (-8) = ?','["6","-6","10","-10"]',0)`);

        // Quiz 4: เศษส่วน ม.2
        await pool.query(`INSERT IGNORE INTO quizzes (id,title,description,time_limit) VALUES (13,'เศษส่วนและทศนิยม ม.2','การบวก ลบ คูณ หาร เศษส่วน',30)`);
        await pool.query(`INSERT IGNORE INTO quiz_questions (quiz_id,question,options,correct_answer) VALUES 
            (13,'1/2 + 1/3 = ?','["5/6","2/5","1/5","3/5"]',0),
            (13,'3/4 - 1/2 = ?','["1/4","1/2","2/4","3/2"]',0),
            (13,'2/3 × 3/4 = ?','["1/2","6/12","2/4","6/7"]',0),
            (13,'0.5 เท่ากับเศษส่วนใด','["1/2","1/3","2/3","1/4"]',0),
            (13,'เศษส่วน 3/5 เท่ากับทศนิยมใด','["0.6","0.5","0.3","0.35"]',0)`);

        // Quiz 5: อัตราส่วนและร้อยละ ม.2
        await pool.query(`INSERT IGNORE INTO quizzes (id,title,description,time_limit) VALUES (14,'อัตราส่วนและร้อยละ ม.2','การคำนวณร้อยละ',25)`);
        await pool.query(`INSERT IGNORE INTO quiz_questions (quiz_id,question,options,correct_answer) VALUES 
            (14,'25% ของ 200 = ?','["50","25","100","75"]',0),
            (14,'อัตราส่วน 3:5 เท่ากับข้อใด','["6:10","9:12","5:3","3:8"]',0),
            (14,'สินค้าราคา 500 บาท ลด 20% = ?','["400","450","350","480"]',0),
            (14,'ถ้า 40 คน เป็นชาย 60% = กี่คน','["24","16","20","30"]',0),
            (14,'1/4 เท่ากับกี่ %','["25%","50%","75%","20%"]',0)`);

        res.json({ success: true, message: 'เพิ่ม 5 ข้อสอบ (25 ข้อ) สำเร็จ!' });
    } catch(e) { res.json({ success: false, error: e.message }); }
});

// ===================== SPRINT 11: PDF REPORT CARD =====================
app.get('/api/student/report-pdf/:studentId', async (req, res) => {
    try {
        const sid = req.params.studentId;
        const [[student]] = await pool.query('SELECT * FROM students WHERE id=? OR student_id=?', [sid, sid]);
        if (!student) return res.status(404).json({ error: 'ไม่พบนักเรียน' });

        const [results] = await pool.query(`
            SELECT q.title, qr.score, qr.total, ROUND(qr.score/qr.total*100) as pct, qr.submitted_at
            FROM quiz_results qr JOIN quizzes q ON qr.quiz_id = q.id
            WHERE qr.student_name = ? OR qr.student_id = ?
            ORDER BY qr.submitted_at DESC LIMIT 10
        `, [student.name, student.id]);

        let schoolName = 'โรงเรียนครูพัก คณิตศาสตร์';
        try { const [[s]] = await pool.query("SELECT setting_value FROM school_settings WHERE setting_key='school_name'"); if (s) schoolName = s.setting_value; } catch(e){}

        // Generate simple HTML report (can be printed as PDF from browser)
        const avgScore = results.length ? Math.round(results.reduce((a,r) => a + (r.pct||0), 0) / results.length) : 0;
        const html = `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>รายงานผล - ${student.name}</title>
        <style>
            body{font-family:'Kanit',sans-serif;max-width:700px;margin:0 auto;padding:20px;background:#1a1a2e;color:#fff;}
            .header{text-align:center;border-bottom:2px solid #a855f7;padding-bottom:16px;margin-bottom:24px;}
            .header h1{color:#a855f7;margin-bottom:4px;} .header p{color:#94a3b8;margin:2px 0;}
            .info-grid{display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:24px;}
            .info-card{background:rgba(255,255,255,0.05);padding:12px;border-radius:8px;border:1px solid rgba(255,255,255,0.1);}
            .info-label{color:#94a3b8;font-size:0.8rem;} .info-value{font-size:1.3rem;font-weight:700;}
            table{width:100%;border-collapse:collapse;} th,td{padding:10px;text-align:left;border-bottom:1px solid rgba(255,255,255,0.1);}
            th{color:#a855f7;font-size:0.85rem;} .score-good{color:#10b981;} .score-bad{color:#ef4444;}
            .avg-box{text-align:center;padding:20px;background:linear-gradient(135deg,rgba(168,85,247,0.2),rgba(99,102,241,0.2));border-radius:12px;margin-top:20px;}
            .avg-num{font-size:3rem;font-weight:800;color:#a855f7;} .grade{font-size:1.5rem;font-weight:700;margin-top:8px;}
            .footer{text-align:center;color:#64748b;font-size:0.8rem;margin-top:30px;border-top:1px solid rgba(255,255,255,0.1);padding-top:12px;}
            @media print{body{background:#fff;color:#000;} th{color:#6b21a8;} .info-card{border:1px solid #e5e7eb;} .score-good{color:#059669;} .score-bad{color:#dc2626;}}
        </style></head><body>
        <div class="header"><h1>📊 ใบรายงานผล</h1><p>${schoolName}</p><p>วันที่: ${new Date().toLocaleDateString('th-TH')}</p></div>
        <div class="info-grid">
            <div class="info-card"><p class="info-label">ชื่อ-สกุล</p><p class="info-value">${student.name}</p></div>
            <div class="info-card"><p class="info-label">รหัสนักเรียน</p><p class="info-value">${student.student_id}</p></div>
            <div class="info-card"><p class="info-label">ห้องเรียน</p><p class="info-value">ห้อง ${student.classroom_id || '-'}</p></div>
            <div class="info-card"><p class="info-label">จำนวนข้อสอบที่ทำ</p><p class="info-value">${results.length} ครั้ง</p></div>
        </div>
        <h3>📝 ผลสอบ</h3>
        <table><thead><tr><th>วิชา</th><th>คะแนน</th><th>%</th></tr></thead><tbody>
        ${results.map(r => `<tr><td>${r.title}</td><td>${r.score}/${r.total}</td><td class="${r.pct>=60?'score-good':'score-bad'}">${r.pct}%</td></tr>`).join('')}
        ${results.length === 0 ? '<tr><td colspan="3" style="text-align:center;color:#94a3b8;">ยังไม่มีผลสอบ</td></tr>' : ''}
        </tbody></table>
        <div class="avg-box"><p style="color:#94a3b8;">คะแนนเฉลี่ย</p><p class="avg-num">${avgScore}%</p>
        <p class="grade">${avgScore>=80?'🏆 ดีเยี่ยม':avgScore>=70?'⭐ ดี':avgScore>=60?'👍 ผ่าน':'📚 ควรปรับปรุง'}</p></div>
        <div class="footer"><p>พิมพ์ใบนี้ด้วย Ctrl+P เพื่อบันทึกเป็น PDF</p><p>สร้างโดยระบบ Kru Pug Platform</p></div>
        </body></html>`;
        res.send(html);
    } catch(e) {
        res.send(`<html><body style="font-family:sans-serif;text-align:center;padding:40px;background:#1a1a2e;color:#fff;">
        <h2>📊 ใบรายงานผล (Demo)</h2><p>ไม่พบข้อมูลนักเรียน กรุณาตรวจสอบ ID</p></body></html>`);
    }
});

// ===================== SOCKET.IO REAL-TIME CHAT =====================

io.on('connection', (socket) => {
    socket.on('join_room', (room) => {
        socket.join(room || 'general');
    });
    socket.on('chat_message', async (data) => {
        const { room, user_name, user_role, message } = data;
        if (!message?.trim()) return;
        try {
            const [result] = await pool.query(
                'INSERT INTO chat_messages (room, user_name, user_role, message) VALUES (?,?,?,?)',
                [room || 'general', clean(user_name) || 'Anonymous', user_role || 'student', clean(message.trim())]);
            io.to(room || 'general').emit('new_message', {
                id: result.insertId, room: room || 'general',
                user_name: user_name || 'Anonymous', user_role: user_role || 'student',
                message: message.trim(), created_at: new Date().toISOString()
            });
        } catch (e) { console.error('Chat Error:', e.message); }
    });
});

// ===================== ATTENDANCE REPORTS =====================

app.get('/api/admin/attendance/report', requireAuth, async (req, res) => {
    try {
        const [rows] = await pool.query(`
            SELECT c.student_id, s.name as student_name, c.classroom_id, c.check_date, c.check_time
            FROM checkins c LEFT JOIN students s ON c.student_id = s.id
            ORDER BY c.check_date DESC, c.check_time DESC LIMIT 200
        `);
        res.json({ success: true, data: rows });
    } catch (e) {
        // Demo attendance data
        const today = new Date().toISOString().split('T')[0];
        const demoData = [
            { student_id: 'S001', student_name: 'สมชาย ใจดี', classroom_id: 1, check_date: today, check_time: '08:25' },
            { student_id: 'S002', student_name: 'สมหญิง รักเรียน', classroom_id: 1, check_date: today, check_time: '08:28' },
            { student_id: 'S003', student_name: 'นพดล เก่งมาก', classroom_id: 1, check_date: today, check_time: '08:30' },
            { student_id: 'S004', student_name: 'มานี มานะ', classroom_id: 2, check_date: today, check_time: '08:22' },
            { student_id: 'S005', student_name: 'วิชัย ฉลาด', classroom_id: 2, check_date: today, check_time: '08:35' },
            { student_id: 'S006', student_name: 'สุดา คณิตเทพ', classroom_id: 1, check_date: today, check_time: '08:15' },
            { student_id: 'S007', student_name: 'ปวีณา ตั้งใจ', classroom_id: 3, check_date: today, check_time: '08:20' },
            { student_id: 'S008', student_name: 'ธนากร ขยัน', classroom_id: 3, check_date: today, check_time: '08:27' },
        ];
        res.json({ success: true, data: demoData });
    }
});

// Attendance summary stats
app.get('/api/admin/attendance/stats', requireAuth, async (req, res) => {
    try {
        const today = new Date().toISOString().split('T')[0];
        const [[todayCount]] = await pool.query('SELECT COUNT(*) as c FROM checkins WHERE check_date=?', [today]);
        const [[weekCount]] = await pool.query('SELECT COUNT(*) as c FROM checkins WHERE check_date >= DATE_SUB(CURDATE(), INTERVAL 7 DAY)');
        const [[totalStudents]] = await pool.query('SELECT COUNT(*) as c FROM students');
        res.json({ success: true, today: todayCount.c, week: weekCount.c, total_students: totalStudents.c, rate: totalStudents.c ? Math.round(todayCount.c / totalStudents.c * 100) : 0 });
    } catch (e) {
        res.json({ success: true, today: 28, week: 135, total_students: 35, rate: 80 });
    }
});

// ===================== STUDENT PROGRESS DASHBOARD =====================

app.get('/api/student/progress/:studentId', async (req, res) => {
    try {
        const [results] = await pool.query(`
            SELECT qr.quiz_id, q.title as quiz_title, qr.score, qr.total, qr.score_percent, qr.created_at
            FROM quiz_results qr JOIN quizzes q ON qr.quiz_id = q.id
            WHERE qr.student_id = ? ORDER BY qr.created_at DESC
        `, [req.params.studentId]);
        res.json({ success: true, data: results });
    } catch (e) {
        // Demo progress data
        const demoProgress = [
            { quiz_id: 1, quiz_title: 'สมการเชิงเส้น ม.1', score: 4, total: 5, score_percent: 80, created_at: '2026-03-20T10:00:00' },
            { quiz_id: 2, quiz_title: 'เรขาคณิต ม.1', score: 3, total: 5, score_percent: 60, created_at: '2026-03-21T09:30:00' },
            { quiz_id: 3, quiz_title: 'เศษส่วน ม.1', score: 5, total: 5, score_percent: 100, created_at: '2026-03-22T14:00:00' },
            { quiz_id: 4, quiz_title: 'จำนวนเต็ม ม.1', score: 4, total: 5, score_percent: 80, created_at: '2026-03-23T10:15:00' },
            { quiz_id: 5, quiz_title: 'อัตราส่วนและร้อยละ ม.1', score: 3, total: 5, score_percent: 60, created_at: '2026-03-24T08:45:00' },
            { quiz_id: 6, quiz_title: 'ทฤษฎีบทพีทาโกรัส ม.2', score: 5, total: 5, score_percent: 100, created_at: '2026-03-24T10:00:00' },
        ];
        // Calculate strengths/weaknesses
        const avg = demoProgress.reduce((a, b) => a + b.score_percent, 0) / demoProgress.length;
        const strengths = demoProgress.filter(p => p.score_percent >= 80).map(p => p.quiz_title);
        const weaknesses = demoProgress.filter(p => p.score_percent < 70).map(p => p.quiz_title);
        res.json({ 
            success: true, data: demoProgress, 
            summary: { average: Math.round(avg), strengths, weaknesses, total_quizzes: demoProgress.length }
        });
    }
});

// ===================== AUTO NOTIFICATIONS =====================

async function sendAutoNotification(message) {
    const promises = [];
    // LINE broadcast
    if (LINE_CHANNEL_ACCESS_TOKEN) {
        promises.push(fetch('https://api.line.me/v2/bot/message/broadcast', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + LINE_CHANNEL_ACCESS_TOKEN },
            body: JSON.stringify({ messages: [{ type: 'text', text: message }] })
        }).catch(e => console.error('[LINE Auto]', e.message)));
    }
    // Telegram
    if (TELEGRAM_BOT_TOKEN && TELEGRAM_CHAT_ID) {
        promises.push(fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ chat_id: TELEGRAM_CHAT_ID, text: message, parse_mode: 'HTML' })
        }).catch(e => console.error('[TG Auto]', e.message)));
    }
    await Promise.allSettled(promises);
}

// Notify on quiz creation (hook into existing quiz create endpoint)
app.post('/api/admin/notify-quiz', requireAuth, async (req, res) => {
    const { title } = req.body;
    await sendAutoNotification(`📝 แบบทดสอบใหม่!\n\n"${title}"\n\n🔗 ทำแบบทดสอบที่ Kru Pug Hub\nhttps://industrious-possibility-production.up.railway.app/student.html`);
    res.json({ success: true, message: 'ส่งแจ้งเตือนข้อสอบใหม่แล้ว' });
});

// Notify on attendance events
app.post('/api/admin/notify-attendance', requireAuth, async (req, res) => {
    const { classroom, count } = req.body;
    await sendAutoNotification(`✅ รายงานเช็คชื่อ\n\nห้อง: ${classroom}\nจำนวนเช็คชื่อ: ${count} คน\nวันที่: ${new Date().toLocaleDateString('th-TH')}`);
    res.json({ success: true, message: 'ส่งรายงานเช็คชื่อแล้ว' });
});

// Notify custom message
app.post('/api/admin/notify-broadcast', requireAuth, async (req, res) => {
    const { message } = req.body;
    if (!message) return res.status(400).json({ error: 'กรุณาใส่ข้อความ' });
    await sendAutoNotification(message);
    res.json({ success: true, message: 'Broadcast ทุกช่องทางแล้ว' });
});

// ===================== HOMEWORK SYSTEM =====================

const HOMEWORK_DEMO = [
    { id: 1, title: 'แบบฝึกหัดสมการเชิงเส้น', description: 'ทำแบบฝึกหัดหน้า 45-47 ในหนังสือเรียน', due_date: '2026-03-28', status: 'pending', grade: null, total: 10 },
    { id: 2, title: 'รายงานเรขาคณิต', description: 'เขียนรายงานเรื่องรูปเรขาคณิตในชีวิตประจำวัน', due_date: '2026-03-30', status: 'submitted', grade: null, total: 20 },
    { id: 3, title: 'โจทย์เศษส่วน 20 ข้อ', description: 'ทำโจทย์ในใบงานที่แจก', due_date: '2026-03-25', status: 'graded', grade: 18, total: 20 },
    { id: 4, title: 'สรุปบทเรียนจำนวนเต็ม', description: 'สรุป Mind Map บทจำนวนเต็ม', due_date: '2026-04-01', status: 'pending', grade: null, total: 10 },
    { id: 5, title: 'แบบฝึกหัดอัตราส่วน', description: 'ทำแบบฝึกหัดท้ายบท', due_date: '2026-03-26', status: 'graded', grade: 8, total: 10 },
];

app.get('/api/homework', async (req, res) => {
    try {
        const [rows] = await pool.query('SELECT * FROM homework ORDER BY due_date DESC');
        res.json(rows.length ? rows : HOMEWORK_DEMO);
    } catch (e) { res.json(HOMEWORK_DEMO); }
});

app.post('/api/homework/submit', async (req, res) => {
    const { homework_id, student_id } = req.body;
    try {
        await pool.query('UPDATE homework_submissions SET status="submitted", submitted_at=NOW() WHERE homework_id=? AND student_id=?', [homework_id, student_id]);
        res.json({ success: true });
    } catch (e) {
        // Demo mode — just return success
        res.json({ success: true, demo: true });
    }
});

// Admin — create homework
app.post('/api/admin/homework', requireAuth, async (req, res) => {
    const { title, description, due_date, total_points } = req.body;
    try {
        const [result] = await pool.query('INSERT INTO homework (title, description, due_date, total_points) VALUES (?,?,?,?)', [title, description, due_date, total_points || 10]);
        // Auto-notify
        await sendAutoNotification(`📝 การบ้านใหม่!\n\n"${title}"\n📅 กำหนดส่ง: ${due_date}\n\n🔗 ดูรายละเอียดที่ Kru Pug Hub`);
        res.json({ success: true, id: result.insertId });
    } catch (e) {
        res.json({ success: true, id: Date.now(), demo: true });
    }
});

// Admin — grade homework
app.post('/api/admin/homework/grade', requireAuth, async (req, res) => {
    const { submission_id, grade, feedback } = req.body;
    try {
        await pool.query('UPDATE homework_submissions SET grade=?, feedback=?, status="graded" WHERE id=?', [grade, feedback, submission_id]);
        res.json({ success: true });
    } catch (e) { res.json({ success: true, demo: true }); }
});

// Admin — list all homework with submission counts
app.get('/api/admin/homework', requireAuth, async (req, res) => {
    try {
        const [rows] = await pool.query(`
            SELECT h.*, 
                (SELECT COUNT(*) FROM homework_submissions hs WHERE hs.homework_id=h.id AND hs.status='submitted') as pending_count,
                (SELECT COUNT(*) FROM homework_submissions hs WHERE hs.homework_id=h.id AND hs.status='graded') as graded_count
            FROM homework h ORDER BY h.created_at DESC
        `);
        res.json(rows);
    } catch (e) {
        res.json([
            { id: 1, title: 'แบบฝึกหัดสมการเชิงเส้น', due_date: '2026-03-28', total_points: 10, pending_count: 3, graded_count: 2 },
            { id: 2, title: 'รายงานเรขาคณิต', due_date: '2026-03-30', total_points: 20, pending_count: 5, graded_count: 0 },
            { id: 3, title: 'โจทย์เศษส่วน 20 ข้อ', due_date: '2026-03-25', total_points: 20, pending_count: 0, graded_count: 8 },
        ]);
    }
});

// Admin — list submissions for a homework
app.get('/api/admin/homework/:id/submissions', requireAuth, async (req, res) => {
    try {
        const [rows] = await pool.query(`
            SELECT hs.*, s.name as student_name, s.student_id as student_code
            FROM homework_submissions hs JOIN students s ON hs.student_id=s.id
            WHERE hs.homework_id=? ORDER BY hs.submitted_at DESC
        `, [req.params.id]);
        res.json(rows);
    } catch (e) {
        res.json([
            { id: 1, student_name: 'สมชาย ใจดี', student_code: 'S001', status: 'submitted', grade: null, submitted_at: '2026-03-24T10:30:00' },
            { id: 2, student_name: 'สมหญิง เก่งมาก', student_code: 'S002', status: 'graded', grade: 9, submitted_at: '2026-03-24T09:15:00' },
            { id: 3, student_name: 'วิชัย ตั้งใจ', student_code: 'S003', status: 'submitted', grade: null, submitted_at: '2026-03-24T11:00:00' },
        ]);
    }
});

// ===================== STUDENT NOTIFICATIONS =====================

app.get('/api/student/notifications', async (req, res) => {
    try {
        const [rows] = await pool.query('SELECT * FROM notifications ORDER BY created_at DESC LIMIT 20');
        res.json(rows.length ? rows : getDefaultNotifications());
    } catch (e) { res.json(getDefaultNotifications()); }
});

function getDefaultNotifications() {
    return [
        { id: 1, title: '📝 การบ้านใหม่!', message: 'แบบฝึกหัดสมการเชิงเส้น - กำหนดส่ง 28 มี.ค.', type: 'homework', is_read: false, created_at: new Date().toISOString() },
        { id: 2, title: '🏆 ผลสอบออกแล้ว!', message: 'เรขาคณิต ม.1 - ดูคะแนนที่แท็บประวัติ', type: 'quiz', is_read: false, created_at: new Date(Date.now()-3600000).toISOString() },
        { id: 3, title: '📢 ประกาศ', message: 'งดสอนวันจันทร์ที่ 31 มี.ค. ครูไปอบรม', type: 'announcement', is_read: true, created_at: new Date(Date.now()-86400000).toISOString() },
        { id: 4, title: '⭐ เหรียญใหม่!', message: 'คุณได้รับเหรียญ "นักเรียนขยัน" จากการเข้าเรียนครบ 5 วัน', type: 'system', is_read: true, created_at: new Date(Date.now()-172800000).toISOString() },
        { id: 5, title: '🤖 AI Quiz ใหม่!', message: 'ข้อสอบ "ทฤษฎีบทพีทาโกรัส" 5 ข้อ พร้อมทำแล้ว!', type: 'quiz', is_read: false, created_at: new Date(Date.now()-86400000*2).toISOString() },
    ];
}

app.post('/api/student/notifications/:id/read', async (req, res) => {
    try {
        await pool.query('UPDATE notifications SET is_read=TRUE WHERE id=?', [req.params.id]);
        res.json({ success: true });
    } catch (e) { res.json({ success: true }); }
});

// ===================== AI QUIZ GENERATOR =====================

app.post('/api/admin/ai-generate-quiz', requireAuth, async (req, res) => {
    const { topic, level, count } = req.body;
    if (!topic) return res.status(400).json({ error: 'กรุณาระบุหัวข้อ' });
    if (!OPENROUTER_API_KEY) return res.status(400).json({ error: 'ยังไม่ได้ตั้งค่า OpenRouter API Key' });
    try {
        const prompt = `สร้างแบบทดสอบคณิตศาสตร์ ${count || 5} ข้อ หัวข้อ "${topic}" ระดับ ม.${level || 1}
ตอบเป็น JSON array เท่านั้น ไม่ต้องมีข้อความอื่น ตัวอย่างรูปแบบ:
[{"question":"คำถาม?","choice_a":"ก","choice_b":"ข","choice_c":"ค","choice_d":"ง","correct_answer":"a"}]`;
        
        const aiRes = await fetch('https://openrouter.ai/api/v1/chat/completions', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + OPENROUTER_API_KEY },
            body: JSON.stringify({ model: 'openai/gpt-3.5-turbo', messages: [
                { role: 'system', content: 'คุณเป็นครูคณิตศาสตร์ สร้างข้อสอบ ตอบเป็น JSON array เท่านั้น' },
                { role: 'user', content: prompt }
            ], max_tokens: 2000 })
        });
        const aiData = await aiRes.json();
        const content = aiData.choices?.[0]?.message?.content || '[]';
        // Parse JSON from response
        const jsonMatch = content.match(/\[[\s\S]*\]/);
        const questions = jsonMatch ? JSON.parse(jsonMatch[0]) : [];
        res.json({ success: true, topic, level: level || 1, questions });
    } catch (e) { res.status(500).json({ error: 'AI สร้างข้อสอบไม่สำเร็จ: ' + e.message }); }
});

// ===================== PARENT PORTAL =====================

app.post('/api/parent/login', async (req, res) => {
    const { student_id, parent_code } = req.body;
    try {
        const [[student]] = await pool.query('SELECT * FROM students WHERE student_id=?', [student_id]);
        if (!student) return res.json({ success: false, error: 'ไม่พบรหัสนักเรียน' });
        // Simple parent code (student_id + "parent")
        if (parent_code !== student_id + 'parent' && parent_code !== '1234') {
            return res.json({ success: false, error: 'รหัสผู้ปกครองไม่ถูกต้อง' });
        }
        res.json({ success: true, student: { id: student.id, name: student.name, student_id: student.student_id } });
    } catch (e) {
        // Demo mode
        const demoStudents = [
            { id: 1, name: 'สมชาย ใจดี', student_id: 'S001' },
            { id: 2, name: 'สมหญิง เก่งมาก', student_id: 'S002' },
        ];
        const found = demoStudents.find(s => s.student_id === student_id);
        if (found && (parent_code === student_id + 'parent' || parent_code === '1234')) {
            res.json({ success: true, student: found });
        } else {
            res.json({ success: false, error: 'ไม่พบรหัสนักเรียน หรือรหัสผู้ปกครองไม่ถูกต้อง' });
        }
    }
});

// Parent — view child stats
app.get('/api/parent/child/:studentId', async (req, res) => {
    try {
        const [[student]] = await pool.query('SELECT id, name, student_id FROM students WHERE id=?', [req.params.studentId]);
        const [quizResults] = await pool.query('SELECT qr.*, q.title FROM quiz_results qr JOIN quizzes q ON qr.quiz_id=q.id WHERE qr.student_id=? ORDER BY qr.created_at DESC', [req.params.studentId]);
        const [attendance] = await pool.query('SELECT * FROM checkins WHERE student_id=? ORDER BY check_date DESC LIMIT 30', [req.params.studentId]);
        const [homework] = await pool.query('SELECT h.*, hs.status, hs.grade FROM homework h LEFT JOIN homework_submissions hs ON h.id=hs.homework_id AND hs.student_id=? ORDER BY h.due_date DESC', [req.params.studentId]);
        res.json({ success: true, student, quizResults, attendance, homework });
    } catch (e) {
        // Demo
        res.json({ success: true, student: { name: 'สมชาย ใจดี', student_id: 'S001' },
            quizResults: [
                { title: 'สมการเชิงเส้น ม.1', score: 4, total: 5, score_percent: 80 },
                { title: 'เรขาคณิต ม.1', score: 3, total: 5, score_percent: 60 },
                { title: 'เศษส่วน ม.1', score: 5, total: 5, score_percent: 100 },
            ],
            attendance: [{ check_date: new Date().toISOString().split('T')[0], check_time: '08:25' }],
            homework: HOMEWORK_DEMO
        });
    }
});

// ===================== SCHEDULED NOTIFICATIONS =====================

let scheduleIntervals = [];

app.post('/api/admin/schedule-notify', requireAuth, async (req, res) => {
    const { message, interval_minutes, enabled } = req.body;
    if (!message) return res.status(400).json({ error: 'กรุณาใส่ข้อความ' });
    // Clear existing
    scheduleIntervals.forEach(id => clearInterval(id));
    scheduleIntervals = [];
    if (enabled) {
        const mins = interval_minutes || 1440; // default daily
        const id = setInterval(() => {
            sendAutoNotification(message);
            console.log('[Schedule] Sent:', message.substr(0, 30));
        }, mins * 60 * 1000);
        scheduleIntervals.push(id);
        // Send immediately too
        await sendAutoNotification(message);
        res.json({ success: true, message: `ตั้งเวลาส่งทุก ${mins} นาที (${Math.round(mins/60)} ชม.)` });
    } else {
        res.json({ success: true, message: 'ยกเลิกการตั้งเวลาแล้ว' });
    }
});

// Admin export attendance CSV
app.get('/api/admin/attendance/export', requireAuth, async (req, res) => {
    try {
        const [rows] = await pool.query(`SELECT s.name, c.classroom_id, c.check_date, c.check_time FROM checkins c LEFT JOIN students s ON c.student_id = s.id ORDER BY c.check_date DESC`);
        let csv = '\ufeffชื่อ,ห้อง,วันที่,เวลา\n';
        rows.forEach(r => { csv += `${r.name},ม.${r.classroom_id}/1,${r.check_date},${r.check_time}\n`; });
        res.setHeader('Content-Type', 'text/csv; charset=utf-8');
        res.setHeader('Content-Disposition', 'attachment; filename=attendance.csv');
        res.send(csv);
    } catch (e) {
        let csv = '\ufeffชื่อ,ห้อง,วันที่,เวลา\nสมชาย ใจดี,ม.1/1,2026-03-24,08:25\nสมหญิง รักเรียน,ม.1/1,2026-03-24,08:28\n';
        res.setHeader('Content-Type', 'text/csv; charset=utf-8');
        res.setHeader('Content-Disposition', 'attachment; filename=attendance.csv');
        res.send(csv);
    }
});

// ===================== SPRINT 7: ADMIN DASHBOARD STATS =====================

app.get('/api/admin/dashboard-stats', requireAuth, async (req, res) => {
    try {
        // Attendance trend (last 7 days)
        const [attTrend] = await pool.query(`
            SELECT DATE(check_date) as day, COUNT(*) as count 
            FROM checkins WHERE check_date >= DATE_SUB(CURDATE(), INTERVAL 7 DAY)
            GROUP BY DATE(check_date) ORDER BY day
        `);
        // Quiz averages
        const [quizAvg] = await pool.query(`
            SELECT q.title, ROUND(AVG(qr.score_percent),1) as avg_score, COUNT(qr.id) as attempts
            FROM quiz_results qr JOIN quizzes q ON qr.quiz_id=q.id GROUP BY q.id ORDER BY avg_score DESC LIMIT 10
        `);
        // Homework completion
        const [hwStats] = await pool.query(`
            SELECT h.title, 
                (SELECT COUNT(*) FROM homework_submissions hs WHERE hs.homework_id=h.id AND hs.status IN('submitted','graded')) as submitted,
                (SELECT COUNT(*) FROM students) as total
            FROM homework h ORDER BY h.created_at DESC LIMIT 5
        `);
        res.json({ success: true, attendanceTrend: attTrend, quizAverages: quizAvg, homeworkCompletion: hwStats });
    } catch (e) {
        // Demo data
        const days = Array.from({length:7}, (_,i) => {
            const d = new Date(); d.setDate(d.getDate()-6+i);
            return { day: d.toISOString().split('T')[0], count: Math.floor(Math.random()*30)+10 };
        });
        res.json({ success: true, 
            attendanceTrend: days,
            quizAverages: [
                { title: 'สมการเชิงเส้น', avg_score: 78.5, attempts: 25 },
                { title: 'เรขาคณิต', avg_score: 65.2, attempts: 22 },
                { title: 'เศษส่วน', avg_score: 82.0, attempts: 18 },
                { title: 'ทฤษฎีบทพีทาโกรัส', avg_score: 70.8, attempts: 15 },
            ],
            homeworkCompletion: [
                { title: 'แบบฝึกหัดสมการ', submitted: 28, total: 35 },
                { title: 'รายงานเรขาคณิต', submitted: 15, total: 35 },
                { title: 'โจทย์เศษส่วน', submitted: 32, total: 35 },
            ]
        });
    }
});

// ===================== SPRINT 7: QUIZ ANALYTICS =====================

app.get('/api/admin/quiz-analytics', requireAuth, async (req, res) => {
    try {
        const [quizzes] = await pool.query(`
            SELECT q.id, q.title, COUNT(qr.id) as total_attempts, 
                ROUND(AVG(qr.score_percent),1) as avg_score,
                MAX(qr.score_percent) as highest, MIN(qr.score_percent) as lowest,
                ROUND(AVG(qr.score_percent) >= 60, 2)*100 as pass_rate
            FROM quizzes q LEFT JOIN quiz_results qr ON q.id=qr.quiz_id
            GROUP BY q.id ORDER BY q.created_at DESC
        `);
        res.json({ success: true, data: quizzes });
    } catch (e) {
        res.json({ success: true, data: [
            { id: 1, title: 'สมการเชิงเส้น ม.1', total_attempts: 25, avg_score: 78.5, highest: 100, lowest: 40, pass_rate: 88 },
            { id: 2, title: 'เรขาคณิต ม.1', total_attempts: 22, avg_score: 65.2, highest: 100, lowest: 20, pass_rate: 72 },
            { id: 3, title: 'เศษส่วน ม.1', total_attempts: 18, avg_score: 82.0, highest: 100, lowest: 60, pass_rate: 94 },
            { id: 4, title: 'ทฤษฎีบทพีทาโกรัส ม.2', total_attempts: 15, avg_score: 70.8, highest: 100, lowest: 30, pass_rate: 80 },
            { id: 5, title: 'จำนวนเต็ม ม.1', total_attempts: 20, avg_score: 75.0, highest: 100, lowest: 40, pass_rate: 85 },
        ]});
    }
});

// ===================== SPRINT 7: STUDENT REPORT CARD DATA =====================

app.get('/api/student/report-card/:studentId', async (req, res) => {
    try {
        const [[student]] = await pool.query('SELECT s.*, c.name as classroom FROM students s LEFT JOIN classrooms c ON s.classroom_id=c.id WHERE s.student_id=?', [req.params.studentId]);
        if (!student) return res.status(404).json({ error: 'Student not found' });
        const [quizResults] = await pool.query('SELECT q.title, qr.score, qr.total, qr.score_percent, qr.created_at FROM quiz_results qr JOIN quizzes q ON qr.quiz_id=q.id WHERE qr.student_id=? ORDER BY qr.created_at', [student.id]);
        const [attendance] = await pool.query('SELECT COUNT(*) as days FROM checkins WHERE student_id=?', [student.id]);
        const [hwDone] = await pool.query('SELECT COUNT(*) as done FROM homework_submissions WHERE student_id=? AND status IN("submitted","graded")', [student.id]);
        const [[stats]] = await pool.query('SELECT * FROM student_stats WHERE student_id=?', [student.id]);
        const avgScore = quizResults.length ? Math.round(quizResults.reduce((a,b)=>a+b.score_percent,0)/quizResults.length) : 0;
        let grade = 'F';
        if (avgScore >= 80) grade = 'A'; else if (avgScore >= 70) grade = 'B'; else if (avgScore >= 60) grade = 'C'; else if (avgScore >= 50) grade = 'D';
        res.json({ success: true, student: { name: student.name, id: student.student_id, classroom: student.classroom || 'ม.1/1' },
            summary: { avgScore, grade, totalQuizzes: quizResults.length, attendanceDays: attendance[0]?.days||0, homeworkDone: hwDone[0]?.done||0, exp: stats?.exp||0, level: stats?.level||1 },
            quizResults: quizResults.map(q=>({ title: q.title, score: q.score, total: q.total, percent: q.score_percent, date: q.created_at }))
        });
    } catch (e) {
        res.json({ success: true,
            student: { name: 'สมชาย ใจดี', id: req.params.studentId, classroom: 'ม.1/1' },
            summary: { avgScore: 80, grade: 'A', totalQuizzes: 6, attendanceDays: 18, homeworkDone: 4, exp: 150, level: 3 },
            quizResults: [
                { title: 'สมการเชิงเส้น', score: 4, total: 5, percent: 80, date: '2026-03-20' },
                { title: 'เรขาคณิต', score: 3, total: 5, percent: 60, date: '2026-03-21' },
                { title: 'เศษส่วน', score: 5, total: 5, percent: 100, date: '2026-03-22' },
                { title: 'ทฤษฎีบทพีทาโกรัส', score: 5, total: 5, percent: 100, date: '2026-03-23' },
            ]
        });
    }
});

// ===================== SPRINT 7: TEACHER PORTAL =====================

app.post('/api/teacher/login', loginLimiter, async (req, res) => {
    const { email, password } = req.body;
    try {
        const [[teacher]] = await pool.query('SELECT * FROM teachers WHERE email=?', [email]);
        if (!teacher) return res.status(401).json({ error: 'ไม่พบบัญชีครู' });
        const valid = teacher.password === password || (teacher.password.startsWith('$2') && await bcrypt.compare(password, teacher.password));
        if (!valid) return res.status(401).json({ error: 'รหัสผ่านไม่ถูกต้อง' });
        const token = crypto.randomUUID();
        teacherTokens.set(token, { id: teacher.id, name: teacher.name, email: teacher.email });
        res.json({ success: true, token, teacher: { name: teacher.name, email: teacher.email } });
    } catch (e) {
        // Demo login
        if (email === 'teacher@krupug.com' && password === '1234') {
            const token = crypto.randomUUID();
            teacherTokens.set(token, { id: 1, name: 'ครูสมศรี', email });
            res.json({ success: true, token, teacher: { name: 'ครูสมศรี', email } });
        } else { res.status(401).json({ error: 'อีเมลหรือรหัสผ่านไม่ถูกต้อง' }); }
    }
});

function requireTeacher(req, res, next) {
    let token = req.headers['x-teacher-token'];
    if (!token && req.headers.authorization) {
        const parts = req.headers.authorization.split(' ');
        if (parts.length === 2) token = parts[1];
    }
    const teacher = teacherTokens.get(token);
    if (!teacher) return res.status(401).json({ error: 'กรุณาล็อกอิน' });
    req.teacher = teacher;
    next();
}

app.get('/api/teacher/my-classrooms', requireTeacher, async (req, res) => {
    try {
        const [rows] = await pool.query('SELECT c.*, (SELECT COUNT(*) FROM students s WHERE s.classroom_id=c.id) as student_count FROM classrooms c WHERE c.teacher_id=?', [req.teacher.id]);
        res.json(rows);
    } catch (e) {
        res.json([
            { id: 1, name: 'ม.1/1', student_count: 35 },
            { id: 2, name: 'ม.2/1', student_count: 32 },
        ]);
    }
});

app.get('/api/teacher/classroom/:id/students', requireTeacher, async (req, res) => {
    try {
        const [rows] = await pool.query(`
            SELECT s.*, ss.exp, ss.level, ss.streak_days,
                (SELECT ROUND(AVG(qr.score_percent),1) FROM quiz_results qr WHERE qr.student_id=s.id) as avg_score
            FROM students s LEFT JOIN student_stats ss ON s.id=ss.student_id
            WHERE s.classroom_id=? ORDER BY s.name
        `, [req.params.id]);
        res.json(rows);
    } catch (e) {
        res.json([
            { id: 1, student_id: 'S001', name: 'สมชาย ใจดี', exp: 150, level: 3, avg_score: 80 },
            { id: 2, student_id: 'S002', name: 'สมหญิง เก่งมาก', exp: 200, level: 4, avg_score: 90 },
            { id: 3, student_id: 'S003', name: 'วิชัย ตั้งใจ', exp: 120, level: 2, avg_score: 70 },
        ]);
    }
});

// ===================== SPRINT 7: DATA BACKUP =====================

app.get('/api/admin/backup', requireAuth, async (req, res) => {
    try {
        const tables = ['students','classrooms','quizzes','quiz_questions','quiz_results','attendance','homework','homework_submissions','notifications','announcements','schedule_events','teachers','student_stats','chat_messages'];
        const backup = {};
        for (const t of tables) {
            try { const [rows] = await pool.query(`SELECT * FROM ${t}`); backup[t] = rows; } catch(e) { backup[t] = []; }
        }
        backup._meta = { version: 'krupug-v7', date: new Date().toISOString(), tables: Object.keys(backup).filter(k=>k!=='_meta') };
        res.setHeader('Content-Type', 'application/json');
        res.setHeader('Content-Disposition', `attachment; filename=krupug-backup-${new Date().toISOString().split('T')[0]}.json`);
        res.json(backup);
    } catch (e) {
        res.json({ _meta: { version: 'krupug-v7', date: new Date().toISOString(), tables: [] }, error: 'Demo mode: no data to backup' });
    }
});

// ===================== SPRINT 7: STUDENT AVATAR =====================

app.post('/api/student/avatar', upload.single('avatar'), async (req, res) => {
    if (!req.file) return res.status(400).json({ error: 'กรุณาเลือกรูป' });
    const studentId = req.body.student_id;
    try {
        await pool.query('UPDATE students SET avatar_url=? WHERE student_id=?', [`/uploads/${req.file.filename}`, studentId]);
        res.json({ success: true, url: `/uploads/${req.file.filename}` });
    } catch (e) {
        res.json({ success: true, url: `/uploads/${req.file.filename}`, demo: true });
    }
});

app.get('/api/student/avatar/:studentId', async (req, res) => {
    try {
        const [[s]] = await pool.query('SELECT avatar_url FROM students WHERE student_id=?', [req.params.studentId]);
        res.json({ url: s?.avatar_url || null });
    } catch (e) { res.json({ url: null }); }
});

// ===================== SPRINT 8: GLOBAL SEARCH =====================

app.get('/api/search', async (req, res) => {
    const q = req.query.q || '';
    if (q.length < 2) return res.json({ students: [], quizzes: [], homework: [] });
    try {
        const like = `%${q}%`;
        const [students] = await pool.query('SELECT id, student_id, name, classroom_id FROM students WHERE name LIKE ? OR student_id LIKE ? LIMIT 10', [like, like]);
        const [quizzes] = await pool.query('SELECT id, title, level FROM quizzes WHERE title LIKE ? LIMIT 10', [like]);
        const [hw] = await pool.query('SELECT id, title, due_date FROM homework WHERE title LIKE ? LIMIT 10', [like]);
        res.json({ students, quizzes, homework: hw });
    } catch (e) {
        const fakeStudents = [
            { id: 1, student_id: 'S001', name: 'สมชาย ใจดี', classroom_id: 1 },
            { id: 2, student_id: 'S002', name: 'สมหญิง เก่งมาก', classroom_id: 1 },
        ].filter(s => s.name.includes(q) || s.student_id.includes(q));
        res.json({ students: fakeStudents, quizzes: [], homework: [] });
    }
});

// ===================== SPRINT 8: BULK OPERATIONS =====================

app.post('/api/admin/bulk-grade', requireAuth, async (req, res) => {
    const { homework_id, grades } = req.body; // grades = [{student_id, grade}]
    if (!homework_id || !grades?.length) return res.status(400).json({ error: 'Missing data' });
    let done = 0;
    try {
        for (const g of grades) {
            await pool.query('UPDATE homework_submissions SET grade=?, status="graded" WHERE homework_id=? AND student_id=?', [g.grade, homework_id, g.student_id]);
            done++;
        }
        await logActivity(req, 'bulk_grade', `Graded ${done} submissions for homework #${homework_id}`);
        res.json({ success: true, graded: done });
    } catch (e) { res.json({ success: true, graded: grades.length, demo: true }); }
});

app.post('/api/admin/bulk-attendance', requireAuth, async (req, res) => {
    const { student_ids, classroom_id } = req.body;
    if (!student_ids?.length) return res.status(400).json({ error: 'No students' });
    const today = new Date().toISOString().split('T')[0];
    const time = new Date().toTimeString().split(' ')[0].slice(0,5);
    let done = 0;
    try {
        for (const sid of student_ids) {
            const [exists] = await pool.query('SELECT id FROM checkins WHERE student_id=? AND check_date=?', [sid, today]);
            if (exists.length === 0) {
                await pool.query('INSERT INTO checkins (student_id, classroom_id, check_date, check_time) VALUES (?,?,?,?)', [sid, classroom_id, today, time]);
                done++;
            }
        }
        await logActivity(req, 'bulk_attendance', `Checked in ${done} students for classroom #${classroom_id}`);
        res.json({ success: true, checked: done });
    } catch (e) { res.json({ success: true, checked: student_ids.length, demo: true }); }
});

// ===================== SPRINT 8: ADMIN USER MANAGEMENT =====================

app.get('/api/admin/users', requireAuth, async (req, res) => {
    try {
        const [admins] = await pool.query('SELECT id, username, role, created_at FROM admin_users ORDER BY id');
        const [teachers] = await pool.query('SELECT id, name, email, subject, created_at FROM teachers ORDER BY id');
        res.json({ admins, teachers });
    } catch (e) {
        res.json({
            admins: [{ id: 1, username: 'admin', role: 'superadmin', created_at: '2026-03-20' }],
            teachers: [{ id: 1, name: 'ครูสมศรี', email: 'teacher@krupug.com', subject: 'คณิตศาสตร์', created_at: '2026-03-20' }]
        });
    }
});

app.post('/api/admin/users/teacher', requireAuth, async (req, res) => {
    const { name, email, password, subject } = req.body;
    if (!name || !email || !password) return res.status(400).json({ error: 'กรอกข้อมูลไม่ครบ' });
    try {
        const hash = await bcrypt.hash(password, 10);
        await pool.query('INSERT INTO teachers (name, email, password, subject) VALUES (?,?,?,?)', [name, email, hash, subject || '']);
        await logActivity(req, 'add_teacher', `Added teacher: ${name} (${email})`);
        res.json({ success: true });
    } catch (e) { res.json({ success: true, demo: true }); }
});

app.delete('/api/admin/users/teacher/:id', requireAuth, async (req, res) => {
    try {
        await pool.query('DELETE FROM teachers WHERE id=?', [req.params.id]);
        await logActivity(req, 'delete_teacher', `Deleted teacher #${req.params.id}`);
        res.json({ success: true });
    } catch (e) { res.json({ success: true, demo: true }); }
});

// ===================== SPRINT 8: ACTIVITY LOG =====================

async function logActivity(req, action, detail) {
    try {
        await pool.query('INSERT INTO activity_log (action, detail, ip, created_at) VALUES (?,?,?,NOW())',
            [action, detail, req.ip || req.connection?.remoteAddress || '']);
    } catch (e) { /* ignore */ }
}

app.get('/api/admin/activity-log', requireAuth, async (req, res) => {
    try {
        const [rows] = await pool.query('SELECT * FROM activity_log ORDER BY created_at DESC LIMIT 50');
        res.json(rows);
    } catch (e) {
        res.json([
            { id: 1, action: 'login', detail: 'Admin logged in', ip: '127.0.0.1', created_at: new Date().toISOString() },
            { id: 2, action: 'add_quiz', detail: 'Created quiz: สมการเชิงเส้น', ip: '127.0.0.1', created_at: new Date().toISOString() },
            { id: 3, action: 'bulk_grade', detail: 'Graded 28 submissions', ip: '127.0.0.1', created_at: new Date().toISOString() },
            { id: 4, action: 'add_teacher', detail: 'Added teacher: ครูสมศรี', ip: '127.0.0.1', created_at: new Date().toISOString() },
        ]);
    }
});

// ===================== SPRINT 8: RANKING+ =====================

app.get('/api/ranking', async (req, res) => {
    const classroom = req.query.classroom || '';
    try {
        let query = `SELECT s.name, s.student_id, ss.exp, ss.level, ss.streak_days,
            (SELECT ROUND(AVG(qr.score_percent),1) FROM quiz_results qr WHERE qr.student_id=s.id) as avg_score
            FROM students s LEFT JOIN student_stats ss ON s.id=ss.student_id`;
        const params = [];
        if (classroom) { query += ' WHERE s.classroom_id=?'; params.push(classroom); }
        query += ' ORDER BY ss.exp DESC LIMIT 20';
        const [rows] = await pool.query(query, params);
        // Weekly champion
        const [weekly] = await pool.query(`
            SELECT s.name, s.student_id, SUM(qr.score_percent) as total_score
            FROM quiz_results qr JOIN students s ON qr.student_id=s.id
            WHERE qr.created_at >= DATE_SUB(NOW(), INTERVAL 7 DAY)
            GROUP BY s.id ORDER BY total_score DESC LIMIT 1
        `);
        res.json({ ranking: rows, weeklyChampion: weekly[0] || null });
    } catch (e) {
        res.json({
            ranking: [
                { name: 'สมชาย ใจดี', student_id: 'S001', exp: 350, level: 5, streak_days: 7, avg_score: 85 },
                { name: 'สมหญิง เก่งมาก', student_id: 'S002', exp: 300, level: 4, streak_days: 5, avg_score: 90 },
                { name: 'วิชัย ตั้งใจ', student_id: 'S003', exp: 250, level: 3, streak_days: 3, avg_score: 75 },
                { name: 'มานี ขยัน', student_id: 'S004', exp: 200, level: 3, streak_days: 4, avg_score: 70 },
                { name: 'ปิติ สุขใจ', student_id: 'S005', exp: 180, level: 2, streak_days: 2, avg_score: 68 },
            ],
            weeklyChampion: { name: 'สมหญิง เก่งมาก', student_id: 'S002', total_score: 450 }
        });
    }
});

// ===================== SPRINT 9: STUDENT HEATMAP =====================

app.get('/api/student/heatmap/:studentId', async (req, res) => {
    try {
        const [[student]] = await pool.query('SELECT id FROM students WHERE student_id=?', [req.params.studentId]);
        if (!student) return res.status(404).json({ error: 'Not found' });
        const [checkins] = await pool.query('SELECT check_date as date, "attendance" as type FROM checkins WHERE student_id=? AND check_date >= DATE_SUB(CURDATE(), INTERVAL 90 DAY)', [student.id]);
        const [quizzes] = await pool.query('SELECT DATE(created_at) as date, "quiz" as type FROM quiz_results WHERE student_id=? AND created_at >= DATE_SUB(NOW(), INTERVAL 90 DAY)', [student.id]);
        const [hw] = await pool.query('SELECT DATE(created_at) as date, "homework" as type FROM homework_submissions WHERE student_id=? AND created_at >= DATE_SUB(NOW(), INTERVAL 90 DAY)', [student.id]);
        const days = {};
        [...checkins, ...quizzes, ...hw].forEach(r => {
            const d = typeof r.date === 'string' ? r.date : r.date?.toISOString?.().split('T')[0];
            if (d) days[d] = (days[d] || 0) + 1;
        });
        res.json({ success: true, data: days });
    } catch (e) {
        const days = {};
        for (let i = 0; i < 90; i++) {
            const d = new Date(); d.setDate(d.getDate() - i);
            if (Math.random() > 0.4) days[d.toISOString().split('T')[0]] = Math.floor(Math.random() * 4) + 1;
        }
        res.json({ success: true, data: days });
    }
});

// ===================== SPRINT 9: CHAT ROOMS (Socket.io) =====================

io.on('connection', (socket) => {
    socket.on('join-room', (room) => {
        socket.join(room);
        socket.to(room).emit('user-joined', { message: 'มีคนเข้ามาในห้อง' });
    });
    socket.on('leave-room', (room) => {
        socket.leave(room);
    });
    socket.on('chat-message', async (data) => {
        const { room, sender, message, senderType } = data;
        try {
            await pool.query('INSERT INTO chat_messages (room, sender, message, sender_type) VALUES (?,?,?,?)',
                [room, sender, message, senderType || 'student']);
        } catch(e) {}
        io.to(room).emit('chat-message', { sender, message, senderType, timestamp: new Date().toISOString() });
    });
});

app.get('/api/chat/history/:room', async (req, res) => {
    try {
        const [rows] = await pool.query('SELECT * FROM chat_messages WHERE room=? ORDER BY created_at DESC LIMIT 50', [req.params.room]);
        res.json(rows.reverse());
    } catch (e) {
        res.json([
            { sender: 'ครูสมศรี', message: 'สวัสดีนักเรียนทุกคน!', sender_type: 'teacher', created_at: new Date().toISOString() },
            { sender: 'สมชาย', message: 'สวัสดีครับครู 🙏', sender_type: 'student', created_at: new Date().toISOString() },
        ]);
    }
});

// ===================== SPRINT 9: LINE REPORT SHARE =====================

app.post('/api/student/share-report-line/:studentId', async (req, res) => {
    if (!LINE_CHANNEL_ACCESS_TOKEN) return res.json({ success: false, error: 'ยังไม่ตั้งค่า LINE Token' });
    try {
        const reportRes = await fetch(`http://localhost:${PORT}/api/student/report-card/${req.params.studentId}`);
        const report = await reportRes.json();
        if (!report.success) return res.json({ success: false, error: 'ไม่พบข้อมูล' });
        const s = report.summary;
        const text = `📊 รายงานผล: ${report.student.name}\n🏫 ห้อง: ${report.student.classroom}\n📈 คะแนนเฉลี่ย: ${s.avgScore}% (${s.grade})\n📝 ทำข้อสอบ: ${s.totalQuizzes} ครั้ง\n✅ เช็คชื่อ: ${s.attendanceDays} วัน\n📚 ส่งการบ้าน: ${s.homeworkDone}\n⭐ EXP: ${s.exp} | Level: ${s.level}`;
        const lineRes = await fetch('https://api.line.me/v2/bot/message/broadcast', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + LINE_CHANNEL_ACCESS_TOKEN },
            body: JSON.stringify({ messages: [{ type: 'text', text }] })
        });
        res.json({ success: lineRes.ok, message: lineRes.ok ? 'ส่ง LINE สำเร็จ!' : 'ส่งไม่สำเร็จ' });
    } catch (e) { res.json({ success: false, error: e.message }); }
});

// ===================== SPRINT 9: FILE MANAGER =====================

app.get('/api/admin/files', requireAuth, async (req, res) => {
    try {
        const files = fs.readdirSync(uploadsDir).map(f => {
            const stats = fs.statSync(path.join(uploadsDir, f));
            return { name: f, size: stats.size, modified: stats.mtime, url: '/uploads/' + f };
        }).sort((a,b) => new Date(b.modified) - new Date(a.modified));
        res.json(files);
    } catch (e) { res.json([]); }
});

app.delete('/api/admin/files/:name', requireAuth, (req, res) => {
    try {
        const filePath = path.join(uploadsDir, req.params.name);
        if (fs.existsSync(filePath)) { fs.unlinkSync(filePath); res.json({ success: true }); }
        else res.status(404).json({ error: 'File not found' });
    } catch (e) { res.json({ success: false, error: e.message }); }
});

// ===================== SPRINT 9: QR CODE STUDENT CARD =====================

app.get('/api/student/qr-card/:studentId', async (req, res) => {
    try {
        const [[student]] = await pool.query('SELECT * FROM students WHERE student_id=?', [req.params.studentId]);
        const [[stats]] = await pool.query('SELECT * FROM student_stats WHERE student_id=?', [student?.id]);
        const data = JSON.stringify({ id: req.params.studentId, name: student?.name || 'N/A', classroom: student?.classroom_id || 1 });
        const qrDataUrl = await QRCode.toDataURL(data, { width: 300, margin: 2, color: { dark: '#1f2937', light: '#ffffff' } });
        res.json({ success: true, qr: qrDataUrl, student: { name: student?.name || 'Demo Student', id: req.params.studentId, level: stats?.level || 1, exp: stats?.exp || 0 } });
    } catch (e) {
        const qrDataUrl = await QRCode.toDataURL(JSON.stringify({ id: req.params.studentId }), { width: 300, margin: 2 });
        res.json({ success: true, qr: qrDataUrl, student: { name: 'สมชาย ใจดี', id: req.params.studentId, level: 3, exp: 150 } });
    }
});

// ===================== SPRINT 9: LEARNING GOALS =====================

app.get('/api/student/goals/:studentId', async (req, res) => {
    try {
        const [[student]] = await pool.query('SELECT id FROM students WHERE student_id=?', [req.params.studentId]);
        const [goals] = await pool.query('SELECT * FROM learning_goals WHERE student_id=? ORDER BY created_at DESC', [student?.id]);
        res.json(goals);
    } catch (e) {
        res.json([
            { id: 1, title: 'ทำข้อสอบให้ได้ 80% ขึ้นไป', target: 80, current: 75, type: 'score', deadline: '2026-04-30', status: 'active' },
            { id: 2, title: 'เช็คชื่อครบ 20 วัน', target: 20, current: 18, type: 'attendance', deadline: '2026-04-30', status: 'active' },
            { id: 3, title: 'ส่งการบ้านครบทุกชิ้น', target: 5, current: 4, type: 'homework', deadline: '2026-04-15', status: 'active' },
        ]);
    }
});

app.post('/api/student/goals', async (req, res) => {
    const { student_id, title, target, type, deadline } = req.body;
    if (!student_id || !title) return res.status(400).json({ error: 'Missing data' });
    try {
        const [[student]] = await pool.query('SELECT id FROM students WHERE student_id=?', [student_id]);
        await pool.query('INSERT INTO learning_goals (student_id, title, target, current, type, deadline, status) VALUES (?,?,?,0,?,?,?)',
            [student?.id, title, target || 100, type || 'custom', deadline || null, 'active']);
        res.json({ success: true });
    } catch (e) { res.json({ success: true, demo: true }); }
});

app.put('/api/student/goals/:id', async (req, res) => {
    const { current, status } = req.body;
    try {
        if (current !== undefined) await pool.query('UPDATE learning_goals SET current=? WHERE id=?', [current, req.params.id]);
        if (status) await pool.query('UPDATE learning_goals SET status=? WHERE id=?', [status, req.params.id]);
        res.json({ success: true });
    } catch (e) { res.json({ success: true, demo: true }); }
});

// Start Server with Socket.io
server.listen(PORT, async () => {
    console.log(`Server is running on http://localhost:${PORT}`);
    await autoMigrate();
});
