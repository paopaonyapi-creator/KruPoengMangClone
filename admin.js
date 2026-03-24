let TOKEN = localStorage.getItem('adminToken');
let questionCounter = 0;

// Auth check
(async () => {
    try {
        const res = await fetch('/api/auth/check', { headers: { 'x-admin-token': TOKEN } });
        if (!res.ok) { showAdminLogin(); return; }
    } catch { showAdminLogin(); return; }
    showAdminDashboard();
})();

function showAdminLogin() {
    document.getElementById('admin-login-page').style.display = 'block';
    document.getElementById('admin-body').style.display = 'none';
}

function showAdminDashboard() {
    document.getElementById('admin-login-page').style.display = 'none';
    document.getElementById('admin-body').style.display = 'block';
    if (document.getElementById('admin-floating-utils')) document.getElementById('admin-floating-utils').style.display = 'none';
    loadDashboard();
    loadAllTables();
    loadClassrooms();
    loadQuizList();
    document.getElementById('att-date').value = new Date().toISOString().split('T')[0];
    loadStudentCount();
    loadApiKeyStatus();
    loadTelegramStatus();
}

async function adminPageLogin() {
    const pass = document.getElementById('admin-login-pass').value;
    if (!pass) return;
    try {
        const response = await fetch('/api/auth/login', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ password: pass })
        });
        const data = await response.json();
        if (data.success) {
            TOKEN = data.token;
            localStorage.setItem('adminToken', data.token);
            showAdminDashboard();
        } else {
            document.getElementById('admin-login-error').style.display = 'block';
        }
    } catch (err) {
        document.getElementById('admin-login-error').style.display = 'block';
        document.getElementById('admin-login-error').textContent = 'เกิดข้อผิดพลาด กรุณาลองใหม่';
    }
}

function logout() { localStorage.removeItem('adminToken'); TOKEN = null; showAdminLogin(); }

function switchTab(tabId, btn) {
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.admin-panel').forEach(p => p.classList.remove('active'));
    btn.classList.add('active');
    document.getElementById('panel-' + tabId).classList.add('active');
    if (tabId === 'analytics') loadAnalytics();
}

// API Helpers
async function apiPost(url, data) {
    const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-admin-token': TOKEN }, body: JSON.stringify(data) });
    return res.json();
}
async function apiPut(url, data) {
    const res = await fetch(url, { method: 'PUT', headers: { 'Content-Type': 'application/json', 'x-admin-token': TOKEN }, body: JSON.stringify(data) });
    return res.json();
}
async function apiDelete(table, id) {
    if (!confirm('ยืนยันลบข้อมูลนี้?')) return;
    await fetch(`/api/admin/${table}/${id}`, { method: 'DELETE', headers: { 'x-admin-token': TOKEN } });
    loadAllTables(); loadDashboard(); loadClassrooms(); loadQuizList();
}

// Dashboard
async function loadDashboard() {
    try {
        const res = await fetch('/api/dashboard');
        const d = await res.json();
        document.getElementById('d-systems').textContent = d.systems;
        document.getElementById('d-materials').textContent = d.materials;
        document.getElementById('d-clips').textContent = d.clips;
        document.getElementById('d-prompts').textContent = d.prompts;
        document.getElementById('d-wfh').textContent = d.wfh_today;
        document.getElementById('d-quizzes').textContent = d.quizzes;
        document.getElementById('d-classrooms').textContent = d.classrooms;
    } catch (e) { console.error(e); }
}

// Load all content tables
async function loadAllTables() {
    await Promise.all([loadSystemsTable(), loadClipsTable(), loadPromptsTable(), loadMaterialsTable(), loadAnnouncementsTable(), loadStudentsTable()]);
}

async function loadSystemsTable() {
    try {
        const r = await (await fetch('/api/systems')).json();
        document.getElementById('table-systems').innerHTML = r.map(x =>
            `<tr><td>${x.id}</td><td>${x.ep}</td><td>${x.title}</td><td>
            <button class="btn-edit" onclick="editSystem(${x.id},'${esc(x.ep)}','${esc(x.title)}','${esc(x.desc_text)}','${esc(x.icon)}')"><i class="fa-solid fa-pen"></i></button>
            <button class="btn-delete" onclick="apiDelete('systems',${x.id})"><i class="fa-solid fa-trash"></i></button></td></tr>`).join('');
    } catch (e) {}
}
async function loadClipsTable() {
    try {
        const r = await (await fetch('/api/clips')).json();
        document.getElementById('table-clips').innerHTML = r.map(x =>
            `<tr><td>${x.id}</td><td>${x.ep}</td><td>${x.title}</td><td>
            <button class="btn-edit" onclick="editClip(${x.id},'${esc(x.ep)}','${esc(x.title)}','${esc(x.video_url)}')"><i class="fa-solid fa-pen"></i></button>
            <button class="btn-delete" onclick="apiDelete('clips',${x.id})"><i class="fa-solid fa-trash"></i></button></td></tr>`).join('');
    } catch (e) {}
}
async function loadPromptsTable() {
    try {
        const r = await (await fetch('/api/prompts')).json();
        document.getElementById('table-prompts').innerHTML = r.map(x =>
            `<tr><td>${x.id}</td><td>${x.title}</td><td>
            <button class="btn-edit" onclick="editPrompt(${x.id},'${esc(x.title)}','${esc(x.desc_text)}')"><i class="fa-solid fa-pen"></i></button>
            <button class="btn-delete" onclick="apiDelete('prompts',${x.id})"><i class="fa-solid fa-trash"></i></button></td></tr>`).join('');
    } catch (e) {}
}
async function loadMaterialsTable() {
    try {
        const r = await (await fetch('/api/materials')).json();
        document.getElementById('table-materials').innerHTML = r.map(x =>
            `<tr><td>${x.id}</td><td>${x.title}</td><td>
            <button class="btn-edit" onclick="editMaterial(${x.id},'${esc(x.title)}','${esc(x.desc_text)}','${esc(x.icon)}','${esc(x.file_url)}')"><i class="fa-solid fa-pen"></i></button>
            <button class="btn-delete" onclick="apiDelete('materials',${x.id})"><i class="fa-solid fa-trash"></i></button></td></tr>`).join('');
    } catch (e) {}
}
async function loadAnnouncementsTable() {
    try {
        const r = await (await fetch('/api/announcements')).json();
        document.getElementById('table-announcements').innerHTML = r.map(x =>
            `<tr><td>${x.id}</td><td>${x.text}</td><td>
            <button class="btn-edit" onclick="editAnnouncement(${x.id},'${esc(x.text)}')"><i class="fa-solid fa-pen"></i></button>
            <button class="btn-delete" onclick="apiDelete('announcements',${x.id})"><i class="fa-solid fa-trash"></i></button></td></tr>`).join('');
    } catch (e) {}
}
async function loadStudentsTable() {
    try {
        const r = await (await fetch('/api/students')).json();
        document.getElementById('table-students').innerHTML = r.map(x =>
            `<tr><td>${x.id}</td><td>${x.student_id||'-'}</td><td>${x.name}</td><td>${x.class_name||'-'}</td><td>
            <button class="btn-delete" onclick="apiDelete('students',${x.id})"><i class="fa-solid fa-trash"></i></button></td></tr>`).join('');
    } catch (e) {}
}

