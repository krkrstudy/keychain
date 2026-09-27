const allowedOrigin = 'https://krkrstudy.github.io';
const encoder = new TextEncoder();
const sessionLifetime = 3600;
const loginWindow = 900;
function bytes(text) { return Uint8Array.from(atob(text), c => c.charCodeAt(0)); }
function base64(data) { let value = ''; for (const b of new Uint8Array(data)) value += String.fromCharCode(b); return btoa(value); }
async function hash(value) { return base64(await crypto.subtle.digest('SHA-256', encoder.encode(value))); }
function equal(a, b) { if (a.length !== b.length) return false; let difference = 0; for (let i = 0; i < a.length; i++) difference |= a[i] ^ b[i]; return difference === 0; }
function reply(request, data, status = 200) {
  const headers = { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Vary': 'Origin' };
  if (request.headers.get('Origin') === allowedOrigin) headers['Access-Control-Allow-Origin'] = allowedOrigin;
  return new Response(JSON.stringify(data), { status, headers });
}
async function readJSON(request, maxBytes) {
  if (!request.headers.get('content-type')?.toLowerCase().startsWith('application/json')) throw new Error('bad-input');
  if (Number(request.headers.get('content-length')) > maxBytes) throw new Error('bad-input');
  const reader = request.body?.getReader(); if (!reader) throw new Error('bad-input');
  const chunks = []; let size = 0;
  while (true) { const {done,value} = await reader.read(); if (done) break; size += value.byteLength;
    if (size > maxBytes) { await reader.cancel(); throw new Error('bad-input'); } chunks.push(value); }
  const body = new Uint8Array(size); let offset = 0;
  for (const chunk of chunks) { body.set(chunk, offset); offset += chunk.length; }
  try { return JSON.parse(new TextDecoder('utf-8', {fatal:true}).decode(body)); } catch { throw new Error('bad-input'); }
}
function envelopeIsValid(data) {
  try {
    return data && Object.keys(data).sort().join(',') === 'algorithm,ciphertext,iterations,iv,salt,version' &&
      data.version === 1 && data.algorithm === 'AES-GCM' && data.iterations === 600000 &&
      typeof data.salt === 'string' && bytes(data.salt).length === 16 && typeof data.iv === 'string' && bytes(data.iv).length === 12 &&
      typeof data.ciphertext === 'string' && data.ciphertext.length <= 801000 && bytes(data.ciphertext).length >= 16;
  } catch { return false; }
}
async function authorized(request, db, now) {
  const auth = request.headers.get('Authorization') || '';
  if (!/^Bearer [A-Za-z0-9_-]{43}$/.test(auth)) return null;
  const digest = await hash(auth.slice(7));
  const session = await db.prepare('SELECT digest FROM admin_sessions WHERE digest = ? AND expires_at > ?').bind(digest, now).first();
  return session?.digest || null;
}
export default {
  async fetch(request, env) {
    const path = new URL(request.url).pathname;
    if (request.method === 'OPTIONS') {
      if (request.headers.get('Origin') !== allowedOrigin) return reply(request, {error:'origin-not-allowed'}, 403);
      return new Response(null, {status:204, headers:{'Access-Control-Allow-Origin':allowedOrigin,'Access-Control-Allow-Methods':'GET, POST, PUT, OPTIONS','Access-Control-Allow-Headers':'Content-Type, Authorization','Access-Control-Max-Age':'600','Vary':'Origin'}});
    }
    if (request.method !== 'GET' && request.headers.get('Origin') !== allowedOrigin) return reply(request, {error:'origin-not-allowed'}, 403);
    const now = Math.floor(Date.now()/1000);
    try {
      if (!env.DB || !env.ADMIN_AUTH || !env.INITIAL_VAULT) return reply(request, {error:'service-unavailable'}, 503);
      if (request.method === 'GET' && path === '/vault') {
        const row = await env.DB.prepare('SELECT revision, envelope FROM vault WHERE id = 1').first();
        return reply(request, {revision:row?.revision || 0, envelope:JSON.parse(row?.envelope || env.INITIAL_VAULT)});
      }
      if (request.method === 'POST' && path === '/admin/login') {
        const body = await readJSON(request, 2048);
        if (typeof body.password !== 'string' || body.password.length > 200) return reply(request, {error:'invalid-credentials'}, 401);
        const config = JSON.parse(env.ADMIN_AUTH);
        const ipHash = await hash(config.salt + ':' + (request.headers.get('CF-Connecting-IP') || 'unknown'));
        await env.DB.prepare('DELETE FROM login_attempts WHERE reset_at < ?').bind(now).run();
        const attempt = await env.DB.prepare(`INSERT INTO login_attempts(ip_hash,count,reset_at) VALUES (?,1,?)
          ON CONFLICT(ip_hash) DO UPDATE SET count = count + 1 RETURNING count`).bind(ipHash, now + loginWindow).first();
        if (attempt.count > 10) return reply(request, {error:'too-many-attempts'}, 429);
        const material = await crypto.subtle.importKey('raw', encoder.encode(body.password), 'PBKDF2', false, ['deriveBits']);
        const digest = new Uint8Array(await crypto.subtle.deriveBits({name:'PBKDF2',hash:'SHA-256',salt:bytes(config.salt),iterations:100000}, material,256));
        if (!equal(digest, bytes(config.verifier))) return reply(request, {error:'invalid-credentials'}, 401);
        await env.DB.prepare('DELETE FROM admin_sessions WHERE expires_at <= ?').bind(now).run();
        const token = base64(crypto.getRandomValues(new Uint8Array(32))).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
        const expiresAt = now + sessionLifetime;
        await env.DB.prepare('INSERT INTO admin_sessions(digest,expires_at) VALUES (?,?)').bind(await hash(token), expiresAt).run();
        await env.DB.prepare('DELETE FROM login_attempts WHERE ip_hash = ?').bind(ipHash).run();
        return reply(request, {session:token, expiresAt});
      }
      if (request.method === 'POST' && path === '/admin/logout') {
        const digest = await authorized(request,env.DB,now);
        if (digest) await env.DB.prepare('DELETE FROM admin_sessions WHERE digest = ?').bind(digest).run();
        return reply(request, {ok:true});
      }
      if (request.method === 'PUT' && path === '/vault') {
        if (!await authorized(request,env.DB,now)) return reply(request, {error:'admin-required'}, 401);
        const body = await readJSON(request, 850000);
        if (!Number.isSafeInteger(body.revision) || body.revision < 0 || !envelopeIsValid(body.envelope)) return reply(request, {error:'invalid-vault'},400);
        const json = JSON.stringify(body.envelope);
        const row = body.revision === 0
          ? await env.DB.prepare('INSERT INTO vault(id,revision,envelope) VALUES (1,1,?) ON CONFLICT(id) DO NOTHING RETURNING revision').bind(json).first()
          : await env.DB.prepare('UPDATE vault SET revision = revision + 1, envelope = ? WHERE id = 1 AND revision = ? RETURNING revision').bind(json,body.revision).first();
        if (!row) return reply(request, {error:'revision-conflict'},409);
        return reply(request, {revision:row.revision});
      }
      return reply(request, {error:'not-found'},404);
    } catch (error) {
      if (error?.message === 'bad-input') return reply(request, {error:'invalid-request'},400);
      console.error('Keychain request failed without logging request data.');
      return reply(request, {error:'service-unavailable'},503);
    }
  }
};
