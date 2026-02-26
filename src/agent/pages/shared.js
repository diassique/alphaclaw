/* ─── AlphaClaw Shared JS ─────────────────────────────────────────────────── */

const API = '';

/* ─── Utilities ───────────────────────────────────────────────────────────── */

function timeAgo(iso) {
  const d = Math.floor((Date.now() - new Date(iso)) / 1000);
  if (d < 60) return `${d}s ago`;
  if (d < 3600) return `${Math.floor(d/60)}m ago`;
  return `${Math.floor(d/3600)}h ago`;
}

function shortAddr(addr) {
  return addr ? addr.slice(0,6) + '\u2026' + addr.slice(-4) : '\u2014';
}

function shortHash(h) {
  return h ? h.slice(0,10) + '\u2026' : '\u2014';
}

function formatMs(ms) {
  const s = Math.round(ms / 1000);
  return s >= 60 ? `${Math.floor(s/60)}m ${s%60}s` : `${s}s`;
}

function latencyClass(ms) {
  if (ms < 100) return 'fast';
  if (ms < 500) return 'medium';
  return 'slow';
}

/* ─── Constants ───────────────────────────────────────────────────────────── */

const SERVICE_LABELS = {
  sentiment: 'Sentiment v1',
  sentiment2: 'Sentiment v2',
  polymarket: 'Polymarket',
  defi: 'DeFi',
  news: 'News',
  whale: 'Whale'
};

const CIRCUIT_LABELS = {
  sentiment: 'Sentiment', sentiment2: 'Sent. v2',
  polymarket: 'Polymarket', defi: 'DeFi',
  news: 'News', whale: 'Whale'
};

/* ─── Sparkline ───────────────────────────────────────────────────────────── */

function sparklineSVG(history, w, h) {
  if (!history || history.length < 2) return '';
  const min = Math.min(...history) * 0.95;
  const max = Math.max(...history) * 1.05 || 1;
  const range = max - min || 0.01;
  const pts = history.map((v, i) => {
    const x = (i / (history.length - 1)) * w;
    const y = h - ((v - min) / range) * h;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(' ');
  const trending = history[history.length - 1] >= history[0];
  const color = trending ? 'var(--green)' : 'var(--red)';
  return `<div class="rep-sparkline"><svg viewBox="0 0 ${w} ${h}" preserveAspectRatio="none"><polyline points="${pts}" stroke="${color}" /></svg></div>`;
}

/* ─── Status Strip ────────────────────────────────────────────────────────── */

function statusIcon(status) {
  return status === 'ok' ? '&#10003;' : '&#10007;';
}

function updateStatusStrip(data) {
  const indicator = document.getElementById('strip-indicator');
  const label = document.getElementById('strip-label');
  const dots = document.getElementById('strip-dots');
  const latency = document.getElementById('strip-latency');
  const checked = document.getElementById('strip-checked');
  if (!indicator) return;

  const cls = data.ok ? 'ok' : data.onlineCount > 0 ? 'degraded' : 'offline';
  const labelText = data.ok ? 'ALL OPERATIONAL' : data.onlineCount > 0 ? `DEGRADED (${data.onlineCount}/${data.totalCount})` : 'OFFLINE';

  indicator.className = `status-indicator ${cls}`;
  label.className = `status-label ${cls}`;
  label.textContent = labelText;
  latency.textContent = `avg ${data.avgLatencyMs}ms`;
  checked.textContent = `updated ${new Date(data.checkedAt).toLocaleTimeString('en', {hour12: false})}`;

  dots.innerHTML = data.services.map(s => {
    const dotCls = s.status === 'ok' ? 'ok' : s.status === 'error' ? 'error' : 'offline';
    return `
      <div class="status-dot ${dotCls}" title="${s.name}">
        <span>${statusIcon(s.status)}</span>
        <div class="tooltip">
          <strong>${s.name}</strong><br/>
          Port ${s.port} &middot; ${s.latencyMs}ms<br/>
          ${s.price ? s.price + ' USDC' : 'coordinator'}<br/>
          Status: <span style="color:var(${s.status === 'ok' ? '--green' : '--red'})">${s.status.toUpperCase()}</span>
        </div>
      </div>`;
  }).join('');

  // Update nav badge
  const navBadge = document.querySelector('.nav-right .badge-green, .nav-right .badge-yellow, .nav-right .badge-red');
  if (navBadge) {
    if (data.ok) {
      navBadge.className = 'badge badge-green';
      navBadge.innerHTML = '<span class="dot"></span> LIVE';
    } else if (data.onlineCount > 0) {
      navBadge.className = 'badge badge-yellow';
      navBadge.innerHTML = '<span class="dot"></span> DEGRADED';
    } else {
      navBadge.className = 'badge badge-red';
      navBadge.innerHTML = '<span class="dot"></span> OFFLINE';
    }
  }
}

async function loadStatusStrip() {
  try {
    const r = await fetch('/health-all');
    const d = await r.json();
    updateStatusStrip(d);
    return d;
  } catch(e) {
    const indicator = document.getElementById('strip-indicator');
    const label = document.getElementById('strip-label');
    if (indicator) {
      indicator.className = 'status-indicator offline';
      label.className = 'status-label offline';
      label.textContent = 'UNREACHABLE';
    }
    const dots = document.getElementById('strip-dots');
    if (dots) dots.innerHTML = '';
    const lat = document.getElementById('strip-latency');
    if (lat) lat.textContent = '--';
    const chk = document.getElementById('strip-checked');
    if (chk) chk.textContent = 'failed';
    return null;
  }
}

/* ─── Telegram Badge ──────────────────────────────────────────────────────── */

async function loadTelegram() {
  try {
    const r = await fetch('/telegram/status');
    const d = await r.json();
    const badge = document.getElementById('tg-badge');
    if (!badge) return;
    if (d.enabled) {
      badge.className = 'tg-badge tg-on';
      badge.textContent = 'TG ON';
      badge.title = `Telegram Bot \u00b7 Threshold: ${d.alertThreshold}%`;
    } else {
      badge.className = 'tg-badge tg-off';
      badge.textContent = 'TG OFF';
      badge.title = 'Telegram Bot (not configured)';
    }
  } catch(e) {}
}

/* ─── Nav Highlighting ────────────────────────────────────────────────────── */

document.addEventListener('DOMContentLoaded', () => {
  const path = window.location.pathname;
  document.querySelectorAll('.nav-link').forEach(link => {
    const href = link.getAttribute('href');
    if (href === path || (href === '/' && path === '/')) {
      link.classList.add('active');
    }
  });
});

/* ─── Status Strip Countdown ──────────────────────────────────────────────── */

function restartCountdown(intervalMs) {
  const el = document.getElementById('strip-countdown');
  if (!el) return;
  el.style.animation = 'none';
  void el.offsetHeight;
  el.style.animation = `spin ${(intervalMs || 10000) / 1000}s linear infinite`;
}
