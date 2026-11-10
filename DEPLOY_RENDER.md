# Deploy en Render

## Requisitos

- Base de datos Neon activa y accesible.
- `DATABASE_URL` con la cadena de conexión de Neon.
- Node.js 18+ en Render.

## Build y start

- Build Command: `npm ci`
- Start Command: `npm start`

## Variables de entorno

### Requeridas

- `DATABASE_URL`.
- `NODE_ENV=production` (activa cookies `Secure`, requiere HTTPS).
- `APP_ORIGIN`, por ejemplo `https://pedidos58.onrender.com`, sin rutas. Debe coincidir con el origen usado por los empleados.
- Para el primer arranque: `AUTH_ADMIN_USER` y `AUTH_ADMIN_PASSWORD` (12–128 caracteres). El usuario admite 3–64 caracteres: letras minúsculas, números, punto, guion y guion bajo.

### Opcionales

- `ALLOWED_ORIGINS`: lista de orígenes permitidos separados por comas, solo si el frontend se sirve en otro dominio. Por defecto la API funciona con las páginas del mismo origen; no se permite CORS universal.

El acceso de empleados está diseñado para frontend y API en el mismo origen. `ALLOWED_ORIGINS` no habilita sesiones entre dominios ni permite mutaciones desde otros orígenes.

### Si usas sincronizacion con Google Sheets

- `GOOGLE_SHEETS_WEBAPP_URL`.

### Gestionada por Render

- `PORT`.

## Pasos de despliegue

1. Crear o verificar la base Neon.
2. Copiar la cadena de conexión en `DATABASE_URL`.
3. En Render, crear un **Web Service** desde el repositorio.
4. Seleccionar la carpeta raiz del proyecto si aplica.
5. Configurar el Build Command como `npm ci`.
6. Configurar el Start Command como `npm start`.
7. Agregar las variables de entorno.
8. Desplegar y esperar el primer arranque.

## Verificacion posterior

Probar estas rutas:

- `GET /api/health`
- `GET /api/categorias`
- `GET /api/productos`
- `GET /api/gastos`
- `GET /api/gastos/export`
- `GET /api/dashboard/resumen`
- `GET /api/dashboard/productos-top`
- `GET /api/dashboard/productos-ranking`
- `GET /api/dashboard/ventas-diarias`
- `GET /api/dashboard/categorias`
- `GET /api/caja`
- `POST /api/caja/abrir`
- `POST /api/caja/cerrar`
- `GET /admin`
- `GET /admin-dashboard`
- `GET /admin-caja`
- `GET /admin-gastos`
- `GET /admin-productos`
- `GET /admin-categorias`

Ejemplos:

```bash
curl https://<tu-servicio>.onrender.com/api/health
curl https://<tu-servicio>.onrender.com/api/categorias
curl https://<tu-servicio>.onrender.com/api/productos
```

## Notas

- Las solicitudes POST/PUT/PATCH requieren un objeto JSON y `Content-Type: application/json`; el límite es 1 MiB. JSON inválido responde 400, tipo no admitido 415 y tamaño excesivo 413.
- El proxy de Sheets tiene un timeout de 15 segundos. Los errores internos de la API no muestran detalles al cliente.
- Ejecutar `node --test test/*.test.js` para verificar protecciones HTTP, escape de datos y autenticación. Las pruebas automatizadas de HTTP usan servicios simulados; no escriben en Neon.

- El arranque reintenta la inicializacion de Neon si hay latencia temporal.
- En el primer despliegue puede tardar mas por verificacion de schema y carga de semillas.
- El schema ahora incluye la tabla `cajas` para el cierre diario.
- Si no defines `GOOGLE_SHEETS_WEBAPP_URL`, la ruta `/api/google-sheets` respondera con error y la sincronizacion con Sheets quedara deshabilitada.

## Acceso de empleados

Todas las pantallas y APIs operativas requieren sesión. Son públicos únicamente `/login`, `/mi-sesion` (contenedor sin datos), `/auth-client.js`, el inicio de sesión y `GET /api/health` para Render.

El primer arranque crea `empleados`, `empleado_sesiones` y `auth_login_limits`. Si no existen empleados, requiere las dos variables `AUTH_ADMIN_*`; no hay contraseña por defecto. Tras crear el administrador, retirar esas variables de Render. Los reinicios no cambian contraseñas ni recrean usuarios cuando ya existen empleados.

| Rol | Permisos |
| --- | --- |
| `admin` | Todas las operaciones existentes, incluidas eliminaciones y catálogo. |
| `caja` | POS, lectura de reportes, creación/edición de pedidos y gastos, apertura/cierre de caja y operaciones conocidas de Sheets. Sin eliminar registros ni editar catálogo. |
| `consulta` | Panel de pedidos y dashboard; lectura de APIs y exportaciones. Sin escrituras ni acceso al proxy de Sheets. |

