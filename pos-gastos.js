const GASTO_CART_STORAGE_KEY = 'sabor58:gasto-carrito-v1';
const GASTO_CART_PAYMENT_KEY = 'sabor58:gasto-carrito-metodo-v1';

let gastoCarrito = cargarGastoCarritoLocalStorage();
let catalogoInsumos = [];
let catalogoLoadPromise = null;
let catalogoLoaded = false;

const gastoCategoriaInput = document.getElementById('gasto-categoria');
const gastoDescripcionInput = document.getElementById('gasto-descripcion');
const gastoMontoInput = document.getElementById('gasto-monto');
const gastoMetodoPagoSelect = document.getElementById('gasto-metodo-pago');
const gastoButton = document.getElementById('btn-guardar-gasto');
const gastoCatalogoCategoriaSelect = document.getElementById('gasto-catalogo-categoria');
const gastoCatalogoCount = document.getElementById('gasto-catalogo-count');
const gastoCatalogoStatus = document.getElementById('gasto-catalog-status');
const gastoProductosGrid = document.getElementById('gasto-productos-grid');
const gastoProductosEmpty = document.getElementById('gasto-productos-empty');
const gastoCarritoList = document.getElementById('gasto-carrito-list');
const gastoCarritoEmpty = document.getElementById('gasto-carrito-empty');
const gastoCarritoCount = document.getElementById('gasto-carrito-count');
const gastoCarritoTotal = document.getElementById('gasto-carrito-total');
const gastoCompraMetodoPagoSelect = document.getElementById('gasto-compra-metodo-pago');
const gastoVaciarCarritoButton = document.getElementById('btn-vaciar-gasto-carrito');
const gastoRegistrarCompraButton = document.getElementById('btn-registrar-compra');

async function enviarGasto() {
  const categoria = gastoCategoriaInput?.value.trim() || '';
  const descripcion = gastoDescripcionInput?.value.trim() || '';
  const monto = Number(gastoMontoInput?.value || 0);
  const metodoPago = gastoMetodoPagoSelect?.value.trim() || '';

  if (!categoria || !descripcion || !monto) {
    mostrarToast('Completa categoría, descripción y monto del gasto');
    return;
  }

  const datos = {
    tipoEntrada: 'gasto',
    categoria,
    descripcion,
    monto,
    total: monto,
    metodoPago,
    fecha: fechaHoy(),
    hora: new Date().toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit' }),
  };

  if (gastoButton) {
    gastoButton.disabled = true;
    gastoButton.textContent = 'Guardando...';
  }

  const resultado = await enviarAProxySheets(datos);

  if (resultado.ok) {
    mostrarToast('✅ Gasto guardado');
    limpiarFieldsGasto();
  } else {
    mostrarToast('⚠️ No se pudo guardar el gasto');
  }

  if (gastoButton) {
    gastoButton.disabled = false; gastoButton.textContent = '✅ Guardar gasto';
  }
}

async function guardarGastoEnPostgres(datos) {
  const key = `sabor58:compra-pendiente:${datos.tipoEntrada}`;
  try {
    const { hora, fecha, operationId, ...contenido } = datos;
    const fingerprint = JSON.stringify(contenido);
    const raw = sessionStorage.getItem(key);
    const previous = raw ? JSON.parse(raw) : null;
    if (previous && previous.fingerprint !== fingerprint) {
      mostrarToast('Hay una compra anterior sin confirmar. Usa «Reintentar compra pendiente».');
      mostrarReintentoGasto(previous.payload);
      return { ok: false };
    }
    const pending = previous || { fingerprint, payload: { ...datos, operationId: crypto.randomUUID() } };
    sessionStorage.setItem(key, JSON.stringify(pending));
    const response = await fetch(`${API}/gastos/pos`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(pending.payload) });
    const payload = await response.json();
    if (!response.ok) {
      if ([400, 403, 409, 415, 413].includes(response.status)) sessionStorage.removeItem(key);
      mostrarToast(payload.error || 'No se pudo guardar el gasto');
      return { ok: false };
    }
    sessionStorage.removeItem(key);
    document.getElementById(`retry-${datos.tipoEntrada}`)?.remove();
    if (payload.sheets_status !== 'enviado') {
      const notice = document.getElementById('gasto-sync-notice') || document.createElement('p');
      notice.id = 'gasto-sync-notice';
      notice.setAttribute('role', 'status');
      notice.textContent = 'Gasto guardado en PostgreSQL. La copia de Google Sheets necesita revisión.';
      gastoButton?.parentElement.append(notice);
    }
    return { ok: true, response: payload };
  } catch {
    try {
      const pending = sessionStorage.getItem(key);
      if (pending) mostrarReintentoGasto(JSON.parse(pending).payload);
    } catch { mostrarToast('Habilita el almacenamiento de sesión para registrar compras con reintentos seguros.'); }
    return { ok: false };
  }
}

