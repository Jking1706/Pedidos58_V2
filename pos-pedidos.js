let pedidos = [], pedidoCount = 0, editandoId = null, servidorOK = false;

// ─── ESTADO SERVIDOR ─────────────────────────────────────────────
async function verificarServidor() {
  if (document.hidden || guardandoPedido || pedidosEnProceso.size) return;
  try {
    const r = await fetchWithTimeout(`${API}/pedidos`, {}, 10000);
    if (r.ok) {
      const data = await r.json();
      if (guardandoPedido || pedidosEnProceso.size) return;
      servidorOK = true;
      document.getElementById('status-dot').className = 'status-dot';
      document.getElementById('status-txt').textContent = 'Conectado · Guardando en PostgreSQL';
      // Cargar número de pedido siguiente
      pedidos = data;
      pedidoCount = pedidos.reduce((max, p) => Math.max(max, p.numero), 0);
      actualizarStatusBar();
    } else throw new Error('Servidor no disponible');
  } catch {
    servidorOK = false;
    document.getElementById('status-dot').className = 'status-dot offline';
    document.getElementById('status-txt').textContent = 'Sin conexión · El guardado requiere servidor';
  }
}

async function cargarPedidosHoy() {
  try {
    const r = await fetch(`${API}/pedidos`);
    if (!r.ok) return;
    pedidos = await r.json();
    pedidoCount = pedidos.length > 0 ? Math.max(...pedidos.map(p => p.numero)) : 0;
    actualizarStatusBar();
  } catch {}
}

// ─── SHEETS SYNC ───────────────────────────────────────────────────
function resumenItems(items) {
  return items.map(i => `${i.qty}x ${i.nombre}`).join(' | ');
}

function estadoParaSheets(pedido, accion = 'upsert') {
  if (accion === 'delete') return 'Cancelado';
  if (accion === 'delivered') return 'Entregado';
  if (pedido.entregado) return 'Entregado';
  if (accion === 'update') return pedido.estado || 'Editado';
  return pedido.estado || 'Nuevo';
}

async function enviarAProxySheets(datos) {
  if (['gasto', 'gasto_carrito'].includes(datos.tipoEntrada)) return guardarGastoEnPostgres(datos);

  try {
    const response = await fetch(GOOGLE_SHEETS_PROXY_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(datos),
    });

    const text = await response.text();
    let payload;

    try {
      payload = text ? JSON.parse(text) : {};
    } catch {
      payload = { raw: text };
    }

    if (!response.ok || payload.ok === false) {
      console.error('[Sheets sync] respuesta no exitosa:', {
        status: response.status,
        statusText: response.statusText,
        payload
      });
      return { ok: false, response: payload };
    }

    console.log('[Sheets sync] respuesta:', payload);
    return { ok: true, response: payload };
  } catch (error) {
    console.error('[Sheets sync] Error de red o CORS:', error);
    return { ok: false, error: error.message };
  }
}

function enviarPedidoASheets(pedido, accion = 'upsert') {
  const datos = {
    accion,
    pedidoKey: String(pedido.numero ?? pedido.id ?? ''),
    numero: String(pedido.numero ?? ''),
    idLocal: String(pedido.id ?? ''),
    cliente: pedido.cliente || '',
    telefono: pedido.telefono || '',
    direccion: pedido.direccion || '',
    metodoPago: pedido.metodoPago || '',
    notas: pedido.notas || '',
    items: JSON.stringify(pedido.items || []),
    itemsResumen: resumenItems(pedido.items || []),
    total: String(pedido.total ?? 0),
    hora: pedido.hora || '',
    fecha: pedido.fecha || fechaHoy(),
    entregado: pedido.entregado ? 'true' : 'false',
    estado: estadoParaSheets(pedido, accion),
  };

  return enviarAProxySheets(datos);
}

