'use strict';

const COLA_ESTADO_NUEVO = 'Nuevo';
const COLA_ESTADO_PREPARANDO = 'En preparación';
const COLA_ESTADO_LISTO = 'Listo';
const REFRESH_MS = 4000;
const SONIDO_KEY = 'sabor58:cola-sonido';
const PAUSA_KEY = 'sabor58:cola-pausa';

let sonidoOn = true;
let pausada = false;
let refreshTimer = null;
let sonidoCtx = null;
try { sonidoOn = localStorage.getItem(SONIDO_KEY) !== '0'; } catch {}
try { pausada = localStorage.getItem(PAUSA_KEY) === '1'; } catch {}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
}

function colaHoyStr() {
  const d = new Date();
  return String(d.getDate()).padStart(2, '0') + '/' + String(d.getMonth() + 1).padStart(2, '0') + '/' + d.getFullYear();
}

async function apiFetch(url, options) {
  const response = await fetch(url, { credentials: 'same-origin', ...(options || {}) });
  if (!response.ok) {
    const err = new Error('HTTP ' + response.status);
    err.status = response.status;
    throw err;
  }
  const text = await response.text();
  return text ? JSON.parse(text) : null;
}

function tsSafe(value) { return Number(value) || 0; }

function itemText(pedido) {
  const items = Array.isArray(pedido.items) ? pedido.items : [];
  return items.map((it) => (it && it.nombre ? `${Number(it.qty) || 1}× ${escapeHtml(it.nombre)}` : '')).filter(Boolean).join(', ');
}

function colaCard(pedido) {
  const btn = pedido.estado === COLA_ESTADO_NUEVO
    ? `<button type="button" class="btn-cola-accion prep-btn" onclick="Cola.cocinar(${pedido.id})">▶ Empezar</button>`
    : pedido.estado === COLA_ESTADO_PREPARANDO
      ? `<button type="button" class="btn-cola-accion ready-btn" onclick="Cola.listo(${pedido.id})">✓ Listo</button>`
      : `<button type="button" class="btn-cola-accion entregar-btn" onclick="Cola.entregar(${pedido.id})">✓ Entregar</button>
         <button type="button" class="btn-cola-accion btn-imprimir-comanda" onclick="Cola.imprimir(${pedido.id})" aria-label="Imprimir comanda del pedido #${pedido.numero}">🖨️ Comanda</button>`;
  const notas = pedido.notas && String(pedido.notas).trim()
    ? `<div class="cola-card-meta">📝 ${escapeHtml(pedido.notas)}</div>`
    : '';
  const dots = {
    [COLA_ESTADO_NUEVO]: '<span class="cola-dot" style="background:#CF1720"></span>',
    [COLA_ESTADO_PREPARANDO]: '<span class="cola-dot" style="background:#F5C518"></span>',
    [COLA_ESTADO_LISTO]: '<span class="cola-dot" style="background:#168443"></span>',
  };
  const dot = dots[pedido.estado] || '';
  return `<article class="cola-card" data-pedido-id="${pedido.id}" data-estado="${escapeHtml(pedido.estado)}">
    <div class="cola-card-top">
      <span class="cola-card-numero">${dot}#${Number(pedido.numero) || 0}</span>
      <span class="cola-card-hora">${escapeHtml(String(pedido.hora || ''))}</span>
    </div>
    <div class="cola-card-items">${escapeHtml(itemText(pedido)) || 'Sin items'}</div>
    <div class="cola-card-total">${fmt(tsSafe(pedido.total))}</div>
    ${notas}
    <div class="cola-actions">${btn}</div>
  </article>`;
}

