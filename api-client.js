function resolveApiBase() {
  const explicit = String(window.__API_BASE__ || '').trim();
  if (explicit) {
    return explicit.replace(/\/$/, '');
  }

  const origin = String(window.location.origin || '').trim();
  if (origin && origin !== 'null' && !origin.startsWith('file:')) {
    return `${origin}/api`;
  }

  return 'http://localhost:3000/api';
}

const API = resolveApiBase();
const GOOGLE_SHEETS_PROXY_URL = `${API}/google-sheets`;
const MOBILE_BREAKPOINT = 900;

function fetchWithTimeout(url, options = {}, timeoutMs = 0) {
  if (!timeoutMs || typeof AbortController === 'undefined') {
    return fetch(url, options);
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  return fetch(url, { ...options, signal: controller.signal })
    .finally(() => clearTimeout(timer));
}

async function apiJson(url, options = {}) {
  const response = await fetch(url, {
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
    ...options,
  });

  const text = await response.text();
  let payload = null;
  try { payload = text ? JSON.parse(text) : null; } catch { payload = text; }

  if (!response.ok) {
    const message = payload?.error || payload?.message || `HTTP ${response.status}`;
    throw new Error(message);
  }

  return payload;
}