function esc(str) { return (str||'').replace(/\\/g,'\\\\').replace(/'/g,"\\'").replace(/\n/g,' '); }

// ========== EDIT MODAL ==========
function showEditModal(title, fields, onSave) {
    let modal = document.getElementById('edit-modal');
    if (!modal) { modal = document.createElement('div'); modal.id = 'edit-modal'; modal.className = 'edit-overlay'; document.body.appendChild(modal); }
    modal.innerHTML = `<div class="edit-box glass-card">
        <h3 style="margin-bottom:16px;color:#f59e0b;"><i class="fa-solid fa-pen-to-square"></i> ${title}</h3>
        <form id="edit-form">
            ${fields.map(f => `<div class="form-group"><label>${f.label}</label>
            ${f.type==='textarea' ? `<textarea class="glass-input" name="${f.name}" rows="3">${f.value||''}</textarea>` :
            `<input type="text" class="glass-input" name="${f.name}" value="${(f.value||'').replace(/"/g,'&quot;')}">`}</div>`).join('')}
            <div style="display:flex;gap:12px;">
                <button type="submit" class="btn-glow" style="flex:1;background:#f59e0b;"><i class="fa-solid fa-save"></i> บันทึก</button>
                <button type="button" class="btn-outline" style="flex:1;" onclick="closeEditModal()"><i class="fa-solid fa-xmark"></i> ยกเลิก</button>
            </div>
        </form></div>`;
    modal.style.display = 'flex';
    document.getElementById('edit-form').addEventListener('submit', async (e) => {
        e.preventDefault();
        const fd = new FormData(e.target);
        await onSave(Object.fromEntries(fd.entries()));
        closeEditModal(); loadAllTables(); loadDashboard();
    });
}
function closeEditModal() { const m = document.getElementById('edit-modal'); if (m) m.style.display = 'none'; }

function editSystem(id, ep, t, d, i) { showEditModal('แก้ไขระบบ', [{name:'ep',label:'Ep',value:ep},{name:'title',label:'ชื่อ',value:t},{name:'desc_text',label:'รายละเอียด',value:d,type:'textarea'},{name:'icon',label:'Icon',value:i}], data => apiPut(`/api/admin/systems/${id}`, data)); }
function editClip(id, ep, t, u) { showEditModal('แก้ไขคลิป', [{name:'ep',label:'Ep',value:ep},{name:'title',label:'ชื่อ',value:t},{name:'video_url',label:'URL',value:u}], data => apiPut(`/api/admin/clips/${id}`, data)); }
function editPrompt(id, t, d) { showEditModal('แก้ไข Prompt', [{name:'title',label:'ชื่อ',value:t},{name:'desc_text',label:'คำสั่ง',value:d,type:'textarea'}], data => apiPut(`/api/admin/prompts/${id}`, data)); }
function editMaterial(id, t, d, i, u) { showEditModal('แก้ไขสื่อ', [{name:'title',label:'ชื่อ',value:t},{name:'desc_text',label:'รายละเอียด',value:d,type:'textarea'},{name:'icon',label:'Icon',value:i},{name:'file_url',label:'ลิงก์',value:u}], data => apiPut(`/api/admin/materials/${id}`, data)); }
function editAnnouncement(id, t) { showEditModal('แก้ไขข่าว', [{name:'text',label:'ข้อความ',value:t,type:'textarea'}], data => apiPut(`/api/admin/announcements/${id}`, data)); }

// ========== FILE UPLOAD ==========
async function uploadFile(input) {
    const file = input.files[0];
    if (!file) return;
    document.getElementById('upload-status').textContent = `กำลังอัปโหลด: ${file.name}...`;
    const fd = new FormData();
    fd.append('file', file);
    try {
        const res = await fetch('/api/admin/upload', { method: 'POST', headers: { 'x-admin-token': TOKEN }, body: fd });
        const data = await res.json();
        if (data.success) {
            document.getElementById('mat-url').value = data.url;
            document.getElementById('upload-status').innerHTML = `<span style="color:#10b981;">✅ อัปโหลดสำเร็จ: ${data.filename}</span>`;
        } else { document.getElementById('upload-status').textContent = '❌ อัปโหลดไม่สำเร็จ'; }
    } catch (e) { document.getElementById('upload-status').textContent = '❌ เกิดข้อผิดพลาด'; }
}

// ========== CLASSROOMS ==========
async function loadClassrooms() {
    try {
        const r = await (await fetch('/api/classrooms')).json();
        // Classroom list with QR
        document.getElementById('classrooms-list').innerHTML = r.map(c =>
            `<div class="glass-card" style="margin-top:12px;display:flex;justify-content:space-between;align-items:center;">
                <div>
                    <strong>${c.name}</strong> <span style="color:var(--text-muted);">(${c.grade||'-'})</span>
                    ${c.qr_code ? `<br><img src="${c.qr_code}" class="qr-img" alt="QR">` : ''}
                    <br><a href="attendance.html?class=${c.id}" target="_blank" style="color:var(--primary);font-size:0.85rem;">เปิดหน้าเช็คชื่อ</a>
                </div>
                <button class="btn-delete" onclick="apiDelete('classrooms',${c.id})"><i class="fa-solid fa-trash"></i></button>
            </div>`).join('');
        // Update select dropdowns
        const opts = r.map(c => `<option value="${c.id}">${c.name}</option>`).join('');
        document.getElementById('stu-class').innerHTML = '<option value="">เลือก</option>' + opts;
        document.getElementById('att-class').innerHTML = '<option value="">เลือกห้อง</option>' + opts;
    } catch (e) {}
}

// ========== ATTENDANCE ==========
async function loadAttendance() {
    const classId = document.getElementById('att-class').value;
    const date = document.getElementById('att-date').value;
    if (!classId) return;
    try {
        const r = await (await fetch(`/api/attendance?class_id=${classId}&date=${date}`)).json();
        document.getElementById('table-attendance').innerHTML = r.length === 0
            ? '<tr><td colspan="4" style="text-align:center;color:var(--text-muted);">ไม่มีข้อมูล</td></tr>'
            : r.map(a => {
                const statusMap = { present: '✅ มาเรียน', late: '⏰ มาสาย', absent: '❌ ขาด' };
                const time = new Date(a.check_in).toLocaleTimeString('th-TH');
                return `<tr><td>${a.student_name}</td><td>${a.sid||'-'}</td><td>${statusMap[a.status]||a.status}</td><td>${time}</td></tr>`;
            }).join('');
    } catch (e) {}
}

// ========== QUIZ BUILDER ==========
function addQuestionField() {
    questionCounter++;
    const div = document.createElement('div');
    div.className = 'glass-card';
    div.style.marginBottom = '12px';
    div.style.padding = '16px';
    div.innerHTML = `
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">
            <strong style="color:var(--primary);">ข้อ ${questionCounter}</strong>
            <button type="button" class="btn-delete" onclick="this.parentElement.parentElement.remove()"><i class="fa-solid fa-xmark"></i></button>
        </div>
        <div class="form-group"><label>คำถาม</label><input type="text" class="glass-input q-question" required></div>
        <div class="form-row">
            <div class="form-group"><label>ก.</label><input type="text" class="glass-input q-a" required></div>
            <div class="form-group"><label>ข.</label><input type="text" class="glass-input q-b" required></div>
        </div>
        <div class="form-row">
            <div class="form-group"><label>ค.</label><input type="text" class="glass-input q-c" required></div>
            <div class="form-group"><label>ง.</label><input type="text" class="glass-input q-d" required></div>
        </div>
        <div class="form-group"><label>เฉลย (a/b/c/d)</label>
            <select class="glass-input q-answer"><option value="a">ก</option><option value="b">ข</option><option value="c">ค</option><option value="d">ง</option></select>
        </div>`;
    document.getElementById('questions-builder').appendChild(div);
}

async function loadQuizList() {
    try {
        const r = await (await fetch('/api/quizzes')).json();
        document.getElementById('quiz-list-admin').innerHTML = r.length === 0
            ? '<p style="color:var(--text-muted);text-align:center;padding:20px;">ยังไม่มีแบบทดสอบ</p>'
            : r.map(q => `
                <div class="glass-card" style="margin-top:12px;display:flex;justify-content:space-between;align-items:center;">
                    <div>
                        <strong>${q.title}</strong>
                        <span style="color:var(--text-muted);font-size:0.85rem;margin-left:8px;">(${q.time_limit} นาที)</span>
                        <br><a href="quiz.html" target="_blank" style="color:var(--primary);font-size:0.85rem;">เปิดหน้าทำแบบทดสอบ</a>
                        <button class="btn-outline" style="font-size:0.75rem;padding:2px 8px;margin-left:8px;" onclick="viewResults(${q.id},'${esc(q.title)}')">ดูผลสอบ</button>
                    </div>
                    <button class="btn-delete" onclick="apiDelete('quizzes',${q.id})"><i class="fa-solid fa-trash"></i></button>
                </div>`).join('');
    } catch (e) {}
}

async function viewResults(quizId, title) {
    try {
        const r = await fetch(`/api/admin/quiz-results/${quizId}`, { headers: { 'x-admin-token': TOKEN } });
        const results = await r.json();
        let modal = document.getElementById('edit-modal');
        if (!modal) { modal = document.createElement('div'); modal.id = 'edit-modal'; modal.className = 'edit-overlay'; document.body.appendChild(modal); }
        modal.innerHTML = `<div class="edit-box glass-card" style="max-width:700px;">
            <h3 style="margin-bottom:16px;color:#f59e0b;">ผลสอบ: ${title}</h3>
            ${results.length === 0 ? '<p style="color:var(--text-muted);">ยังไม่มีคนทำ</p>' :
            `<table class="data-table"><thead><tr><th>ชื่อ</th><th>คะแนน</th><th>เวลา</th><th></th></tr></thead><tbody>
            ${results.map(r => `<tr><td>${r.student_name}</td><td>${r.score}/${r.total} (${r.total>0?Math.round(r.score/r.total*100):0}%)</td><td>${new Date(r.submitted_at).toLocaleString('th-TH')}</td>
            <td><button class="btn-edit" onclick="viewDetailedResult(${r.id})">ดูรายข้อ</button></td></tr>`).join('')}
            </tbody></table>
            <button class="btn-outline" style="margin-top:12px;" onclick="exportQuizCSV(${quizId})"><i class="fa-solid fa-file-csv"></i> Export CSV</button>`}
            <button class="btn-outline btn-full" style="margin-top:16px;" onclick="closeEditModal()">ปิด</button></div>`;
        modal.style.display = 'flex';
    } catch (e) { console.error(e); }
}

// ========== FORM SUBMISSIONS ==========
document.getElementById('form-system').addEventListener('submit', async (e) => {
    e.preventDefault();
    await apiPost('/api/admin/systems', { ep: document.getElementById('sys-ep').value, title: document.getElementById('sys-title').value, desc_text: document.getElementById('sys-desc').value, icon: document.getElementById('sys-icon').value });
    e.target.reset(); document.getElementById('sys-icon').value='fa-laptop-code'; loadAllTables(); loadDashboard();
});
document.getElementById('form-clip').addEventListener('submit', async (e) => {
    e.preventDefault();
    await apiPost('/api/admin/clips', { ep: document.getElementById('clip-ep').value, title: document.getElementById('clip-title').value, video_url: document.getElementById('clip-url').value });
    e.target.reset(); loadAllTables(); loadDashboard();
});
document.getElementById('form-prompt').addEventListener('submit', async (e) => {
    e.preventDefault();
    await apiPost('/api/admin/prompts', { title: document.getElementById('prompt-title').value, desc_text: document.getElementById('prompt-desc').value });
    e.target.reset(); loadAllTables(); loadDashboard();
});
document.getElementById('form-material').addEventListener('submit', async (e) => {
    e.preventDefault();
    await apiPost('/api/admin/materials', { title: document.getElementById('mat-title').value, desc_text: document.getElementById('mat-desc').value, icon: document.getElementById('mat-icon').value, file_url: document.getElementById('mat-url').value || '#' });
    e.target.reset(); document.getElementById('mat-icon').value='fa-file-pdf'; document.getElementById('upload-status').textContent='คลิกเพื่อเลือกไฟล์'; loadAllTables(); loadDashboard();
});
document.getElementById('form-announcement').addEventListener('submit', async (e) => {
    e.preventDefault();
    await apiPost('/api/admin/announcements', { text: document.getElementById('ann-text').value });
    e.target.reset(); loadAllTables(); loadDashboard();
});
document.getElementById('form-classroom').addEventListener('submit', async (e) => {
    e.preventDefault();
    await apiPost('/api/admin/classrooms', { name: document.getElementById('class-name').value, grade: document.getElementById('class-grade').value });
    e.target.reset(); loadClassrooms(); loadDashboard();
});
document.getElementById('form-student').addEventListener('submit', async (e) => {
    e.preventDefault();
    await apiPost('/api/admin/students', { student_id: document.getElementById('stu-id').value, name: document.getElementById('stu-name').value, classroom_id: document.getElementById('stu-class').value });
    e.target.reset(); loadStudentsTable();
});
document.getElementById('form-quiz').addEventListener('submit', async (e) => {
    e.preventDefault();
    const questions = [];
    document.querySelectorAll('#questions-builder .glass-card').forEach(card => {
        questions.push({
            question: card.querySelector('.q-question').value,
            choice_a: card.querySelector('.q-a').value,
            choice_b: card.querySelector('.q-b').value,
            choice_c: card.querySelector('.q-c').value,
            choice_d: card.querySelector('.q-d').value,
            correct_answer: card.querySelector('.q-answer').value
        });
    });
    if (questions.length === 0) { alert('กรุณาเพิ่มคำถามอย่างน้อย 1 ข้อ'); return; }
    await apiPost('/api/admin/quizzes', { title: document.getElementById('quiz-title').value, description: document.getElementById('quiz-desc').value, time_limit: parseInt(document.getElementById('quiz-time').value), questions });
    e.target.reset(); document.getElementById('questions-builder').innerHTML = '<h4 style="margin:16px 0 8px;color:var(--text-muted);">คำถาม</h4>'; questionCounter = 0;
    loadQuizList(); loadDashboard();
});

// Change Password
document.getElementById('form-change-password').addEventListener('submit', async (e) => {
    e.preventDefault();
    const errEl = document.getElementById('pass-error');
    const newPass = document.getElementById('new-pass').value;
    const confirmPass = document.getElementById('confirm-pass').value;
    if (newPass !== confirmPass) { errEl.textContent = 'รหัสใหม่ไม่ตรงกัน'; errEl.style.display = 'block'; return; }
    const res = await fetch('/api/admin/change-password', {
        method: 'PUT', headers: { 'Content-Type': 'application/json', 'x-admin-token': TOKEN },
        body: JSON.stringify({ oldPassword: document.getElementById('old-pass').value, newPassword: newPass })
    });
    const data = await res.json();
    if (data.success) { alert('เปลี่ยนรหัสสำเร็จ!'); e.target.reset(); errEl.style.display = 'none'; }
    else { errEl.textContent = data.error || 'เกิดข้อผิดพลาด'; errEl.style.display = 'block'; }
});

// ========== STUDENT COUNT ==========
async function loadStudentCount() {
    try {
        const res = await fetch('/api/students');
        const students = await res.json();
        const el = document.getElementById('d-students');
        if (el) el.textContent = students.length;
    } catch (e) {}
}

// ========== ANALYTICS ==========
var attChart = null, quizChart = null;
async function loadAnalytics() {
    try {
        const res = await fetch('/api/admin/analytics', { headers: { 'x-admin-token': TOKEN } });
        const data = await res.json();
        document.getElementById('a-students').textContent = data.totalStudents || 0;
        document.getElementById('a-attempts').textContent = data.totalQuizAttempts || 0;

        // Attendance Chart
        const attCtx = document.getElementById('chart-attendance')?.getContext('2d');
        if (attCtx) {
            if (attChart) attChart.destroy();
            attChart = new Chart(attCtx, {
                type: 'line',
                data: {
                    labels: data.weeklyAttendance.map(d => new Date(d.date).toLocaleDateString('th-TH', {day:'numeric',month:'short'})),
                    datasets: [{ label: 'เช็คชื่อ', data: data.weeklyAttendance.map(d => d.count),
                        borderColor: '#10b981', backgroundColor: 'rgba(16,185,129,0.1)', fill: true, tension: 0.4 }]
                },
                options: { responsive: true, plugins: { legend: { labels: { color: '#fff' } } },
                    scales: { x: { ticks: { color: '#888' } }, y: { ticks: { color: '#888' }, beginAtZero: true } } }
            });
        }

        // Quiz Score Chart
        const qCtx = document.getElementById('chart-quiz')?.getContext('2d');
        if (qCtx) {
            if (quizChart) quizChart.destroy();
            quizChart = new Chart(qCtx, {
                type: 'bar',
                data: {
                    labels: data.quizScores.map(q => q.title.substring(0,20)),
                    datasets: [{ label: 'คะแนนเฉลี่ย (%)', data: data.quizScores.map(q => q.avg_score),
                        backgroundColor: ['#f59e0b','#ec4899','#8b5cf6','#10b981','#3b82f6'], borderRadius: 6 }]
                },
                options: { responsive: true, plugins: { legend: { labels: { color: '#fff' } } },
                    scales: { x: { ticks: { color: '#888' } }, y: { ticks: { color: '#888' }, beginAtZero: true, max: 100 } } }
            });
        }
    } catch (e) { console.error('Analytics error:', e); }
}

// ========== EXPORT CSV ==========
function exportAttendanceCSV() {
    const classId = document.getElementById('att-class').value;
    const date = document.getElementById('att-date').value;
    const params = new URLSearchParams();
    if (classId) params.set('class_id', classId);
    if (date) params.set('date', date);
    window.open(`/api/admin/export/attendance?${params.toString()}&token=${TOKEN}`, '_blank');
}

function exportQuizCSV(quizId) {
    window.open(`/api/admin/export/quiz-results/${quizId}?token=${TOKEN}`, '_blank');
}

// ========== AI QUIZ GENERATION ==========
async function generateAIQuiz() {
    const topic = document.getElementById('ai-topic').value.trim();
    const count = parseInt(document.getElementById('ai-count').value) || 5;
    if (!topic) { alert('กรุณาใส่หัวข้อ'); return; }
    const btn = document.getElementById('btn-ai-gen');
    btn.disabled = true; btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> กำลังสร้าง...';
    try {
        const res = await fetch('/api/ai/generate-quiz', {
            method: 'POST', headers: { 'Content-Type': 'application/json', 'x-admin-token': TOKEN },
            body: JSON.stringify({ topic, count })
        });
        const data = await res.json();
        if (data.questions && data.questions.length > 0) {
            document.getElementById('questions-builder').innerHTML = '<h4 style="margin:16px 0 8px;color:var(--text-muted);">คำถาม (สร้างโดย AI)</h4>';
            questionCounter = 0;
            data.questions.forEach(q => {
                addQuestionField();
                const cards = document.querySelectorAll('#questions-builder .glass-card');
                const last = cards[cards.length - 1];
                if (last) {
                    last.querySelector('.q-question').value = q.question || '';
                    last.querySelector('.q-a').value = q.choice_a || '';
                    last.querySelector('.q-b').value = q.choice_b || '';
                    last.querySelector('.q-c').value = q.choice_c || '';
                    last.querySelector('.q-d').value = q.choice_d || '';
                    last.querySelector('.q-answer').value = q.correct_answer || 'a';
                }
            });
            document.getElementById('quiz-title').value = topic;
            alert(`สร้างข้อสอบ ${data.questions.length} ข้อสำเร็จ!`);
        } else { alert('ไม่สามารถสร้างข้อสอบได้ ลองเปลี่ยนหัวข้อ'); }
    } catch (e) { console.error(e); alert('เกิดข้อผิดพลาดในการเชื่อมต่อ AI'); }
    btn.disabled = false; btn.innerHTML = '<i class="fa-solid fa-wand-magic-sparkles"></i> สร้างข้อสอบ AI';
}

// ========== DETAILED QUIZ RESULT ==========
async function viewDetailedResult(resultId) {
    try {
        const res = await fetch(`/api/admin/quiz-result-detail/${resultId}`, { headers: { 'x-admin-token': TOKEN } });
        const data = await res.json();
        let modal = document.getElementById('edit-modal');
        if (!modal) { modal = document.createElement('div'); modal.id = 'edit-modal'; modal.className = 'edit-overlay'; document.body.appendChild(modal); }
        const choiceLabels = {a:'ก',b:'ข',c:'ค',d:'ง'};
        modal.innerHTML = `<div class="edit-box glass-card" style="max-width:700px;">
            <h3 style="margin-bottom:8px;">📋 ${data.student_name} — ${data.score}/${data.total} คะแนน</h3>
            <div style="font-size:0.9rem;">
            ${data.detail.map((q,i) => `
                <div style="padding:12px 0;border-bottom:1px solid var(--glass-border);">
                    <div><strong>ข้อ ${i+1}:</strong> ${q.question}</div>
                    <div style="margin-top:6px;display:flex;gap:6px;align-items:center;">
                        <span style="color:${q.is_correct?'#10b981':'#ef4444'};font-weight:600;">
                            ${q.is_correct?'✅ ถูก':'❌ ผิด'}
                        </span>
                        <span style="color:var(--text-muted);">ตอบ: ${choiceLabels[q.answered]||q.answered}</span>
                        ${!q.is_correct ? `<span style="color:#10b981;"> · เฉลย: ${choiceLabels[q.correct]||q.correct}</span>` : ''}
                    </div>
                </div>
            `).join('')}
            </div>
            <button class="btn-outline btn-full" style="margin-top:16px;" onclick="closeEditModal()">ปิด</button></div>`;
        modal.style.display = 'flex';
    } catch (e) { console.error(e); }
}

// ========== API KEY MANAGEMENT ==========
async function loadApiKeyStatus() {
    try {
        const res = await fetch('/api/admin/api-key', { headers: { 'x-admin-token': TOKEN } });
        const data = await res.json();
        const el = document.getElementById('api-key-status');
        if (data.hasKey) {
            el.innerHTML = `<span style="color:#10b981;">✅ มี API Key:</span> <code>${data.key}</code>`;
        } else {
            el.innerHTML = '<span style="color:#ef4444;">❌ ยังไม่มี API Key</span>';
        }
    } catch (e) { console.error(e); }
}

async function saveApiKey() {
    const key = document.getElementById('api-key-input').value.trim();
    if (!key) { showApiResult(false, 'กรุณาใส่ API Key'); return; }
    try {
        const res = await fetch('/api/admin/api-key', {
            method: 'PUT', headers: { 'Content-Type': 'application/json', 'x-admin-token': TOKEN },
            body: JSON.stringify({ key })
        });
        const data = await res.json();
        if (data.success) {
            showApiResult(true, '✅ บันทึกสำเร็จ!');
            document.getElementById('api-key-input').value = '';
            loadApiKeyStatus();
        } else {
            showApiResult(false, data.error || 'เกิดข้อผิดพลาด');
        }
    } catch (e) { showApiResult(false, 'เกิดข้อผิดพลาด'); }
}

async function testApiKey() {
    const key = document.getElementById('api-key-input').value.trim();
    showApiResult(null, '⏳ กำลังทดสอบ...');
    try {
        const res = await fetch('/api/admin/api-key/test', {
            method: 'POST', headers: { 'Content-Type': 'application/json', 'x-admin-token': TOKEN },
            body: JSON.stringify({ key: key || undefined })
        });
        const data = await res.json();
        if (data.success) {
            showApiResult(true, `✅ ${data.message} — AI ตอบ: "${data.response}"`);
        } else {
            showApiResult(false, `❌ ${data.message}${data.detail ? ' — ' + data.detail : ''}`);
        }
    } catch (e) { showApiResult(false, '❌ เชื่อมต่อไม่ได้'); }
}

async function deleteApiKey() {
    if (!confirm('ยืนยันลบ API Key?')) return;
    try {
        await fetch('/api/admin/api-key', { method: 'DELETE', headers: { 'x-admin-token': TOKEN } });
        showApiResult(true, '🗑️ ลบ API Key แล้ว');
        loadApiKeyStatus();
    } catch (e) { showApiResult(false, 'เกิดข้อผิดพลาด'); }
}

function toggleKeyVisibility() {
    const input = document.getElementById('api-key-input');
    const icon = document.getElementById('eye-icon');
    if (input.type === 'password') {
        input.type = 'text'; icon.className = 'fa-solid fa-eye-slash';
    } else {
        input.type = 'password'; icon.className = 'fa-solid fa-eye';
    }
}

function showApiResult(success, msg) {
    const el = document.getElementById('api-key-result');
    el.style.display = 'block';
    el.style.background = success === true ? 'rgba(16,185,129,0.15)' : success === false ? 'rgba(239,68,68,0.15)' : 'rgba(59,130,246,0.15)';
    el.style.color = success === true ? '#10b981' : success === false ? '#ef4444' : '#3b82f6';
    el.textContent = msg;
}

// ===================== PHASE 5: ANALYTICS =====================

let chartInstances = {};

async function loadAnalytics() {
    try {
        const res = await fetch('/api/admin/analytics', { headers: { 'x-admin-token': TOKEN } });
        const data = await res.json();
        document.getElementById('a-students').textContent = data.total_students;
        document.getElementById('a-attempts').textContent = data.total_attempts;

        // Destroy existing charts
        Object.values(chartInstances).forEach(c => c.destroy && c.destroy());

        // Attendance chart
        const attCtx = document.getElementById('chart-attendance').getContext('2d');
        chartInstances.att = new Chart(attCtx, {
            type: 'bar',
            data: {
                labels: data.weeklyAtt.map(d => new Date(d.d).toLocaleDateString('th-TH', {weekday:'short',day:'numeric'})),
                datasets: [
                    { label: 'มาเรียน', data: data.weeklyAtt.map(d => d.present_count), backgroundColor: '#10b981' },
                    { label: 'สาย', data: data.weeklyAtt.map(d => d.late_count), backgroundColor: '#f59e0b' },
                    { label: 'ขาด', data: data.weeklyAtt.map(d => d.absent_count), backgroundColor: '#ef4444' }
                ]
            },
            options: { responsive: true, scales: { x: { stacked: true }, y: { stacked: true, beginAtZero: true } }, plugins: { legend: { labels: { color: '#a0aec0' } } } }
        });

        // Quiz averages chart
        const quizCtx = document.getElementById('chart-quiz').getContext('2d');
        chartInstances.quiz = new Chart(quizCtx, {
            type: 'bar',
            data: {
                labels: data.quizAvg.map(q => q.title.length > 15 ? q.title.substring(0,15)+'...' : q.title),
                datasets: [{ label: 'คะแนนเฉลี่ย (%)', data: data.quizAvg.map(q => q.avg_score), backgroundColor: 'rgba(99,102,241,0.7)', borderColor: '#6366f1', borderWidth: 1 }]
            },
            options: { responsive: true, scales: { y: { beginAtZero: true, max: 100 } }, plugins: { legend: { labels: { color: '#a0aec0' } } } }
        });

        // EXP leaderboard chart
        const expCtx = document.getElementById('chart-exp').getContext('2d');
        chartInstances.exp = new Chart(expCtx, {
            type: 'bar',
            data: {
                labels: data.expDist.map(e => e.name),
                datasets: [{ label: 'EXP', data: data.expDist.map(e => e.exp), backgroundColor: 'rgba(168,85,247,0.7)', borderColor: '#a855f7', borderWidth: 1 }]
            },
            options: { indexAxis: 'y', responsive: true, plugins: { legend: { labels: { color: '#a0aec0' } } } }
        });

        // Recent activity
        const actEl = document.getElementById('recent-activity');
        actEl.innerHTML = data.recentAct.length ?
            data.recentAct.map(a => `<div style="padding:8px 0;border-bottom:1px solid var(--glass-border);font-size:0.85rem;">
                <span style="color:${a.type==='quiz'?'#f59e0b':'#10b981'};">${a.type==='quiz'?'📝':'✅'}</span> ${a.text}
                <span style="float:right;color:var(--text-muted);font-size:0.75rem;">${new Date(a.ts).toLocaleString('th-TH')}</span>
            </div>`).join('') :
            '<p style="color:var(--text-muted);text-align:center;padding:20px;">ยังไม่มีกิจกรรม</p>';
    } catch (e) { console.error('Analytics error:', e); }
}

// ===================== PHASE 5: AI QUIZ GENERATOR =====================

async function generateAIQuiz() {
    const topic = document.getElementById('ai-topic').value.trim();
    const count = parseInt(document.getElementById('ai-count').value) || 5;
    const difficulty = document.getElementById('ai-difficulty')?.value || 'ปานกลาง';
    if (!topic) { alert('กรุณาใส่หัวข้อ'); return; }
    const btn = document.getElementById('btn-ai-gen');
    btn.disabled = true;
    btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> AI กำลังสร้างข้อสอบ...';
    try {
        const res = await fetch('/api/admin/generate-quiz', {
            method: 'POST', headers: { 'Content-Type': 'application/json', 'x-admin-token': TOKEN },
            body: JSON.stringify({ topic, count, difficulty })
        });
        const data = await res.json();
        if (data.success) {
            alert(`✅ สร้างแบบทดสอบ ${data.questions} ข้อ สำเร็จ! (ID: ${data.quiz_id})`);
            loadQuizList();
        } else {
            alert('❌ ' + (data.error || 'ไม่สามารถสร้างได้'));
        }
    } catch (e) { alert('เกิดข้อผิดพลาด'); }
    btn.disabled = false;
    btn.innerHTML = '<i class="fa-solid fa-wand-magic-sparkles"></i> สร้างข้อสอบ AI';
}

// ===================== PHASE 5: EXCEL EXPORT =====================

async function exportExcel(type) {
    try {
        const res = await fetch(`/api/admin/export/${type}`, { headers: { 'x-admin-token': TOKEN } });
        const data = await res.json();
        if (!data.length) { alert('ไม่มีข้อมูล'); return; }
        const ws = XLSX.utils.json_to_sheet(data);
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, type);
        XLSX.writeFile(wb, `krupug_${type}_${new Date().toISOString().split('T')[0]}.xlsx`);
        showToast('📥 ดาวน์โหลด Excel สำเร็จ!');
    } catch (e) { alert('เกิดข้อผิดพลาด'); console.error(e); }
}

// ===================== PHASE 5: CLASS GOALS =====================

async function saveGoal() {
    const classroom_id = document.getElementById('goal-classroom').value;
    const target_avg = document.getElementById('goal-target').value;
    const description = document.getElementById('goal-desc').value;
    if (!classroom_id || !target_avg) { alert('กรุณาเลือกห้องและใส่เป้า %'); return; }
    try {
        await apiPost('/api/admin/goals', { classroom_id, target_avg, description });
        showToast('✅ บันทึกเป้าหมายสำเร็จ!');
        loadGoals();
    } catch (e) { alert('เกิดข้อผิดพลาด'); }
}

async function loadGoals() {
    try {
        const res = await fetch('/api/admin/goals', { headers: { 'x-admin-token': TOKEN } });
        const goals = await res.json();
        const el = document.getElementById('goals-list');
        el.innerHTML = goals.length ? goals.map(g => {
            const pct = g.current_avg || 0;
            const target = g.target_avg;
            const progress = Math.min(100, (pct / target) * 100);
            const color = progress >= 100 ? '#10b981' : progress >= 70 ? '#f59e0b' : '#ef4444';
            return `<div class="glass-card" style="margin:8px 0;padding:16px;">
                <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">
                    <strong>${g.classroom_name}</strong>
                    <span style="color:${color};font-weight:700;">${pct||0}% / ${target}%</span>
                </div>
                <div style="background:rgba(255,255,255,0.1);border-radius:8px;height:12px;overflow:hidden;">
                    <div style="background:${color};height:100%;width:${progress}%;border-radius:8px;transition:width 0.5s;"></div>
                </div>
                ${g.description ? `<p style="color:var(--text-muted);font-size:0.8rem;margin-top:4px;">${g.description}</p>` : ''}
            </div>`;
        }).join('') : '<p style="color:var(--text-muted);text-align:center;">ยังไม่มีเป้าหมาย</p>';
    } catch (e) { console.error(e); }
}

// ===================== PHASE 5: TEACHER MANAGEMENT =====================

document.getElementById('form-teacher')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const name = document.getElementById('tc-name').value.trim();
    const email = document.getElementById('tc-email').value.trim();
    const password = document.getElementById('tc-pass').value.trim();
    const role = document.getElementById('tc-role').value;
    if (!name || !email) return;
    try {
        await apiPost('/api/admin/teachers', { name, email, password, role });
        showToast('✅ เพิ่มครูสำเร็จ!');
        document.getElementById('form-teacher').reset();
        document.getElementById('tc-pass').value = '1234';
        loadTeachers();
    } catch (e) { alert('เกิดข้อผิดพลาด'); }
});

