# Plan — Pestaña de Pedidos (Cola de preparación)

> Documento de diseño para la nueva pestaña de pedidos en la app POS.
> **No implementado aún** — esto es solo el plan para revisión y aprobación.
> Complementario a `PLAN_MEJORAS.md`. Código en `master` (Render); nada llega al vivo hasta redeploy.

---

## 1. Objetivo

Convertir el panel actual "Pedidos" en una estación de preparación estilo KDS (Kitchen Display System) dentro del POS:

- Cada pedido que entra (`Nuevo`) aparece en una cola visual y cronológica.
- Estado secuencial e irreversible del ciclo: **Nuevo → En preparación → Listo → Entregado**.
- Cola FIFO global del día (más nuevo primero, según `ORDER BY id DESC` existente).
- Cocina/un encargado puede marcar cada transición con botones grandes, sin abrir detalles.
- Los pedidos de hoy se sincronizan en tiempo real con `GET /api/pedidos` que ya consume el POS.

El objetivo operativo es que la cocina sepa **qué falta** en vez de recibir comandas aisladas en papel.

## 2. Contexto técnico actual (verificado en este repo)

| Capa | Estado | Detalle |
|------|--------|---------|
| `pedidos` table | existe, sin columnas KDS | `id, numero, cliente, telefono, direccion, metodo_pago, notas, items jsonb, subtotal, total, fecha, hora, entregado bool DEFAULT FALSE, estado text DEFAULT 'Nuevo'` |
| Transiciones existentes | limitadas | `entregado` es el único botón de cambio de estado. `estado` hoy se actualiza implícitamente según `entregado` (`'Entregado'`) o como flag al editar. No existe `'En preparación'` ni `'Listo'`. |
| API existente | parcial | `GET /api/pedidos?fecha` retorna pedidos del día `ORDER BY id DESC`; `PUT /api/pedidos/:id` edita arbitrariamente, sin idempotencia. La premisa actual es que el cliente hace `fetch` cada 30 s (`setInterval(verificarServidor, 30000)` en `pos-ui.js`) — sin pushed events. |
| Sheets sync | opcional, hoy 500 | `POST /api/google-sheets` tira 500/502 porque `SHEET_PROXY_URL` no está configurada en Render. La cola NO debe depender de Sheets. |
| POS UI | básico | `data-tab-target="pedidos"`, `[data-tab-panel]`; ARIA existente; CSS con tokens en `index.html`. |
| Offline today | parcial | D1 (esta sesión) persiste un pedido pendiente en `localStorage['sabor58:pedido-pendiente-v1']` y reintenta idempotentemente. El POS ya tiene infraestructura de "respuesta perdida". |

### Hoy el POS lista pedidos, pero NO tiene gestión de cola

- Ve la lista en "Pedidos" con botones `✏️ Editar`, `🖨️ Comanda`, `✓ Entregar`.
- No hay forma rápida de ver qué está pendiente en cocina vs. qué ya está listo para entrega.
- "Entregar" salta directo a `estado = 'Entregado'` sin pasar por `Lísto`.

## 3. Requisitos

### 3.1 Funcionales

| # | Requisito |
|---|-----------|
| RQ-01 | Nueva pestaña **«Cola»** junto a Pedidos / Gastos / Dashboard en el POS (`index.html`). |
| RQ-02 | Pedido nuevo (`estado = 'Nuevo'`) aparece en la cola en el siguiente refresh sin interacción. |
| RQ-03 | Transiciones con un clic: `Nuevo → En preparación`, `En preparación → Listo`. `Listo → Entregado` reusa el botón actual. |
| RQ-04 | El estado global del POS refleja el `estado` actual: badge de cola pendientes; badge de listos. |
| RQ-05 | Cola FIFO del día: eventos en la misma fecha y estado visible; más reciente al inicio. |
| RQ-06 | La cola funciona offline (muestra pedidos en caché); las mutaciones requieren red (el `estado` no se inventa localmente, se confirma contra el servidor). |
| RQ-07 | Impresión de comanda desde cada tarjeta de "Listo"/"En preparación" sin salir de la cola (reusa `imprimirComanda` ya implementado). |
| RQ-08 | Aiso la cola de otros paneles: no filtra información de pago de otros roles innecesariamente; solo muestra: numero, items, total, notas, hora. |

