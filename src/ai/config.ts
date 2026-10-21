/**
 * Adresse des KI-Servers (Cloudflare Worker aus dem Ordner `worker/`). Er hält den Gemini-Schlüssel geheim.
 * Nach `npx wrangler deploy` die ausgegebene Adresse hier eintragen.
 * Alternativ beim Bauen über die Umgebungsvariable VITE_AI_PROXY_URL setzen.
 */
const PROXY_URL = '';

export const AI_PROXY_URL: string = (import.meta.env.VITE_AI_PROXY_URL as string | undefined) || PROXY_URL;
