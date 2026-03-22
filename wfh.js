document.addEventListener('DOMContentLoaded', fetchLogs);

document.getElementById('wfh-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = document.getElementById('btn-submit');
    btn.disabled = true;
    btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> กำลังดึงพิกัด...';

    if ("geolocation" in navigator) {
        navigator.geolocation.getCurrentPosition(
            async (pos) => { await submitWFH(pos.coords.latitude, pos.coords.longitude); },
            async () => { await submitWFH('', ''); }
        );
    } else { await submitWFH('', ''); }
});

async function submitWFH(lat, lon) {
    const data = {
        full_name: document.getElementById('wfh-name').value,
        role: document.getElementById('wfh-role').value,
        note: document.getElementById('wfh-note').value,
        lat: lat ? lat.toString() : '', lon: lon ? lon.toString() : ''
    };
    try {
        const res = await fetch('/api/wfh', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
        const result = await res.json();
        if (result.success) { alert('ลงเวลาปฏิบัติงานสำเร็จ!'); document.getElementById('wfh-form').reset(); fetchLogs(); }
        else { alert('เกิดข้อผิดพลาด'); }
    } catch (err) { alert('เชื่อมต่อกับฐานข้อมูลไม่สำเร็จ'); }
    finally {
        const btn = document.getElementById('btn-submit');
        btn.disabled = false;
        btn.innerHTML = '<i class="fa-solid fa-location-dot"></i> ลงเวลาเข้างานและระบุพิกัด';
    }
}

async function checkoutWFH(id) {
    try {
        const res = await fetch(`/api/wfh/${id}/checkout`, { method: 'PUT' });
        const result = await res.json();
        if (result.success) { alert('เช็คเอาท์สำเร็จ!'); fetchLogs(); }
    } catch { alert('เกิดข้อผิดพลาด'); }
}

async function fetchLogs() {
    try {
        const res = await fetch('/api/wfh');
        const logs = await res.json();
        const tbody = document.getElementById('wfh-logs');
        if (logs.length === 0) { tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;">ยังไม่มีประวัติการลงเวลา</td></tr>'; return; }
        tbody.innerHTML = logs.map(log => {
            const timeIn = new Date(log.time_in).toLocaleString('th-TH');
            const timeOut = log.time_out ? new Date(log.time_out).toLocaleString('th-TH') : '';
            const statusHtml = log.time_out
                ? '<span class="status-badge" style="background:#6366f1;">เช็คเอาท์แล้ว</span>'
                : `<button class="status-badge" style="cursor:pointer;border:none;" onclick="checkoutWFH(${log.id})">กดเช็คเอาท์</button>`;
            return `<tr><td>${timeIn}</td><td>${timeOut || '-'}</td><td>${log.full_name}</td><td>${log.role}</td><td>${log.note}</td><td>${statusHtml}</td></tr>`;
        }).join('');
    } catch { document.getElementById('wfh-logs').innerHTML = '<tr><td colspan="6" style="text-align:center;color:#ef4444;">ดึงข้อมูลล้มเหลว</td></tr>'; }
}
