document.addEventListener('DOMContentLoaded', () => {
    initTheme();
    initNavigation();
    initModals();
    initSearch();
    initAnimations();
    fetchContent();
    loadHomeLeaderboard();
    // Register Service Worker for PWA
    if ('serviceWorker' in navigator) {
        navigator.serviceWorker.register('/sw.js').catch(e => console.log('SW:', e));
    }
});

// ===== THEME TOGGLE =====
function initTheme() {
    const savedTheme = localStorage.getItem('theme') || 'dark';
    document.documentElement.setAttribute('data-theme', savedTheme);
    updateThemeIcon(savedTheme);
    
    const toggleBtn = document.getElementById('theme-toggle');
    if (toggleBtn) {
        toggleBtn.addEventListener('click', () => {
            const current = document.documentElement.getAttribute('data-theme') || 'dark';
            const next = current === 'dark' ? 'light' : 'dark';
            document.documentElement.setAttribute('data-theme', next);
            localStorage.setItem('theme', next);
            updateThemeIcon(next);
        });
    }
}

function updateThemeIcon(theme) {
    const btn = document.getElementById('theme-toggle');
    if (btn) btn.innerHTML = theme === 'dark' ? '<i class="fa-solid fa-moon"></i>' : '<i class="fa-solid fa-sun"></i>';
}

// ===== SCROLL ANIMATIONS =====
function initAnimations() {
    const observer = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
            if (entry.isIntersecting) { entry.target.classList.add('visible'); observer.unobserve(entry.target); }
        });
    }, { threshold: 0.1, rootMargin: '0px 0px -30px 0px' });
    document.querySelectorAll('.animate-in').forEach(el => observer.observe(el));
}

let state = { systems: [], clips: [], prompts: [], materials: [], announcements: [] };

async function fetchContent() {
    try {
        const [sysRes, clipsRes, promptsRes, matRes, annRes] = await Promise.all([
            fetch('/api/systems'), fetch('/api/clips'), fetch('/api/prompts'),
            fetch('/api/materials'), fetch('/api/announcements')
        ]);
        state.systems = await sysRes.json();
        state.clips = await clipsRes.json();
        state.prompts = await promptsRes.json();
        state.materials = await matRes.json();
        state.announcements = await annRes.json();
        renderContent();
    } catch (error) {
        console.error("Error fetching data:", error);
    }
}

function initNavigation() {
    const links = document.querySelectorAll('.nav-links a');
    const sections = document.querySelectorAll('.page-section');
    const mobileToggle = document.querySelector('.mobile-toggle');
    const navLinks = document.querySelector('.nav-links');

    links.forEach(link => {
        link.addEventListener('click', (e) => {
            e.preventDefault();
            const targetPage = link.getAttribute('data-page');
            links.forEach(l => l.classList.remove('active'));
            link.classList.add('active');
            sections.forEach(sec => {
                sec.classList.remove('active');
                sec.classList.add('hidden');
            });
            const target = document.getElementById(`page-${targetPage}`);
            if (target) { target.classList.remove('hidden'); target.classList.add('active'); }
            navLinks.classList.remove('mobile-open');
            window.scrollTo({ top: 0, behavior: 'smooth' });
        });
    });

    if (mobileToggle) {
        mobileToggle.addEventListener('click', () => {
            navLinks.classList.toggle('mobile-open');
        });
    }
}

function initModals() {
    document.getElementById('btn-admin').addEventListener('click', () => {
        document.getElementById('modal-admin').classList.remove('hidden');
    });
    document.querySelectorAll('.modal-close').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.target.closest('.modal-overlay').classList.add('hidden');
        });
    });
    document.querySelectorAll('.modal-overlay').forEach(overlay => {
        overlay.addEventListener('click', (e) => {
            if (e.target === overlay) overlay.classList.add('hidden');
        });
    });

    document.getElementById('admin-login-form').addEventListener('submit', async (e) => {
        e.preventDefault();
        const pass = document.getElementById('admin-pass').value;
        try {
            const response = await fetch('/api/auth/login', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ password: pass })
            });
            const data = await response.json();
            if (data.success) {
                localStorage.setItem('adminToken', data.token);
                window.location.href = 'admin.html';
            } else {
                document.getElementById('admin-error').classList.remove('hidden');
            }
        } catch (err) { console.error(err); }
    });
}

