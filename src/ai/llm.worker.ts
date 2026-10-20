// Läuft in einem eigenen Thread, damit die App beim Rechnen der KI flüssig bleibt.
import { WebWorkerMLCEngineHandler } from '@mlc-ai/web-llm';

const handler = new WebWorkerMLCEngineHandler();
self.onmessage = (msg: MessageEvent) => handler.onmessage(msg);
