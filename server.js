const express = require('express');
const cors = require('cors');
const mysql = require('mysql2/promise');
const path = require('path');
const crypto = require('crypto');
const multer = require('multer');
const QRCode = require('qrcode');
const fs = require('fs');
require('dotenv').config();

let OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY || '';

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname)));

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

// ===================== PUBLIC APIs =====================

// Systems
app.get('/api/systems', async (req, res) => {
    try { const [rows] = await pool.query('SELECT * FROM systems ORDER BY id DESC'); res.json(rows); }
    catch (err) { res.status(500).json({ error: err.message }); }
});

// Clips
app.get('/api/clips', async (req, res) => {
    try { const [rows] = await pool.query('SELECT * FROM clips ORDER BY id DESC'); res.json(rows); }
    catch (err) { res.status(500).json({ error: err.message }); }
});

// Prompts
app.get('/api/prompts', async (req, res) => {
    try { const [rows] = await pool.query('SELECT * FROM prompts ORDER BY id DESC'); res.json(rows); }
    catch (err) { res.status(500).json({ error: err.message }); }
});

// Materials
app.get('/api/materials', async (req, res) => {
    try { const [rows] = await pool.query('SELECT * FROM materials ORDER BY id DESC'); res.json(rows); }
    catch (err) { res.status(500).json({ error: err.message }); }
});