// Search
function initSearch() {
    const input = document.getElementById('search-input');
    const resultsDiv = document.getElementById('search-results');
    let debounce;

    input.addEventListener('input', () => {
        clearTimeout(debounce);
        const q = input.value.trim();
        if (q.length < 2) { resultsDiv.innerHTML = ''; resultsDiv.style.display = 'none'; return; }
        debounce = setTimeout(async () => {
            try {
                const res = await fetch(`/api/search?q=${encodeURIComponent(q)}`);
                const items = await res.json();
                if (items.length === 0) {
                    resultsDiv.innerHTML = '<div class="search-item">ไม่พบผลลัพธ์</div>';
                } else {
                    resultsDiv.innerHTML = items.slice(0, 8).map(item => {
                        const typeLabel = { system: '🖥️ ระบบ', material: '📄 สื่อ', clip: '🎬 คลิป', prompt: '🤖 Prompt' }[item.type] || item.type;
                        return `<div class="search-item"><span class="search-type">${typeLabel}</span> ${item.title}</div>`;
                    }).join('');
                }
                resultsDiv.style.display = 'block';
            } catch (err) { console.error(err); }
        }, 300);
    });

    document.addEventListener('click', (e) => {
        if (!e.target.closest('.search-bar')) { resultsDiv.style.display = 'none'; }
    });
}

// Copy to clipboard helper
async function copyPrompt(text) {
    try {
        await navigator.clipboard.writeText(text);
        showToast('คัดลอก Prompt สำเร็จ!');
    } catch {
        // Fallback
        const ta = document.createElement('textarea');
        ta.value = text;
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        document.body.removeChild(ta);
        showToast('คัดลอก Prompt สำเร็จ!');
    }
}

function showToast(msg) {
    const t = document.createElement('div');
    t.className = 'toast-msg';
    t.textContent = msg;
    document.body.appendChild(t);
    setTimeout(() => t.remove(), 2500);
}

