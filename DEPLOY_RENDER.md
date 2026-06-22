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

### Recomendadas

- `NODE_ENV=production`.

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
- `GET /api/dashboard/resumen`
- `GET /api/dashboard/productos-top`
- `GET /api/dashboard/ventas-diarias`
- `GET /api/dashboard/categorias`
- `GET /admin`
- `GET /admin-dashboard`
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

- El arranque reintenta la inicializacion de Neon si hay latencia temporal.
- En el primer despliegue puede tardar mas por verificacion de schema y carga de semillas.
- Si no defines `GOOGLE_SHEETS_WEBAPP_URL`, la ruta `/api/google-sheets` respondera con error y la sincronizacion con Sheets quedara deshabilitada.
