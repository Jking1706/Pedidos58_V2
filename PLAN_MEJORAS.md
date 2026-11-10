# Plan de mejoras — parte práctica

Contexto: la versión hoy en vivo (`pedidos58-v2.onrender.com`) es una build **antigua** con la interfaz pública de POS sin autenticación (`/pos-core.js` y `/login` están 404; catálogo y pedidos abiertos). Las mejoras aplicadas en los últimos commits (headers, CSP, SRI, índice de dashboard, corrección de `/api-client.js`) **no llegarán al sitio real hasta que se haga redeploy desde GitHub master en Render**.

Prioridades con esfuerzo, impacto y evidencia. **P0 son bloqueadores**; **P1** usa el plazo; **P2** es mejora continua; **P3** es consolidación.

## Estado de entregas (2026-11-10)

| # | Mejora | Ubicación | Estado | Evidencia de verificación |
|---|--------|-----------|--------|---------------------------|
| D1 | **Cola de pedido pendiente offline**: si falla la red/fetch, el pedido se guarda en `localStorage['sabor58:pedido-pendiente-v1']` y se muestra un banner fijo y clicable con *"Reintentar"* / *"Descartar"*. El reintento verifica primero `GET /api/pedidos?fecha=…` para no duplicar (detecta por fingerprint `items+total+fecha+cliente+notas`); si ya existe, limpia el banner y muestra «El pedido #N ya estaba guardado». | `pos-pedidos.js`, `pos-ui.js`, `index.html` | Aplicada y verificada | Retry evita duplicados: tras inyectar un pending clon idéntico a pedido #1 (DB efímera) y pulsar Reintentar — banner desaparece y el POS muestra «El pedido #1 ya estaba guardado»; 57/57 tests verdes |
| D2 | **Comanda imprimible**: `window.print()` con layout propio genera la comanda tras cada guardado (default ON) y con botón 🖨️ en cada tarjeta/historial. | `pos-pedidos.js`, `index.html` (`#comanda-print`) | Aplicada y verificada | Tras guardar, `window.__prints === 1` y el DOM contiene `PEDIDO #1 … TOTAL $10.000` |
| D6 | **Caché del catálogo con ETag/304** (`W/"productos-<maxUpdated>-<count>-<active\|all>"`) con fallback al payload del localStorage cuando falla la red. | `pos-core.js`, `productos.controller.js`, `rutas/{productos,index,api}.js`, `server.js` | Aplicada y verificada | Primer `GET /api/productos` → 200 + `ETag`; cabecera `If-None-Match` → **304** con body vacío (verificado con probe `http` raw) |
| D7 | **Pasada visual en navegador** | navegador | Parcial | Viewport mostrado ~800×621: el banner D4 queda fijo y clicable; **390px/1200px pendientes de verificación manual** (la herramienta disponible no permite cambiar viewport) |
| — | **Fix crítico**: `routes/index.js` no propagaba `headers` al `context` de rutas → el `If-None-Match` nunca llegaba al controlador (causa del 304 roto). | `src/routes/index.js` | Corregido | — |

Referencia de contexto para el flujo de transiciones (`Nuevo → En preparación → Listo`) y la nueva pestaña de cola: ver **`PLAN_COLA_PEDIDOS.md`**.

## P0 — Antes de abrir el sistema a cualquier usuario (2–3 días)

