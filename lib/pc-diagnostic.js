function toNum(v, fallback = 0) {
    const n = Number(v);
    return Number.isFinite(n) ? n : fallback;
}

function roundGb(v) {
    const n = toNum(v);
    return Math.round(n * 100) / 100;
}

function normalizeRamSlots(slots) {
    if (!Array.isArray(slots)) return [];
    return slots.map((slot, i) => {
        const s = slot && typeof slot === 'object' ? slot : {};
        return {
            slot: String(s.slot || s.DeviceLocator || `Slot ${i + 1}`).trim(),
            sizeGb: roundGb(s.size_gb != null ? s.size_gb : s.sizeGb),
            speedMhz: toNum(s.speed_mhz != null ? s.speed_mhz : s.speedMhz, 0),
            manufacturer: String(s.manufacturer || '').trim() || '—'
        };
    }).filter((s) => s.sizeGb > 0 || s.slot);
}

function normalizeStorageList(list) {
    if (!Array.isArray(list)) return [];
    return list.map((item) => {
        const d = item && typeof item === 'object' ? item : {};
        return {
            model: String(d.model || 'Disco').trim(),
            sizeGb: roundGb(d.size_gb != null ? d.size_gb : d.sizeGb),
            status: String(d.status || 'OK').trim() || 'OK'
        };
    }).filter((d) => d.model);
}

function normalizeGpuList(list) {
    if (!Array.isArray(list)) return [];
    return list.map((item) => {
        const g = item && typeof item === 'object' ? item : {};
        return {
            name: String(g.name || 'GPU').trim(),
            driver: String(g.driver || g.driverVersion || '—').trim() || '—'
        };
    }).filter((g) => g.name);
}

function normalizeBattery(raw) {
    const b = raw && typeof raw === 'object' ? raw : {};
    const detected = Boolean(b.detected);
    const healthRaw = b.health_pct != null ? b.health_pct : b.healthPct;
    const wearRaw = b.wear_pct != null ? b.wear_pct : b.wearPct;
    const healthNum = healthRaw === 'N/A' || healthRaw == null || healthRaw === ''
        ? null
        : roundGb(healthRaw);
    const wearNum = wearRaw === 'N/A' || wearRaw == null || wearRaw === ''
        ? (healthNum != null ? roundGb(100 - healthNum) : null)
        : roundGb(wearRaw);
    return {
        detected,
        name: String(b.name || 'N/A').trim() || 'N/A',
        healthPct: healthNum,
        wearPct: wearNum,
        designMwh: toNum(b.design_mwh != null ? b.design_mwh : b.designMwh, 0),
        fullMwh: toNum(b.full_mwh != null ? b.full_mwh : b.fullMwh, 0)
    };
}

function normalizePcDiagnostic(raw) {
    if (!raw || typeof raw !== 'object') return null;
    const computerName = String(raw.computer_name || raw.computerName || '').trim();
    if (!computerName) return null;

    const os = raw.os && typeof raw.os === 'object' ? raw.os : {};
    const board = raw.motherboard && typeof raw.motherboard === 'object' ? raw.motherboard : {};
    const cpu = raw.cpu && typeof raw.cpu === 'object' ? raw.cpu : {};
    const ram = raw.ram && typeof raw.ram === 'object' ? raw.ram : {};

    return {
        computerName,
        timestamp: String(raw.timestamp || raw.receivedAt || '').trim() || new Date().toISOString(),
        os: {
            caption: String(os.caption || '—').trim(),
            arch: String(os.arch || os.OSArchitecture || '—').trim(),
            version: String(os.version || '—').trim()
        },
        motherboard: {
            manufacturer: String(board.manufacturer || '—').trim(),
            model: String(board.model || board.product || '—').trim(),
            serialMobo: String(board.serial_mobo || board.serialMobo || '—').trim(),
            serialBios: String(board.serial_bios || board.serialBios || '—').trim(),
            biosVersion: String(board.bios_version || board.biosVersion || '—').trim()
        },
        cpu: {
            name: String(cpu.name || '—').trim(),
            cores: toNum(cpu.cores, 0),
            threads: toNum(cpu.threads, 0)
        },
        ram: {
            totalGb: roundGb(ram.total_gb != null ? ram.total_gb : ram.totalGb),
            slots: normalizeRamSlots(ram.slots)
        },
        storage: normalizeStorageList(raw.storage),
        gpu: normalizeGpuList(raw.gpu),
        battery: normalizeBattery(raw.battery)
    };
}

