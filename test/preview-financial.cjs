// Vista local de QA, solo datos sintéticos. No inicia ni migra PostgreSQL.
process.env.NODE_ENV = 'test';
process.env.APP_ORIGIN = 'http://127.0.0.1:3014';
const http = require('node:http');
const { createRequestHandler } = require('../src/server');
const product = { producto: 'Arepa de prueba', categoria: 'Arepas', precio: 100, costo: 40, cantidad_vendida: 2, ingresos: 200, utilidad: 120 };
const expense = { id: 1, fecha: '2026-11-09', descripcion: 'Gasto de prueba', categoria: 'Insumos', valor: 30, observaciones: 'Datos sintéticos' };
const server = http.createServer(createRequestHandler({
  authService: { authenticate: async () => ({ username: 'QA local', role: 'admin' }) },
  apiHandler: async ({ pathname }) => {
    let payload;
    if (pathname.endsWith('/resumen')) payload = { ventas_rango: 200, gastos_rango: 30, utilidad_rango: 120, ticket_promedio_rango: 100, productos_promedio_pedido: 1, pedidos_por_dia_rango: 2 };
    else if (pathname.endsWith('/ventas-diarias')) payload = [{ fecha: '2026-11-09', ingresos: 200, pedidos: 2 }];
    else if (pathname.endsWith('/productos-ranking')) payload = { reporte: [product], top_vendidos: [product], top_rentables: [product], menos_vendidos: [product] };
    else if (pathname.endsWith('/categorias')) payload = [{ categoria: 'Arepas', ingresos: 200 }];
    else if (pathname === '/api/caja') payload = { caja: null, resumen: { fecha: '2026-11-09', ventas: 200, gastos: 30, monto_final_estimado: 170 }, historial: [] };
    else if (pathname === '/api/pedidos/rango') payload = [{ fecha: '09/11/2026', numero: 1, cliente: 'Prueba', total: 100 }, { fecha: '09/11/2026', numero: 2, total: 100 }];
    else if (pathname.startsWith('/api/gastos')) payload = { items: [expense], pagination: { page: 1, limit: 10, total: 1, totalPages: 1 }, summary: { totalValor: 30, totalRegistros: 1 } };
    else return { statusCode: 404, payload: { error: 'Ruta no simulada' } };
    return { statusCode: 200, payload };
  },
}));
server.listen(3014, '127.0.0.1', () => console.log(`QA local: http://127.0.0.1:3014/admin-dashboard (PID ${process.pid})`));
