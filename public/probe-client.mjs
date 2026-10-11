// No credentials are printed or written to disk.
export async function consumeSSE(response, onDelta = () => {}, { allowMissingContentType = false } = {}) {
  if (!response.ok) throw Error(`HTTP ${response.status}`);
  const contentType = response.headers.get('content-type');
  if (!(contentType || '').includes('text/event-stream') && !(allowMissingContentType && contentType === null)) throw Error('Expected SSE');
  let pending = ''; let completed = false;
  for await (const chunk of response.body.pipeThrough(new TextDecoderStream())) {
    pending += chunk;
    let match;
    while ((match = /\r?\n\r?\n/.exec(pending))) {
      const block = pending.slice(0, match.index); pending = pending.slice(match.index + match[0].length);
      const data = block.split(/\r?\n/).filter(l => l.startsWith('data:')).map(l => l.slice(5).trimStart()).join('\n');
      if (!data || data === '[DONE]') continue;
      const e = JSON.parse(data);
      if (['response.failed', 'response.incomplete', 'error'].includes(e.type)) throw Error(`Inference ${e.type}`);
      if (e.type === 'response.output_text.delta') onDelta(e.delta);
      if (e.type === 'response.completed') completed = true;
    }
  }
  if (!completed || pending.trim()) throw Error('Stream ended without complete terminal event');
  return { completed: true };
}
if (typeof process !== 'undefined' && import.meta.url === `file://${process.argv[1]}`) {
  const base = process.env.WORKER_URL; const secret = process.env.ADMIN_SECRET;
  if (!base || !secret) { console.error('Set WORKER_URL and ADMIN_SECRET'); process.exitCode = 1; }
  else try {
    const response = await fetch(new URL('/probe', base), { method: 'POST', headers: { 'X-Admin-Secret': secret, 'Content-Type': 'application/json' }, body: JSON.stringify({ model: process.env.MODEL, input: 'Return exactly: SIWC_OK' }), signal: AbortSignal.timeout(120000) });
    await consumeSSE(response, delta => process.stdout.write(delta)); console.log('\nPASS: response.completed');
  } catch (e) { console.error(e.message); process.exitCode = 1; }
}