function mostrarReintentoGasto(payload) {
  const id = `retry-${payload.tipoEntrada}`;
  if (document.getElementById(id)) return;
  const button = document.createElement('button');
  button.id = id;
  button.type = 'button';
  button.textContent = `Reintentar compra pendiente (${payload.fecha})`;
  button.addEventListener('click', async () => {
    button.disabled = true;
    const result = await guardarGastoEnPostgres(payload);
    if (result.ok) { button.remove(); mostrarToast('Compra anterior confirmada. Revisa el listado antes de registrar otra igual.'); }
    else button.disabled = false;
  });
  gastoButton?.parentElement.append(button);
}

function limpiarFieldsGasto() {
  if (gastoCategoriaInput) gastoCategoriaInput.value = '';
  if (gastoDescripcionInput) gastoDescripcionInput.value = '';
  if (gastoMontoInput) gastoMontoInput.value = '';
  if (gastoMetodoPagoSelect) gastoMetodoPagoSelect.value = '';
}

async function registrarCompraGastos() {
  if (!gastoCarrito.length) {
    mostrarToast('El carrito está vacío');
    return;
  }

  const metodoPago = gastoCompraMetodoPagoSelect?.value.trim() || '';
  const fecha = fechaHoy();
  const hora = new Date().toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit' });

  const datos = {
    tipoEntrada: 'gasto_carrito',
    metodoPago,
    fecha,
    hora,
    items: gastoCarrito.map((item) => ({
      categoria: item.categoria,
      producto: item.producto,
      unidad: item.unidad,
      precioReferencia: item.precioReferencia,
      precioFinal: item.precioFinal,
      cantidad: item.cantidad,
      monto: calcularSubtotalGastoItem(item),
    })),
  };

  if (gastoRegistrarCompraButton) {
    gastoRegistrarCompraButton.disabled = true;
    gastoRegistrarCompraButton.textContent = 'Registrando...';
  }

  const resultado = await enviarAProxySheets(datos);

  if (resultado.ok) {
    vaciarGastoCarrito(false);
    if (gastoCompraMetodoPagoSelect) gastoCompraMetodoPagoSelect.value = '';
    guardarMetodoPagoCompraGastoLocalStorage('');
    mostrarToast(`✅ Compra registrada (${datos.items.length} líneas)`);
  } else {
    mostrarToast('⚠️ No se pudo registrar la compra');
  }

  if (gastoRegistrarCompraButton) {
    gastoRegistrarCompraButton.disabled = gastoCarrito.length === 0;
    gastoRegistrarCompraButton.textContent = 'Registrar Compra';
  }
}

function renderCatalogoCategorias() {
  if (!gastoCatalogoCategoriaSelect) return;

  const categoriaActual = gastoCatalogoCategoriaSelect.value;
  const categorias = Array.from(new Set(catalogoInsumos.map((item) => item.categoria).filter(Boolean)));

  gastoCatalogoCategoriaSelect.innerHTML = [
    '<option value="">Todas las categorías</option>',
    ...categorias.map((categoria) => `<option value="${escapeHtml(categoria)}">${escapeHtml(categoria)}</option>`),
  ].join('');

  if (categoriaActual && categorias.includes(categoriaActual)) {
    gastoCatalogoCategoriaSelect.value = categoriaActual;
  } else {
    gastoCatalogoCategoriaSelect.value = '';
  }
}

function usarCatalogoFallback(motivo = '') {
  catalogoInsumos = CATALOGO_FALLBACK.map((item, index) => normalizarCatalogoItem(item, index)).filter(Boolean);
  catalogoLoaded = true;
  if (gastoCatalogoStatus) gastoCatalogoStatus.textContent = motivo ? `Catálogo base · ${motivo}` : 'Catálogo base';
  renderCatalogoCategorias();
  renderCatalogoProductos();
}

