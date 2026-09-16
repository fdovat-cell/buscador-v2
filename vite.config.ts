import path from 'path';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

// Host de Supabase Storage (xxlgsipmocwizhafinwr.supabase.co) de donde
// salen los datos del catálogo y las fotos. Abajo va como texto literal
// dentro de cada "urlPattern" a propósito: esas funciones las ejecuta el
// Service Worker en el navegador, no este archivo — no pueden depender de
// una constante de acá.

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      // El Service Worker se actualiza solo en segundo plano y toma el
      // control apenas está listo, sin pedirle nada a Fer (uso personal,
      // no hace falta un cartel de "hay versión nueva").
      registerType: 'autoUpdate',
      includeAssets: ['favicon.svg'],
      manifest: {
        name: 'Buscador Pelpap',
        short_name: 'Buscador',
        description: 'Buscador de productos de papelería — PelSAS',
        theme_color: '#FF3C00',
        background_color: '#111113',
        display: 'standalone',
        start_url: '/',
        icons: [
          { src: '/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        // admin.html es la herramienta de edición: siempre tiene que salir
        // de la red, nunca servirse cacheada, para que Fer vea siempre la
        // versión más nueva del panel.
        globIgnores: ['admin.html'],
        navigateFallbackDenylist: [/^\/admin\.html$/],
        runtimeCaching: [
          {
            // productos.json / subcategorias.json / categorias_orden.json:
            // primero intenta traer la versión más nueva de la red (así los
            // cambios hechos en admin.html se ven enseguida); si no hay
            // internet, muestra la última copia guardada.
            urlPattern: ({ url }) => url.hostname === 'xxlgsipmocwizhafinwr.supabase.co' && url.pathname.includes('/catalogo-data/'),
            handler: 'NetworkFirst',
            options: {
              cacheName: 'catalogo-data',
              networkTimeoutSeconds: 4,
              matchOptions: { ignoreSearch: true },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
          {
            // Fotos de productos: se muestran al instante desde el
            // celular/tablet (cache-first en la práctica) y, si hay
            // internet, se actualizan solas por detrás para la próxima vez
            // que alguien suba una foto nueva para ese mismo código.
            urlPattern: ({ url }) => url.hostname === 'xxlgsipmocwizhafinwr.supabase.co' && url.pathname.includes('/fotos-productos/'),
            handler: 'StaleWhileRevalidate',
            options: {
              cacheName: 'fotos-productos',
              matchOptions: { ignoreSearch: true },
              expiration: { maxEntries: 8000, maxAgeSeconds: 60 * 60 * 24 * 180 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
          {
            urlPattern: ({ url }) => url.hostname === 'fonts.googleapis.com',
            handler: 'StaleWhileRevalidate',
            options: { cacheName: 'google-fonts-stylesheets' },
          },
          {
            urlPattern: ({ url }) => url.hostname === 'fonts.gstatic.com',
            handler: 'CacheFirst',
            options: {
              cacheName: 'google-fonts-webfonts',
              expiration: { maxEntries: 10, maxAgeSeconds: 60 * 60 * 24 * 365 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
        ],
      },
    }),
  ],
  resolve: {
    alias: {
      '@': path.resolve(import.meta.dirname, 'src'),
    },
    dedupe: ['react', 'react-dom'],
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
  server: {
    port: 5173,
    host: true,
  },
  preview: {
    port: 4173,
    host: true,
  },
});
