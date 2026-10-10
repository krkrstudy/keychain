import { validateEnvelope } from './crypto.js';
const storageKey = 'keychain-encrypted-offline-v1';
// Only explicitly selected ciphertext fields can enter persistent storage.
export function snapshot(file, savedAt = Date.now()) {
  if (!Number.isSafeInteger(file.revision) || file.revision < 0 || !Number.isSafeInteger(savedAt) || savedAt < 0) throw new Error('离线副本格式无效。');
  const e = validateEnvelope(file.envelope);
  return { revision: file.revision, savedAt, envelope: {
    version: e.version, algorithm: e.algorithm, iterations: e.iterations,
    salt: e.salt, iv: e.iv, ciphertext: e.ciphertext
  } };
}
export function loadOffline(storage = localStorage) {
  try {
    const raw = storage.getItem(storageKey);
    if (!raw) return null;
    const file = JSON.parse(raw);
    return snapshot(file, file.savedAt);
  } catch { return null; }
}
export function saveOffline(file, storage = localStorage) {
  const copy = snapshot(file);
  try { storage.setItem(storageKey, JSON.stringify(copy)); }
  catch { throw new Error('浏览器未能保存离线副本，请检查可用空间或浏览器设置。'); }
  return copy;
}
export function clearOffline(storage = localStorage) {
  try { storage.removeItem(storageKey); }
  catch { throw new Error('浏览器未能清除离线副本，请在浏览器设置中清除此网站的数据。'); }
}