function renderContent() {
    document.getElementById('count-systems').textContent = state.systems.length;
    document.getElementById('count-clips').textContent = state.clips.length;
    document.getElementById('count-prompts').textContent = state.prompts.length;
    document.getElementById('count-materials').textContent = state.materials.length;

    // Announcements (dynamic)
    const annList = document.getElementById('announcement-list');
    if (state.announcements.length > 0) {
        annList.innerHTML = state.announcements.map(a => `<li>${a.text}</li>`).join('');
    } else {
        annList.innerHTML = '<li>ยังไม่มีข่าวประชาสัมพันธ์</li>';
    }

    // Materials
    const matGrid = document.getElementById('grid-materials');
    if (state.materials.length > 0) {
        matGrid.innerHTML = state.materials.map(mat => `
            <div class="item-card glass-card">
                <span class="item-badge" style="background:#f59e0b;">สื่อ</span>
                <div class="item-icon" style="color:#f59e0b;opacity:1;"><i class="fa-solid ${mat.icon}"></i></div>
                <h3 class="item-title">${mat.title}</h3>
                <p class="item-desc">${mat.desc_text}</p>
                <div class="item-actions">
                    <button class="btn-glow btn-full" style="background:linear-gradient(135deg,#f59e0b,#d97706);" onclick="window.open('${mat.file_url}','_blank')"><i class="fa-solid fa-download"></i> ดาวน์โหลด</button>
                </div>
            </div>
        `).join('');
    } else {
        matGrid.innerHTML = '<div class="empty-state glass-card"><i class="fa-solid fa-box-open empty-icon"></i><h3>ยังไม่มีสื่อการสอน</h3></div>';
    }

    // Systems
    document.getElementById('grid-systems').innerHTML = state.systems.map(sys => `
        <div class="item-card glass-card">
            <span class="item-badge ep">${sys.ep}</span>
            <div class="item-icon"><i class="fa-solid ${sys.icon}"></i></div>
            <h3 class="item-title">${sys.title}</h3>
            <p class="item-desc">${sys.desc_text}</p>
            <div class="item-actions">
                <button class="btn-outline" onclick="${sys.preview_url && sys.preview_url !== '#' ? `window.open('${sys.preview_url}','_blank')` : `showToast('เร็วๆ นี้!')`}"><i class="fa-solid fa-eye"></i> ตัวอย่าง</button>
                <button class="btn-glow" onclick="${sys.download_url && sys.download_url !== '#' ? `window.open('${sys.download_url}','_blank')` : `showToast('เร็วๆ นี้!')`}"><i class="fa-solid fa-download"></i> ดาวน์โหลด</button>
            </div>
        </div>
    `).join('');

    // Clips
    document.getElementById('grid-clips').innerHTML = state.clips.map(clip => `
        <div class="item-card glass-card">
            <span class="item-badge ep">${clip.ep}</span>
            <div class="item-icon" style="color:#ef4444;opacity:1;"><i class="fa-brands fa-youtube"></i></div>
            <h3 class="item-title">${clip.title}</h3>
            <div class="item-actions">
                <button class="btn-glow btn-full" style="background:#ef4444;" onclick="window.open('${clip.video_url}','_blank')"><i class="fa-solid fa-play"></i> รับชม</button>
            </div>
        </div>
    `).join('');

    // Prompts — REAL clipboard copy
    document.getElementById('grid-prompts').innerHTML = state.prompts.map(prompt => `
        <div class="item-card glass-card">
            <span class="item-badge" style="background:#10b981;">AI Prompt</span>
            <div class="item-icon" style="color:#10b981;opacity:1;"><i class="fa-solid ${prompt.icon}"></i></div>
            <h3 class="item-title">${prompt.title}</h3>
            <p class="item-desc">${prompt.desc_text}</p>
            <div class="item-actions">
                <button class="btn-glow btn-full" style="background:#10b981;" onclick="copyPrompt(\`${prompt.desc_text.replace(/`/g, '\\`').replace(/\\/g, '\\\\')}\`)"><i class="fa-solid fa-copy"></i> คัดลอก</button>
            </div>
        </div>
    `).join('');

    // Popular
    document.getElementById('popular-content-list').innerHTML = state.systems.slice(0,3).map(sys => `
        <li><i class="fa-solid fa-star" style="color:#f59e0b;margin-right:8px;"></i>${sys.title} <span style="color:var(--text-muted);font-size:0.8rem;">(${sys.ep})</span></li>
    `).join('');
}

// ===== NOTIFICATION SYSTEM =====
async function loadNotifBadge() {
    try {
        const res = await fetch('/api/notifications/unread-count');
        const data = await res.json();
        const badge = document.getElementById('notif-badge');
        if (badge) {
            if (data.count > 0) { badge.style.display = 'inline'; badge.textContent = data.count; }
            else { badge.style.display = 'none'; }
        }
    } catch (e) {}
}

function toggleNotifPanel() {
    const panel = document.getElementById('notif-panel');
    if (!panel) return;
    panel.classList.toggle('hidden');
    if (!panel.classList.contains('hidden')) loadNotifications();
}

