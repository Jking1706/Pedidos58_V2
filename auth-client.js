(() => {
  const originalFetch = window.fetch.bind(window);
  window.fetch = async (...args) => {
    const response = await originalFetch(...args);
    const url = new URL(args[0] instanceof Request ? args[0].url : args[0], location.href);
    if (url.origin === location.origin && url.pathname.startsWith('/api/') && response.status === 401) {
      location.replace('/login');
      // Evita que el POS interprete la expiración como un fallo de red y active su modo offline.
      return new Promise(() => {});
    }
    return response;
  };
  const actions = document.querySelector('.top-actions') || document.querySelector('header');
  if (actions) {
    const link = document.createElement('a');
    link.href = '/mi-sesion';
    link.className = 'btn-link';
    link.textContent = 'Mi sesión';
    actions.append(link);
  }
  window.fetch('/api/auth/me').then(async (response) => {
    if (!response.ok) return;
    const user = await response.json();
    if (user.role === 'admin') return;
    const style = document.createElement('style');
    style.textContent = '.btn-eliminar-pedido, [data-action="delete"], #delete-edit-btn { display: none !important; }';
    document.head.append(style);
    document.querySelectorAll('a[href="/admin-productos"], a[href="/admin-categorias"]').forEach((link) => { link.hidden = true; });
    if (user.role === 'consulta') {
      document.querySelectorAll('a[href="/"], a[href="/admin-gastos"], a[href="/admin-caja"]').forEach((link) => { link.hidden = true; });
    }
  }).catch(() => {});
})();
