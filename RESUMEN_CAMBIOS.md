# Resumen de cambios — Sabor +58 (Sesión 2026-11-10)

## Dropdown de Método de pago
- Archivo: `index.html`
- Fix: regla global `.pedido-campo option { background:#fff; color: var(--negro); }` (cubre los 3 selects). Se eliminó la regla duplicada `.gasto-card .pedido-campo option`.
- Verificado: todos los `<option>` computan `color: rgb(15,15,15)` sobre `background: rgb(255,255,255)`. Suite 66/66 verdes.

## Cola de pedidos (P1)
- Archivos: `pos-cola.js`, `index.html`
- **FIFO:** sort cambió de `b.id - a.id` a `a.id - b.id` (línea de `for...sort`).
- **Aging:** función `minutosDesde(hora)` ahora soporta formato 12h (`3:45 p. m.`, `3:45 PM`) y 24h (`15:20`). Badges: `ok` (<10 min, verde/gris), `warn` (≥10 min, ámbar), `late` (≥15 min, rojo con parpadeo `colaLateBlink`).
- **Legibilidad:** `.section-pill` tiene chip propio `#181410` / `#F5C518`; `.cola-card-numero` Bebas Neue 23.2px; `.cola-card-items` Nunito 16px/700; `.cola-card-meta` `overflow-wrap: anywhere`.
- **CSS roto `.cola-shell`:** regla `display:flex` propio, `.cola-head` con layout `flex-end` y gap 14px.

## Cierre de caja (P1)
- Archivos: `index.html`, `admin-caja.html`, `admin-caja.html` script
- **Nav SPA:** enlace `💵 Cierre de caja` tipo `<a class="app-tab" href="/admin-caja">`, con `focus-visible` style.
- **Panel pre-cierre:** HTML + CSS `.pre-close` (grid, filas con título/valor, input `conteo-fisico`, diff `pc-diff-row` oculto/visible). Solo visible cuando caja está `abierta`.
- **renderPreClose/liveDiff:** muestra Apertura/Ventas/Gastos/Final esperado + diferencia con el conteo físico en tiempo real (se oculta al vaciar el input).
- **closeCaja():** confirmación de dos pasos: (1) "¿Cerrar la caja del ...? Apertura/Ventas/Gastos/Final esperado/Efectivo físico/Diferencia"; (2) si |físico−final| ≥ 1, confirmación extra "Atención: diferencia de X. ¿Cerrar igualmente?".
- QA en vivo: caja abierta con apertura $100.000, ventas $232.000 → final esperado $332.000; diff −$2.000 / +$8.000 / $0 verificado correctamente.

## Localización fmt/locale/tz (no rieles de pago)
- Archivos modificados (13): `pos-core.js`, `pos-pedidos.js`, `pos-gastos.js`, `report-tools.js`, `src/server.js`, `src/services/reporting.utils.js`, `admin.html`, `admin-gastos.html`, `admin-productos.html`, `admin-caja.html`, `admin-dashboard.html`, `admin-categorias.html`, `apps-script/Code.md`.
- `es-CO → es-VE` y `America/Bogota → America/Caracas` en todos los `Intl.NumberFormat` y `Intl.DateTimeFormat`.
- Quitado `currency: 'COP'` en 4 archivos admin; ahora usa `'$' + new Intl.NumberFormat('es-VE', { minimumFractionDigits: 0, maximumFractionDigits: 2 })`.
- **No se tocaron** métodos de pago (Nequi/Daviplata/Colombia) — según decisión.

## Incidentes recuperados
- Dos batches PowerShell dañaron 13 archivos (mojibake UTF-8 y `$'` duplicado). Recuperados con `git checkout HEAD -- <13 archivos>` y re-edición segura con `edit` tool. Nada se commiteó ni empujó.

## Tests
- 66/66 verdes.
- Fixes aplicados:
  - `routes.test.js`: `handleCaja` ya no hardcodea `2026-11-10`; ahora assert contra `formatIsoDate()` (hoy Caracas).
  - `exports.test.js`: `admin-dashboard.html` tiene CRLF; se normaliza `\r\n → \n` antes de cortar el script por el marcador `presetButtons.forEach(...)`. Los 2 fallos `applyRangeBtn.addEventListener is not a function` quedaron resueltos.

## Incidente y recuperación 2026-11-17
- Un `git checkout HEAD -- .` accidental descartó los cambios sin commitear de la sesión anterior (15 archivos).
- Se recuperaron 14 archivos completos desde blobs huérfanos del object store de git (verificados: diff stats idénticos a los pre-pérdida, marcadores es-VE/pre-close/FIFO presentes).
- `pos-cola.js` se recuperó de un blob intermedio (30 vs 36 líneas del diff original): la única pieza faltante era el parse de hora 12h en `minutosDesde`, reconstruido según la spec del RESUMEN (`3:45 p. m.`, `3:45 PM`, `15:20`). Marcado con comentario RECONSTRUIDO en el código.
- `opencode.json` recuperado reescribiéndolo (Figma + Render MCP con placeholder `{env:RENDER_API_KEY}`; la key literal vive en variable de entorno User, no en git).

## Estado del git
- 15 archivos modificados (`admin-caja.html`, `admin-categorias.html`, `admin-dashboard.html`, `admin-gastos.html`, `admin-productos.html`, `admin.html`, `apps-script/Code.md`, `index.html`, `pos-cola.js`, `pos-core.js`, `pos-gastos.js`, `pos-pedidos.js`, `report-tools.js`, `src/server.js`, `src/services/reporting.utils.js`).
- `.impeccable/` untracked (snapshot de la crítica, no commiteado).
- HEAD = `d08ef66` (sin commits ni pushes a producción/Neon/Render).