import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  // Relative Pfade, damit der Build unter jeder URL läuft (Domain-Root oder Unterordner wie GitHub Pages).
  base: './',
  plugins: [react()],
  server: { host: true },
  preview: { host: true },
});