async function loadTeachers() {
    try {
        const res = await fetch('/api/admin/teachers', { headers: { 'x-admin-token': TOKEN } });
        const teachers = await res.json();
        document.getElementById('table-teachers').innerHTML = teachers.length ?
            teachers.map(t => `<tr><td>${t.id}</td><td>${t.name}</td><td>${t.email}</td><td>${t.role}</td>
                <td><button class="btn-delete" onclick="deleteTeacher(${t.id})"><i class="fa-solid fa-trash"></i></button></td></tr>`).join('') :
            '<tr><td colspan="5" style="color:var(--text-muted);">ยังไม่มีครู</td></tr>';
    } catch (e) { console.error(e); }
}

async function deleteTeacher(id) {
    if (!confirm('ยืนยันลบครู?')) return;
    await fetch(`/api/admin/teachers/${id}`, { method: 'DELETE', headers: { 'x-admin-token': TOKEN } });
    loadTeachers();
}

// ===================== PHASE 5: NOTIFICATIONS =====================

async function sendNotification() {
    const title = document.getElementById('noti-title').value.trim();
    const message = document.getElementById('noti-msg').value.trim();
    const type = document.getElementById('noti-type').value;
    const classroom_id = document.getElementById('noti-class').value || null;
    if (!title) { alert('กรุณาใส่หัวข้อ'); return; }
    try {
        await apiPost('/api/admin/notify', { title, message, type, classroom_id });
        showToast('🔔 ส่งแจ้งเตือนสำเร็จ!');
        document.getElementById('noti-title').value = '';
        document.getElementById('noti-msg').value = '';
    } catch (e) { alert('เกิดข้อผิดพลาด'); }
}