### 3.2 No funcionales

- **Idempotencia**: transiciones duplicadas no corrompen; `UPDATE … WHERE estado = 'Esperado'` dentro de una transacción hará que el segundo clic sea no-op (mismo `estado` ya alcanzado).
- **Rendimiento**: listada con índice por `(fecha, estado, id)`, sin cargar todo el histórico.
- **Acceso**: respeta los permisos del rol; endpoint restringido igual que `/api/pedidos` (todos los roles autenticados). `consulta` puede ver pero no mutar (regla existente al `/api/admin`).
- **No escritura manual en Neon**: cualquier migración se hace por `npm run migrate` tras revisión/coordinación.
- **TTFF < 150 ms** para `GET /api/pedidos/cola` (la tabla ya tiene índice `idx_pedidos_fecha_civil`, más un índice compuesto nuevo).
- **No dependencias de pago** ni Chrome APIs exclusivas más allá de `window.print()` ya usado en D2.
- **Security headers intactos** (CSP/HSTS/nosniff).

### 3.3 Fuera de scope

- Facturación colombiana/venezolana (NFR de esta entrega).
- Integración con impresora térmica real (vía `window.print()` por ahora).
- Gestión de inventario/stock en la cola (requiere `stock`, item count, etc.; queda en el plan de mejoras).
- Multi-sede (`sede_id`); un solo sitio por ahora.
- Sistema de notificaciones push (SSE/WebSocket). Ver §8 Polling vs SSE.

---

## 4. Modelo de estados

```
   POST /api/pedidos
        │
        ▼
   ┌─────────┐   click"En prep"   ┌──────────────────┐   click"Listo"   ┌─────────┐   click"Entregar"   ┌────────────┐
   │  NUEVO  │  ───────────────► │  EN PREPARACIÓN  │  ─────────────► │   LISTO  │  ─────────────────► │ ENTREGADO │
   └─────────┘                   └──────────────────┘                 └─────────┘                    └────────────┘
```

- **NUEVO**: pedido creado, cocina no lo tocó aún. Tarjeta visible en columna "Nuevo".
- **EN PREPARACIÓN**: cocina lo tomó. Tarjeta en columna "En preparación"; no debe volver a "Nuevo".
- **LISTO**: cocina lo terminó. Tarjeta en columna "Listo"; cajero lo entrega.
- **ENTREGADO**: fin del flujo. Sale de la cola visible del día (queda en historial).
- **Cancelado** (futuro): no implementado en esta fase; usar `estado = 'Cancelado'` + `entregado = false` dejaría el pedido en cola; no es aceptable. Será un nuevo estado cuando se requiera anulación del trabajo.

### Esquema conceptual `pedidos` tras Fase F1

```sql
ALTER TABLE pedidos
  ADD COLUMN IF NOT EXISTS preparacion_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS listo_at       TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS preparado_por  INTEGER REFERENCES empleados(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS listo_por      INTEGER REFERENCES empleados(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_pedidos_fecha_estado
  ON pedidos (fecha, estado, id DESC);
```

Migración: `migrations/0002_pedidos_cola.sql` — idempotente, revisada antes de aplicar.

### Tabla de permisos por transición

| Transición | Quién | Rol mínimo | Notas |
|------------|-------|-----------|-------|
| Nuevo → En preparación | Cocina / Caja / Admin | `caja` | solo 1 clic |
| En preparación → Listo | Cocina / Caja / Admin | `caja` | timestamp `listo_at` |
| Listo → Entregado | Caja / Admin | `caja` | timestamp |
| Cualquier → Nuevo (revertir) | Admin | `admin` | fuera de este plan; requiere audit log |

---

## 5. API

### 5.1 `GET /api/pedidos/cola?fecha=DD/MM/YYYY`

Respuesta `200`:

```json
{
  "fecha": "10/11/2026",
  "columnas": [
    { "id": "nuevo",        "label": "Nuevo",         "count": 1 },
    { "id": "preparando",   "label": "En preparación","count": 1 },
    { "id": "listo",        "label": "Listo",         "count": 1 }
  ],
  "pedidos": [
    {
      "id": 1,
      "numero": 1,
      "hora": "04:15 p. m.",
      "cliente": null,
      "items": [ { "id": 1, "nombre": "Arepa Dominó", "qty": 1, "precio": 10000 } ],
      "total": 10000,
      "notas": null,
      "estado": "Nuevo",
      "preparacion_at": null,
      "listo_at": null
    }
  ]
}
```

Cacheable por 5 s con `Cache-Control: no-cache` (mismo origen que hoy, sin ETag necesario hasta saber si ahorra).

### 5.2 `POST /api/pedidos/:id/transicion`

Body:

```json
{ "transicion": "prep" }     // 'prep' | 'ready' | 'entregar'
```

Respuesta `200`:

```json
{
  "id": 1, "numero": 1,
  "estado": "En preparación",
  "preparacion_at": "2026-11-10T21:33:00-04:00",
  "prep": true, "ready": false
}
```

Respuestas a validar con tests:

- `401` sesión inválida
- `403` rol no autorizado
- `404` pedido inexistente
- `409` transición inválida (ej. `Entregar` desde `Nuevo`); responde `{ "error": "transición inválida", "from": "Nuevo", "to": "…" }`
- `200` no-op si ya estaba en ese estado (idempotencia)

### 5.3 Reutilizado sin cambios

- `GET /api/pedidos?fecha=` sigue mostrando los pedidos de hoy en la vista "Pedidos" (historial/panel clásico).
- `PUT /api/pedidos/:id` sigue existiendo para editar; el cajista **no** debe usarlo para transiciones ephémeras.
- `POST /api(/pedidos)` sigue el mismo contrato de `items`/`total`.

---

## 6. UI / UX

### 6.1 Wireframe (lienzo de 800×621)

```
┌────────────────────────────────────────────────────────────┐
│ 📦 COLA                  Hoy 10/11/2026      [🔄 Actualizar]│
├───────────┬──────────────────┬─────────────────────────────┤
│ NUEVO (1) │  EN PREPARACIÓN  │  LISTO                       │
│           │  (1)             │  (1)                         │
│  #1 Arepa │  #2 Perr. Esp.   │  #3 Arepa La Pelúa (Costeño) │
│  $10.000  │  $14.000         │  $14.000                     │
│  1× Arepa │  2× Perr. Esp.   │  1× Arepa La Pelúa           │
│  16:15    │  16:20           │  16:25                       │
│  [Cocinar]│  [Listo ✓]       │  [Entregar]                  │
│           │  [🖨️ Comanda]    │  [🖨️ Comanda]   [📋 Ver]     │
├───────────┴──────────────────┴─────────────────────────────┤
│  Total hoy: $38.000 · Activos pendientes: 2                │
├────────────────────────────────────────────────────────────┤
│  [Sonido: ON]  [Auto-refresh: ON]  [Imprimir auto]          │
└────────────────────────────────────────────────────────────┘
```

### 6.2 Reglas de pantalla

- **Grid de 3 columnas en desktop** ≥ 1024 px; **2 columnas** en tablet; **1 columna** en móvil (≤ 640 px) con las mismas tres secciones Apiladas (colapsadas con `<details>`).
- Tarjetas compactas, siempre con el mismo layout: `#numero · hora`, `items count`, `total` y un botón de acción.
- **Touch targets ≥ 44 px** (accesibilidad móvil ya usada en el POS).
- **Sonido opcional**: campana suave (`Web Audio API`, 3 tonos 880/660/440 Hz, 40 ms). Botón toggle; por defecto ON en cocina.
- **Auto-refresh**: polling 4 s; botón `⏸ Pausar refresh` visible.
- **Manejo vacío**: cada columna muestra "Nada aquí" / "Sin comandas en este estado".
- **Confirmación**: al pasar a `Listo` se muestra toast (2 s) con el número de pedido. Al `Entregar` se usa el toast existente.
- **Impresión**: botón `🖨️ Comanda` reusa `imprimirComanda(order)`; no se llama automáticamente en la cola (evita doble print al reimprimir).
- **Accesibilidad**: roles `region`, `aria-live="polite"` en cada columna; navegación por teclado; `aria-pressed` en los toggles (Sonido / Auto-refresh).