function renderCola(data) {
  const pedidos = Array.isArray(data?.pedidos) ? data.pedidos : [];
  const buckets = {
    [COLA_ESTADO_NUEVO]: [],
    [COLA_ESTADO_PREPARANDO]: [],
    [COLA_ESTADO_LISTO]: [],
  };
  for (const pedido of pedidos) {
    if (buckets[pedido.estado]) buckets[pedido.estado].push(pedido);
  }
  for (const key of Object.keys(buckets)) {
    buckets[key].sort((a, b) => (Number(b.id) || 0) - (Number(a.id) || 0));
  }
  const set = (id, list) => { const el = document.getElementById(id); if (el) el.innerHTML = list.map(colaCard).join(''); };
  set('cola-list-new', buckets[COLA_ESTADO_NUEVO]);
  set('cola-list-prep', buckets[COLA_ESTADO_PREPARANDO]);
  set('cola-list-ready', buckets[COLA_ESTADO_LISTO]);
  const setText = (id, value) => { const el = document.getElementById(id); if (el) el.textContent = String(value); };
  setText('cola-count-new', buckets[COLA_ESTADO_NUEVO].length);
  setText('cola-count-prep', buckets[COLA_ESTADO_PREPARANDO].length);
  setText('cola-count-ready', buckets[COLA_ESTADO_LISTO].length);
  const nAct = buckets[COLA_ESTADO_NUEVO].length + buckets[COLA_ESTADO_PREPARANDO].length + buckets[COLA_ESTADO_LISTO].length;
  setText('cola-count', nAct);
  const totNuevo = buckets[COLA_ESTADO_NUEVO].reduce((s, p) => s + tsSafe(p.total), 0);
  const totPrep = buckets[COLA_ESTADO_PREPARANDO].reduce((s, p) => s + tsSafe(p.total), 0);
  const totListo = buckets[COLA_ESTADO_LISTO].reduce((s, p) => s + tsSafe(p.total), 0);
  const footer = document.getElementById('cola-footer');
  if (footer) {
    footer.innerHTML = '<span>⏳ En espera <strong>' + fmt(totNuevo) + '</strong></span>' +
      '<span>🍳 Preparando <strong>' + fmt(totPrep) + '</strong></span>' +
      '<span>✅ Listos para entrega <strong>' + fmt(totListo) + '</strong></span>' +
      '<span>📦 Total en cola <strong>' + fmt(totNuevo + totPrep + totListo) + '</strong></span>';
  }
}

function playSonido() {
  if (!sonidoOn) return;
  try {
    const Ctor = window.AudioContext || window.webkitAudioContext;
    if (!Ctor) return;
    if (!sonidoCtx) sonidoCtx = new Ctor();
    const ctx = sonidoCtx;
    const tones = [880, 660, 440];
    let offset = 0;
    for (const freq of tones) {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain); gain.connect(ctx.destination);
      osc.type = 'sine'; osc.frequency.value = freq;
      const now = ctx.currentTime + offset;
      gain.gain.setValueAtTime(0.12, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.18);
      osc.start(now); osc.stop(now + 0.2);
      offset += 0.18;
    }
  } catch {}
}

async function refreshCola() {
  const url = API + '/pedidos/cola?fecha=' + encodeURIComponent(colaHoyStr());
  try {
    const data = await apiFetch(url);
    renderCola(data);
    return data;
  } catch (error) {
    const status = error && (error.status || error.statusCode);
    if (status === 403 || status === 401) {
      renderCola({ fecha: colaHoyStr(), pedidos: [], contadores: {}, totalActivo: 0 });
      const footer = document.getElementById('cola-footer');
      if (footer) footer.textContent = '🔒 La cola de pedidos solo es visible para caja y admin.';
      if (typeof mostrarToast === 'function') mostrarToast('Acceso denegado a la cola de pedidos');
      return;
    }
    const footer = document.getElementById('cola-footer');
    if (footer) footer.textContent = '⚠️ Cola de pedidos no disponible: ' + (error ? error.message : 'sin conexión');
    if (typeof mostrarToast === 'function') mostrarToast('La cola de pedidos no está disponible');
  }
}

function clearRefreshTimer() {
  if (refreshTimer) { clearInterval(refreshTimer); refreshTimer = null; }
}