// ===================== PHASE 5: PARENT CODE =====================

async function generateParentCode() {
    const select = document.getElementById('parent-student');
    const student_id = select.value;
    if (!student_id) { alert('กรุณาเลือกนักเรียน'); return; }
    try {
        const res = await fetch('/api/admin/parent-code', {
            method: 'POST', headers: { 'Content-Type': 'application/json', 'x-admin-token': TOKEN },
            body: JSON.stringify({ student_id, parent_name: 'ผู้ปกครอง' })
        });
        const data = await res.json();
        if (data.success) {
            const el = document.getElementById('parent-code-result');
            el.style.display = 'block';
            el.innerHTML = `<div style="padding:12px;background:rgba(16,185,129,0.1);border:1px solid rgba(16,185,129,0.3);border-radius:8px;">
                <p>✅ รหัสผู้ปกครอง: <strong style="font-size:1.3rem;color:#10b981;">${data.code}</strong></p>
                <p style="color:var(--text-muted);font-size:0.8rem;margin-top:4px;">ให้ผู้ปกครองใช้รหัสนี้ที่หน้า parent.html</p>
            </div>`;
        }
    } catch (e) { alert('เกิดข้อผิดพลาด'); }
}

function showToast(msg) {
    const toast = document.createElement('div');
    toast.className = 'toast-msg';
    toast.textContent = msg;
    document.body.appendChild(toast);
    setTimeout(() => toast.remove(), 2500);
}

