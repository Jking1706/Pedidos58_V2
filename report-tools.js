(function (root) {
  const loads = new Map();
  const libraries = {
    chart: ['https://cdn.jsdelivr.net/npm/chart.js@4.4.1/dist/chart.umd.min.js', () => root.Chart],
    excel: ['https://cdn.sheetjs.com/xlsx-0.20.3/package/dist/xlsx.full.min.js', () => root.XLSX],
    pdf: ['https://cdn.jsdelivr.net/npm/jspdf@2.5.1/dist/jspdf.umd.min.js', () => root.jspdf?.jsPDF],
    tables: ['https://cdn.jsdelivr.net/npm/jspdf-autotable@3.8.4/dist/jspdf.plugin.autotable.min.js', () => root.jspdf?.jsPDF?.API?.autoTable],
  };
  function load(name) {
    const [url, ready] = libraries[name];
    if (ready()) return Promise.resolve();
    if (loads.has(name)) return loads.get(name);
    const pending = new Promise((resolve, reject) => {
      const script = document.createElement('script');
      const timeout = setTimeout(() => fail(), 20000);
      const fail = () => {
        clearTimeout(timeout);
        loads.delete(name);
        script.remove();
        reject(new Error(`No se pudo cargar ${name}. Comprueba la conexión e intenta otra vez.`));
      };
      script.src = url;
      script.onload = () => { if (!ready()) return fail(); clearTimeout(timeout); resolve(); };
      script.onerror = fail;
      document.head.append(script);
    });
    loads.set(name, pending);
    return pending;
  }
  function today(now = new Date()) {
    const parts = new Intl.DateTimeFormat('en-CA', { timeZone: root.__BUSINESS_TIME_ZONE__ || 'America/Bogota', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now);
    const get = (type) => parts.find((part) => part.type === type).value;
    return `${get('year')}-${get('month')}-${get('day')}`;
  }
  function preset(name, now = new Date()) {
    const to = today(now);
    const date = new Date(`${to}T00:00:00Z`);
    if (name === 'ayer') date.setUTCDate(date.getUTCDate() - 1);
    if (name === 'semana') date.setUTCDate(date.getUTCDate() - (date.getUTCDay() + 6) % 7);
    if (name === '30dias') date.setUTCDate(date.getUTCDate() - 29);
    if (name === 'mes') date.setUTCDate(1);
    const from = date.toISOString().slice(0, 10);
    return { from, to: name === 'ayer' ? from : to };
  }
  function range(from, to) {
    for (const value of [from, to]) {
      const date = new Date(`${value}T00:00:00Z`);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value || value < '0001-01-01') throw new Error('Selecciona fechas válidas');
    }
    if (from > to) [from, to] = [to, from];
    if ((Date.parse(to) - Date.parse(from)) / 86400000 + 1 > 366) throw new Error('El rango máximo es de 366 días');
    return { from, to };
  }
  function dailySummary(orders, expenses) {
    const days = new Map();
    const day = (date) => {
      if (!days.has(date)) days.set(date, { Fecha: date, Ventas: 0, Gastos: 0, 'Saldo operativo': 0 });
      return days.get(date);
    };
    for (const order of orders) {
      const [d, m, y] = String(order.fecha).split('/');
      day(`${y}-${m}-${d}`).Ventas += Number(order.total) || 0;
    }
    for (const expense of expenses) day(expense.fecha).Gastos += Number(expense.valor) || 0;
    return [...days.values()].sort((a, b) => a.Fecha.localeCompare(b.Fecha)).map((row) => ({ ...row, 'Saldo operativo': Math.round((row.Ventas - row.Gastos) * 100) / 100 }));
  }
  const api = { load, today, preset, range, dailySummary };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.ReportTools = api;
})(globalThis);