Las sesiones duran 8 horas y se almacenan como hashes en PostgreSQL. Las cookies son `HttpOnly`, `SameSite=Strict` y `Secure` en producción. Cada solicitud vuelve a verificar que el empleado siga activo. `/mi-sesion` permite cerrar sesión. Una sesión vencida redirige a `/login` cuando la página realiza una solicitud a la API.

Las mutaciones requieren un encabezado `Origin` igual a `APP_ORIGIN` (incluido login y logout). Las pruebas manuales con curl deben enviarlo junto a la cookie y `Content-Type: application/json`. El límite de acceso es 10 intentos por usuario, 20 por IP (primera l\u00ednea de `X-Forwarded-For`) y 100 globales por ventana de 15 minutos; responde 429 al superarlo.

### Crear o desactivar empleados

Desde una terminal autorizada con acceso a la base, configurar las variables mediante el gestor de secretos del entorno:

- `EMPLOYEE_USERNAME`: usuario a gestionar.
- `EMPLOYEE_PASSWORD`: contraseña de 12–128 caracteres, para crear o restablecer.
- `EMPLOYEE_ROLE`: `admin`, `caja` o `consulta`, solo al crear (por defecto `caja`).

Ejecutar la operación requerida:

```text
node scripts/employee.js create
node scripts/employee.js reset-password
node scripts/employee.js disable
```

Restablecer la contraseña o desactivar revoca las sesiones existentes. No se permite desactivar el último administrador activo. Retirar las variables temporales después de la operación. Esta herramienta requiere que el esquema haya sido creado por el servidor; no existe registro público de usuarios.

### Verificación del despliegue

1. Configurar variables de acceso antes del despliegue y verificar respaldo de Neon.
2. Confirmar que `/api/health` responde 200 sin sesión y `/api/pedidos` responde 401.
3. Iniciar sesión en `/login`; probar pedidos, gastos, caja y exportaciones con el administrador.
4. Crear empleados de caja y consulta; verificar que no pueden realizar operaciones reservadas, incluso llamando directamente a la API.
5. Cerrar sesión y comprobar que la cookie anterior deja de dar acceso.

No borrar las tablas de autenticación al revertir código. Volver a una versión sin autenticación vuelve a exponer las rutas administrativas.

### Cabeceras de seguridad y escaneo externo

Este servidor emite, en todas las respuestas: `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy: same-origin`, `Content-Security-Policy` con `default-src 'self'` (scripts e imagenes limitados a mismo origen y a los CDNs pineados con SRI), `Permissions-Policy` revocando camara/microfono/geolocalizacion y `X-Robots-Tag: noindex,nofollow`. En produccion (`NODE_ENV=production`) tambien emite `Strict-Transport-Security: max-age=15552000; includeSubDomains`. Las hojas de estilos externas las sirve `https://fonts.gstatic.com` via `https://fonts.googleapis.com` y deben coincidir con `style-src`/`font-src` del CSP.

Los scripts de terceros (Chart.js, SheetJS, jsPDF, jsPDF-autotable) cargan con `integrity` y `crossorigin=anonymous`; los hashes estan fijados a la version exacta del bundle (Chart.js 4.4.1, SheetJS 0.20.3, jsPDF 2.5.1+autotable). Si se actualiza la dependencia, hay que recalcular el hash SHA-384 del nuevo bundle y actualizar `report-tools.js`.

Disposition de los hallazgos del escaner externo (`https://pedidos58-v2.onrender.com`, 10/11/2026):

- HSTS, CSP, `X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy`, `Permissions-Policy`: cubiertos por el codigo desde el commit reciente; el despliegue anterior no incluia estas cabeceras (el servidor Render servia contenido sin ellas). Tras redisplegar, se emiten en cada respuesta.
- `.env`, `.git/` y `package.json`: verificados 404 en la URL publica; el \x27raw\x27 estatico nunca se sirve porque solo `index.html`, `auth.html` y paginas protegidas proceden de la raiz del repo.
- SPF/DKIM/DMARC para `pedidos58-v2.onrender.com`: DNS del dominio compartido de Render; la app no envia correo, por lo que no puede spoofearse email "de pedidos58". Se recomienda fijar un dominio propio para publicar SPF/DKIM/DMARC si se usa correo.
- WordPress/plugins: N/A, la app no usa WordPress.
- Redireccion HTTP -> HTTPS: confirmada (301 de Cloudflare).

Para monitoreo externo periódico se sugiere integrar `nuclei -t cves -u <dominio> -silent` como verificación programada, pero no es un control de acceso ni sustituye las cabeceras del servidor.