// Updated switchTab to load new panels
const origSwitchTab = switchTab;
switchTab = function(tabId, btn) {
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.admin-panel').forEach(p => p.classList.remove('active'));
    btn.classList.add('active');
    document.getElementById('panel-' + tabId).classList.add('active');
    if (tabId === 'analytics') loadAnalytics();
    if (tabId === 'goals') { loadGoals(); populateGoalClassrooms(); }
    if (tabId === 'teachers') loadTeachers();
    if (tabId === 'notify') populateNotiClassrooms();
};

async function populateGoalClassrooms() {
    try {
        const res = await fetch('/api/classrooms');
        const data = await res.json();
        const sel = document.getElementById('goal-classroom');
        sel.innerHTML = '<option value="">เลือกห้อง</option>' + data.map(c => `<option value="${c.id}">${c.name}</option>`).join('');
    } catch (e) {}
}

async function populateNotiClassrooms() {
    try {
        const res = await fetch('/api/classrooms');
        const data = await res.json();
        const sel = document.getElementById('noti-class');
        sel.innerHTML = '<option value="">ทุกห้อง</option>' + data.map(c => `<option value="${c.id}">${c.name}</option>`).join('');
    } catch (e) {}
}

// Populate parent student dropdown
async function populateParentStudents() {
    try {
        const res = await fetch('/api/admin/students', { headers: { 'x-admin-token': TOKEN } });
        const data = await res.json();
        const sel = document.getElementById('parent-student');
        if (sel) sel.innerHTML = '<option value="">เลือกนักเรียน</option>' + data.map(s => `<option value="${s.id}">${s.student_id||''} — ${s.name}</option>`).join('');
    } catch (e) {}
}

// Auto-load parent students list
setTimeout(populateParentStudents, 1500);

// ===================== PHASE 6: TELEGRAM BOT =====================

async function loadTelegramStatus() {
    try {
        const res = await fetch('/api/admin/telegram', { headers: { 'x-admin-token': TOKEN } });
        const data = await res.json();
        const el = document.getElementById('tg-status');
        if (el) el.innerHTML = data.hasToken ? `<span style="color:#0088cc;">✅ Bot: ${data.bot_token} | Chat: ${data.chat_id}</span>` : '<span style="color:#ef4444;">❌ ยังไม่ได้ตั้งค่า</span>';
    } catch(e) {}
}

async function saveTelegram() {
    const bot_token = document.getElementById('tg-bot-token').value.trim();
    const chat_id = document.getElementById('tg-chat-id').value.trim();
    if (!bot_token || !chat_id) return alert('กรุณาใส่ Bot Token และ Chat ID');
    const res = await apiPost('/api/admin/telegram', { bot_token, chat_id });
    if (res.success) { alert('บันทึก Telegram สำเร็จ!'); loadTelegramStatus(); document.getElementById('tg-bot-token').value = ''; document.getElementById('tg-chat-id').value = ''; }
    else alert(res.error || 'เกิดข้อผิดพลาด');
}

async function testTelegram() {
    const bot_token = document.getElementById('tg-bot-token').value.trim();
    const chat_id = document.getElementById('tg-chat-id').value.trim();
    const el = document.getElementById('tg-result');
    el.style.display = 'block';
    el.innerHTML = '⏳ กำลังทดสอบ...';
    const res = await apiPost('/api/admin/telegram/test', { bot_token: bot_token || undefined, chat_id: chat_id || undefined });
    el.style.background = res.success ? 'rgba(0,136,204,0.15)' : 'rgba(239,68,68,0.15)';
    el.innerHTML = res.success ? `✅ ${res.message}` : `❌ ${res.message || res.error}`;
}

// ===================== LINE NOTIFY =====================

async function loadLineStatus() {
    try {
        const res = await fetch('/api/admin/line-notify/status', { headers: { 'x-admin-token': TOKEN } });
        const data = await res.json();
        const el = document.getElementById('line-status');
        if (el) el.innerHTML = data.hasToken ? `<span style="color:#06c755;">✅ Token ตั้งค่าแล้ว (${data.token_preview})</span>` : '<span style="color:#ef4444;">❌ ยังไม่ได้ตั้งค่า</span>';
    } catch(e) {}
}

async function saveLineNotify() {
    const token = document.getElementById('line-token-input').value.trim();
    if (!token) return alert('กรุณาใส่ LINE Notify Token');
    const res = await apiPost('/api/admin/line-notify/save', { token });
    if (res.success) { alert('บันทึก LINE Notify Token สำเร็จ!'); loadLineStatus(); document.getElementById('line-token-input').value = ''; }
    else alert(res.error || 'เกิดข้อผิดพลาด');
}

async function testLineNotify() {
    const el = document.getElementById('line-result');
    el.style.display = 'block';
    el.innerHTML = '⏳ กำลังส่งข้อความทดสอบ...';
    const res = await apiPost('/api/admin/line-notify/test', {});
    el.style.background = res.success ? 'rgba(6,199,85,0.15)' : 'rgba(239,68,68,0.15)';
    el.innerHTML = res.success ? '✅ ส่งข้อความทดสอบสำเร็จ! ตรวจสอบที่ LINE' : `❌ ${res.error || 'เกิดข้อผิดพลาด'}`;
}

async function sendLineMessage() {
    const msg = document.getElementById('line-msg').value.trim();
    if (!msg) return alert('กรุณาพิมพ์ข้อความ');
    const el = document.getElementById('line-send-result');
    el.style.display = 'block';
    el.innerHTML = '⏳ กำลังส่ง...';
    const res = await apiPost('/api/admin/line-notify', { message: msg });
    el.style.background = res.success ? 'rgba(6,199,85,0.15)' : 'rgba(239,68,68,0.15)';
    el.innerHTML = res.success ? '✅ ส่งข้อความสำเร็จ!' : `❌ ${res.error || 'เกิดข้อผิดพลาด'}`;
    if (res.success) document.getElementById('line-msg').value = '';
}

