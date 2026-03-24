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
        cb(null, `${Date.now()}-${Math.random().toString(36).substr(2,6)}${ext}`);
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
    const token = req.headers['x-admin-token'] || req.query.token;
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
        try { envContent = fs.readFileSync(envPath, 'utf-8'); } catch(e) {}
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
    } catch(e) {}
    res.json({ success: true, message: 'API Key deleted' });
});

// ===================== DEMO DATA (fallback when DB unavailable) =====================
const DEMO = {
    systems: [
        { id:1, ep:'EP.01', title:'ระบบแบบทดสอบออนไลน์', desc_text:'ระบบทำแบบทดสอบคณิตศาสตร์ออนไลน์ พร้อมตรวจคะแนนอัตโนมัติ', icon:'fa-clipboard-check', preview_url:'quiz.html', download_url:'#' },
        { id:2, ep:'EP.02', title:'ระบบเช็คชื่อนักเรียน', desc_text:'เช็คชื่อเข้าเรียนด้วย QR Code สะดวกรวดเร็ว', icon:'fa-qrcode', preview_url:'student.html', download_url:'#' },
        { id:3, ep:'EP.03', title:'ระบบจัดการห้องเรียน', desc_text:'จัดการข้อมูลห้องเรียน นักเรียน และผลการเรียน', icon:'fa-school', preview_url:'teacher.html', download_url:'#' },
        { id:4, ep:'EP.04', title:'ระบบรายงานผู้ปกครอง', desc_text:'ผู้ปกครองดูผลการเรียนและการเข้าเรียนของลูกผ่านมือถือ', icon:'fa-users', preview_url:'parent.html', download_url:'#' },
    ],
    clips: [
        { id:1, ep:'ตอนที่ 1', title:'สมการเชิงเส้น ม.1', video_url:'https://www.youtube.com/watch?v=dQw4w9WgXcQ' },
        { id:2, ep:'ตอนที่ 2', title:'เศษส่วนและทศนิยม ม.1', video_url:'https://www.youtube.com/watch?v=dQw4w9WgXcQ' },
        { id:3, ep:'ตอนที่ 3', title:'พีทาโกรัส ม.2', video_url:'https://www.youtube.com/watch?v=dQw4w9WgXcQ' },
    ],
    prompts: [
        { id:1, title:'สร้างโจทย์คณิต', desc_text:'สร้างโจทย์คณิตศาสตร์ระดับ ม.ต้น เรื่องสมการ 10 ข้อ พร้อมเฉลยละเอียด', icon:'fa-calculator' },
        { id:2, title:'อธิบายแนวคิด', desc_text:'อธิบายแนวคิดเรื่องอัตราส่วนตรีโกณมิติให้นักเรียน ม.3 เข้าใจง่ายๆ พร้อมตัวอย่าง', icon:'fa-lightbulb' },
        { id:3, title:'วิเคราะห์ข้อสอบ', desc_text:'วิเคราะห์ข้อสอบคณิตศาสตร์ O-NET ม.3 ย้อนหลัง 5 ปี แยกตามมาตรฐาน', icon:'fa-chart-bar' },
    ],
    materials: [
        { id:1, title:'ใบงานสมการเชิงเส้น', desc_text:'ใบงานฝึกทักษะสมการเชิงเส้นตัวแปรเดียว ม.1 จำนวน 20 ข้อ', icon:'fa-file-pdf', file_url:'#' },
        { id:2, title:'สรุปสูตรคณิต ม.ต้น', desc_text:'สรุปสูตรคณิตศาสตร์ ม.1-3 ครบทุกบท พร้อมตัวอย่าง', icon:'fa-book', file_url:'#' },
    ],
    announcements: [
        { id:1, text:'🎉 ยินดีต้อนรับสู่ Kru Pug Hub — ศูนย์รวมสื่อคณิตศาสตร์!' },
        { id:2, text:'📢 เปิดให้ทำแบบทดสอบออนไลน์แล้ว กดที่ Quick Links เพื่อเริ่มทำ!' },
        { id:3, text:'🆕 อัปเดตระบบเช็คชื่อ QR Code เวอร์ชันล่าสุด' },
    ],
    leaderboard: [
        { student_name:'สมชาย ใจดี', quizzes_taken:12, avg_percent:95 },
        { student_name:'สมหญิง เก่งมาก', quizzes_taken:10, avg_percent:92 },
        { student_name:'นายธน รักเรียน', quizzes_taken:8, avg_percent:88 },
        { student_name:'สุดา คณิตเทพ', quizzes_taken:15, avg_percent:85 },
        { student_name:'วิชัย เลขดี', quizzes_taken:9, avg_percent:82 },
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
            ...DEMO.systems.filter(s => s.title.toLowerCase().includes(q)).map(s => ({...s, type:'system'})),
            ...DEMO.materials.filter(m => m.title.toLowerCase().includes(q)).map(m => ({...m, type:'material'})),
            ...DEMO.clips.filter(c => c.title.toLowerCase().includes(q)).map(c => ({...c, type:'clip'})),
            ...DEMO.prompts.filter(p => p.title.toLowerCase().includes(q)).map(p => ({...p, type:'prompt'})),
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
        } catch(e) { /* DB unavailable, use default */ }
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
            [ep, title, desc_text, icon||'fa-laptop-code', preview_url||'#', download_url||'#']
        );
        res.json({ success: true, id: result.insertId });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/admin/clips', requireAuth, async (req, res) => {
    try {
        const { ep, title, video_url } = req.body;
        const [result] = await pool.query('INSERT INTO clips (ep, title, video_url) VALUES (?, ?, ?)', [ep, title, video_url||'#']);
        res.json({ success: true, id: result.insertId });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/admin/prompts', requireAuth, async (req, res) => {
    try {
        const { title, desc_text, icon } = req.body;
        const [result] = await pool.query('INSERT INTO prompts (title, desc_text, icon) VALUES (?, ?, ?)',
            [title, desc_text, icon||'fa-robot']);
        res.json({ success: true, id: result.insertId });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/admin/materials', requireAuth, async (req, res) => {
    try {
        const { title, desc_text, icon, file_url } = req.body;
        const [result] = await pool.query('INSERT INTO materials (title, desc_text, icon, file_url) VALUES (?, ?, ?, ?)',
            [title, desc_text, icon||'fa-file-pdf', file_url||'#']);
        res.json({ success: true, id: result.insertId });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/admin/announcements', requireAuth, async (req, res) => {
    try {
        const { text } = req.body;
        const [result] = await pool.query('INSERT INTO announcements (text) VALUES (?)', [text||'']);
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
            [ep, title, desc_text, icon||'fa-laptop-code', preview_url||'#', download_url||'#', req.params.id]);
        res.json({ success: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.put('/api/admin/clips/:id', requireAuth, async (req, res) => {
    try {
        const { ep, title, video_url } = req.body;
        await pool.query('UPDATE clips SET ep=?, title=?, video_url=? WHERE id=?', [ep, title, video_url||'#', req.params.id]);
        res.json({ success: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.put('/api/admin/prompts/:id', requireAuth, async (req, res) => {
    try {
        const { title, desc_text, icon } = req.body;
        await pool.query('UPDATE prompts SET title=?, desc_text=?, icon=? WHERE id=?', [title, desc_text, icon||'fa-robot', req.params.id]);
        res.json({ success: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.put('/api/admin/materials/:id', requireAuth, async (req, res) => {
    try {
        const { title, desc_text, icon, file_url } = req.body;
        await pool.query('UPDATE materials SET title=?, desc_text=?, icon=?, file_url=? WHERE id=?', [title, desc_text, icon||'fa-file-pdf', file_url||'#', req.params.id]);
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
        const [result] = await pool.query('INSERT INTO wfh_logs (name, role) VALUES (?, ?)', [name, role||'ครูผู้สอน']);
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
        const [result] = await pool.query('INSERT INTO classrooms (name, grade) VALUES (?, ?)', [name, grade||'']);
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
            [student_id||'', name, classroom_id]);
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
            [student_id, classroom_id, status||'present']);
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
    try { const [rows] = await pool.query('SELECT * FROM quizzes ORDER BY id DESC'); res.json(rows); }
    catch (err) { res.status(500).json({ error: err.message }); }
});

// Get quiz with questions (for taking)
app.get('/api/quizzes/:id', async (req, res) => {
    try {
        const [[quiz]] = await pool.query('SELECT * FROM quizzes WHERE id=?', [req.params.id]);
        if (!quiz) return res.status(404).json({ error: 'Quiz not found' });
        const [questions] = await pool.query(
            'SELECT id, question, choice_a, choice_b, choice_c, choice_d FROM quiz_questions WHERE quiz_id=?', [req.params.id]);
        res.json({ ...quiz, questions });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// Create quiz
app.post('/api/admin/quizzes', requireAuth, async (req, res) => {
    try {
        const { title, description, time_limit, questions } = req.body;
        const [result] = await pool.query('INSERT INTO quizzes (title, description, time_limit) VALUES (?, ?, ?)',
            [title, description||'', time_limit||30]);
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
        const [questions] = await pool.query('SELECT * FROM quiz_questions WHERE quiz_id=?', [req.params.id]);
        let score = 0;
        const total = questions.length;
        questions.forEach(q => { if (answers[q.id] === q.correct_answer) score++; });
        await pool.query('INSERT INTO quiz_results (quiz_id, student_name, score, total, answers) VALUES (?, ?, ?, ?, ?)',
            [req.params.id, student_name, score, total, JSON.stringify(answers)]);
        res.json({ success: true, score, total, percentage: total > 0 ? Math.round((score/total)*100) : 0 });
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
        res.json(rows);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/notifications/unread-count', async (req, res) => {
    try {
        const [[r]] = await pool.query('SELECT COUNT(*) as c FROM notifications WHERE is_read=FALSE');
        res.json({ count: r.c });
    } catch (err) { res.status(500).json({ error: err.message }); }
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
        res.json({ weeklyAttendance: weeklyAtt, quizScores, classSummary,
            totalStudents: totalStudents.c, totalQuizAttempts: totalResults.c });
    } catch (err) { res.status(500).json({ error: err.message }); }
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
        rows.forEach(r => { csv += headers.map(h => `"${(r[h]||'').toString().replace(/"/g,'""')}"`).join(',') + '\n'; });
        res.setHeader('Content-Type', 'text/csv; charset=utf-8');
        res.setHeader('Content-Disposition', `attachment; filename=attendance_${Date.now()}.csv`);
        res.send(csv);
    } catch (err) { res.status(500).json({ error: err.message }); }
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
        rows.forEach(r => { csv += headers.map(h => `"${(r[h]||'').toString().replace(/"/g,'""')}"`).join(',') + '\n'; });
        res.setHeader('Content-Type', 'text/csv; charset=utf-8');
        res.setHeader('Content-Disposition', `attachment; filename=quiz_results_${Date.now()}.csv`);
        res.send(csv);
    } catch (err) { res.status(500).json({ error: err.message }); }
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
            [user_name||'Guest', message, aiResponse]);
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
                    content: `สร้างข้อสอบคณิตศาสตร์เรื่อง "${topic}" จำนวน ${count||5} ข้อ แบบ 4 ตัวเลือก (a,b,c,d)
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
            [title, event_date, time_start||'', time_end||'', type||'class', description||'']);
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
        // Support both plain and bcrypt passwords  
        let match = student.password === (password||'1234');
        if (!match && student.password?.startsWith('$2')) match = await bcrypt.compare(password||'1234', student.password);
        if (student.password && !match) {
            return res.status(401).json({ error: 'รหัสผ่านไม่ถูกต้อง' });
        }
        const token = crypto.randomBytes(32).toString('hex');
        studentTokens.set(token, { id: student.id, student_id: student.student_id, name: student.name, classroom: student.classroom_name, classroom_id: student.classroom_id });
        res.json({ success: true, token, student: { id: student.id, student_id: student.student_id, name: student.name, classroom: student.classroom_name, classroom_id: student.classroom_id } });
    } catch (err) { res.status(500).json({ error: err.message }); }
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
        // Stats
        let stats = { exp: 0, level: 1, badges: '[]', streak_days: 0 };
        const [[existingStats]] = await pool.query('SELECT * FROM student_stats WHERE student_id=?', [sid]);
        if (existingStats) stats = existingStats;
        res.json({ student: req.student, attendance, quizResults, stats });
    } catch (err) { res.status(500).json({ error: err.message }); }
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
            [req.params.room, user_name||'Anonymous', user_role||'student', message.trim()]);
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
    } catch(e) { console.error('EXP Error:', e); }
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
    } catch (err) { res.status(500).json({ error: err.message }); }
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
        // Attendance (last 30 days)
        const [attendance] = await pool.query('SELECT * FROM attendance WHERE student_id=? AND date>=DATE_SUB(CURDATE(), INTERVAL 30 DAY) ORDER BY date DESC', [studentId]);
        // Stats
        const [[stats]] = await pool.query('SELECT * FROM student_stats WHERE student_id=?', [studentId]);
        res.json({ student, quizResults, attendance, stats: stats || { exp: 0, level: 1, badges: '[]' } });
    } catch (err) { res.status(500).json({ error: err.message }); }
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
    } catch(e) { console.error('Telegram Error:', e.message); }
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
    try { envContent = fs.readFileSync(envPath, 'utf-8'); } catch(e) {}
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
    } catch(e) { res.json({ success: false, message: e.message }); }
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
        const avgScore = totalQuizzes > 0 ? Math.round(quizResults.reduce((s,r) => s + r.percent, 0) / totalQuizzes) : 0;
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
        try { await conn.query('ALTER TABLE notifications ADD COLUMN target_classroom_id INT DEFAULT NULL'); } catch(e) {}
        try { await conn.query('ALTER TABLE classrooms ADD COLUMN teacher_id INT DEFAULT NULL'); } catch(e) {}
        try { await conn.query('ALTER TABLE schedule_events ADD COLUMN meeting_url TEXT DEFAULT NULL'); } catch(e) {}
        console.log('Auto-migration complete!');
    } catch(e) { console.error('Migration error:', e.message); }
}

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
        } catch(e) { console.error('Chat Error:', e.message); }
    });
});

// Start Server with Socket.io
server.listen(PORT, async () => {
    console.log(`Server is running on http://localhost:${PORT}`);
    await autoMigrate();
});