// ─── GUARDAR PEDIDO ───────────────────────────────────────────────
let guardandoPedido = false;
async function confirmarPedido() {
  if (guardandoPedido) return;
  const items = Object.values(carrito);
  if (!items.length) { mostrarToast('⚠️ El carrito está vacío'); return; }
  const total = calcTotal();
  const datosPedido = leerDatosPedido();
  const hora = new Date().toLocaleTimeString('es-CO',{timeZone: window.__BUSINESS_TIME_ZONE__ || 'America/Bogota', hour:'2-digit',minute:'2-digit'});
  const fecha = fechaHoy();
  const payload = {
    numero: pedidoCount + 1,
    ...datosPedido,
    items: items.map(i=>({...i})),
    total,
    hora,
    fecha,
    entregado: false,
    estado: 'Nuevo'
  };

  const btn = document.getElementById('btn-guardar');
  guardandoPedido = true;
  let feedback = document.getElementById('order-feedback');
  if (!feedback) {
    feedback = document.createElement('p');
    feedback.id = 'order-feedback';
    feedback.className = 'order-feedback';
    feedback.setAttribute('role', 'alert');
    btn.parentNode.insertBefore(feedback, btn);
  }
  feedback.textContent = '';
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner"></span> Guardando...';

  try {
    const r = await fetchWithTimeout(`${API}/pedidos`, { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(payload) }, 20000);
    if (!r.ok) throw new Error(r.status === 401 ? 'Tu sesión venció. Inicia sesión para guardar.' : 'El servidor rechazó el pedido. Revisa los datos antes de reintentar.');
    const nuevo = await r.json();
    if (!nuevo.id) throw new Error('Respuesta incompleta. Revisa los pedidos antes de reintentar.');
    const pedidoGuardado = { ...payload, ...nuevo };
    pedidos = [pedidoGuardado, ...pedidos.filter(p => p.id !== nuevo.id)];
    pedidoCount = Math.max(pedidoCount, pedidoGuardado.numero);
    void enviarPedidoASheets(pedidoGuardado, 'upsert');
    carrito = {};
    limpiarFieldsPedido();
    actualizarUI(); actualizarStatusBar();
    mostrarToast(`Pedido #${pedidoGuardado.numero} guardado en PostgreSQL`);
    if (esVistaMovil()) toggleCarritoMobile(false);
  } catch (error) {
    feedback.textContent = error instanceof TypeError || error.name === 'AbortError'
      ? 'No pudimos confirmar el guardado. Conservamos el carrito. Revisa Pedidos antes de reintentar para evitar duplicados.'
      : error.message;
  } finally {
    guardandoPedido = false;
    btn.disabled = false; btn.textContent = 'Guardar pedido';
  }
}

// ─── STATUS BAR ───────────────────────────────────────────────────
function actualizarStatusBar() {
  const activos = pedidos.filter(p=>!p.entregado).length;
  document.getElementById('badge-pedidos').textContent = pedidos.length;
  document.getElementById('txt-activos').textContent = activos;
  document.getElementById('txt-total-dia').textContent = fmt(pedidos.reduce((s,p)=>s+p.total,0));
}

// ─── OVERLAYS ─────────────────────────────────────────────────────
function abrirPedidos() { document.getElementById('overlay-pedidos').classList.add('visible'); renderPedidos(); }
function abrirHistorial() {
  document.getElementById('overlay-historial').classList.add('visible');
  // Fecha de hoy en formato YYYY-MM-DD para el input date
  const [dd, mm, yyyy] = fechaHoy().split('/');
  document.getElementById('fecha-historial').value = `${yyyy}-${mm}-${dd}`;
  cargarHistorial();
}
function cerrarOverlay(id) { document.getElementById(id).classList.remove('visible'); editandoId=null; }
function cerrarClick(e,id) { if(e.target===document.getElementById(id)) cerrarOverlay(id); }

