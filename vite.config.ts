import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import pkg from './package.json' with { type: 'json' };

export default defineConfig({
  // Relative Pfade, damit der Build unter jeder URL läuft (Domain-Root oder Unterordner wie GitHub Pages).
  base: './',
  plugins: [react()],
  define: { __APP_VERSION__: JSON.stringify(pkg.version) },
  server: { host: true },
  preview: { host: true },
});
