// ===================== SHARED i18n MODULE =====================
const krupugI18n = {
    en: {
        // Navbar (index.html)
        nav_home: 'Home', nav_systems: 'Education Systems', nav_materials: 'Teaching Materials',
        nav_clips: 'Teaching Clips', nav_prompts: 'AI Prompt',
        // Quick Links
        ql_quiz: 'Quiz', ql_student: 'Student Portal', ql_calendar: 'Schedule', ql_wfh: 'WFH',
        // Hero
        hero_title: 'Quality Resources for Math Teachers', hero_free: 'Free!',
        hero_desc: 'Education systems, teaching materials, video clips, and AI Prompts by Kru Pug',
        // Profile
        profile_role: 'Math Teacher | Education System Developer',
        profile_desc: 'Quality resource hub, education systems, math teaching clips, and AI prompts for all math teachers',
        // Stats
        stat_systems: 'Systems', stat_materials: 'Materials', stat_clips: 'Clips', stat_prompts: 'Prompts',
        // Footer
        footer_text: 'Made with ❤️ by Kru Pug',
        // AI Chat
        ai_title: 'Kru Pug AI', ai_placeholder: 'Type your question...', ai_greeting: 'Hello! I am <b>Kru Pug AI</b> 🤖 Ask me anything about math!',
        // Announcements
        announcements: 'Announcements', no_news: 'No announcements',
        // Admin
        admin_title: 'Admin Panel', admin_back: 'Back to website', admin_logout: 'Logout',
        dashboard: 'Dashboard', systems: 'Systems', clips: 'Clips', materials: 'Materials',
        news: 'News', classroom: '🏫 Classroom', quiz: '📝 Quiz', analytics: '📊 Analytics',
        goals: '🎯 Goals', teachers: '👨‍🏫 Teachers', notify: '🔔 Notify', settings: '⚙️ Settings',
        change_pass: 'Change Password', old_pass: 'Old password', new_pass: 'New password',
        confirm_pass: 'Confirm password', change_pass_btn: 'Change Password',
        tg_title: 'Telegram Bot Notifications', tg_desc: 'Send notifications via Telegram when there are new quizzes or announcements',
        tg_status: 'Status', tg_save: 'Save', tg_test: 'Test',
        // Parent
        parent_title: 'Parent Portal', parent_desc: 'View your child\'s academic results',
        parent_login: 'Login', parent_student_id: 'Student ID', parent_code: 'Parent code',
        parent_report: 'Academic Report', parent_logout: 'Logout',
        parent_exp: 'EXP', parent_level: 'Level', parent_quizzes: 'Quizzes', parent_attendance: 'Attendance Days',
        badges: 'Badges', quiz_results: 'Quiz Results', attendance_history: 'Attendance History (30 Days)',
        no_badges: 'No badges yet', no_quiz: 'No quiz results', no_data: 'No data',
        // Teacher
        teacher_title: 'Teacher System', teacher_desc: 'Login with email and password',
        teacher_email: 'Email', teacher_pass: 'Password',
        teacher_classrooms: 'My Classrooms', teacher_students: 'Students', teacher_today_att: 'Today Attendance',
        teacher_id: 'ID', teacher_name: 'Name', teacher_room: 'Room',
        status_present: 'Present', status_late: 'Late', status_absent: 'Absent',
        // Shared
        login: 'Login', back: '← Back to home', loading: 'Loading...'
    },
    th: {
        nav_home: 'หน้าแรก', nav_systems: 'ระบบการศึกษา', nav_materials: 'สื่อการสอน',
        nav_clips: 'คลิปการสอน', nav_prompts: 'AI Prompt',
        ql_quiz: 'แบบทดสอบ', ql_student: 'พอร์ทัลนักเรียน', ql_calendar: 'ตารางสอน', ql_wfh: 'WFH',
        hero_title: 'ศูนย์รวมสื่อคุณภาพเพื่อครูคณิต', hero_free: 'ดาวน์โหลดฟรี!',
        hero_desc: 'ระบบเพื่อการศึกษา สื่อการสอน คลิปวิดีโอ และ AI Prompt โดยครู Pug',
        profile_role: 'ครูคณิตศาสตร์ | นักพัฒนาระบบการศึกษา',
        profile_desc: 'ศูนย์รวมสื่อคุณภาพ ระบบเพื่อการศึกษา คลิปสอนคณิต และ AI Prompt สำหรับครูคณิตศาสตร์ทุกคน',
        stat_systems: 'ระบบ', stat_materials: 'สื่อ', stat_clips: 'คลิป', stat_prompts: 'Prompt',
        footer_text: 'Made with ❤️ by ครู Pug',
        ai_title: 'ครูพัก AI', ai_placeholder: 'พิมพ์คำถาม...', ai_greeting: 'สวัสดีครับ! ผม<b>ครูพัก AI</b> 🤖 ถามอะไรเกี่ยวกับคณิตได้เลยนะ!',
        announcements: 'ข่าวประกาศ', no_news: 'ไม่มีข่าวประกาศ',
        admin_title: 'ระบบจัดการ (Admin)', admin_back: 'กลับหน้าเว็บ', admin_logout: 'ออกจากระบบ',
        dashboard: 'Dashboard', systems: 'ระบบ', clips: 'คลิป', materials: 'สื่อ',
        news: 'ข่าว', classroom: '🏫 ห้องเรียน', quiz: '📝 แบบทดสอบ', analytics: '📊 สถิติ',
        goals: '🎯 เป้าหมาย', teachers: '👨‍🏫 ครู', notify: '🔔 แจ้งเตือน', settings: '⚙️ ตั้งค่า',
        change_pass: 'เปลี่ยนรหัสผ่าน', old_pass: 'รหัสเดิม', new_pass: 'รหัสใหม่',
        confirm_pass: 'ยืนยันรหัสใหม่', change_pass_btn: 'เปลี่ยนรหัสผ่าน',
        tg_title: 'Telegram Bot แจ้งเตือน', tg_desc: 'ส่งแจ้งเตือนผ่าน Telegram เมื่อมีข้อสอบใหม่ หรือประกาศ',
        tg_status: 'สถานะ', tg_save: 'บันทึก', tg_test: 'ทดสอบ',
        parent_title: 'พอร์ทัลผู้ปกครอง', parent_desc: 'ดูผลการเรียนของบุตรหลาน',
        parent_login: 'เข้าสู่ระบบ', parent_student_id: 'รหัสนักเรียน', parent_code: 'รหัสผู้ปกครอง',
        parent_report: 'รายงานผลการเรียน', parent_logout: 'ออก',
        parent_exp: 'EXP', parent_level: 'Level', parent_quizzes: 'ทำข้อสอบ', parent_attendance: 'วันเข้าเรียน',
        badges: 'เหรียญรางวัล', quiz_results: 'ผลแบบทดสอบ', attendance_history: 'ประวัติเช็คชื่อ (30 วัน)',
        no_badges: 'ยังไม่มี', no_quiz: 'ยังไม่มีผลสอบ', no_data: 'ยังไม่มีข้อมูล',
        teacher_title: 'ระบบครู', teacher_desc: 'เข้าสู่ระบบด้วยอีเมลและรหัสผ่าน',
        teacher_email: 'อีเมล', teacher_pass: 'รหัสผ่าน',
        teacher_classrooms: 'ห้องเรียนของฉัน', teacher_students: 'นักเรียน', teacher_today_att: 'เช็คชื่อวันนี้',
        teacher_id: 'รหัส', teacher_name: 'ชื่อ', teacher_room: 'ห้อง',
        status_present: 'มาเรียน', status_late: 'สาย', status_absent: 'ขาด',
        login: 'เข้าสู่ระบบ', back: '← กลับหน้าหลัก', loading: 'กำลังโหลด...'
    }
};

let krupugLang = localStorage.getItem('krupug-lang') || 'th';

function applyI18n() {
    const strings = krupugI18n[krupugLang] || krupugI18n.th;
    document.querySelectorAll('[data-i18n]').forEach(el => {
        const key = el.getAttribute('data-i18n');
        if (strings[key]) el.textContent = strings[key];
    });
    document.querySelectorAll('[data-i18n-placeholder]').forEach(el => {
        const key = el.getAttribute('data-i18n-placeholder');
        if (strings[key]) el.placeholder = strings[key];
    });
    document.querySelectorAll('[data-i18n-html]').forEach(el => {
        const key = el.getAttribute('data-i18n-html');
        if (strings[key]) el.innerHTML = strings[key];
    });
    // Update lang toggle buttons
    document.querySelectorAll('.lang-toggle-btn').forEach(btn => {
        btn.textContent = krupugLang === 'th' ? '🇹🇭 ไทย' : '🇬🇧 EN';
    });
}

function toggleKrupugLang() {
    krupugLang = krupugLang === 'th' ? 'en' : 'th';
    localStorage.setItem('krupug-lang', krupugLang);
    applyI18n();
}

// Auto-apply on load
document.addEventListener('DOMContentLoaded', applyI18n);
