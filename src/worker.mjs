const headers = { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' };
const json = (body, status = 200) => Response.json(body, { status, headers });
export function createWorker(fetchImpl = fetch) {
  return { async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === '/' && request.method === 'GET') {
      return env.ASSETS ? env.ASSETS.fetch(request) : new Response('Use /health, /models and /probe');
    }
    if (url.pathname === '/health' && request.method === 'GET') return json({ ok: true, oauth: 'not_tested', inference: 'not_tested' });
    if (url.pathname === '/probe-client.mjs' && request.method === 'GET' && env.ASSETS) return env.ASSETS.fetch(request);
    if (!['/models', '/probe'].includes(url.pathname)) return json({ error: 'not_found' }, 404);
    if (!env.ADMIN_SECRET || request.headers.get('X-Admin-Secret') !== env.ADMIN_SECRET) return json({ error: 'forbidden' }, 403);
    if ((url.pathname === '/models' && request.method !== 'GET') || (url.pathname === '/probe' && request.method !== 'POST')) return json({ error: 'method_not_allowed' }, 405);
    if (!env.SIWC_ACCESS_TOKEN) return json({ error: 'missing_siwc_access_token' }, 503);
    try {
      if (url.pathname === '/models') {
        const upstream = await fetchImpl('https://api.openai.com/v1/models', { headers: { Authorization: `Bearer ${env.SIWC_ACCESS_TOKEN}` }, signal: AbortSignal.timeout(30000) });
        if (!upstream.ok) return json({ error: 'upstream_rejected', upstream_status: upstream.status }, upstream.status);
        const body = await upstream.json();
        if (!Array.isArray(body.models)) return json({ error: 'unexpected_model_catalog' }, 502);
        return json({ models: body.models.filter(m => m.visibility === 'list').map(m => ({ slug: m.slug, display_name: m.display_name })) });
      }
      if (!(request.headers.get('Content-Type') || '').includes('application/json')) return json({ error: 'json_required' }, 415);
      // Limit bytes while reading, rather than trusting Content-Length.
      const reader = request.body?.getReader(); let size = 0; const chunks = [];
      if (reader) while (true) { const { done, value } = await reader.read(); if (done) break; size += value.byteLength; if (size > 32768) { await reader.cancel(); return json({ error: 'body_too_large' }, 413); } chunks.push(value); }
      const bytes = new Uint8Array(size); let offset = 0; for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
      let body; try { body = JSON.parse(new TextDecoder().decode(bytes)); } catch { return json({ error: 'invalid_json' }, 400); }
      if (!body || typeof body !== 'object' || Array.isArray(body)) return json({ error: 'invalid_body' }, 400);
      const model = body.model ?? env.MODEL;
      if (typeof model !== 'string' || !model || model.length > 200) return json({ error: 'model_required' }, 400);
      const input = body.input ?? 'Return exactly: SIWC_OK';
      if (typeof input !== 'string' || !input.trim() || input.length > 5000) return json({ error: 'invalid_input' }, 400);
      const upstream = await fetchImpl('https://api.openai.com/v1/responses', {
        method: 'POST', headers: { Authorization: `Bearer ${env.SIWC_ACCESS_TOKEN}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ model, store: false, stream: true, input: [{ role: 'user', content: [{ type: 'input_text', text: input }] }] }),
        signal: request.signal,
      });
      if (!upstream.ok) return json({ error: 'upstream_rejected', upstream_status: upstream.status }, upstream.status);
      if (!(upstream.headers.get('Content-Type') || '').includes('text/event-stream')) return json({ error: 'expected_sse' }, 502);
      return new Response(upstream.body, { status: 200, headers: { ...headers, 'Content-Type': 'text/event-stream' } });
    } catch { return json({ error: 'upstream_unavailable' }, 502); }
  } };
}
export default createWorker();