function renderCatalogoProductos() {
  if (!gastoProductosGrid || !gastoProductosEmpty) return;

  gastoProductosEmpty.textContent = 'No hay productos para esta categoría.';

  const categoriaSeleccionada = gastoCatalogoCategoriaSelect?.value || '';
  const productos = categoriaSeleccionada
    ? catalogoInsumos.filter((item) => item.categoria === categoriaSeleccionada)
    : catalogoInsumos;

  if (gastoCatalogoCount) {
    const totalTexto = `${productos.length} producto${productos.length === 1 ? '' : 's'}`;
    gastoCatalogoCount.textContent = categoriaSeleccionada ? `${totalTexto} en ${categoriaSeleccionada}` : `${totalTexto} cargados`;
  }

  if (!productos.length) {
    gastoProductosGrid.innerHTML = '';
    gastoProductosEmpty.hidden = false;
    return;
  }

  gastoProductosEmpty.hidden = true;
  gastoProductosGrid.innerHTML = productos.map((item) => `
    <button class="gasto-producto-card" type="button" onclick="agregarProductoCatalogo('${escapeHtml(item.id)}')">
      <span class="gasto-producto-chip">${escapeHtml(item.categoria)}</span>
      <div class="gasto-producto-nombre">${escapeHtml(item.producto)}</div>
      <div class="gasto-producto-meta">
        <span>Unidad: ${escapeHtml(item.unidad || 'N/D')}</span>
        <span>Referencia: ${fmt(item.precioReferencia)}</span>
      </div>
      <div class="gasto-producto-precio">${fmt(item.precioReferencia)}</div>
      <span class="gasto-producto-cta">Agregar al carrito</span>
    </button>
  `).join('');
}

function calcularSubtotalGastoItem(item) {
  return Math.max(0, Number(item.cantidad || 0) * Number(item.precioFinal || 0));
}

function renderGastoCarrito() {
  if (!gastoCarritoList || !gastoCarritoEmpty) return;

  if (!gastoCarrito.length) {
    gastoCarritoList.innerHTML = '';
    gastoCarritoEmpty.hidden = false;
    actualizarResumenGastoCarrito();
    return;
  }

  gastoCarritoEmpty.hidden = true;
  gastoCarritoList.innerHTML = gastoCarrito.map((item) => `
    <div class="gasto-cart-item" data-gasto-item-id="${escapeHtml(item.id)}">
      <div class="gasto-cart-item-head">
        <div>
          <div class="gasto-cart-item-title">${escapeHtml(item.producto)}</div>
          <div class="gasto-cart-item-meta">${escapeHtml(item.categoria)} · ${escapeHtml(item.unidad || 'N/D')}</div>
        </div>
        <button class="gasto-cart-remove" type="button" onclick="eliminarGastoCarrito('${escapeHtml(item.id)}')">✕</button>
      </div>

      <div class="gasto-cart-controls">
        <label class="gasto-cart-control">
          <span>Cantidad</span>
          <input class="gasto-cart-input" type="number" min="1" step="1" value="${escapeHtml(item.cantidad)}" oninput="actualizarCantidadGastoCarrito('${escapeHtml(item.id)}', this.value)" />
        </label>
        <label class="gasto-cart-control">
          <span>Precio final</span>
          <input class="gasto-cart-input" type="number" min="0" step="1" value="${escapeHtml(item.precioFinal)}" oninput="actualizarPrecioGastoCarrito('${escapeHtml(item.id)}', this.value)" />
        </label>
      </div>

      <div class="gasto-cart-footer-line">
        <span>Ref: ${fmt(item.precioReferencia)}</span>
        <strong id="gasto-cart-subtotal-${escapeHtml(item.id)}">${fmt(calcularSubtotalGastoItem(item))}</strong>
      </div>
    </div>
  `).join('');

  actualizarResumenGastoCarrito();
}

function agregarProductoCatalogo(id) {
  const producto = catalogoInsumos.find((item) => item.id === id);
  if (!producto) return;

  const existente = gastoCarrito.find((item) => item.id === id);
  if (existente) {
    existente.cantidad += 1;
    if (existente.precioFinal === undefined || existente.precioFinal === null || existente.precioFinal === '') {
      existente.precioFinal = producto.precioReferencia;
    }
  } else {
    gastoCarrito.push(normalizarCarritoGastoItem({
      id: producto.id,
      categoria: producto.categoria,
      producto: producto.producto,
      unidad: producto.unidad,
      precioReferencia: producto.precioReferencia,
      precioFinal: producto.precioReferencia,
      cantidad: 1,
    }));
  }

  guardarGastoCarritoLocalStorage();
  renderGastoCarrito();
  mostrarToast(`+ ${producto.producto}`);
}

function actualizarCantidadGastoCarrito(id, valor) {
  const item = gastoCarrito.find((entry) => entry.id === id);
  if (!item) return;

  const cantidad = Math.max(1, Math.round(parseNumberLoose(valor)) || 1);
  item.cantidad = cantidad;
  guardarGastoCarritoLocalStorage();

  const subtotalEl = document.getElementById(`gasto-cart-subtotal-${id}`);
  if (subtotalEl) subtotalEl.textContent = fmt(calcularSubtotalGastoItem(item));

  actualizarResumenGastoCarrito();
}

