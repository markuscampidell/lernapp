import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  // Relative Pfade, damit der Build unter jeder URL läuft (Domain-Root oder Unterordner wie GitHub Pages).
  base: './',
  plugins: [react()],
  // Der KI-Worker nutzt ES-Module (dynamische Imports von WebLLM).
  worker: { format: 'es' },
  server: { host: true },
  preview: { host: true },
});