### 6.3 Archivo(s) nuevos

- `cola.css` o embebido en `index.html` (preferible esta última hasta que el bloque supere ~250 líneas).
- `pos-cola.js` — nuevo módulo; expone: `renderCola()`, `getCola()`, `transaccionarPedido(id, 'prep'|'ready'|'entregar')`, `startColaRefresh()`.
- `pos-cola.test.js` — tests unitarios del render y de la lógica de transición cliente.

### 6.4 Integración suave con el plan D1/D2 previos

- El POS ya imprime comanda tras guardar; la cola **no** re-imprime por defecto.
- El POS ya reintenta pedido perdido offline; la cola muestra ese mismo pedido ya confirmado.

---

## 7. Fases y esfuerzo

| Fase | Alcance | Archivos | Esfuerzo (1 dev) | Riesgo |
|------|---------|----------|------------------|--------|
| F0 — Definir contigo | aprobar estados Extra (Cancelado?) y roles de consola | `PLAN_COLA_PEDIDOS.md` | 0.5–1 h | Bajo |
| F1 — Base de datos | migración `0002_pedidos_cola.sql` + tests de esquema | `migrations/`, `scripts/migrate.js` | 1 día | Bajo |
| F2 — Backend | `GET /api/pedidos/cola`, `POST /api/pedidos/:id/transicion`, tests unit + integración contra Docker efímera (igual que esta sesión) | `src/controllers/pedidos.controller.js`, `src/services/pedidos.service.js`, routes | 1–1.5 días | Medio (SQL atómico, idempotencia) |
| F3 — UI | nueva pestaña `Data-tab-target="cola"` + `pos-cola.js` + CSS + dnd; reusa estándar del POS | `index.html`, `pos-cola.js` | 1 día | Bajo (UI conocida) |
| F4 — QA + deploy | suite de tests + smoke manual post-deploy; redeploy Render; probar en prod con pedido sintético | — | 4–8 h | Bajo |
| **Total** | | | **~4–5 días** | |

### Dependencias

- F0 aprobada.
- Migración ejecutada contra Neon en coordinación con el operador (acordado: **nunca** mutar prod sin consentimiento).
- Transiciones atómicas implementadas con `UPDATE … WHERE estado = ? RETURNING …` para evitar carreras.

---

## 8. Polling vs SSE

| Criterio | Polling 4 s | SSE (text/event-stream) |
|----------|-------------|--------------------------|
| Complejidad | mínima; reusa `fetch`, layout conocido | requiere mantener 1 conexión abierta por cliente; no cacheable por navegador; endpoints especiales |
| Latencia | ≤ 4 s | < 100 ms |
| Costo servidor | 15 req/min por cliente (negligible) | 1 conn abierta; bloquea 1 thread en http clásico (Node es async, no bloquea) |
| Soporte navegador | 100% | `EventSource` — 100% (no WebSockets) |
| Reenvío/reconexión | natural vía `setInterval` | automática con `id` y `Last-Event-ID` |
| Escalado futuro | OK hasta ~30 clientes concurrentes | Necesario si > 50 dispositivos en cocina o salas remotas |
| Render free plan | funciona (Vercel/Render mantienen SSE si `Cache-Control: no-cache` + keep-alive) | funciona; requiere confirmación del proxy |
| Recomendación **MVP** | **Sí** (esta fase) | Upgrade si la operatividad lo exige (ver Fase F4) |

**Decisión: Polling por ahora** (4 s). La cocina ve los cambios casi al instante y no se compromete la arquitectura. Si después se desea SSE, se aisla detrás de `/api/pedidos/cola/events` sin cambiar la UI (una de las funciones de `pos-cola.js` lo consume).

---

## 9. Riesgos y mitigaciones

