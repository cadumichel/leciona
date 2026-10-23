
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.ico', 'apple-touch-icon.png', 'mask-icon.svg'],

      // CRÍTICO: Habilita SW em desenvolvimento para testes em localhost
      devOptions: {
        enabled: true,
        type: 'module'
      },

      manifest: {
        name: 'Leciona - Gestão Escolar',
        short_name: 'Leciona',
        // Mesmo id do manifest antigo: o app instalado continua sendo reconhecido
        id: '/?source=pwa',
        description: 'Aplicativo para gestão de rotina educacional',
        lang: 'pt-BR',
        theme_color: '#2563eb',
        background_color: '#ffffff',
        display: 'standalone',
        start_url: '/',
        scope: '/',
        orientation: 'portrait-primary',
        categories: ['education', 'productivity'],
        icons: [
          // PNG de verdade (192 e 512): sem eles o Chrome do Android não instala o app (WebAPK)
          // e cria só um atalho, com o símbolo do Chrome no canto do ícone
          { src: '/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
          { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' }
        ]
      },

      workbox: {
        globPatterns: ['**/*.{js,css,html,ico,png,svg,woff2}'],
        // Login e servidor do conector do Claude não podem cair na página do app guardada offline
        navigateFallbackDenylist: [/^\/api\//, /^\/\.well-known\//],
        runtimeCaching: [
          {
            urlPattern: /^https:\/\/fonts\.googleapis\.com\/.*/i,
            handler: 'CacheFirst',
            options: {
              cacheName: 'google-fonts-cache',
              expiration: {
                maxEntries: 10,
                maxAgeSeconds: 60 * 60 * 24 * 365 // 1 ano
              },
              cacheableResponse: {
                statuses: [0, 200]
              }
            }
          },
          {
            urlPattern: /^https:\/\/firebasestorage\.googleapis\.com\/.*/i,
            handler: 'NetworkFirst',
            options: {
              cacheName: 'firebase-storage-cache',
              networkTimeoutSeconds: 10,
              expiration: {
                maxEntries: 50,
                maxAgeSeconds: 60 * 60 * 24 * 7 // 1 semana
              }
            }
          }
        ]
      }
    })
  ],
  resolve: {
    // Garante que o Vite encontre os arquivos mesmo sem a extensão no import
    extensions: ['.mjs', '.js', '.ts', '.jsx', '.tsx', '.json']
  },
  build: {
    outDir: 'dist',
    sourcemap: false,
    minify: 'esbuild',
    rollupOptions: {
      output: {
        manualChunks: {
          vendor: ['react', 'react-dom', 'lucide-react'],
        },
      },
    },
  },
});
