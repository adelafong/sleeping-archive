const schema = `CREATE TABLE IF NOT EXISTS visitors (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT NOT NULL,
  organisation TEXT NOT NULL,
  consent_version TEXT NOT NULL,
  registered_at TEXT NOT NULL
)`;
const reply = (status, body) => Response.json(body, { status, headers: { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' } });

export async function onRequest({ request, env }) {
  if (request.method === 'GET') {
    if (!env.VISITORS_DB) return reply(503, { ready: false });
    try {
      await env.VISITORS_DB.prepare('SELECT 1').first();
      return reply(200, { ready: true });
    } catch { return reply(503, { ready: false }); }
  }
  if (request.method !== 'POST') return reply(405, { error: 'Method not allowed.' });
  if (request.headers.get('Origin') !== new URL(request.url).origin) return reply(403, { error: 'Please submit from this website.' });
  if (!(request.headers.get('Content-Type') || '').startsWith('application/json')) return reply(415, { error: 'Invalid submission format.' });
  let data;
  try {
    const reader = request.body?.getReader();
    if (!reader) return reply(400, { error: 'Missing submission.' });
    const chunks = []; let size = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 8192) { await reader.cancel(); return reply(413, { error: 'Submission too large.' }); }
      chunks.push(value);
    }
    const bytes = new Uint8Array(size); let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
    data = JSON.parse(new TextDecoder().decode(bytes));
    if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error();
  } catch { return reply(400, { error: 'Invalid submission.' }); }
  if (data.website) return reply(400, { error: 'Unable to accept this submission.' });
  const clean = (v) => typeof v === 'string' ? v.trim() : '';
  const name = clean(data.name), email = clean(data.email), organisation = clean(data.organisation);
  const id = clean(data.id);
  if (!name || name.length > 120 || !organisation || organisation.length > 200 || email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id) || data.consent !== true) {
    return reply(400, { error: 'Please enter valid details and agree to the consent statement.' });
  }
  if (!env.VISITORS_DB) return reply(503, { error: 'Registration is temporarily unavailable. Please try again later or continue without registering.' });
  try {
    await env.VISITORS_DB.prepare(schema).run();
    await env.VISITORS_DB.prepare('INSERT INTO visitors (id, name, email, organisation, consent_version, registered_at) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO NOTHING')
      .bind(id, name, email, organisation, 'audience-research-v1', new Date().toISOString()).run();
    return reply(200, { ok: true });
  } catch {
    return reply(503, { error: 'We could not save your registration. Please retry or continue without registering.' });
  }
}