// ===================== QR CODE GENERATOR =====================

async function generateQRCheckin() {
    const classId = document.getElementById('qr-classroom').value;
    try {
        const res = await fetch(`/api/qr/generate/${classId}`, { headers: { 'x-admin-token': TOKEN } });
        const data = await res.json();
        if (data.success) {
            document.getElementById('qr-result').style.display = 'block';
            document.getElementById('qr-image').src = data.qr;
            document.getElementById('qr-url').textContent = data.url;
        } else alert(data.error);
    } catch(e) { alert('เกิดข้อผิดพลาด'); }
}

// Load LINE status on page load
if (typeof loadLineStatus === 'function') setTimeout(loadLineStatus, 500);

// ===================== ATTENDANCE REPORT =====================

async function loadAttendanceReport() {
    const TOKEN = localStorage.getItem('admin_token');
    try {
        // Load stats
        const statsRes = await fetch('/api/admin/attendance/stats', { headers: { 'Authorization': 'Bearer ' + TOKEN } });
        const stats = await statsRes.json();
        if (stats.success) {
            document.getElementById('att-today').textContent = stats.today;
            document.getElementById('att-week').textContent = stats.week;
            document.getElementById('att-total').textContent = stats.total_students;
            document.getElementById('att-rate').textContent = stats.rate + '%';
        }
        // Load report
        const reportRes = await fetch('/api/admin/attendance/report', { headers: { 'Authorization': 'Bearer ' + TOKEN } });
        const report = await reportRes.json();
        if (report.success && report.data.length) {
            const tbody = document.getElementById('attendance-body');
            tbody.innerHTML = report.data.map(r => `<tr style="border-bottom:1px solid var(--glass-border);">
                <td style="padding:8px;">${r.student_name}</td>
                <td style="padding:8px;text-align:center;">ม.${r.classroom_id}/1</td>
                <td style="padding:8px;text-align:center;">${r.check_date}</td>
                <td style="padding:8px;text-align:center;">${r.check_time}</td>
            </tr>`).join('');
            document.getElementById('attendance-table').style.display = 'block';
        }
    } catch(e) { console.error(e); }
}

// ===================== BROADCAST ALL =====================

async function broadcastAll() {
    const msg = document.getElementById('broadcast-msg').value.trim();
    if (!msg) return alert('กรุณาใส่ข้อความ');
    const TOKEN = localStorage.getItem('admin_token');
    const result = document.getElementById('broadcast-result');
    try {
        const res = await fetch('/api/admin/notify-broadcast', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + TOKEN },
            body: JSON.stringify({ message: msg })
        });
        const data = await res.json();
        result.style.display = 'block';
        result.style.background = data.success ? 'rgba(16,185,129,0.2)' : 'rgba(239,68,68,0.2)';
        result.textContent = data.success ? '✅ ส่ง Broadcast สำเร็จ (LINE + Telegram)' : '❌ ' + (data.error || 'เกิดข้อผิดพลาด');
        if (data.success) document.getElementById('broadcast-msg').value = '';
    } catch(e) { result.style.display='block'; result.style.background='rgba(239,68,68,0.2)'; result.textContent='❌ '+e.message; }
}

// ===================== LINE RICH MENU =====================

async function createRichMenu() {
    const TOKEN = localStorage.getItem('admin_token');
    const result = document.getElementById('richmenu-result');
    try {
        const res = await fetch('/api/admin/line-richmenu', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + TOKEN }
        });
        const data = await res.json();
        result.style.display = 'block';
        result.style.background = data.success ? 'rgba(6,199,85,0.2)' : 'rgba(239,68,68,0.2)';
        result.textContent = data.success ? '✅ ' + data.message : '❌ ' + (data.error || 'เกิดข้อผิดพลาด');
    } catch(e) { result.style.display='block'; result.style.background='rgba(239,68,68,0.2)'; result.textContent='❌ '+e.message; }
}

// ===================== HOMEWORK MANAGER =====================

async function createHomework() {
    const TOKEN = localStorage.getItem('admin_token');
    const title = document.getElementById('hw-title').value.trim();
    const desc = document.getElementById('hw-desc').value.trim();
    const due = document.getElementById('hw-due').value;
    const points = document.getElementById('hw-points').value;
    const result = document.getElementById('hw-result');
    if (!title || !due) return alert('กรุณากรอกชื่อการบ้านและกำหนดส่ง');
    try {
        const res = await fetch('/api/admin/homework', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + TOKEN },
            body: JSON.stringify({ title, description: desc, due_date: due, total_points: parseInt(points) || 10 })
        });
        const data = await res.json();
        result.style.display = 'block';
        result.style.background = 'rgba(168,85,247,0.2)';
        result.textContent = data.success ? '✅ สั่งการบ้าน + ส่งแจ้งเตือนแล้ว!' : '❌ เกิดข้อผิดพลาด';
        if (data.success) { document.getElementById('hw-title').value = ''; document.getElementById('hw-desc').value = ''; }
    } catch(e) { result.style.display='block'; result.style.background='rgba(239,68,68,0.2)'; result.textContent='❌ '+e.message; }
}

// ===================== AI QUIZ GENERATOR =====================

async function generateAIQuiz() {
    const TOKEN = localStorage.getItem('admin_token');
    const topic = document.getElementById('ai-topic').value.trim();
    const level = document.getElementById('ai-level').value;
    const count = document.getElementById('ai-count').value;
    const result = document.getElementById('ai-quiz-result');
    if (!topic) return alert('กรุณาใส่หัวข้อ');
    result.style.display = 'block';
    result.innerHTML = '<div style="text-align:center;padding:20px;"><i class="fa-solid fa-spinner fa-spin" style="font-size:2rem;color:#ec4899;"></i><p>🤖 AI กำลังสร้างข้อสอบ...</p></div>';
    try {
        const res = await fetch('/api/admin/ai-generate-quiz', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + TOKEN },
            body: JSON.stringify({ topic, level: parseInt(level), count: parseInt(count) || 5 })
        });
        const data = await res.json();
        if (data.success && data.questions?.length) {
            result.innerHTML = '<div style="background:rgba(236,72,153,0.15);padding:12px;border-radius:10px;margin-bottom:12px;"><strong>✅ สร้าง ' + data.questions.length + ' ข้อ หัวข้อ "' + data.topic + '" ม.' + data.level + '</strong></div>' +
                data.questions.map(function(q, i) {
                    return '<div style="background:var(--glass-bg);border:1px solid var(--glass-border);border-radius:10px;padding:12px;margin-bottom:8px;font-size:0.85rem;">' +
                        '<strong>ข้อ ' + (i+1) + ':</strong> ' + q.question + '<br>' +
                        '<span style="color:var(--text-muted);">ก.' + q.choice_a + '  ข.' + q.choice_b + '  ค.' + q.choice_c + '  ง.' + q.choice_d + '</span><br>' +
                        '<span style="color:#10b981;">✅ เฉลย: ' + q.correct_answer.toUpperCase() + '</span></div>';
                }).join('');
        } else {
            result.innerHTML = '<div style="background:rgba(239,68,68,0.2);padding:12px;border-radius:8px;">❌ ' + (data.error || 'ไม่สามารถสร้างข้อสอบได้') + '</div>';
        }
    } catch(e) { result.innerHTML = '<div style="background:rgba(239,68,68,0.2);padding:12px;border-radius:8px;">❌ ' + e.message + '</div>'; }
}

// ===================== SCHEDULE NOTIFICATIONS =====================

async function toggleSchedule(enabled) {
    const TOKEN = localStorage.getItem('admin_token');
    const msg = document.getElementById('schedule-msg').value.trim();
    const interval = document.getElementById('schedule-interval').value;
    const result = document.getElementById('schedule-result');
    if (enabled && !msg) return alert('กรุณาใส่ข้อความ');
    try {
        const res = await fetch('/api/admin/schedule-notify', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + TOKEN },
            body: JSON.stringify({ message: msg || 'test', interval_minutes: parseInt(interval), enabled })
        });
        const data = await res.json();
        result.style.display = 'block';
        result.style.background = enabled ? 'rgba(245,158,11,0.2)' : 'rgba(107,114,128,0.2)';
        result.textContent = data.success ? (enabled ? '⏰ ' : '⏹️ ') + data.message : '❌ ' + (data.error || 'เกิดข้อผิดพลาด');
    } catch(e) { result.style.display='block'; result.style.background='rgba(239,68,68,0.2)'; result.textContent='❌ '+e.message; }
}

// ===================== HOMEWORK GRADING =====================

