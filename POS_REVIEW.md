# Revisión del registro de pedidos

Fecha: 2026-11-09. Superficie: `index.html` y servicio de pedidos.

## Hallazgos corregidos

- Una respuesta fallida al crear se presentaba como un pedido guardado en memoria y vaciaba el carrito. Ahora el carrito se conserva y el error permanece visible.
- La doble invocación de guardar podía enviar dos solicitudes. Ahora se bloquea mientras la primera está pendiente.
- Las ediciones, entregas y eliminaciones alteraban la pantalla sin comprobar la respuesta HTTP. Ahora requieren confirmación y no sincronizan cambios rechazados a Sheets.
- Los totales recibidos del navegador se aceptaban sin recalcular. Ahora se calculan desde las líneas al crear y editar, validando cantidades enteras, precios enteros y límites de almacenamiento.
- Nombres, descripciones, datos del cliente y notas se interpolaban como HTML en el POS. Ahora se escapan; los controles de cantidad usan listeners en lugar de interpolar identificadores en JavaScript.
- El refresco consultaba resumen y lista: tres consultas SQL por ciclo. Ahora consulta la lista una vez y calcula el resumen visible. Se omite cuando la pestaña está oculta o hay una operación pendiente.
- Hora de registro y fecha inicial del historial usan Bogotá.

## Revisión estética

Se conserva la identidad existente: crema, negro, amarillo y rojo; Nunito y Bebas Neue. El catálogo necesita una cuadrícula repetitiva para comparar productos rápidamente.

- Fondo del catálogo menos saturado; bordes suaves y sombras ligeras.
- Precios y nombres con mayor jerarquía; descripciones y estados vacíos con mejor contraste.
- Productos accesibles mediante botones de teclado, foco visible y controles de cantidad etiquetados.
- Campos móviles de 16 px, controles táctiles mayores y respeto de movimiento reducido.
- Se elimina el pulso continuo del estado y la transición de altura de los datos del cliente.
- La franja amarilla del encabezado y el fondo crema son decisiones de identidad preexistentes; se conservan pese a advertencias genéricas del detector.

## Verificación y límites

- `npm test`: suite local con servicios simulados; no escribe en Neon.
- Navegador con API sintética local: agregar, guardar, editar y entregar funcionaron. Dos adiciones al carrito tomaron aproximadamente 6,8 ms en una muestra; no constituye un benchmark de producción.
- Layout comprobado mediante frames de 1200 y 390 px: sin desbordamiento horizontal y botón de guardar dentro del viewport con el carrito abierto.
- Se inspeccionó una captura a 800 px. Las capturas finales de escritorio/móvil quedaron bloqueadas porque la ventana del navegador dejó de estar visible; la validación visual final sigue pendiente.
- Falta verificar persistencia real y latencia con Render/Neon cuando se retome la configuración de acceso.
- El alta de pedidos todavía no tiene claves de idempotencia ni numeración atómica entre terminales. Una respuesta perdida requiere revisar la lista antes de reintentar. El bloqueo de doble clic no resuelve ese caso.
- El carrito retenido vive en la página: no es una cola offline persistente. Sheets sigue siendo una copia secundaria cuya entrega depende de su integración actual.

## Figma

Configurado en `opencode.json`, usando `mcp.servers.Figma`. La comprobación devolvió HTTP 405; no se confirma conexión. Revisar el servidor desde `/mcps` y completar OAuth si se solicita. No se utilizaron diseños de Figma en esta revisión.
