const fmt = n => '$' + n.toLocaleString('es-CO');

function fechaHoy() {
  return new Intl.DateTimeFormat('en-GB', { timeZone: window.__BUSINESS_TIME_ZONE__ || 'America/Bogota', day: '2-digit', month: '2-digit', year: 'numeric' }).format(new Date());
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function parseNumberLoose(value) {
  if (value === undefined || value === null || value === '') {
    return 0;
  }

  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }

  const text = String(value).trim();
  if (!text) {
    return 0;
  }

  const normalized = text.replace(/\s/g, '').replace(/\./g, '').replace(/,/g, '.');
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : 0;
}

function slugifyText(value) {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'item';
}

function crearCatalogoId(item, index = 0) {
  return slugifyText(`${item.categoria || ''}-${item.producto || ''}-${item.unidad || ''}-${index}`);
}

function normalizarCatalogoItem(item, index = 0) {
  const categoria = String(item?.categoria ?? item?.Categoría ?? item?.Categoria ?? '').trim();
  const producto = String(item?.producto ?? item?.Producto ?? item?.nombre ?? '').trim();
  const unidad = String(item?.unidad ?? item?.Unidad ?? '').trim();
  const precioReferencia = parseNumberLoose(item?.precioReferencia ?? item?.Precio_Referencia ?? item?.precio_referencia ?? item?.precioRef ?? item?.precio ?? 0);

  if (!categoria || !producto) {
    return null;
  }

  return {
    id: String(item?.id ?? crearCatalogoId({ categoria, producto, unidad }, index)),
    categoria,
    producto,
    unidad,
    precioReferencia,
  };
}

function normalizarCarritoGastoItem(item, index = 0) {
  const categoria = String(item?.categoria ?? '').trim();
  const producto = String(item?.producto ?? '').trim();
  const unidad = String(item?.unidad ?? '').trim();
  if (!categoria || !producto) {
    return null;
  }

  const precioReferencia = parseNumberLoose(item?.precioReferencia ?? item?.precio_referencia ?? 0);
  const precioFinalBase = parseNumberLoose(item?.precioFinal ?? item?.precio_final ?? item?.precio ?? precioReferencia);
  const precioFinal = precioFinalBase > 0 ? precioFinalBase : precioReferencia;
  const cantidad = Math.max(1, Math.round(parseNumberLoose(item?.cantidad ?? item?.qty ?? 1)) || 1);

  return {
    id: String(item?.id ?? crearCatalogoId({ categoria, producto, unidad }, index)),
    categoria,
    producto,
    unidad,
    precioReferencia,
    precioFinal,
    cantidad,
  };
}

function extraerEmojiDesdeNombre(nombre) {
  const text = String(nombre || '').trim();
  if (!text) return '🍽️';

  const firstToken = text.split(/\s+/)[0];
  return /\p{Extended_Pictographic}/u.test(firstToken) ? firstToken : '🍽️';
}

function ordenarPorCampoOrden(a, b) {
  const categoriaOrdenA = Number(a.categoria_orden) > 0 ? Number(a.categoria_orden) : Number.MAX_SAFE_INTEGER;
  const categoriaOrdenB = Number(b.categoria_orden) > 0 ? Number(b.categoria_orden) : Number.MAX_SAFE_INTEGER;
  const ordenA = Number(a.orden) > 0 ? Number(a.orden) : Number.MAX_SAFE_INTEGER;
  const ordenB = Number(b.orden) > 0 ? Number(b.orden) : Number.MAX_SAFE_INTEGER;

  return categoriaOrdenA - categoriaOrdenB
    || String(a.categoria_nombre || a.categoria || '').localeCompare(String(b.categoria_nombre || b.categoria || ''), 'es')
    || ordenA - ordenB
    || String(a.nombre || '').localeCompare(String(b.nombre || ''), 'es')
    || Number(a.id) - Number(b.id);
}

