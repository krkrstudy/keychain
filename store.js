import { validateEnvelope } from './crypto.js';
const DB_NAME = 'keychain-private-device-v1';
const CONFLICT = '此设备的资料已在另一个窗口更新。请锁定后重新登录，再进行修改。';
export function record(file) {
  if (!file || file.version !== 1 || file.username !== 'admin' || typeof file.id !== 'string' || !file.id || file.id.length > 100 || !Number.isSafeInteger(file.revision) || file.revision < 1) throw new Error('本地密码库格式异常，请使用加密备份恢复。');
  const e = validateEnvelope(file.envelope);
  return {version: 1, username: 'admin', id: file.id, revision: file.revision, envelope: {
    version: e.version, algorithm: e.algorithm, iterations: e.iterations,
    salt: e.salt, iv: e.iv, ciphertext: e.ciphertext
  }};
}
function open() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore('vault');
    req.onsuccess = () => { const db = req.result; db.onversionchange = () => db.close(); resolve(db); };
    req.onerror = () => reject(new Error('此浏览器无法使用本地存储，请在 Safari 或 Chrome 中打开，且不要使用无痕模式。'));
    req.onblocked = () => reject(new Error('请关闭此网站的其他窗口后重试。'));
  });
}
export async function readLocal() {
  const db = await open();
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction('vault', 'readonly'), req = tx.objectStore('vault').get('current');
      let value;
      req.onsuccess = () => { value = req.result; };
      tx.oncomplete = () => { try { resolve(value === undefined ? null : record(value)); } catch(e) { reject(e); } };
      tx.onabort = tx.onerror = () => reject(new Error('无法读取本地资料，请重新打开页面。'));
    });
  } finally { db.close(); }
}
export async function writeLocal(file, expected) {
  const next = record(file), db = await open();
  try {
    await new Promise((resolve, reject) => {
      const tx = db.transaction('vault', 'readwrite'), store = tx.objectStore('vault'), req = store.get('current');
      let reason;
      req.onsuccess = () => {
        const old = req.result;
        if (expected === null ? old !== undefined : !old || old.id !== expected.id || old.revision !== expected.revision) {
          reason = new Error(CONFLICT); tx.abort(); return;
        }
        if (expected && (next.id !== expected.id || next.revision !== expected.revision + 1)) {
          reason = new Error('本地资料版本异常。'); tx.abort(); return;
        }
        store.put(next, 'current');
      };
      tx.oncomplete = resolve;
      tx.onabort = tx.onerror = () => reject(reason || new Error('保存失败，请检查设备可用空间。请勿清理网站数据，先导出加密备份。'));
    });
    return next;
  } finally { db.close(); }
}
