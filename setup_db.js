const mysql = require('mysql2/promise');

async function setup() {
    try {
        console.log("Connecting to MySQL server (localhost, root, no password)...");
        const connection = await mysql.createConnection({
            host: 'localhost',
            user: 'root',
            password: ''
        });

        console.log("Creating database 'krupug_db' if not exists...");
        await connection.query('CREATE DATABASE IF NOT EXISTS krupug_db CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;');
        await connection.changeUser({ database: 'krupug_db' });

        console.log("Creating tables...");
        
        await connection.query(`
            CREATE TABLE IF NOT EXISTS systems (
                id INT AUTO_INCREMENT PRIMARY KEY,
                ep VARCHAR(20),
                title VARCHAR(255),
                desc_text TEXT,
                icon VARCHAR(100),
                preview_url VARCHAR(255) DEFAULT '#',
                download_url VARCHAR(255) DEFAULT '#',
                youtube_url VARCHAR(255) DEFAULT '#'
            )
        `);

        await connection.query(`
            CREATE TABLE IF NOT EXISTS clips (
                id INT AUTO_INCREMENT PRIMARY KEY,
                ep VARCHAR(20),
                title VARCHAR(255),
                video_url VARCHAR(255) DEFAULT '#'
            )
        `);

        await connection.query(`
            CREATE TABLE IF NOT EXISTS prompts (
                id INT AUTO_INCREMENT PRIMARY KEY,
                title VARCHAR(255),
                desc_text TEXT,
                icon VARCHAR(100)
            )
        `);

        console.log("Inserting initial data from Kru Pug's hub...");
        await connection.query('TRUNCATE TABLE systems');
        await connection.query('TRUNCATE TABLE clips');
        await connection.query('TRUNCATE TABLE prompts');

        const systems = [
            ['Ep.73', 'ระบบรับแจ้งซ่อม / รายงานซ่อม', 'รับแจ้งอุปกรณ์ชำรุด พร้อม Dashboard', 'fa-screwdriver-wrench'],
            ['Ep.72', 'ระบบวารสารออนไลน์', 'ตีพิมพ์เผยแพร่วารสารโรงเรียน', 'fa-book'],
            ['Ep.71', 'ระบบเช็คเวลาเรียน', 'แจ้งเตือนนักเรียนเวลาเรียนไม่ถึง 80%', 'fa-user-clock'],
            ['Ep.64', 'จัดการผลการเรียน 0, ร, มส', 'ติดตามแก้ไขเกรดอย่างเป็นระบบ', 'fa-file-signature'],
            ['New', 'ระบบลงเวลา WFH', 'บันทึกเวลาทำงานที่บ้าน', 'fa-house-user']
        ];
        for (let s of systems) {
            await connection.query('INSERT INTO systems (ep, title, desc_text, icon) VALUES (?, ?, ?, ?)', s);
        }

        const clips = [
            ['Ep.2', 'วิธีการติดตั้งระบบลงเวลา WFH สำหรับองค์กร'],
            ['Ep.3', 'การผูก Line Notify แจ้งเตือนในระบบซ่อมบำรุง'],
            ['Ep.4', 'แก้ปัญหาการ Deploy Google Apps Script'],
            ['Ep.5', 'การปรับแต่ง Dashboard หน้าแรก'],
            ['Ep.6', 'วิธีการ Import ข้อมูลนักเรียนจากไฟล์ Excel']
        ];
        for (let c of clips) {
            await connection.query('INSERT INTO clips (ep, title) VALUES (?, ?)', c);
        }

        const prompts = [
            ['สร้างระบบรายงานขยะ', 'คำสั่ง สร้างระบบบันทึกปริมาณขยะแยกประเภท', 'fa-recycle'],
            ['ระบบยื่นคำร้องแก้ผลการเรียน', 'คำสั่ง AI เขียน GAS แบบจบครบกระบวนการ', 'fa-file-pen']
        ];
        for (let p of prompts) {
            await connection.query('INSERT INTO prompts (title, desc_text, icon) VALUES (?, ?, ?)', p);
        }

        console.log("Database setup completed successfully! MySQL is ready.");
        process.exit(0);
    } catch (err) {
        console.error("Error setting up database:", err.message);
        console.error("\n*** PLEASE ENSURE XAMPP MYSQL IS RUNNING (via XAMPP Control Panel) ***");
        process.exit(1);
    }
}

setup();
