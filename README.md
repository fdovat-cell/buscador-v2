# Buscador Pelpap V2

Buscador de productos de papelería (React + Vite + Tailwind v4). El catálogo
vive en `public/data/productos.json` y las fotos en `public/fotos/`; la app
los lee directamente en el navegador, no necesita backend para funcionar.

## Desarrollo local

```bash
npm install
npm run dev
```

## Build de producción

```bash
npm run build
```

Genera la carpeta `dist/` lista para servir como sitio estático.

## Cargar productos y categorías

Editá `public/data/productos.json` (array de objetos con `codigo`,
`descripcion`, `precio`, `categoria_raw`, `tipo`, `marcas`, `imagenes`, etc.)
y agregá las fotos correspondientes en `public/fotos/`. Al hacer commit y
push, Cloudflare Pages vuelve a construir y publicar el sitio automáticamente.

## Despliegue

Ver guía completa en la conversación con Claude / historial del proyecto.
Resumen: repo en GitHub → Cloudflare Pages conectado al repo → build command
`npm run build`, output directory `dist`.