| Riesgo | Impacto | Mitigación |
|--------|---------|------------|
| Doble clic rápido "Listo" → estado corrompido | duplica transición | `UPDATE ... WHERE estado = 'En preparación' RETURNING ...`; segundo clic recibe 0 filas → 409 no-op |
| Cocina marca como Listo un pedido que aún no está | error operativo | requiere pulsar botón → confirmación existe (toast previo con nombre de pedido #); supervisor audita vía `listo_por` |
| Neon caído durante servicio | cola queda sola | cola degrada a solo lectura con últimos datos en `sessionStorage`; mutaciones se encolan (`pendientes_transicion[]`) y se reintentan al recuperar |
| 2 dispositivos mantienen columnas desincronizadas | confusión | mismas queries, misma fecha; mostrar siempre `id` y `hora` para que el operador cruce visualmente |
| Pedidos de prueba contaminan el día real | cocina confundida | usar pedido sintético (`notas = 'QA'`) y eliminarlo al terminar smoke |
| `SHEET_PROXY_URL` no configurado | Sheets falla | cola no depende de Sheets; el POS actual ya tolera Sheets caído (hasta hacer configurable la sync). |
| Neon pool agota conexiones | CPU sobrecosto | `max` del pool actual es 10; polling 4 s con 5 dispositivos = 75 req/min; aceptable; ampliar a 20 si entra segundo turno |
| `items` grande en JSON → payload pesado | TTFB | `items` ya está en `pedidos` tabla; se retorna tal cual; sin paginación (máximo 30 pedidos activos por día esperados) |
| Viewport móvil estrecho | layout roto | desktop 3-col → tablet 2-col → móvil 1-col colapsado con `<details>` |

---

## 10. Checklist de implementación/despliegue (coordinación)

### Antes de empezar

- [ ] F0 con el usuario: ¿se necesita estado `Cancelado`? ¿`preparado_por` de verdad hace falta o basta con hora?
- [ ] Verificar que master master está clean (`git status` limpio).
- [ ] Levantar Docker efímera (`sabor58-testdb3`) y conectar con `psql` para sanity-test de la migración antes de tocar Neon.

### Durante desarrollo

- [ ] F1 migración → `psql -d test -c "\d pedidos"` confirma columnas.
- [ ] F2 unit tests (servicio: `/api/pedidos/cola` · `/transicion`): 80%+ coverage sobre lo nuevo.
- [ ] F3 sync conflict manual (2 ventanas del POS abiertas: marcar igual desde ambas).
- [ ] `npm test` verde.

### Antes de `master` / Render

- [ ] `smoke.js` equivalente: levantar app contra BD efimera + flujo completo aceptar pedido → En preparación → Listo → Entregado.
- [ ] Documentar en `QA_CHECKLIST.md` qué se probó, para no repetir todo en prod.

### Deploy (operador)

1. (Coordinado) `psql` — aplicar migración 0002 a Neon.
2. Redeploy en Render (`Manual Deploy > Clear cache & deploy latest commit`, `master`).
3. `NODE_ENV=production` declarado; `DATABASE_URL` intacto.
4. Smoke real: crear 1 pedido de prueba en POS → verificar aparece en Cola → `Preparando` → `Listo` → `Entregar`.
5. Eliminar el pedido sintético (`DELETE /api/pedidos/:id` como admin) o marcar `estado='Cancelado'` cuando el estado exista.

### KPIs a observar primera semana

- % de pedidos que pasan por `En preparación` (debería ser ~100% en uso normal)
- tiempo mediano `preparacion_at` → `listo_at`
- deploy rollback: si `5xx` > 1% en 15 min, revertir migración (`migrations/0002_down.sql`) — verificar previamente en efímera.

---

## 11. Decisión abierta / preguntas para el usuario

1. ¿En esta fase se requiere `Cancelado` (o "Anulado") para que un pedido ya en cola pueda ser cancelado sin entregarlo?
2. ¿Qué roles ven la pestaña "Cola"? hoy `caja` y `admin` la verían; ¿`consulta` también?
3. ¿Deseas sonido siempre on, o con toggle por dispositivo?
4. ¿Print automático de la comanda al pasar a `Listo` (doble ticket impreso) o solo el `window.print()` manual?
5. ¿`listo_por`/`preparado_por` para auditoría? Si la respuesta es sí, se añade FK a `empleados` en `0002_pedidos_cola.sql`.

Una vez respondido, esta guía se convierte directamente en ruta de implementación.