function agruparProductosDesdeApi(productos) {
  const grupos = new Map();

  [...productos]
    .filter((producto) => producto && producto.activo !== false)
    .sort(ordenarPorCampoOrden)
    .forEach((producto) => {
      const categoriaId = Number(producto.categoria_id || 0);
      const categoriaNombre = String(producto.categoria_nombre || producto.categoria || '').trim();
      if (!categoriaNombre) return;

      const key = categoriaId || categoriaNombre;
      if (!grupos.has(key)) {
        grupos.set(key, {
          categoriaId,
          categoria: categoriaNombre,
          categoriaOrden: Number(producto.categoria_orden) || 0,
          emoji: extraerEmojiDesdeNombre(categoriaNombre),
          productos: [],
        });
      }

      grupos.get(key).productos.push({
        id: Number(producto.id),
        emoji: extraerEmojiDesdeNombre(categoriaNombre),
        nombre: String(producto.nombre || '').trim(),
        desc: String(producto.descripcion || '').trim(),
        precio: Number(producto.precio) || 0,
        orden: Number(producto.orden) || 0,
      });
    });

  return Array.from(grupos.values()).sort((a, b) => {
    const orderA = Number(a.categoriaOrden) > 0 ? Number(a.categoriaOrden) : Number.MAX_SAFE_INTEGER;
    const orderB = Number(b.categoriaOrden) > 0 ? Number(b.categoriaOrden) : Number.MAX_SAFE_INTEGER;
    return orderA - orderB || a.categoria.localeCompare(b.categoria, 'es') || a.categoriaId - b.categoriaId;
  });
}

let MENU = [];
let TODOS = [];
let productosLoadPromise = null;

const CATALOGO_CACHE_KEY = 'sabor58:catalogo-v1';

function leerCacheCatalogo() {
  try {
    const raw = localStorage.getItem(CATALOGO_CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || !Array.isArray(parsed.payload)) return null;
    return parsed;
  } catch {
    return null;
  }
}

function guardarCacheCatalogo(etag, payload) {
  try {
    localStorage.setItem(
      CATALOGO_CACHE_KEY,
      JSON.stringify({ etag: etag || null, payload, savedAt: Date.now() })
    );
  } catch {}
}

function aplicarCatalogo(payload) {
  MENU = agruparProductosDesdeApi(payload);
  TODOS = MENU.flatMap((categoria) => categoria.productos);
  return MENU;
}

async function cargarProductosDesdeServidor(force = false) {
  if (productosLoadPromise && !force) {
    return productosLoadPromise;
  }

  productosLoadPromise = (async () => {
    const cached = leerCacheCatalogo();
    try {
      const headers = {};
      if (!force && cached?.etag) headers['If-None-Match'] = cached.etag;
      const response = await fetchWithTimeout(`${API}/productos`, { headers }, 10000);

      if (response.status === 304 && cached?.payload) {
        return aplicarCatalogo(cached.payload);
      }

      const text = await response.text();
      let payload;

      try {
        payload = text ? JSON.parse(text) : [];
      } catch {
        payload = [];
      }

      if (!response.ok || !Array.isArray(payload)) {
        throw new Error('No se pudo cargar el catálogo de productos');
      }

      guardarCacheCatalogo(response.headers.get('etag'), payload);
      return aplicarCatalogo(payload);
    } catch (error) {
      if (cached?.payload) {
        console.warn('[Productos] sin conexión, se usa el catálogo guardado:', error);
        return aplicarCatalogo(cached.payload);
      }
      console.error('[Productos] error:', error);
      throw error;
    } finally {
      productosLoadPromise = null;
    }
  })();

  return productosLoadPromise;
}

