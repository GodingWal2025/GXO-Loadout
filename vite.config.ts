import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import dns from "node:dns";

import { VitePWA } from 'vite-plugin-pwa';

dns.setDefaultResultOrder("ipv4first");

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      workbox: {
        // Excel import is a rarely used admin feature and is almost 1 MB by
        // itself. Load it on demand instead of slowing every PWA install.
        globIgnores: ['**/exceljs*.js'],
      },
      includeAssets: ['favicon.ico', 'apple-touch-icon.png'],
      manifest: {
        name: 'GXO Loadout',
        short_name: 'Loadout',
        description: 'Loadout inspection and returns app',
        theme_color: '#1c1917',
        background_color: '#ffffff',
        display: 'standalone',
        orientation: 'any',
        start_url: '/',
        icons: [
          {
            src: 'pwa-192x192.png',
            sizes: '192x192',
            type: 'image/png',
            purpose: 'any'
          },
          {
            src: 'pwa-512x512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'any'
          },
          {
            src: 'pwa-512x512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable'
          }
        ]
      }
    })
  ]
});
