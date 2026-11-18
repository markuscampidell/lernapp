import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';

// Kennung dieses Builds: steckt im Code und in dist/version.json. Die App vergleicht beides,
// um zu merken, dass eine neue Version online ist („Neue Version ist da“).
const env = (globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env ?? {};
const BUILD_ID = `${env.GITHUB_SHA?.slice(0, 7) ?? 'dev'}-${Date.now().toString(36)}`;

function versionFile(): Plugin {
  return {
    name: 'lernapp-version',
    apply: 'build',
    generateBundle() {
      this.emitFile({ type: 'asset', fileName: 'version.json', source: JSON.stringify({ id: BUILD_ID }) });
    },
  };
}

export default defineConfig({
  // Relative Pfade, damit der Build unter jeder URL läuft (Domain-Root oder Unterordner wie GitHub Pages).
  base: './',
  plugins: [react(), versionFile()],
  define: { __BUILD_ID__: JSON.stringify(BUILD_ID) },
  server: { host: true },
  preview: { host: true },
});