// ─── RENDER PEDIDOS ───────────────────────────────────────────────
function renderPedidos() {
  const container = document.getElementById('lista-pedidos');
  if (!pedidos.length) { container.innerHTML='<div class="sin-pedidos">No hay pedidos hoy aún.</div>'; return; }
  container.innerHTML='';
  pedidos.forEach(p=>{
    const estaEditando = editandoId===p.id;
    const card = document.createElement('div');
    card.className='pedido-card'+(p.entregado?' entregado':'');
    const listaItems = p.items.map(i=>`${escapeHtml(i.qty)}× ${escapeHtml(i.nombre)}`).join(' · ');
    card.innerHTML=`
      <div class="pedido-card-top">
        <div>
          <div class="pedido-num">PEDIDO #${p.numero} ${p.cliente?`<span class="pedido-cliente">· ${escapeHtml(p.cliente)}</span>`:''}</div>
          <div class="pedido-hora">🕐 ${escapeHtml(p.hora)}</div>
        </div>
        <button class="btn-eliminar-pedido" onclick="eliminarPedido(${p.id})">🗑</button>
      </div>
      <div class="pedido-items-list" id="plist-${p.id}">${listaItems}</div>
      ${p.notas ? `<div class="pedido-notas"><strong>📝 Notas:</strong> ${escapeHtml(p.notas)}</div>` : ''}
      ${(p.telefono || p.direccion || p.metodoPago) ? `
        <div class="pedido-datos">
          ${p.telefono ? `<div><strong>📞 Teléfono:</strong> ${escapeHtml(p.telefono)}</div>` : ''}
          ${p.direccion ? `<div><strong>📍 Dirección:</strong> ${escapeHtml(p.direccion)}</div>` : ''}
          ${p.metodoPago ? `<div><strong>💳 Pago:</strong> ${escapeHtml(p.metodoPago)}</div>` : ''}
        </div>` : ''}
      <div class="pedido-edit-section ${estaEditando?'visible':''}" id="edit-sec-${p.id}">
        <div class="edit-titulo">✏️ Editar productos</div>
        <div id="edit-items-${p.id}"></div>
        <div class="edit-add-section">
          <div class="edit-add-titulo">+ Agregar producto</div>
          <input class="edit-search-input" id="esearch-${p.id}" type="text" placeholder="Buscar..." oninput="filtrarEdit(${p.id})"/>
          <div class="edit-search-results" id="eresults-${p.id}"></div>
        </div>
      </div>
      <div class="pedido-total-row">
        <div class="pedido-total" id="ptotal-${p.id}">${fmt(p.total)}</div>
      </div>
      <div class="pedido-footer-btns">
        ${!p.entregado?`<button class="btn-editar-pedido ${estaEditando?'activo':''}" onclick="toggleEditar(${p.id})">${estaEditando?'✓ Listo':'✏️ Editar'}</button>`:''}
        ${p.entregado?'<span class="tag-entregado">✓ Entregado</span>':`<button class="btn-entregar" onclick="marcarEntregado(${p.id})">✓ Entregar</button>`}
      </div>`;
    container.appendChild(card);
    if(estaEditando) renderEditItems(p);
  });
}

// ─── EDICIÓN ─────────────────────────────────────────────────────
function toggleEditar(id) { editandoId=(editandoId===id)?null:id; renderPedidos(); }

function renderEditItems(p) {
  const c=document.getElementById('edit-items-'+p.id); if(!c)return;
  c.innerHTML='';
  p.items.forEach(item=>{
    const row=document.createElement('div'); row.className='edit-item-row';
    row.innerHTML=`
      <span class="edit-item-nombre">${escapeHtml(item.emoji)} ${escapeHtml(item.nombre)}</span>
      <button class="btn-ctrl-sm minus" aria-label="Quitar una unidad">−</button>
      <span class="edit-qty-sm">${item.qty}</span>
      <button class="btn-ctrl-sm" aria-label="Agregar una unidad">+</button>
      <span class="edit-item-precio">${fmt(item.precio*item.qty)}</span>`;
    row.querySelector('.minus').onclick = () => editQty(p.id, item.id, -1);
    row.querySelector('.btn-ctrl-sm:not(.minus)').onclick = () => editQty(p.id, item.id, 1);
    c.appendChild(row);
  });
  filtrarEdit(p.id);
}

