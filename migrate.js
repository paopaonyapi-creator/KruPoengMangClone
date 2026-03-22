const mysql = require('mysql2/promise');

async function migrate() {
    const connection = await mysql.createConnection({
        host: 'localhost', user: 'root', password: '', database: 'krupug_db'
    });

    // Original tables
    console.log('Creating materials table...');
    await connection.query(`CREATE TABLE IF NOT EXISTS materials (
        id INT AUTO_INCREMENT PRIMARY KEY, title VARCHAR(255), desc_text TEXT,
        icon VARCHAR(100) DEFAULT 'fa-file-pdf', file_url TEXT, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )`);

    console.log('Creating wfh_logs table...');
    await connection.query(`CREATE TABLE IF NOT EXISTS wfh_logs (
        id INT AUTO_INCREMENT PRIMARY KEY, name VARCHAR(255), role VARCHAR(100),
        time_in DATETIME DEFAULT CURRENT_TIMESTAMP, time_out DATETIME DEFAULT NULL
    )`);

    console.log('Creating announcements table...');
    await connection.query(`CREATE TABLE IF NOT EXISTS announcements (
        id INT AUTO_INCREMENT PRIMARY KEY, text TEXT, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )`);

    // Add time_out column if missing
    try { await connection.query('ALTER TABLE wfh_logs ADD COLUMN time_out DATETIME DEFAULT NULL'); } catch(e) {}

    // ===== NEW: Admin Settings (Password) =====
    console.log('Creating admin_settings table...');
    await connection.query(`CREATE TABLE IF NOT EXISTS admin_settings (
        id INT AUTO_INCREMENT PRIMARY KEY,
        setting_key VARCHAR(100) UNIQUE,
        setting_value TEXT
    )`);
    // Insert default password if not exists
    const [existing] = await connection.query("SELECT * FROM admin_settings WHERE setting_key='admin_password'");
    if (existing.length === 0) {
        await connection.query("INSERT INTO admin_settings (setting_key, setting_value) VALUES ('admin_password', 'admin1234')");
    }

    // ===== NEW: Classrooms & Attendance =====
    console.log('Creating classrooms table...');
    await connection.query(`CREATE TABLE IF NOT EXISTS classrooms (
        id INT AUTO_INCREMENT PRIMARY KEY,
        name VARCHAR(255) NOT NULL,
        grade VARCHAR(50),
        qr_code TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )`);

    console.log('Creating students table...');
    await connection.query(`CREATE TABLE IF NOT EXISTS students (
        id INT AUTO_INCREMENT PRIMARY KEY,
        student_id VARCHAR(50),
        name VARCHAR(255) NOT NULL,
        classroom_id INT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (classroom_id) REFERENCES classrooms(id) ON DELETE SET NULL
    )`);

    console.log('Creating attendance table...');
    await connection.query(`CREATE TABLE IF NOT EXISTS attendance (
        id INT AUTO_INCREMENT PRIMARY KEY,
        student_id INT,
        classroom_id INT,
        status ENUM('present','late','absent') DEFAULT 'present',
        check_in DATETIME DEFAULT CURRENT_TIMESTAMP,
        date DATE DEFAULT (CURDATE()),
        FOREIGN KEY (student_id) REFERENCES students(id) ON DELETE CASCADE,
        FOREIGN KEY (classroom_id) REFERENCES classrooms(id) ON DELETE CASCADE
    )`);

    // ===== NEW: Quizzes =====
    console.log('Creating quizzes table...');
    await connection.query(`CREATE TABLE IF NOT EXISTS quizzes (
        id INT AUTO_INCREMENT PRIMARY KEY,
        title VARCHAR(255) NOT NULL,
        description TEXT,
        time_limit INT DEFAULT 30,
        is_active BOOLEAN DEFAULT TRUE,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )`);

    console.log('Creating quiz_questions table...');
    await connection.query(`CREATE TABLE IF NOT EXISTS quiz_questions (
        id INT AUTO_INCREMENT PRIMARY KEY,
        quiz_id INT NOT NULL,
        question TEXT NOT NULL,
        choice_a VARCHAR(255),
        choice_b VARCHAR(255),
        choice_c VARCHAR(255),
        choice_d VARCHAR(255),
        correct_answer CHAR(1) NOT NULL,
        FOREIGN KEY (quiz_id) REFERENCES quizzes(id) ON DELETE CASCADE
    )`);

    console.log('Creating quiz_results table...');
    await connection.query(`CREATE TABLE IF NOT EXISTS quiz_results (
        id INT AUTO_INCREMENT PRIMARY KEY,
        quiz_id INT NOT NULL,
        student_name VARCHAR(255),
        score INT DEFAULT 0,
        total INT DEFAULT 0,
        answers JSON,
        submitted_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (quiz_id) REFERENCES quizzes(id) ON DELETE CASCADE
    )`);

    console.log('Creating notifications table...');
    await connection.query(`CREATE TABLE IF NOT EXISTS notifications (
        id INT AUTO_INCREMENT PRIMARY KEY,
        title VARCHAR(255) NOT NULL,
        message TEXT,
        type ENUM('quiz','announcement','attendance','system') DEFAULT 'system',
        is_read BOOLEAN DEFAULT FALSE,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )`);

    console.log('Creating ai_chats table...');
    await connection.query(`CREATE TABLE IF NOT EXISTS ai_chats (
        id INT AUTO_INCREMENT PRIMARY KEY,
        user_name VARCHAR(255),
        message TEXT,
        response TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )`);

    // ===== Phase 4: Schedule Events =====
    console.log('Creating schedule_events table...');
    await connection.query(`CREATE TABLE IF NOT EXISTS schedule_events (
        id INT AUTO_INCREMENT PRIMARY KEY,
        title VARCHAR(255) NOT NULL,
        event_date DATE,
        time_start VARCHAR(10),
        time_end VARCHAR(10),
        type ENUM('class','exam','event','holiday') DEFAULT 'class',
        description TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )`);

    // ===== Phase 4: Chat Messages =====
    console.log('Creating chat_messages table...');
    await connection.query(`CREATE TABLE IF NOT EXISTS chat_messages (
        id INT AUTO_INCREMENT PRIMARY KEY,
        room VARCHAR(100) DEFAULT 'general',
        user_name VARCHAR(255),
        user_role ENUM('student','teacher') DEFAULT 'student',
        message TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )`);

    // ===== Phase 4: Student Stats (Gamification) =====
    console.log('Creating student_stats table...');
    await connection.query(`CREATE TABLE IF NOT EXISTS student_stats (
        id INT AUTO_INCREMENT PRIMARY KEY,
        student_id INT NOT NULL,
        exp INT DEFAULT 0,
        level INT DEFAULT 1,
        badges JSON,
        streak_days INT DEFAULT 0,
        last_activity DATE,
        FOREIGN KEY (student_id) REFERENCES students(id) ON DELETE CASCADE
    )`);

    // ===== Phase 4: Add password to students =====
    console.log('Adding password column to students...');
    try {
        await connection.query(`ALTER TABLE students ADD COLUMN password VARCHAR(255) DEFAULT '1234'`);
    } catch(e) { /* column might already exist */ }

    console.log('Migration complete!');
    await connection.end();
}

migrate().catch(console.error);