async function loadNotifications() {
    try {
        const res = await fetch('/api/notifications');
        const notifs = await res.json();
        const list = document.getElementById('notif-list');
        if (!list) return;
        if (notifs.length === 0) { list.innerHTML = '<p style="color:var(--text-muted);">ไม่มีการแจ้งเตือน</p>'; return; }
        const typeMap = { quiz: '📝 แบบทดสอบ', announcement: '📢 ข่าว', system: '⚙️ ระบบ', attendance: '📋 เช็คชื่อ' };
        list.innerHTML = notifs.slice(0,10).map(n => `
            <div style="padding:10px 0;border-bottom:1px solid var(--glass-border);${n.is_read?'':'border-left:3px solid var(--primary);padding-left:10px;'}">
                <small style="color:${n.type==='quiz'?'#f59e0b':'#ec4899'};font-weight:600;">${typeMap[n.type]||'ระบบ'}</small>
                <div style="font-weight:600;margin-top:2px;">${n.title}</div>
                <div style="color:var(--text-muted);font-size:0.85rem;margin-top:2px;">${n.message||''}</div>
            </div>
        `).join('');
    } catch (e) {}
}

async function markAllRead() {
    try { await fetch('/api/notifications/read-all', { method: 'PUT' }); loadNotifBadge(); loadNotifications(); } catch (e) {}
}

// Poll badge every 30s
loadNotifBadge();
setInterval(loadNotifBadge, 30000);
// Close notif panel on outside click
document.addEventListener('click', (e) => {
    const panel = document.getElementById('notif-panel');
    const bell = document.getElementById('notif-bell');
    if (panel && !panel.contains(e.target) && bell && !bell.contains(e.target)) panel.classList.add('hidden');
});

// ===== FLOATING AI CHAT =====
function toggleAIChat() {
    const panel = document.getElementById('ai-chat-panel');
    if (panel) panel.classList.toggle('hidden');
}

async function sendAI() {
    const input = document.getElementById('ai-input');
    const msg = input.value.trim();
    if (!msg) return;
    input.value = '';
    const container = document.getElementById('ai-chat-messages');
    container.innerHTML += `<div class="ai-msg user"><div class="ai-bubble">${msg}</div></div>`;
    container.innerHTML += `<div class="ai-msg ai" id="ai-typing"><div class="ai-bubble" style="color:var(--text-muted);font-style:italic;">กำลังคิด...</div></div>`;
    container.scrollTop = container.scrollHeight;
    try {
        const res = await fetch('/api/ai/chat', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ message: msg, user_name: 'Visitor' })
        });
        const data = await res.json();
        document.getElementById('ai-typing')?.remove();
        const formatted = (data.response || 'ขออภัย ไม่สามารถตอบได้').replace(/\n/g, '<br>');
        container.innerHTML += `<div class="ai-msg ai"><div class="ai-bubble">${formatted}</div></div>`;
        container.scrollTop = container.scrollHeight;
    } catch (e) {
        document.getElementById('ai-typing')?.remove();
        container.innerHTML += `<div class="ai-msg ai"><div class="ai-bubble">❌ เกิดข้อผิดพลาด ลองใหม่อีกครั้ง</div></div>`;
    }
}

// ========== HOME LEADERBOARD ==========
async function loadHomeLeaderboard() {
    try {
        const res = await fetch('/api/leaderboard');
        const data = await res.json();
        const el = document.getElementById('home-leaderboard');
        if (!el) return;
        if (data.length === 0) { el.innerHTML = '<p style="color:var(--text-muted);">ยังไม่มีข้อมูล — ทำแบบทดสอบเพื่อติดอันดับ!</p>'; return; }
        const medals = ['🥇', '🥈', '🥉'];
        el.innerHTML = data.slice(0, 5).map((r, i) => `
            <div style="display:flex;align-items:center;gap:12px;padding:10px 0;border-bottom:1px solid var(--glass-border);">
                <span style="font-size:1.3rem;min-width:36px;text-align:center;font-weight:800;">${i<3?medals[i]:i+1}</span>
                <span style="flex:1;font-weight:600;">${r.student_name}</span>
                <span style="color:var(--text-muted);font-size:0.85rem;">${r.quizzes_taken} ครั้ง</span>
                <span style="font-weight:700;color:#10b981;">${r.avg_percent}%</span>
            </div>
        `).join('');
    } catch(e) { console.error(e); }
}