function renderMenu() {
  const panel = document.getElementById('menu-panel');
  panel.innerHTML = '';

  if (!MENU.length) {
    panel.innerHTML = '<div class="sin-pedidos">No hay productos activos para mostrar.</div>';
    return;
  }

  MENU.forEach(cat => {
    const tit = document.createElement('div');
    tit.className = 'categoria-titulo';
    tit.textContent = cat.categoria;
    panel.appendChild(tit);
    const grid = document.createElement('div');
    grid.className = 'productos-grid';
    cat.productos.forEach(p => {
      const card = document.createElement('button');
      card.type = 'button';
      card.setAttribute('aria-label', `Agregar ${p.nombre}, ${fmt(p.precio)}`);
      card.className = 'producto-card';
      card.id = 'card-' + p.id;
      card.innerHTML = `<span class="prod-emoji" aria-hidden="true">${escapeHtml(p.emoji)}</span>
        <div class="prod-nombre">${escapeHtml(p.nombre)}</div>
        ${p.desc ? `<div class="prod-desc">${escapeHtml(p.desc)}</div>` : ''}
        <div class="prod-precio">${fmt(p.precio)}</div>
        <div class="prod-qty-badge" id="badge-${p.id}">0</div>`;
      card.onclick = () => agregarAlCarrito(p);
      grid.appendChild(card);
    });
    panel.appendChild(grid);
  });
}

const CATALOGO_FALLBACK = [
  { categoria: 'Comida', producto: 'Paq Perro Pequeño', unidad: 'Paquete x10', precioReferencia: 8000 },
  { categoria: 'Comida', producto: 'Paq Perro Grande', unidad: 'Paquete x10', precioReferencia: 12000 },
  { categoria: 'Comida', producto: 'Paq Hamburguesa Grande', unidad: 'Paquete x12', precioReferencia: 15000 },
  { categoria: 'Comida', producto: 'Tocineta', unidad: 'Kilo', precioReferencia: 25000 },
  { categoria: 'Comida', producto: 'Queso Mozzarella', unidad: 'Kilo', precioReferencia: 22000 },
  { categoria: 'Comida', producto: 'Envases de Salsa', unidad: 'Ciento', precioReferencia: 5000 },
  { categoria: 'Arepas', producto: 'Harina', unidad: 'Kilo', precioReferencia: 4500 },
  { categoria: 'Arepas', producto: 'Carne de Res', unidad: 'Kilo', precioReferencia: 28000 },
  { categoria: 'Arepas', producto: 'Queso Costeño', unidad: 'Kilo', precioReferencia: 20000 },
  { categoria: 'Servicios', producto: 'Gas', unidad: 'Mensual', precioReferencia: 60000 },
  { categoria: 'Servicios', producto: 'Papel para envolver', unidad: 'Paquete', precioReferencia: 12000 },
];

const carritoPanel = document.querySelector('.carrito-panel');
const cartFab = document.getElementById('cartFab');
const cartFabCount = document.getElementById('cartFabCount');
const cartFabTotal = document.getElementById('cartFabTotal');
const cartBackdrop = document.getElementById('cartBackdrop');

let carrito = {};

function agregarAlCarrito(p) {
  if (guardandoPedido) return;
  carrito[p.id] ? carrito[p.id].qty++ : (carrito[p.id] = {...p, qty:1});
  actualizarUI();
  mostrarToast(`+ ${p.nombre}`);
}

function cambiarQty(id, delta) {
  if (guardandoPedido) return;
  if (!carrito[id]) return;
  carrito[id].qty += delta;
  if (carrito[id].qty <= 0) delete carrito[id];
  actualizarUI();
}

function limpiarCarrito() {
  if (guardandoPedido) return;
  carrito = {};
  limpiarFieldsPedido();
  calcularCambio(); actualizarUI();
}