async function loadAdminHomework() {
    const TOKEN = localStorage.getItem('admin_token');
    const list = document.getElementById('admin-hw-list');
    list.innerHTML = '<p style="text-align:center;color:var(--text-muted);">กำลังโหลด...</p>';
    try {
        const res = await fetch('/api/admin/homework', { headers: { 'Authorization': 'Bearer ' + TOKEN } });
        const data = await res.json();
        list.innerHTML = data.map(function(hw) {
            return '<div style="background:var(--glass-bg);border:1px solid var(--glass-border);border-radius:10px;padding:12px;margin-bottom:8px;display:flex;justify-content:space-between;align-items:center;">' +
                '<div><strong>' + hw.title + '</strong><br>' +
                '<span style="font-size:0.8rem;color:var(--text-muted);">📅 ' + hw.due_date + ' | ' + hw.total_points + ' คะแนน</span><br>' +
                '<span style="font-size:0.75rem;color:#f59e0b;">⏳ รอตรวจ: ' + hw.pending_count + '</span> &nbsp;' +
                '<span style="font-size:0.75rem;color:#10b981;">✅ ตรวจแล้ว: ' + hw.graded_count + '</span></div>' +
                '<button class="btn-glow" style="padding:6px 14px;font-size:0.8rem;" onclick="viewSubmissions(' + hw.id + ',\'' + hw.title.replace(/'/g, "\\'") + '\')"><i class="fa-solid fa-eye"></i> ดู</button></div>';
        }).join('') || '<p style="color:var(--text-muted);">ยังไม่มีการบ้าน</p>';
    } catch(e) { list.innerHTML = '<p style="color:#ef4444;">❌ ' + e.message + '</p>'; }
}

async function viewSubmissions(hwId, title) {
    const TOKEN = localStorage.getItem('admin_token');
    const panel = document.getElementById('admin-hw-submissions');
    const titleEl = document.getElementById('admin-hw-sub-title');
    const list = document.getElementById('admin-hw-sub-list');
    panel.style.display = 'block';
    titleEl.textContent = '📋 ผู้ส่ง: ' + title;
    list.innerHTML = '<p style="text-align:center;color:var(--text-muted);">กำลังโหลด...</p>';
    try {
        const res = await fetch('/api/admin/homework/' + hwId + '/submissions', { headers: { 'Authorization': 'Bearer ' + TOKEN } });
        const data = await res.json();
        list.innerHTML = data.map(function(sub) {
            if (sub.status === 'graded') {
                return '<div style="background:rgba(16,185,129,0.1);border:1px solid rgba(16,185,129,0.3);border-radius:8px;padding:10px;margin-bottom:6px;font-size:0.85rem;">' +
                    '<strong>' + sub.student_name + '</strong> (' + sub.student_code + ') — ✅ ' + sub.grade + ' คะแนน</div>';
            }
            return '<div style="background:rgba(245,158,11,0.1);border:1px solid rgba(245,158,11,0.3);border-radius:8px;padding:10px;margin-bottom:6px;font-size:0.85rem;">' +
                '<div style="display:flex;justify-content:space-between;align-items:center;">' +
                '<span><strong>' + sub.student_name + '</strong> (' + sub.student_code + ') — ⏳ รอตรวจ</span>' +
                '<div style="display:flex;gap:6px;align-items:center;">' +
                '<input type="number" class="glass-input" style="width:60px;padding:4px 8px;" id="grade-' + sub.id + '" placeholder="คะแนน" min="0">' +
                '<button class="btn-glow" style="padding:4px 10px;font-size:0.8rem;" onclick="gradeSubmission(' + sub.id + ')">✅</button>' +
                '</div></div></div>';
        }).join('') || '<p style="color:var(--text-muted);">ยังไม่มีคนส่ง</p>';
    } catch(e) { list.innerHTML = '<p style="color:#ef4444;">❌ ' + e.message + '</p>'; }
}

async function gradeSubmission(subId) {
    const TOKEN = localStorage.getItem('admin_token');
    const grade = document.getElementById('grade-' + subId)?.value;
    if (!grade) return alert('กรุณาใส่คะแนน');
    try {
        await fetch('/api/admin/homework/grade', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + TOKEN },
            body: JSON.stringify({ submission_id: subId, grade: parseInt(grade), feedback: '' })
        });
        alert('✅ ให้คะแนนสำเร็จ!');
        loadAdminHomework();
    } catch(e) { alert('❌ ' + e.message); }
}

// ===================== DASHBOARD ANALYTICS =====================

var attChart = null, quizAvgChart = null;

async function loadDashboardStats() {
    const TOKEN = localStorage.getItem('admin_token');
    try {
        const res = await fetch('/api/admin/dashboard-stats', { headers: { 'Authorization': 'Bearer ' + TOKEN } });
        const data = await res.json();
        // Attendance Trend Chart
        const ctx1 = document.getElementById('chart-attendance').getContext('2d');
        if (attChart) attChart.destroy();
        attChart = new Chart(ctx1, {
            type: 'line',
            data: {
                labels: data.attendanceTrend.map(d => d.day.slice(5)),
                datasets: [{ label: 'เช็คชื่อ/วัน', data: data.attendanceTrend.map(d => d.count),
                    borderColor: '#10b981', backgroundColor: 'rgba(16,185,129,0.1)', fill: true, tension: 0.4 }]
            },
            options: { responsive: true, plugins: { legend: { labels: { color: '#ccc' } } }, scales: { x: { ticks: { color: '#999' } }, y: { ticks: { color: '#999' } } } }
        });
        // Quiz Averages Chart
        const ctx2 = document.getElementById('chart-quiz-avg').getContext('2d');
        if (quizAvgChart) quizAvgChart.destroy();
        quizAvgChart = new Chart(ctx2, {
            type: 'bar',
            data: {
                labels: data.quizAverages.map(q => q.title.substring(0,12)),
                datasets: [{ label: 'คะแนนเฉลี่ย %', data: data.quizAverages.map(q => q.avg_score),
                    backgroundColor: ['#a855f7','#3b82f6','#10b981','#f59e0b','#ec4899'] }]
            },
            options: { responsive: true, plugins: { legend: { labels: { color: '#ccc' } } }, scales: { x: { ticks: { color: '#999' } }, y: { ticks: { color: '#999' }, max: 100 } } }
        });
        // Homework Completion Bars
        const bars = document.getElementById('hw-completion-bars');
        bars.innerHTML = '<h4 style="margin-bottom:8px;">📝 อัตราส่งการบ้าน</h4>' + data.homeworkCompletion.map(h => {
            const pct = h.total ? Math.round((h.submitted / h.total) * 100) : 0;
            const color = pct >= 80 ? '#10b981' : pct >= 50 ? '#f59e0b' : '#ef4444';
            return '<div style="margin-bottom:8px;"><div style="display:flex;justify-content:space-between;font-size:0.85rem;"><span>' + h.title + '</span><span style="color:' + color + ';">' + h.submitted + '/' + h.total + ' (' + pct + '%)</span></div>' +
                '<div style="background:rgba(255,255,255,0.1);border-radius:4px;height:8px;overflow:hidden;"><div style="height:100%;width:' + pct + '%;background:' + color + ';border-radius:4px;transition:width 0.6s;"></div></div></div>';
        }).join('');
    } catch(e) { alert('❌ ' + e.message); }
}

// ===================== QUIZ ANALYTICS =====================

async function loadQuizAnalytics() {
    const TOKEN = localStorage.getItem('admin_token');
    const table = document.getElementById('quiz-analytics-table');
    table.innerHTML = '<p style="text-align:center;color:var(--text-muted);">กำลังโหลด...</p>';
    try {
        const res = await fetch('/api/admin/quiz-analytics', { headers: { 'Authorization': 'Bearer ' + TOKEN } });
        const data = await res.json();
        table.innerHTML = '<div style="overflow-x:auto;"><table style="width:100%;border-collapse:collapse;font-size:0.85rem;">' +
            '<thead><tr style="border-bottom:1px solid var(--glass-border);"><th style="text-align:left;padding:8px;">ข้อสอบ</th><th>ทำ</th><th>เฉลี่ย</th><th>สูงสุด</th><th>ต่ำสุด</th><th>ผ่าน%</th></tr></thead><tbody>' +
            data.data.map(function(q) {
                const pc = q.pass_rate || 0;
                const color = pc >= 80 ? '#10b981' : pc >= 60 ? '#f59e0b' : '#ef4444';
                return '<tr style="border-bottom:1px solid rgba(255,255,255,0.05);">' +
                    '<td style="padding:8px;">' + q.title + '</td>' +
                    '<td style="text-align:center;">' + q.total_attempts + '</td>' +
                    '<td style="text-align:center;color:#a855f7;font-weight:600;">' + (q.avg_score || 0) + '%</td>' +
                    '<td style="text-align:center;color:#10b981;">' + (q.highest || 0) + '</td>' +
                    '<td style="text-align:center;color:#ef4444;">' + (q.lowest || 0) + '</td>' +
                    '<td style="text-align:center;"><span style="padding:2px 8px;border-radius:6px;background:' + color + '22;color:' + color + ';font-weight:600;">' + pc + '%</span></td></tr>';
            }).join('') + '</tbody></table></div>';
    } catch(e) { table.innerHTML = '<p style="color:#ef4444;">❌ ' + e.message + '</p>'; }
}

// ===================== SPRINT 8: GLOBAL SEARCH =====================

let searchTimer = null;
function globalSearch(q) {
    clearTimeout(searchTimer);
    const out = document.getElementById('search-results');
    if (q.length < 2) { out.innerHTML = ''; return; }
    searchTimer = setTimeout(async () => {
        try {
            const res = await fetch('/api/search?q=' + encodeURIComponent(q));
            const data = await res.json();
            let html = '';
            if (data.students.length) {
                html += '<h4 style="font-size:0.85rem;margin:8px 0;">👨‍🎓 นักเรียน</h4>';
                data.students.forEach(s => { html += '<div style="padding:6px 10px;border-radius:6px;background:rgba(16,185,129,0.1);margin-bottom:4px;font-size:0.85rem;"><strong>' + s.name + '</strong> <span style="color:var(--text-muted);">(' + s.student_id + ')</span></div>'; });
            }
            if (data.quizzes.length) {
                html += '<h4 style="font-size:0.85rem;margin:8px 0;">📝 ข้อสอบ</h4>';
                data.quizzes.forEach(q => { html += '<div style="padding:6px 10px;border-radius:6px;background:rgba(168,85,247,0.1);margin-bottom:4px;font-size:0.85rem;">' + q.title + ' <span style="color:var(--text-muted);">(Lv.' + q.level + ')</span></div>'; });
            }
            if (data.homework.length) {
                html += '<h4 style="font-size:0.85rem;margin:8px 0;">📋 การบ้าน</h4>';
                data.homework.forEach(h => { html += '<div style="padding:6px 10px;border-radius:6px;background:rgba(245,158,11,0.1);margin-bottom:4px;font-size:0.85rem;">' + h.title + '</div>'; });
            }
            out.innerHTML = html || '<p style="color:var(--text-muted);font-size:0.85rem;">ไม่พบผลลัพธ์</p>';
        } catch(e) { out.innerHTML = '<p style="color:#ef4444;">❌ Error</p>'; }
    }, 300);
}