// Announcements
app.get('/api/announcements', async (req, res) => {
    try { const [rows] = await pool.query('SELECT * FROM announcements ORDER BY id DESC'); res.json(rows); }
    catch (err) { res.status(500).json({ error: err.message }); }
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
    } catch (err) { res.status(500).json({ error: err.message }); }
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
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// ===================== AUTH =====================

app.post('/api/auth/login', async (req, res) => {
    const { password } = req.body;
    try {
        const [rows] = await pool.query("SELECT setting_value FROM admin_settings WHERE setting_key='admin_password'");
        const dbPass = rows.length > 0 ? rows[0].setting_value : 'admin1234';
        if (password === dbPass) {
            const token = crypto.randomBytes(32).toString('hex');
            activeTokens.add(token);
            res.json({ success: true, token });
        } else { res.status(401).json({ success: false, error: 'Wrong password' }); }
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/auth/check', requireAuth, (req, res) => {
    res.json({ authenticated: true });
});

// Change password
app.put('/api/admin/change-password', requireAuth, async (req, res) => {
    try {
        const { oldPassword, newPassword } = req.body;
        const [rows] = await pool.query("SELECT setting_value FROM admin_settings WHERE setting_key='admin_password'");
        const currentPass = rows.length > 0 ? rows[0].setting_value : 'admin1234';
        if (oldPassword !== currentPass) return res.status(400).json({ error: 'รหัสเดิมไม่ถูกต้อง' });
        if (!newPassword || newPassword.length < 4) return res.status(400).json({ error: 'รหัสใหม่ต้องมีอย่างน้อย 4 ตัวอักษร' });
        await pool.query("UPDATE admin_settings SET setting_value=? WHERE setting_key='admin_password'", [newPassword]);
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

app.post('/api/student/login', async (req, res) => {
    try {
        const { student_id, password } = req.body;
        const [[student]] = await pool.query(
            'SELECT s.*, c.name as classroom_name FROM students s LEFT JOIN classrooms c ON s.classroom_id=c.id WHERE s.student_id=?',
            [student_id]);
        if (!student) return res.status(401).json({ error: 'ไม่พบรหัสนักเรียน' });
        if (student.password && student.password !== (password||'1234')) {
            return res.status(401).json({ error: 'รหัสผ่านไม่ถูกต้อง' });
        }
        const token = crypto.randomBytes(32).toString('hex');
        studentTokens.set(token, { id: student.id, student_id: student.student_id, name: student.name, classroom: student.classroom_name });
        res.json({ success: true, token, student: { id: student.id, student_id: student.student_id, name: student.name, classroom: student.classroom_name } });
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
        if (student.password !== oldPassword) return res.status(400).json({ error: 'รหัสเดิมไม่ถูกต้อง' });
        await pool.query('UPDATE students SET password=? WHERE id=?', [newPassword, req.student.id]);
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
            // Auto badges
            if (newExp >= 100 && !badges.includes('🌟 เริ่มต้น')) badges.push('🌟 เริ่มต้น');
            if (newExp >= 500 && !badges.includes('🔥 ขยัน')) badges.push('🔥 ขยัน');
            if (newExp >= 1000 && !badges.includes('🏆 เก่งมาก')) badges.push('🏆 เก่งมาก');
            if (newExp >= 2000 && !badges.includes('💎 ระดับเพชร')) badges.push('💎 ระดับเพชร');
            await pool.query('UPDATE student_stats SET exp=?, level=?, badges=?, last_activity=CURDATE() WHERE student_id=?',
                [newExp, newLevel, JSON.stringify(badges), studentId]);
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

// Fallback to index.html for SPA
app.use((req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

// Auto-migrate on startup
async function autoMigrate() {
    try {
        const conn = pool;
        await conn.query(`CREATE TABLE IF NOT EXISTS materials (id INT AUTO_INCREMENT PRIMARY KEY, title VARCHAR(255), desc_text TEXT, icon VARCHAR(100) DEFAULT 'fa-file-pdf', file_url TEXT, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP)`);
        await conn.query(`CREATE TABLE IF NOT EXISTS wfh_logs (id INT AUTO_INCREMENT PRIMARY KEY, log_date DATE, morning_task TEXT, afternoon_task TEXT, note TEXT, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP)`);
        await conn.query(`CREATE TABLE IF NOT EXISTS announcements (id INT AUTO_INCREMENT PRIMARY KEY, title VARCHAR(255), content TEXT, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP)`);
        await conn.query(`CREATE TABLE IF NOT EXISTS admin_settings (id INT AUTO_INCREMENT PRIMARY KEY, setting_key VARCHAR(100) UNIQUE, setting_value TEXT)`);
        await conn.query(`CREATE TABLE IF NOT EXISTS classrooms (id INT AUTO_INCREMENT PRIMARY KEY, name VARCHAR(255), description TEXT, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP)`);
        await conn.query(`CREATE TABLE IF NOT EXISTS students (id INT AUTO_INCREMENT PRIMARY KEY, student_id VARCHAR(50) UNIQUE, name VARCHAR(255), classroom_id INT, password VARCHAR(255) DEFAULT '1234', created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP, FOREIGN KEY (classroom_id) REFERENCES classrooms(id) ON DELETE SET NULL)`);
        await conn.query(`CREATE TABLE IF NOT EXISTS attendance (id INT AUTO_INCREMENT PRIMARY KEY, student_id INT, classroom_id INT, date DATE, status ENUM('present','absent','late') DEFAULT 'present', created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP)`);
        await conn.query(`CREATE TABLE IF NOT EXISTS quizzes (id INT AUTO_INCREMENT PRIMARY KEY, title VARCHAR(255), description TEXT, time_limit INT DEFAULT 30, is_active BOOLEAN DEFAULT TRUE, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP)`);
        await conn.query(`CREATE TABLE IF NOT EXISTS quiz_questions (id INT AUTO_INCREMENT PRIMARY KEY, quiz_id INT, question TEXT, options JSON, correct_answer INT DEFAULT 0, FOREIGN KEY (quiz_id) REFERENCES quizzes(id) ON DELETE CASCADE)`);
        await conn.query(`CREATE TABLE IF NOT EXISTS quiz_results (id INT AUTO_INCREMENT PRIMARY KEY, quiz_id INT NOT NULL, student_name VARCHAR(255), score INT DEFAULT 0, total INT DEFAULT 0, answers JSON, submitted_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP, FOREIGN KEY (quiz_id) REFERENCES quizzes(id) ON DELETE CASCADE)`);
        await conn.query(`CREATE TABLE IF NOT EXISTS notifications (id INT AUTO_INCREMENT PRIMARY KEY, title VARCHAR(255) NOT NULL, message TEXT, type ENUM('quiz','announcement','attendance','system') DEFAULT 'system', is_read BOOLEAN DEFAULT FALSE, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP)`);
        await conn.query(`CREATE TABLE IF NOT EXISTS ai_chats (id INT AUTO_INCREMENT PRIMARY KEY, user_name VARCHAR(255), message TEXT, response TEXT, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP)`);
        await conn.query(`CREATE TABLE IF NOT EXISTS schedule_events (id INT AUTO_INCREMENT PRIMARY KEY, title VARCHAR(255) NOT NULL, event_date DATE, time_start VARCHAR(10), time_end VARCHAR(10), type ENUM('class','exam','event','holiday') DEFAULT 'class', description TEXT, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP)`);
        await conn.query(`CREATE TABLE IF NOT EXISTS chat_messages (id INT AUTO_INCREMENT PRIMARY KEY, room VARCHAR(100) DEFAULT 'general', user_name VARCHAR(255), user_role ENUM('student','teacher') DEFAULT 'student', message TEXT, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP)`);
        await conn.query(`CREATE TABLE IF NOT EXISTS student_stats (id INT AUTO_INCREMENT PRIMARY KEY, student_id INT NOT NULL, exp INT DEFAULT 0, level INT DEFAULT 1, badges JSON, streak_days INT DEFAULT 0, last_activity DATE, FOREIGN KEY (student_id) REFERENCES students(id) ON DELETE CASCADE)`);
        console.log('Auto-migration complete!');
    } catch(e) { console.error('Migration error:', e.message); }
}

// Start Server
app.listen(PORT, async () => {
    console.log(`Server is running on http://localhost:${PORT}`);
    await autoMigrate();
});
