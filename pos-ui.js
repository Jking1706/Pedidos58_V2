const tabButtons = Array.from(document.querySelectorAll('[data-tab-target]'));
const tabPanels = Array.from(document.querySelectorAll('[data-tab-panel]'));

let datosClienteColapsados = false;

const datosClienteToggleButton = document.getElementById('btn-toggle-datos');
const datosClienteToggleLabel = document.getElementById('datos-cliente-toggle-label');
const datosClientePanel = document.getElementById('carrito-clientes');
const telefonoClienteInput = document.getElementById('telefono-cliente');
const direccionClienteInput = document.getElementById('direccion-cliente');
const metodoPagoSelect = document.getElementById('metodo-pago');

function leerDatosPedido() {
  return {
    cliente: document.getElementById('nombre-cliente').value.trim() || null,
    telefono: telefonoClienteInput?.value.trim() || null,
    direccion: direccionClienteInput?.value.trim() || null,
    metodoPago: metodoPagoSelect?.value.trim() || null,
    notas: document.getElementById('notas-pedido').value.trim() || null,
  };
}

function limpiarFieldsPedido() {
  document.getElementById('nombre-cliente').value = '';
  if (telefonoClienteInput) telefonoClienteInput.value = '';
  if (direccionClienteInput) direccionClienteInput.value = '';
  if (metodoPagoSelect) metodoPagoSelect.value = '';
  document.getElementById('notas-pedido').value = '';
  document.getElementById('pago-input').value = '';
}

function toggleDatosCliente(forceCollapsed) {
  const nextCollapsed = typeof forceCollapsed === 'boolean'
    ? forceCollapsed
    : !datosClienteColapsados;

  datosClienteColapsados = nextCollapsed;
  carritoPanel?.classList.toggle('datos-colapsados', nextCollapsed);

  if (datosClientePanel) {
    datosClientePanel.setAttribute('aria-hidden', String(nextCollapsed));
  }

  if (datosClienteToggleButton) {
    datosClienteToggleButton.setAttribute('aria-expanded', String(!nextCollapsed));
  }

  if (datosClienteToggleLabel) {
    datosClienteToggleLabel.textContent = nextCollapsed ? 'Mostrar datos' : 'Ocultar datos';
  }

  return nextCollapsed;
}

toggleDatosCliente(false);

function setActiveTab(tabName, updateHash = true) {
  const nextTab = ['pedidos', 'cola', 'gastos', 'dashboard'].includes(tabName) ? tabName : 'pedidos';

  tabButtons.forEach((button) => {
    const isActive = button.dataset.tabTarget === nextTab;
    button.classList.toggle('is-active', isActive);
    button.setAttribute('aria-pressed', String(isActive));
  });

  tabPanels.forEach((panel) => {
    panel.classList.toggle('is-active', panel.dataset.tabPanel === nextTab);
  });

  if (nextTab === 'gastos') {
    void cargarCatalogoInsumos();
  }

  if (updateHash) {
    history.replaceState(null, '', `#${nextTab}`);
  }

  window.scrollTo({ top: 0, behavior: 'smooth' });
  return nextTab;
}

function getInitialTab() {
  const hash = String(window.location.hash || '').replace('#', '').trim();
  return ['pedidos', 'cola', 'gastos', 'dashboard'].includes(hash) ? hash : 'pedidos';
}

function mostrarToast(msg) {
  const t=document.getElementById('toast');
  t.textContent=msg; t.classList.add('show');
  clearTimeout(_tt); _tt=setTimeout(()=>t.classList.remove('show'),2000);
}

async function initApp() {
  try {
    await cargarProductosDesdeServidor();
  } catch (error) {
    console.error('[Productos] catalogo no disponible:', error);
  }
  renderMenu();
  void verificarServidor();
  setInterval(verificarServidor, 30000); // Re-chequear cada 30s
  actualizarFabCarrito();
  mostrarPedidoPendiente();
  renderGastoCarrito();
  if (gastoCompraMetodoPagoSelect) {
    gastoCompraMetodoPagoSelect.value = cargarMetodoPagoCompraGastoLocalStorage();
  }
  const impCheck = document.getElementById('imp-print-checkbox');
  const impSaveToggle = document.getElementById('imp-print-toggle');
  if (impCheck && impSaveToggle) {
    try { impCheck.checked = localStorage.getItem('sabor58:imprimir-comanda') !== '0'; } catch {}
    impCheck.addEventListener('change', () => {
      try { localStorage.setItem('sabor58:imprimir-comanda', impCheck.checked ? '1' : '0'); } catch {}
      impSaveToggle.focus();
    });
  }
  setActiveTab(getInitialTab(), false);

  gastoCatalogoCategoriaSelect?.addEventListener('change', renderCatalogoProductos);
  gastoCompraMetodoPagoSelect?.addEventListener('change', (event) => guardarMetodoPagoCompraGastoLocalStorage(event.target.value));
  gastoVaciarCarritoButton?.addEventListener('click', () => vaciarGastoCarrito());
  gastoRegistrarCompraButton?.addEventListener('click', () => { void registrarCompraGastos(); });
  void cargarCatalogoInsumos();

  tabButtons.forEach((button) => {
    button.addEventListener('click', () => setActiveTab(button.dataset.tabTarget));
  });

  cartFab?.addEventListener('click', () => toggleCarritoMobile(true));
  cartBackdrop?.addEventListener('click', () => toggleCarritoMobile(false));
  window.addEventListener('hashchange', () => setActiveTab(getInitialTab(), false));
  window.addEventListener('resize', () => {
    if (!esVistaMovil()) resetCarritoMobile();
  });
}

let _tt;

void initApp();
