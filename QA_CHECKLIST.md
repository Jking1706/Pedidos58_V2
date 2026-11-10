# Pruebas recomendadas para Pedidos58

Fecha: 2026-11-09. Ejecutar con `npm test` y validación manual sobre Render/Neon.

## 1. Acceso y seguridad

- `/api/health` responde 200 sin sesión.
- `/api/pedidos` responde 401 sin cookie.
- `/login` crea sesión y redirige a `/`.
- `/mi-sesion` permite cerrar sesión.
- Cookie `HttpOnly`, `SameSite=Strict` y `Secure` en producción.
- `Origin` incorrecto rechaza POST/PUT/PATCH.
- 10 intentos fallidos por usuario bloquean durante 15 minutos.
- `caja` no puede crear, editar ni eliminar productos.
- `consulta` no puede escribir ni acceder a Sheets.
- `admin` puede gestionar catálogo y pedidos.

## 2. Productos y catálogo

- Crear producto con nombre, categoría, precio, costo, orden y estado.
- Editar producto y verificar que el cambio se refleja inmediatamente.
- Activar y desactivar producto; el POS no muestra inactivos.
- Eliminar producto y confirmar que no se queda en caché.
- Rechazar precio menor o igual a cero.
- Rechazar costo negativo.
- Rechazar categoría inexistente.
- Verificar que un producto inactivo no aparece en el POS.
- Buscar por nombre y filtrar por categoría.
- Ordenar por orden y nombre.
- Refrescar la página y verificar que el catálogo se carga.

## 3. Pedidos

- Crear pedido con carrito vacío: debe rechazarlo.
- Crear pedido con un producto y verificar total.
- Editar cantidad y verificar que el total se recalcula.
- Eliminar producto de un pedido y verificar total.
- Marcar pedido como entregado.
- Eliminar pedido y verificar que desaparece.
- Verificar que no se envía a Sheets si falla la API.
- Verificar que no se duplica al hacer doble clic.
- Verificar que el carrito se conserva si falla el guardado.
- Verificar que el historial carga pedidos por fecha.
- Verificar exportación CSV.

## 4. Gastos y caja

- Crear gasto manual y verificar que aparece en listado.
- Editar gasto y verificar total.
- Eliminar gasto.
- Abrir caja y verificar monto inicial.
- Cerrar caja y verificar resumen.
- Verificar que cierre concurrente no duplica instantánea.
- Verificar que error al cerrar revierte y libera conexión.
- Verificar gastos POS con idempotencia y reintentos.
- Verificar sincronización a Sheets.

## 5. Reportes y exportaciones

- Verificar resumen diario con días sin ventas.
- Verificar que gastos no se duplican.
- Verificar ranking de productos.
- Verificar exportación Excel de ventas.
- Verificar exportación Excel de productos.
- Verificar exportación PDF.
- Verificar filtros por fecha.
- Verificar que la zona horaria es Bogotá.

## 6. Rendimiento y UX

- Verificar que el POS carga en menos de 2 segundos.
- Verificar que no hay desbordamiento horizontal en móvil.
- Verificar que los controles táctiles tienen tamaño adecuado.
- Verificar que el foco es visible.
- Verificar que el movimiento reducido se respeta.
- Verificar que no hay errores en consola.
- Verificar que las imágenes cargan correctamente.

## 7. Estados de error

- Verificar que un error de red muestra mensaje claro.
- Verificar que un error 401 redirige a login.
- Verificar que un error 403 muestra mensaje de permisos.
- Verificar que un error 500 no expone detalles internos.

## 8. Sincronización con Sheets

- Verificar que los pedidos se sincronizan.
- Verificar que los gastos se sincronizan.
- Verificar que los errores de Sheets no bloquean el POS.
- Verificar que la sincronización es asíncrona.

## 9. Base de datos

- Verificar que el schema se crea correctamente.
- Verificar que las migraciones se aplican.
- Verificar que los índices existen.
- Verificar que las constraints funcionan.

## 10. Despliegue

- Verificar que `/api/health` responde 200.
- Verificar que `/api/pedidos` responde 401 sin sesión.
- Verificar que `/admin` redirige a login.
- Verificar que `/admin-dashboard` requiere sesión.
- Verificar que las variables de entorno están configuradas.
- Verificar que el SSL está habilitado.
- Verificar que el CORS está configurado correctamente.