function actualizarPrecioGastoCarrito(id, valor) {
  const item = gastoCarrito.find((entry) => entry.id === id);
  if (!item) return;

  const precioFinal = Math.max(0, Math.round(parseNumberLoose(valor)) || 0);
  item.precioFinal = precioFinal;
  guardarGastoCarritoLocalStorage();

  const subtotalEl = document.getElementById(`gasto-cart-subtotal-${id}`);
  if (subtotalEl) subtotalEl.textContent = fmt(calcularSubtotalGastoItem(item));

  actualizarResumenGastoCarrito();
}

function eliminarGastoCarrito(id) {
  gastoCarrito = gastoCarrito.filter((item) => item.id !== id);
  guardarGastoCarritoLocalStorage();
  renderGastoCarrito();
}

function vaciarGastoCarrito(shouldToast = true) {
  gastoCarrito = [];
  guardarGastoCarritoLocalStorage();
  renderGastoCarrito();
  if (shouldToast) mostrarToast('🧺 Carrito vaciado');
}

function cargarGastoCarritoLocalStorage() {
  try {
    const raw = localStorage.getItem(GASTO_CART_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.map((item, index) => normalizarCarritoGastoItem(item, index)).filter(Boolean);
  } catch {
    return [];
  }
}

function guardarGastoCarritoLocalStorage() {
  try {
    localStorage.setItem(GASTO_CART_STORAGE_KEY, JSON.stringify(gastoCarrito));
  } catch {}
}

function cargarMetodoPagoCompraGastoLocalStorage() {
  try {
    return localStorage.getItem(GASTO_CART_PAYMENT_KEY) || '';
  } catch {
    return '';
  }
}

function guardarMetodoPagoCompraGastoLocalStorage(value) {
  try {
    const texto = String(value ?? '').trim();
    if (texto) localStorage.setItem(GASTO_CART_PAYMENT_KEY, texto);
    else localStorage.removeItem(GASTO_CART_PAYMENT_KEY);
  } catch {}
}

function obtenerTotalGastoCarrito() {
  return gastoCarrito.reduce((suma, item) => suma + (item.cantidad * item.precioFinal), 0);
}

function actualizarResumenGastoCarrito() {
  if (gastoCarritoCount) gastoCarritoCount.textContent = String(gastoCarrito.length);
  if (gastoCarritoTotal) gastoCarritoTotal.textContent = fmt(obtenerTotalGastoCarrito());
  if (gastoVaciarCarritoButton) gastoVaciarCarritoButton.disabled = gastoCarrito.length === 0;
  if (gastoRegistrarCompraButton) gastoRegistrarCompraButton.disabled = gastoCarrito.length === 0;
}

async function cargarCatalogoInsumos(force = false) {
  if (catalogoLoaded && !force) {
    renderCatalogoCategorias();
    renderCatalogoProductos();
    return catalogoInsumos;
  }

  if (catalogoLoadPromise && !force) {
    return catalogoLoadPromise;
  }

  if (gastoCatalogoStatus) gastoCatalogoStatus.textContent = 'Sincronizando...';

  catalogoLoadPromise = (async () => {
    try {
      const response = await fetch(`${GOOGLE_SHEETS_PROXY_URL}?action=catalogo`);
      const text = await response.text();
      let payload;

      try {
        payload = text ? JSON.parse(text) : {};
      } catch {
        payload = { raw: text };
      }

      if (!response.ok || payload.ok === false) {
        throw new Error(payload.error || `No se pudo cargar el catálogo (${response.status})`);
      }

      const items = Array.isArray(payload.items) ? payload.items : Array.isArray(payload.catalogo) ? payload.catalogo : [];
      catalogoInsumos = items.map((item, index) => normalizarCatalogoItem(item, index)).filter(Boolean);

      if (!catalogoInsumos.length) {
        usarCatalogoFallback('sin datos remotos');
        return catalogoInsumos;
      }

      catalogoLoaded = true;
      if (gastoCatalogoStatus) gastoCatalogoStatus.textContent = 'Catálogo listo';
      renderCatalogoCategorias();
      renderCatalogoProductos();
      return catalogoInsumos;
    } catch (error) {
      usarCatalogoFallback('sin conexión');
      console.error('[Catálogo de insumos] error:', error);
      return catalogoInsumos;
    } finally {
      catalogoLoadPromise = null;
    }
  })();

  return catalogoLoadPromise;
}
