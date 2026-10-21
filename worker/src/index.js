/*
 * Lernapp-KI-Proxy (Cloudflare Worker)
 * Hält den Gemini-Schlüssel geheim (als Secret GEMINI_API_KEY) und leitet Anfragen der App an Gemini weiter.
 * - Nur Anfragen von erlaubten Webseiten (ALLOWED_ORIGINS)
 * - Begrenzung pro IP-Adresse (Rate-Limit-Binding LIMITER)
 * - Modell und maximale Antwortlänge legt der Worker fest, nicht die App
 */

const MAX_BODY = 1_500_000; // ca. 1,5 MB Anfrage (Text der Unterlagen)
const MAX_OUTPUT = 8192;

function cors(origin) {
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  };
}

function json(status, data, headers = {}) {
  return new Response(JSON.stringify(data), { status, headers: { ...headers, 'Content-Type': 'application/json' } });
}

export default {
  async fetch(req, env) {
    const origin = req.headers.get('Origin') || '';
    const allowed = (env.ALLOWED_ORIGINS || '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    if (!allowed.includes(origin)) return json(403, { error: { message: 'Herkunft nicht erlaubt.' } });
    const h = cors(origin);

    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: h });
    if (req.method !== 'POST') return json(405, { error: { message: 'Nur POST.' } }, h);
    if (!env.GEMINI_API_KEY) return json(500, { error: { message: 'Server ist nicht eingerichtet (Schlüssel fehlt).' } }, h);

    if (env.LIMITER) {
      const ip = req.headers.get('CF-Connecting-IP') || 'unbekannt';
      const { success } = await env.LIMITER.limit({ key: ip });
      if (!success) return json(429, { error: { message: 'Zu viele Anfragen. Bitte kurz warten.' } }, h);
    }

    const raw = await req.text();
    if (raw.length > MAX_BODY) return json(413, { error: { message: 'Die Unterlagen sind zu groß. Wähle weniger Dateien.' } }, h);
    let body;
    try {
      body = JSON.parse(raw);
    } catch {
      return json(400, { error: { message: 'Ungültige Anfrage.' } }, h);
    }
    if (!Array.isArray(body.contents) || body.contents.length === 0 || body.contents.length > 40)
      return json(400, { error: { message: 'Ungültige Anfrage.' } }, h);

    // Nur Text-Teile mit den Rollen user/model durchlassen.
    const contents = body.contents.map((c) => ({
      role: c.role === 'model' ? 'model' : 'user',
      parts: (Array.isArray(c.parts) ? c.parts : []).filter((p) => typeof p?.text === 'string').map((p) => ({ text: p.text })),
    }));

    const temperature = Math.min(1.5, Math.max(0, Number(body.temperature ?? 0.3) || 0));
    const maxOutputTokens = Math.min(MAX_OUTPUT, Math.max(64, Number(body.maxOutputTokens ?? 2048) || 2048));
    const generationConfig = { temperature, maxOutputTokens };
    if (body.schema && typeof body.schema === 'object') {
      generationConfig.responseMimeType = 'application/json';
      generationConfig.responseSchema = body.schema;
    }
    const payload = { contents, generationConfig };
    if (typeof body.system === 'string' && body.system) payload.systemInstruction = { parts: [{ text: body.system.slice(0, 20000) }] };

    const model = env.MODEL || 'gemini-flash-latest';
    const stream = body.stream === true;
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:${stream ? 'streamGenerateContent?alt=sse' : 'generateContent'}`;

    let upstream;
    try {
      upstream = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': env.GEMINI_API_KEY },
        body: JSON.stringify(payload),
      });
    } catch {
      return json(502, { error: { message: 'Gemini ist nicht erreichbar.' } }, h);
    }

    if (!upstream.ok) {
      let message = '';
      try {
        message = (await upstream.json())?.error?.message || '';
      } catch {
        /* kein JSON */
      }
      // Fehler vom Schlüssel selbst nicht im Detail an Nutzer weitergeben.
      const status = upstream.status === 400 && /api key/i.test(message) ? 500 : upstream.status;
      console.log('Gemini-Fehler', upstream.status, message);
      return json(status, { error: { message: status === 500 ? 'Server-Schlüssel ungültig.' : message } }, h);
    }

    return new Response(upstream.body, {
      status: 200,
      headers: { ...h, 'Content-Type': stream ? 'text/event-stream' : 'application/json', 'Cache-Control': 'no-store' },
    });
  },
};