function batteryHealthTone(healthPct) {
    if (healthPct == null) return 'neutral';
    if (healthPct >= 80) return 'good';
    if (healthPct >= 60) return 'warn';
    return 'bad';
}

function escHtml(v) {
    return String(v ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

function formatDiagnosticTimestamp(ts) {
    if (!ts) return '—';
    const d = new Date(ts);
    if (Number.isNaN(d.getTime())) return String(ts);
    return d.toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
}

function buildPcDiagnosticHtml(diagnostic, options = {}) {
    const d = normalizePcDiagnostic(diagnostic);
    if (!d) return '';

    const compact = options.compact === true;
    const pad = compact ? '14px' : '18px';
    const batteryTone = batteryHealthTone(d.battery.healthPct);
    const batteryColors = {
        good: { bg: '#dcfce7', fg: '#166534', bar: '#22c55e' },
        warn: { bg: '#fef3c7', fg: '#92400e', bar: '#f59e0b' },
        bad: { bg: '#fee2e2', fg: '#991b1b', bar: '#ef4444' },
        neutral: { bg: '#f1f5f9', fg: '#475569', bar: '#94a3b8' }
    };
    const bat = batteryColors[batteryTone] || batteryColors.neutral;

    const ramRows = d.ram.slots.map((slot) => `
        <tr>
          <td style="padding:6px 0;color:#64748b;">${escHtml(slot.slot)}</td>
          <td style="padding:6px 0;text-align:right;font-weight:600;">${escHtml(slot.sizeGb)} GB · ${escHtml(slot.speedMhz)} MHz</td>
        </tr>`).join('');

    const diskRows = d.storage.map((disk) => `
        <tr>
          <td style="padding:6px 0;color:#64748b;">${escHtml(disk.model)}</td>
          <td style="padding:6px 0;text-align:right;font-weight:600;">${escHtml(disk.sizeGb)} GB · ${escHtml(disk.status)}</td>
        </tr>`).join('');

    const gpuRows = d.gpu.map((gpu) => `
        <tr>
          <td style="padding:6px 0;color:#64748b;">${escHtml(gpu.name)}</td>
          <td style="padding:6px 0;text-align:right;font-weight:600;">${escHtml(gpu.driver)}</td>
        </tr>`).join('');

    const batteryBlock = d.battery.detected ? `
        <div style="margin-top:14px;padding:12px 14px;border-radius:12px;background:${bat.bg};color:${bat.fg};">
          <div style="display:flex;justify-content:space-between;align-items:center;gap:10px;margin-bottom:8px;">
            <strong style="font-size:.78rem;text-transform:uppercase;letter-spacing:.06em;">Bateria</strong>
            <span style="font-weight:800;">${d.battery.healthPct != null ? `${escHtml(d.battery.healthPct)}% saúde` : 'N/A'}</span>
          </div>
          ${d.battery.healthPct != null ? `
          <div style="height:8px;background:rgba(0,0,0,.08);border-radius:999px;overflow:hidden;">
            <div style="height:100%;width:${Math.min(100, Math.max(0, d.battery.healthPct))}%;background:${bat.bar};border-radius:999px;"></div>
          </div>
          <p style="margin:8px 0 0;font-size:.8rem;">${escHtml(d.battery.name)}${d.battery.wearPct != null ? ` · desgaste ${escHtml(d.battery.wearPct)}%` : ''}</p>` : `<p style="margin:0;font-size:.8rem;">${escHtml(d.battery.name)}</p>`}
        </div>` : '';

    return `
<section style="margin-top:24px;border:1px solid #e2e8f0;border-radius:18px;overflow:hidden;background:#fff;box-shadow:0 4px 24px rgba(15,23,42,.06);">
  <header style="padding:${pad};background:linear-gradient(135deg,#0f172a,#1e293b);color:#fff;">
    <p style="margin:0;font-size:.72rem;text-transform:uppercase;letter-spacing:.16em;opacity:.85;">Diagnóstico de hardware</p>
    <h2 style="margin:6px 0 0;font-size:1.1rem;font-weight:800;">${escHtml(d.computerName)}</h2>
    <p style="margin:6px 0 0;font-size:.8rem;opacity:.8;">Coletado em ${escHtml(formatDiagnosticTimestamp(d.timestamp))}</p>
  </header>
  <div style="padding:${pad};display:grid;gap:12px;">
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;">
      <div style="background:#f8fafc;border-radius:12px;padding:12px;">
        <div style="font-size:.68rem;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:#64748b;margin-bottom:6px;">Sistema</div>
        <div style="font-weight:700;font-size:.9rem;">${escHtml(d.os.caption)}</div>
        <div style="font-size:.8rem;color:#64748b;margin-top:4px;">${escHtml(d.os.arch)} · v${escHtml(d.os.version)}</div>
      </div>
      <div style="background:#f8fafc;border-radius:12px;padding:12px;">
        <div style="font-size:.68rem;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:#64748b;margin-bottom:6px;">Processador</div>
        <div style="font-weight:700;font-size:.88rem;line-height:1.35;">${escHtml(d.cpu.name)}</div>
        <div style="font-size:.8rem;color:#64748b;margin-top:4px;">${escHtml(d.cpu.cores)} núcleos · ${escHtml(d.cpu.threads)} threads</div>
      </div>
    </div>
    <div style="background:#f8fafc;border-radius:12px;padding:12px;">
      <div style="font-size:.68rem;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:#64748b;margin-bottom:6px;">Placa-mãe / BIOS</div>
      <div style="font-weight:700;font-size:.88rem;">${escHtml(d.motherboard.manufacturer)} ${escHtml(d.motherboard.model)}</div>
      <div style="font-size:.78rem;color:#64748b;margin-top:6px;line-height:1.5;">
        BIOS ${escHtml(d.motherboard.biosVersion)}<br>
        Serial placa: ${escHtml(d.motherboard.serialMobo)} · Serial BIOS: ${escHtml(d.motherboard.serialBios)}
      </div>
    </div>
    <div style="background:#f8fafc;border-radius:12px;padding:12px;">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">
        <div style="font-size:.68rem;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:#64748b;">Memória RAM</div>
        <strong style="font-size:.9rem;">${escHtml(d.ram.totalGb)} GB total</strong>
      </div>
      ${ramRows ? `<table style="width:100%;border-collapse:collapse;font-size:.82rem;">${ramRows}</table>` : '<p style="margin:0;font-size:.82rem;color:#64748b;">Nenhum módulo detectado.</p>'}
    </div>
    ${diskRows ? `<div style="background:#f8fafc;border-radius:12px;padding:12px;">
      <div style="font-size:.68rem;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:#64748b;margin-bottom:8px;">Armazenamento</div>
      <table style="width:100%;border-collapse:collapse;font-size:.82rem;">${diskRows}</table>
    </div>` : ''}
    ${gpuRows ? `<div style="background:#f8fafc;border-radius:12px;padding:12px;">
      <div style="font-size:.68rem;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:#64748b;margin-bottom:8px;">Placa de vídeo</div>
      <table style="width:100%;border-collapse:collapse;font-size:.82rem;">${gpuRows}</table>
    </div>` : ''}
    ${batteryBlock}
  </div>
</section>`;
}

module.exports = {
    normalizePcDiagnostic,
    buildPcDiagnosticHtml,
    batteryHealthTone,
    formatDiagnosticTimestamp
};
