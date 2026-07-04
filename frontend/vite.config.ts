/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  // Puente front→back SOLO en dev: el front hace fetch relativo (VITE_API_URL='')
  // y Vite reenvía las rutas del backend a http://localhost:3001, evitando CORS
  // en desarrollo. En producción NO hay proxy: la conexión cross-origin real la
  // resuelve el CORS del backend (feature backend_hardening) y VITE_API_URL
  // apunta a la URL desplegada (feature deploy). Puerto del back: 3001
  // (backend/src/config/env.ts, PORT por defecto).
  server: {
    proxy: {
      '/crypto': 'http://localhost:3001',
      '/names': 'http://localhost:3001',
      '/health': 'http://localhost:3001',
    },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: './src/test/setup.ts',
    css: true,
    coverage: {
      provider: 'v8',
      reportsDirectory: './coverage',
      exclude: ['**/*.config.*', '**/main.tsx', '**/test/**'],
    },
  },
});