// ===================== SPRINT 8: BULK OPERATIONS =====================

async function bulkAttendance() {
    const TOKEN = localStorage.getItem('admin_token');
    const ids = document.getElementById('bulk-ids').value.split(',').map(s => s.trim()).filter(Boolean);
    const classroom = document.getElementById('bulk-classroom').value;
    const out = document.getElementById('bulk-result');
    try {
        const res = await fetch('/api/admin/bulk-attendance', {
            method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + TOKEN },
            body: JSON.stringify({ student_ids: ids, classroom_id: classroom })
        });
        const data = await res.json();
        out.style.display = 'block'; out.style.background = 'rgba(16,185,129,0.15)'; out.style.color = '#10b981';
        out.textContent = '✅ เช็คชื่อสำเร็จ ' + data.checked + ' คน';
    } catch(e) { out.style.display='block'; out.style.background='rgba(239,68,68,0.15)'; out.style.color='#ef4444'; out.textContent='❌ '+e.message; }
}

async function bulkGrade() {
    const TOKEN = localStorage.getItem('admin_token');
    const ids = document.getElementById('bulk-ids').value.split(',').map(s => s.trim()).filter(Boolean);
    const grade = prompt('ให้คะแนนเท่าไร? (0-100)');
    if (!grade) return;
    const out = document.getElementById('bulk-result');
    try {
        const grades = ids.map(id => ({ student_id: id, grade: parseInt(grade) }));
        const res = await fetch('/api/admin/bulk-grade', {
            method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + TOKEN },
            body: JSON.stringify({ homework_id: 1, grades })
        });
        const data = await res.json();
        out.style.display = 'block'; out.style.background = 'rgba(59,130,246,0.15)'; out.style.color = '#3b82f6';
        out.textContent = '✅ ให้คะแนนสำเร็จ ' + data.graded + ' คน (' + grade + ' คะแนน)';
    } catch(e) { out.style.display='block'; out.style.background='rgba(239,68,68,0.15)'; out.style.color='#ef4444'; out.textContent='❌ '+e.message; }
}

// ===================== SPRINT 8: USER MANAGEMENT =====================

async function loadUsers() {
    const TOKEN = localStorage.getItem('admin_token');
    const out = document.getElementById('user-list');
    out.innerHTML = 'กำลังโหลด...';
    try {
        const res = await fetch('/api/admin/users', { headers: { 'Authorization': 'Bearer ' + TOKEN } });
        const data = await res.json();
        let html = '<h4 style="margin:8px 0;">🔑 Admin</h4>';
        data.admins.forEach(a => { html += '<div style="padding:6px 10px;border-radius:6px;background:rgba(245,158,11,0.1);margin-bottom:4px;font-size:0.85rem;display:flex;justify-content:space-between;"><span>' + a.username + ' <span style="color:var(--text-muted);">(' + a.role + ')</span></span></div>'; });
        html += '<h4 style="margin:8px 0;">👩‍🏫 ครู</h4>';
        data.teachers.forEach(t => { html += '<div style="padding:6px 10px;border-radius:6px;background:rgba(168,85,247,0.1);margin-bottom:4px;font-size:0.85rem;display:flex;justify-content:space-between;align-items:center;"><span>' + t.name + ' <span style="color:var(--text-muted);">(' + t.email + ')</span></span><button onclick="deleteTeacher('+t.id+')" style="background:#ef4444;color:#fff;border:none;padding:2px 8px;border-radius:4px;font-size:0.75rem;cursor:pointer;">ลบ</button></div>'; });
        out.innerHTML = html;
    } catch(e) { out.innerHTML = '<p style="color:#ef4444;">❌ ' + e.message + '</p>'; }
}

async function addTeacher() {
    const TOKEN = localStorage.getItem('admin_token');
    const name = document.getElementById('new-t-name').value;
    const email = document.getElementById('new-t-email').value;
    const password = document.getElementById('new-t-pass').value;
    const subject = document.getElementById('new-t-subject').value;
    if (!name || !email || !password) return alert('กรอกข้อมูลให้ครบ');
    try {
        const res = await fetch('/api/admin/users/teacher', {
            method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + TOKEN },
            body: JSON.stringify({ name, email, password, subject })
        });
        const data = await res.json();
        if (data.success) { alert('✅ เพิ่มครูสำเร็จ!'); loadUsers(); document.getElementById('new-t-name').value=''; document.getElementById('new-t-email').value=''; document.getElementById('new-t-pass').value=''; document.getElementById('new-t-subject').value=''; }
    } catch(e) { alert('❌ ' + e.message); }
}

async function deleteTeacher(id) {
    if (!confirm('ลบครูนี้?')) return;
    const TOKEN = localStorage.getItem('admin_token');
    try {
        await fetch('/api/admin/users/teacher/' + id, { method: 'DELETE', headers: { 'Authorization': 'Bearer ' + TOKEN } });
        alert('✅ ลบสำเร็จ'); loadUsers();
    } catch(e) { alert('❌ ' + e.message); }
}

// ===================== SPRINT 8: ACTIVITY LOG =====================

async function loadActivityLog() {
    const TOKEN = localStorage.getItem('admin_token');
    const out = document.getElementById('activity-log-list');
    out.innerHTML = 'กำลังโหลด...';
    try {
        const res = await fetch('/api/admin/activity-log', { headers: { 'Authorization': 'Bearer ' + TOKEN } });
        const data = await res.json();
        const icons = { login:'🔑', add_quiz:'📝', bulk_grade:'📊', add_teacher:'👩‍🏫', delete_teacher:'🗑️', bulk_attendance:'✅' };
        out.innerHTML = data.map(log => '<div style="padding:8px 10px;border-radius:6px;background:rgba(255,255,255,0.03);margin-bottom:4px;font-size:0.82rem;display:flex;justify-content:space-between;border:1px solid rgba(255,255,255,0.05);"><div>' + (icons[log.action]||'📋') + ' <strong>' + log.action + '</strong> — ' + log.detail + '</div><span style="color:var(--text-muted);font-size:0.75rem;white-space:nowrap;">' + new Date(log.created_at).toLocaleString('th-TH') + '</span></div>').join('') || '<p style="color:var(--text-muted);">ยังไม่มี log</p>';
    } catch(e) { out.innerHTML = '<p style="color:#ef4444;">❌ ' + e.message + '</p>'; }
}

// ===================== SPRINT 8: THEME CUSTOMIZER =====================

function setThemeColor(color) {
    const themes = {
        purple: { accent: '#a855f7', gradient: 'linear-gradient(135deg,#a855f7,#6366f1)' },
        blue: { accent: '#3b82f6', gradient: 'linear-gradient(135deg,#3b82f6,#06b6d4)' },
        green: { accent: '#10b981', gradient: 'linear-gradient(135deg,#10b981,#34d399)' },
        pink: { accent: '#ec4899', gradient: 'linear-gradient(135deg,#ec4899,#f472b6)' },
        orange: { accent: '#f59e0b', gradient: 'linear-gradient(135deg,#f59e0b,#fbbf24)' }
    };
    const t = themes[color]; if (!t) return;
    document.documentElement.style.setProperty('--accent', t.accent);
    document.querySelectorAll('.btn-glow').forEach(btn => {
        if (!btn.style.background || btn.style.background.includes('gradient')) btn.style.background = t.gradient;
    });
    document.querySelectorAll('.admin-tab.active').forEach(tab => { tab.style.background = t.gradient; });
    localStorage.setItem('krupug_theme_color', color);
    alert('✅ Theme: ' + color);
}
// Auto-apply saved theme
(function() {
    const saved = localStorage.getItem('krupug_theme_color');
    if (saved) setTimeout(() => setThemeColor(saved), 100);
})();

// ===================== SPRINT 9: FILE MANAGER =====================

async function loadFiles() {
    const TOKEN = localStorage.getItem('admin_token');
    const out = document.getElementById('file-list');
    out.innerHTML = 'กำลังโหลด...';
    try {
        const res = await fetch('/api/admin/files', { headers: { 'Authorization': 'Bearer ' + TOKEN } });
        const files = await res.json();
        if (!files.length) { out.innerHTML = '<p style="color:var(--text-muted);">ไม่มีไฟล์</p>'; return; }
        out.innerHTML = files.map(f => {
            const size = f.size > 1048576 ? (f.size/1048576).toFixed(1) + ' MB' : (f.size/1024).toFixed(0) + ' KB';
            return '<div style="padding:6px 10px;border-radius:6px;background:rgba(6,182,212,0.08);margin-bottom:4px;font-size:0.82rem;display:flex;justify-content:space-between;align-items:center;">' +
                '<div><i class="fa-solid fa-file" style="color:#06b6d4;margin-right:6px;"></i><a href="' + f.url + '" target="_blank" style="color:#06b6d4;">' + f.name + '</a> <span style="color:var(--text-muted);">(' + size + ')</span></div>' +
                '<button onclick="deleteFile(\'' + f.name + '\')" style="background:#ef4444;color:#fff;border:none;padding:2px 8px;border-radius:4px;font-size:0.7rem;cursor:pointer;">ลบ</button></div>';
        }).join('');
    } catch(e) { out.innerHTML = '<p style="color:#ef4444;">❌ ' + e.message + '</p>'; }
}

async function deleteFile(name) {
    if (!confirm('ลบไฟล์ ' + name + '?')) return;
    const TOKEN = localStorage.getItem('admin_token');
    try {
        await fetch('/api/admin/files/' + encodeURIComponent(name), { method: 'DELETE', headers: { 'Authorization': 'Bearer ' + TOKEN } });
        alert('✅ ลบสำเร็จ'); loadFiles();
    } catch(e) { alert('❌ ' + e.message); }
}
