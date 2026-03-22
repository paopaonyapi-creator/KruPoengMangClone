const TOKEN = localStorage.getItem('adminToken');
let questionCounter = 0;

// Auth check
(async () => {
    try {
        const res = await fetch('/api/auth/check', { headers: { 'x-admin-token': TOKEN } });
        if (!res.ok) { window.location.href = 'index.html'; return; }
    } catch { window.location.href = 'index.html'; return; }
    loadDashboard();
    loadAllTables();
    loadClassrooms();
    loadQuizList();
    document.getElementById('att-date').value = new Date().toISOString().split('T')[0];
    loadStudentCount();
    loadApiKeyStatus();
})();

function logout() { localStorage.removeItem('adminToken'); window.location.href = 'index.html'; }

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
let attChart = null, quizChart = null;
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