| # | Acción | Responsable | Esfuerzo | Resultado verificable |
|---|--------|-------------|----------|------------------------|
| 0.1 | **Redeploy manual en Render** (`Manual Deploy → Clear cache & deploy latest commit`, rama `master`). No hay deploy hook disponible desde este entorno. | Operador con cuenta Render | 15 min | `curl -I https://pedidos58-v2.onrender.com/` devuelve `Content-Security-Policy`, `Permissions-Policy`, `X-Frame-Options`, `nosniff` y `Strict-Transport-Security` |
| 0.2 | **Bootstrap + migración** contra Neon, desde Release del servicio: primero arrancar el app (crea y verifica esquema + seed de productos/categorías), después `npm run migrate`. **No** correr `migrate.js` en base vacía: falla por `relation "pedidos" does not exist`. | Operador con acceso a la Release | 15 min | `schema_migrations.version = '0001_fecha_civil_index'`; `idx_pedidos_fecha_civil` presente en `pg_indexes` |
| 0.3 | **NODE_ENV=production** en el servicio Render (necesario para que HSTS sea emitido y para `__Host-` cookie). | Operador | 5 min | `curl -I` muestra HSTS y cookie `__Host-pedidos58` al iniciar sesión |
| 0.4 | **Deploy-cutover checklist** (sin datos reales): login `/login` funciona; `/api/pedidos` anónimo responde **401**; `/api-client.js`, `/pos-core.js`, `/pos-ui.js` devuelven **200**; un pedido sintético creado desde el POS se ve en `/dashboard`; `POST /api/google-sheets` → 200 con Sheets configurado | Operador | 30 min | Evidencia adjunta (capturas + `curl` outputs) |
| 0.5 | **Configurar Google Sheets**: configurar `SHEET_PROXY_URL` (o la URL del proxy en uso) en Render → hoy el POS da 500/502 al guardar. Si no se quiere Sheets, desactivar el push/semáforo de forma explícita | Operador | 30 min | `POST /api/pedidos` retorna **200/201** (hoy contra Edge devuelve 500) |
| 0.6 | Crear empleados reales con rol mínimo necesario (`caja` para cierre diario, `consulta` para supervisión read-only). Antes de repartir credenciales, aplicar la política de contraseñas de DEPLOY_RENDER | Operador | 30 min | `empleados` con roles correctos; admin no usado para operación |

Secuencia recomendada de release: `0.1 → 0.2 → 0.3 → 0.4 → 0.5 → 0.6`. Si 0.4 falla en cualquier punto, volver a `retry deploy` y **no** dar credenciales a nadie.

## P1 — Operación fiable (semana 1–2)

| # | Acción | Esfuerzo | Resultado |
|---|--------|----------|-----------|
| 1.1 | **Post-deploy smoke en CI**: job en GitHub Actions que levanta el contenedor contra un Postgres efímero (como el aplicado durante esta sesión) y valida: health, login, creación de pedido, listado, logout; falla el pipeline si cualquiera retorna diferente de lo esperado | 1 día | Cada push despliega con evidencia automática |
| 1.2 | **Observabilidad mínima**: Render log drain → Better Stack / CloudWatch; regla de alerta si `http_error` con `statusCode` 5xx ≥ 2 en 10 min, y otra para `locked/rejected` (401/403/429) | 4–8 h | Notificación en menos de 5 min de una caída real |
| 1.3 | **Backups Neon**: confirmar PITR (mínimo 7 días) y restaurar a un proyecto de prueba una vez para validar que el backup es usable | 2–4 h | Restauración probada; RPO/RTO documentados |
| 1.4 | **Renovate/Dependabot**: actualizar Chart.js 4.x / SheetJS / jsPDF regularmente y actualizar SRI automáticamente (script que descargue, calcule `sha384` y parcheee `report-tools.js`) | 1 día | SRI no se rompe en la próxima actualización |
| 1.5 | **Reglas de datos sensibles**: auditar que `productos.costo = 0` (catálogo seeded) no alcance al margen del dashboard; backfill con costo real por producto antes de usarlo como insumo de decisión | 4–8 h | `costo > 0` para todos los productos activos |
| 1.6 | **Presupuesto de límite de sesión correcto**: 8 horas para caja es agresivo para un solo turno; evaluar 4h + logout automático al cerrar caja | 2–4 h | Política alineada a operación real |
| 1.7 | **Checklist de backup semanal**: export `pedidos` del día a CSV (endpoint o scheduled job) y guardado fuera de Neon ocupado emision a usuario | 4–8 h | RPO ≤ 24h independiente de Neon |

## P2 — Funcionalidad de uso real (mes 1–2)