function calcTotal() { return Object.values(carrito).reduce((s,i)=>s+i.precio*i.qty,0); }
function calcularCambio() {
  const total = calcTotal();
  const pago = parseFloat(document.getElementById('pago-input').value)||0;
  const el = document.getElementById('cambio-valor');
  if (!pago) { el.textContent='—'; el.className='cambio-valor neutro'; return; }
  const cambio = pago - total;
  if (cambio>=0) { el.textContent=fmt(cambio); el.className='cambio-valor positivo'; }
  else { el.textContent='- '+fmt(Math.abs(cambio)); el.className='cambio-valor negativo'; }
}
function actualizarUI() {
  TODOS.forEach(p => {
    const card = document.getElementById('card-'+p.id);
    const badge = document.getElementById('badge-'+p.id);
    if (!card) return;
    const qty = carrito[p.id]?.qty||0;
    card.classList.toggle('en-carrito', qty>0);
    badge.textContent = qty;
  });
  const container = document.getElementById('carrito-items');
  const items = Object.values(carrito);
  if (!items.length) {
    container.innerHTML=`<div class="carrito-vacio"><div class="icon">🫙</div><p>El carrito está vacío.<br/>Selecciona productos del menú.</p></div>`;
    document.getElementById('total-valor').textContent='$0';
    actualizarFabCarrito();
    calcularCambio(); return;
  }
  let total=0;
  const cantidadLineas = items.length;
  const cantidadUnidades = items.reduce((suma, item) => suma + item.qty, 0);
  container.innerHTML = `
    <div class="carrito-list-summary">
      <span>Productos seleccionados</span>
      <strong>${cantidadLineas} línea${cantidadLineas === 1 ? '' : 's'} · ${cantidadUnidades} unidad${cantidadUnidades === 1 ? 'es' : 's'}</strong>
    </div>
  `;
  items.forEach(item=>{
    total+=item.precio*item.qty;
    const div=document.createElement('div');
    div.className='item-carrito';
    div.innerHTML=`
      <div class="item-info">
        <div class="item-nombre">${escapeHtml(item.emoji)} ${escapeHtml(item.nombre)}</div>
        <div class="item-meta">
          <span>${fmt(item.precio)} c/u</span>
          <span>x${item.qty}</span>
        </div>
      </div>
      <div class="item-side">
        <div class="item-subtotal">${fmt(item.precio*item.qty)}</div>
        <div class="item-controles">
          <button class="btn-ctrl minus" aria-label="Quitar una unidad">−</button>
          <span class="item-qty">${item.qty}</span>
          <button class="btn-ctrl" aria-label="Agregar una unidad">+</button>
        </div>
      </div>
      `;
    div.querySelector('.minus').onclick = () => cambiarQty(item.id, -1);
    div.querySelector('.btn-ctrl:not(.minus)').onclick = () => cambiarQty(item.id, 1);
    container.appendChild(div);
  });
  document.getElementById('total-valor').textContent=fmt(total);
  actualizarFabCarrito();
  calcularCambio();
}

function actualizarFabCarrito() {
  if (!cartFabCount || !cartFabTotal) return;
  const cantidad = Object.values(carrito).reduce((s, i) => s + i.qty, 0);
  cartFabCount.textContent = cantidad;
  cartFabTotal.textContent = fmt(calcTotal());
}

function esVistaMovil() {
  return window.matchMedia(`(max-width: ${MOBILE_BREAKPOINT}px)`).matches;
}

function toggleCarritoMobile(forceOpen) {
  if (!esVistaMovil() || !carritoPanel || !cartBackdrop) return;
  const abrir = typeof forceOpen === 'boolean'
    ? forceOpen
    : !carritoPanel.classList.contains('visible-mobile');
  carritoPanel.classList.toggle('visible-mobile', abrir);
  cartBackdrop.classList.toggle('visible', abrir);
  document.body.classList.toggle('carrito-mobile-open', abrir);
}

function resetCarritoMobile() {
  if (!carritoPanel || !cartBackdrop) return;
  carritoPanel.classList.remove('visible-mobile');
  cartBackdrop.classList.remove('visible');
  document.body.classList.remove('carrito-mobile-open');
}
