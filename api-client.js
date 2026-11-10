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