| # | Acción | Esfuerzo | Resultado |
|---|--------|----------|-----------|
| 2.1 | **Stock**: columna `stock`, descuento al confirmar pedido (con lock) y umbral mínimo por producto; ítems agotados se ocultan o marcan automáticamente | 2–3 días | Catálogo que refleja realidad operativa |
| 2.2 | **Workflow de pedido**: `Nuevo → En preparación → Entregado` / `Cancelado`, con timestamps y auditoría; idempotente para reintentos (hoy `gasto_operaciones` ya funciona así para gastos; replicar patrón) | 2–4 días | Reiintentos de operador no duplican comandas |
| 2.3 | **Comanda de cocina**: impresión automática al guardar (botón imprimible; `window.print()` layout limpio). **Aplicada 2026-11-10** — auto-print activable con checkbox «⬇ Imprimir comanda al guardar»; reimprimir desde tarjetas del POS e historial | 1–2 días | Cocina recibe pedido sin abrir el POS |
| 2.4 | **Márgenes de productos**: dashboard para utilidad por producto/rango, considerando `costo` corregido; objetivo entender qué eliminar del menú | 1 día | Decisión de carta en 5 min |
| 2.5 | **Google Sheets → reporting plane**: si el POS escribe en Sheets, generar la vista "pedidos del día" para el encargado sin abrir el POS; si se hace inestable, reemplazar por endpoint + CSV paginado | 2–4 días | Encargado ve la operación sin tocar el POS |
| 2.6 | **"Mi sesión" → estado de caja**: en una sola vista, `Activos/Total hoy/Caja pendiente`, accesible desde móvil para cierre rápido | 1 día | Cierre real en 2 min desde el celular del encargado |

## P3 — Consolidación (trimestre)

| # | Acción | Esfuerzo | Resultado |
|---|--------|----------|-----------|
| 3.1 | **Eliminar `'unsafe-inline'` de `script-src`**: mover todos los inline JS a archivos externos (los admin pages aún los tienen); validar con CSP report-only primero | 2–4 días | XSS inline imposible por más que una inyección exista |
| 3.2 | **PWA / offline-first**: cachear el catálogo más reciente y encolar pedidos pendientes. **Parcial 2026-11-10** — cola persistente de un pedido pendiente en `localStorage` (reintento idempotente) y caché del catálogo con ETag/304; falta encolar múltiples pedidos, service worker y manifest | 3–5 días | Ventas no se pierden por corte de internet ni por caída de Neon |
| 3.3 | **Observación de Neon**: dashboard de saturación de conexiones de pool y queries lentas (`pg_stat_statements`), con umbral | 1 día | Caídas por agotamiento de pool detectadas antes de ser incidentes |
| 3.4 | **i18n** if expansion to other Venezuelan cities: move all strings into one module; simplify env. Effort no at this stage constraint | 3–5 días | Múltiples sedes con el mismo código |
| 3.5 | **TEST más natural**: script `scripts/smoke.js` que valida el deploy completo tras merge a master (hoy se hacen a mano) | 1 día | Verificación de producción en 10 segundos |

## Findings abiertos desde las pruebas de uso real (2026-11-10)

- El POS **sí** crea pedidos end-to-end (`POST /api/pedidos` → 201, order #1 con `Arepa Dominó` $10.000 en BD efímera), pero el POS de producción hoy **tampoco funciona en blanco fiable** porque `api-client.js` + `pos-*.js` eran 404 con el bug `path.resolve` (corregido).
- El índice `idx_pedidos_fecha_civil` ya es aplicado con éxito en la base; `EXPLAIN` muestra **Index Scan** (no seq scan) en el filtro de rango.
- `to_date` en búsquedas de pedidos/dashboard era NO-IMMUTABLE; corregido con predicado lexicográfico (`split_part`). Tests 57/57 verdes localmente.
- `isPlaceholderDatabaseUrl` marcaba `localhost` como plantilla (causa de `ECONNREFUSED 5432`), corregido y con tests.
- Las pruebas de uso real se hicieron contra una base local efímera (Docker `sabor58-testdb`) con credenciales desechables; **no se escribió nada contra Neon** ni se alteró la base de producción.
- El cierre de sesión invalidó correctamente el token (`/api/auth/me` → 401 tras logout), el pedido quedó registrado con `estado = "Nuevo"` y el `Total hoy: $10.000` se reflejó en el header del POS.
- `NODE_ENV` **no está declarado** en `.env` local; production debe declararlo para que HSTS y `__Host-` funcionen (hoy no aplican en localhost).
- Aviso de limpieza: los tests emiten `circular dependency` (`connection.js`) al requerir exports parciales; no es un fallo pero debe limpiarse cuando se dividan `server.js` y `connection.js`.