function startColaRefresh(delay) {
  clearRefreshTimer();
  if (pausada) { void refreshCola(); return; }
  refreshTimer = setInterval(refreshCola, typeof delay === 'number' ? delay : REFRESH_MS);
}

function refreshNow() { void refreshCola(); }

function toggleSonido() {
  sonidoOn = !sonidoOn;
  try { localStorage.setItem(SONIDO_KEY, sonidoOn ? '1' : '0'); } catch {}
  const button = document.getElementById('btn-cola-sonido');
  if (button) {
    button.textContent = sonidoOn ? '🔊 Sonido ON' : '🔇 Sonido OFF';
    button.setAttribute('aria-pressed', String(sonidoOn));
    button.classList.toggle('is-on', sonidoOn);
  }
}

function togglePausa() {
  pausada = !pausada;
  try { localStorage.setItem(PAUSA_KEY, pausada ? '1' : '0'); } catch {}
  const button = document.getElementById('btn-cola-pausa');
  if (button) {
    button.textContent = pausada ? '▶ Reanudar' : '⏸ Pausar';
    button.setAttribute('aria-pressed', String(!pausada));
  }
  if (!pausada) {
    startColaRefresh();
  } else {
    clearRefreshTimer();
  }
}

async function postTransicion(id, transicion) {
  try {
    await apiFetch(API + '/pedidos/' + id + '/transicion', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ transicion: transicion }) });
  } catch (e) {
    const status = e && (e.status || e.statusCode);
    if (typeof mostrarToast === 'function') {
      mostrarToast('❌ No se pudo avanzar el pedido #' + id + (status ? ' (HTTP ' + status + ')' : ''));
    }
    return;
  }
  await refreshCola();
  playSonido();
}

async function colaTransicionEntregar(id) {
  try {
    await apiFetch(API + '/pedidos/' + id, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ entregado: true }) });
    if (typeof mostrarToast === 'function') mostrarToast('✅ Pedido #' + id + ' entregado');
    await refreshCola();
    playSonido();
  } catch (e) {
    if (typeof mostrarToast === 'function') mostrarToast('No se pudo marcar como entregado');
  }
}

async function colaImprimirComanda(id) {
  try {
    const data = await apiFetch(API + '/pedidos/' + id);
    if (!data) return;
    if (typeof imprimirComanda === 'function') imprimirComanda(data);
  } catch (e) {
    if (typeof mostrarToast === 'function') mostrarToast('No se pudo imprimir la comanda');
  }
}

window.Cola = {
  init: function () { startColaRefresh(); },
  refresh: refreshNow,
  cocinar: function (id) { void postTransicion(id, 'prep'); if (typeof mostrarToast === 'function') mostrarToast('▶ Pedido #' + id + ' cocinado'); },
  listo: function (id) { void postTransicion(id, 'ready'); if (typeof mostrarToast === 'function') mostrarToast('✓ Pedido #' + id + ' listo'); },
  entregar: function (id) { void colaTransicionEntregar(id); },
  imprimir: function (id) { void colaImprimirComanda(id); },
  sonido: playSonido,
};

document.addEventListener('DOMContentLoaded', function () {
  const button = document.getElementById('btn-cola-pausa');
  if (button) button.setAttribute('aria-pressed', String(!pausada));
  const sonidoButton = document.getElementById('btn-cola-sonido');
  if (sonidoButton) {
    sonidoButton.textContent = sonidoOn ? '🔊 Sonido ON' : '🔇 Sonido OFF';
    sonidoButton.setAttribute('aria-pressed', String(sonidoOn));
    sonidoButton.classList.toggle('is-on', sonidoOn);
  }
  document.getElementById('btn-cola-sonido').addEventListener('click', toggleSonido);
  document.getElementById('btn-cola-pausa').addEventListener('click', togglePausa);
  document.getElementById('btn-cola-refrescar').addEventListener('click', refreshNow);
  startColaRefresh();
});
