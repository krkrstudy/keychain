const encoder = new TextEncoder();
const decoder = new TextDecoder('utf-8', { fatal: true });
export const iterations = 600000;
export function encode(bytes) {
  let result = '';
  for (const b of new Uint8Array(bytes)) result += String.fromCharCode(b);
  return btoa(result);
}
export function decode(text) {
  if (typeof text !== 'string' || text.length > 1100000) throw new Error('密码库格式无效');
  return Uint8Array.from(atob(text), c => c.charCodeAt(0));
}
export function validateEnvelope(data) {
  if (!data || data.version !== 1 || data.iterations !== iterations || data.algorithm !== 'AES-GCM' ||
      decode(data.salt).length !== 16 || decode(data.iv).length !== 12 || decode(data.ciphertext).length < 16) {
    throw new Error('密码库格式无效');
  }
  return data;
}
export async function deriveKey(username, password, salt) {
  const material = await crypto.subtle.importKey('raw', encoder.encode(JSON.stringify([username.trim(), password])), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey({ name: 'PBKDF2', hash: 'SHA-256', iterations, salt: decode(salt) }, material,
    { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}
export function validateEntries(data) {
  if (!data || !Array.isArray(data.entries) || data.entries.length > 1000) throw new Error('密码库内容无效');
  const ids = new Set();
  for (const entry of data.entries) {
    if (!entry || typeof entry.id !== 'string' || entry.id.length > 100 || ids.has(entry.id) ||
        typeof entry.title !== 'string' || !entry.title.trim() || entry.title.length > 100 ||
        typeof entry.username !== 'string' || entry.username.length > 300 ||
        typeof entry.password !== 'string' || entry.password.length > 1000) throw new Error('账号条目无效');
    ids.add(entry.id);
  }
  return data;
}
export async function encryptVault(data, key, salt) {
  validateEntries(data);
  const plaintext = encoder.encode(JSON.stringify(data));
  if (plaintext.length > 600000) throw new Error('密码库已达到容量上限');
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: encoder.encode('keychain-v1') }, key, plaintext);
  return { version: 1, algorithm: 'AES-GCM', iterations, salt, iv: encode(iv), ciphertext: encode(ciphertext) };
}
export async function decryptVault(envelope, key) {
  validateEnvelope(envelope);
  const plaintext = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: decode(envelope.iv), additionalData: encoder.encode('keychain-v1') }, key, decode(envelope.ciphertext));
  return validateEntries(JSON.parse(decoder.decode(plaintext)));
}
export function freshSalt() { return encode(crypto.getRandomValues(new Uint8Array(16))); }
