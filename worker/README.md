# Lernapp-KI-Worker

Kleiner Server bei Cloudflare (kostenlos), der den Gemini-Schlüssel geheim hält. Die App spricht nur mit diesem Worker,
der Schlüssel landet nie im Code oder auf GitHub.

## Einmalig einrichten

```bash
cd worker
npx wrangler login                        # Cloudflare-Konto im Browser bestätigen
npx wrangler secret put GEMINI_API_KEY    # Schlüssel einfügen, Enter
npx wrangler deploy                       # gibt die Adresse aus, z. B. https://lernapp-ki.NAME.workers.dev
```

Die ausgegebene Adresse in `src/ai/config.ts` bei `PROXY_URL` eintragen und pushen.

## Ändern

- Erlaubte Webseiten, Modell, Limit: `wrangler.toml`, danach `npx wrangler deploy`.
- Schlüssel tauschen: `npx wrangler secret put GEMINI_API_KEY` erneut ausführen.
- Protokoll ansehen: `npx wrangler tail`.