async function editQty(pedidoId, prodId, delta) {
  const actual=pedidos.find(x=>x.id===pedidoId); if(!actual || pedidosEnProceso.has(pedidoId))return;
  const p = structuredClone(actual);
  const item=p.items.find(i=>i.id===prodId); if(!item)return;
  if (p.items.length === 1 && item.qty + delta <= 0) { mostrarToast('El pedido debe conservar al menos un producto.'); return; }
  item.qty+=delta;
  if(item.qty<=0) p.items=p.items.filter(i=>i.id!==prodId);
  recalc(p);
  p.estado = p.entregado ? 'Entregado' : 'Editado';
  if (!await sincPedido(p, 'update')) return;
  renderEditItems(p);
  const el=document.getElementById('plist-'+pedidoId); if(el)el.textContent=p.items.map(i=>`${i.qty}× ${i.nombre}`).join(' · ');
  const te=document.getElementById('ptotal-'+pedidoId); if(te)te.textContent=fmt(p.total);
  actualizarStatusBar();
}

async function agregarAPedido(pedidoId, prod) {
  const actual=pedidos.find(x=>x.id===pedidoId); if(!actual || pedidosEnProceso.has(pedidoId))return;
  const p = structuredClone(actual);
  const ex=p.items.find(i=>i.id===prod.id);
  ex?ex.qty++:p.items.push({...prod,qty:1});
  recalc(p);
  p.estado = p.entregado ? 'Entregado' : 'Editado';
  if (!await sincPedido(p, 'update')) return;
  renderEditItems(p);
  const el=document.getElementById('plist-'+pedidoId); if(el)el.textContent=p.items.map(i=>`${i.qty}× ${i.nombre}`).join(' · ');
  const te=document.getElementById('ptotal-'+pedidoId); if(te)te.textContent=fmt(p.total);
  const inp=document.getElementById('esearch-'+pedidoId); if(inp){inp.value='';filtrarEdit(pedidoId);}
  actualizarStatusBar();
  mostrarToast(`+ ${prod.nombre} → #${p.numero}`);
}

function recalc(p) { p.total=p.items.reduce((s,i)=>s+i.precio*i.qty,0); }

const pedidosEnProceso = new Set();
async function sincPedido(p, accion = 'update') {
  if (pedidosEnProceso.has(p.id)) return false;
  pedidosEnProceso.add(p.id);
  try {
    const r = await fetchWithTimeout(`${API}/pedidos/${p.id}`, {method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({items:p.items,total:p.total,entregado:p.entregado,cliente:p.cliente,notas:p.notas,estado:p.estado})}, 20000);
    if (!r.ok) throw new Error('No se pudo actualizar');
    const saved = await r.json();
    pedidos = pedidos.map(item => item.id === p.id ? saved : item);
    void enviarPedidoASheets(saved, accion);
    return true;
  } catch {
    mostrarToast('No se confirmó el cambio. Actualiza Pedidos para verificar.');
    return false;
  } finally { pedidosEnProceso.delete(p.id); }
}

function filtrarEdit(pedidoId) {
  const inp=document.getElementById('esearch-'+pedidoId);
  const c=document.getElementById('eresults-'+pedidoId);
  if(!inp||!c)return;
  const q=inp.value.toLowerCase().trim();
  const res=(q?TODOS.filter(p=>p.nombre.toLowerCase().includes(q)):TODOS).slice(0,6);
  c.innerHTML='';
  res.forEach(prod=>{
    const div=document.createElement('div'); div.className='edit-search-item';
    div.innerHTML=`<span>${escapeHtml(prod.emoji)} ${escapeHtml(prod.nombre)}</span><small>${fmt(prod.precio)}</small>`;
    div.onclick=()=>agregarAPedido(pedidoId,prod);
    c.appendChild(div);
  });
}

async function marcarEntregado(id) {
  const p=pedidos.find(x=>x.id===id); if(!p)return;
  if (!await sincPedido({ ...p, entregado: true, estado: 'Entregado' }, 'delivered')) return;
  if(editandoId===id)editandoId=null;
  actualizarStatusBar(); renderPedidos();
}

async function eliminarPedido(id) {
  if (pedidosEnProceso.has(id)) return;
  pedidosEnProceso.add(id);
  const p = pedidos.find(x=>x.id===id);
  try {
    const r = await fetchWithTimeout(`${API}/pedidos/${id}`, {method:'DELETE'}, 20000);
    if (!r.ok) throw new Error('No se pudo eliminar');
    pedidos=pedidos.filter(x=>x.id!==id); if(editandoId===id)editandoId=null;
    if (p) void enviarPedidoASheets({ ...p, estado: 'Cancelado' }, 'delete');
    actualizarStatusBar(); renderPedidos();
  } catch { mostrarToast('No se confirmó la eliminación. Actualiza Pedidos para verificar.'); }
}

// ─── HISTORIAL ────────────────────────────────────────────────────
async function cargarHistorial() {
  const inp = document.getElementById('fecha-historial');
  const val = inp.value; // YYYY-MM-DD
  if (!val) return;
  // Convertir a DD/MM/YYYY (formato que usa el servidor)
  const [yyyy,mm,dd] = val.split('-');
  const fecha = `${dd}/${mm}/${yyyy}`;

  const listEl = document.getElementById('lista-historial');
  const resEl = document.getElementById('resumen-historial-wrap');
  listEl.innerHTML = '<div class="sin-pedidos">Cargando...</div>';
  resEl.innerHTML = '';

  if (!servidorOK) { listEl.innerHTML='<div class="sin-pedidos">⚠️ Servidor no disponible</div>'; return; }
  try {
    const r = await fetch(`${API}/pedidos?fecha=${encodeURIComponent(fecha)}`);
    const data = await r.json();
    const totalVentas = data.reduce((s,p)=>s+p.total,0);
    const entregados = data.filter(p=>p.entregado).length;

    resEl.innerHTML=`<div class="resumen-historial">
      <div class="res-item"><span class="res-valor">${data.length}</span><span class="res-label">Pedidos</span></div>
      <div class="res-item"><span class="res-valor">${entregados}</span><span class="res-label">Entregados</span></div>
      <div class="res-item"><span class="res-valor">${fmt(totalVentas)}</span><span class="res-label">Total ventas</span></div>
    </div>`;

    if (!data.length) { listEl.innerHTML='<div class="sin-pedidos">No hay pedidos para esta fecha.</div>'; return; }
    listEl.innerHTML='';
    data.forEach(p=>{
      const card=document.createElement('div');
      card.className='pedido-card'+(p.entregado?' entregado':'');
      card.innerHTML=`
        <div class="pedido-num">PEDIDO #${p.numero} ${p.cliente?`<span class="pedido-cliente">· ${escapeHtml(p.cliente)}</span>`:''}</div>
        <div class="pedido-hora">🕐 ${escapeHtml(p.hora)}</div>
        <div class="pedido-items-list">${p.items.map(i=>`${escapeHtml(i.qty)}× ${escapeHtml(i.nombre)}`).join(' · ')}</div>
        ${p.notas ? `<div class="pedido-notas"><strong>📝 Notas:</strong> ${escapeHtml(p.notas)}</div>` : ''}
        ${(p.telefono || p.direccion || p.metodoPago) ? `
          <div class="pedido-datos">
            ${p.telefono ? `<div><strong>📞 Teléfono:</strong> ${escapeHtml(p.telefono)}</div>` : ''}
            ${p.direccion ? `<div><strong>📍 Dirección:</strong> ${escapeHtml(p.direccion)}</div>` : ''}
            ${p.metodoPago ? `<div><strong>💳 Pago:</strong> ${escapeHtml(p.metodoPago)}</div>` : ''}
          </div>` : ''}
        <div class="pedido-total-row"><div class="pedido-total">${fmt(p.total)}</div>${p.entregado?'<span class="tag-entregado">✓ Entregado</span>':''}</div>`;
      listEl.appendChild(card);
    });
  } catch { listEl.innerHTML='<div class="sin-pedidos">Error al cargar historial.</div>'; }
}

// ─── EXPORT ───────────────────────────────────────────────────────
function exportarCSV() {
  const inp = document.getElementById('fecha-historial').value;
  if (!inp) return;
  const [yyyy,mm,dd] = inp.split('-');
  const fecha = `${dd}/${mm}/${yyyy}`;
  window.open(`${API}/export?fecha=${encodeURIComponent(fecha)}`);
}
