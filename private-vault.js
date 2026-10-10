import { deriveKey, encryptVault, decryptVault, freshSalt, validateEnvelope } from './crypto.js';
export const account = 'admin';
export function validNewPassword(password, confirmation) {
  if (typeof password !== 'string' || password.length < 8 || password.length > 128 || password === '123456') throw new Error('请设置 8—128 位新密码，不能继续使用初始密码。');
  if (password !== confirmation) throw new Error('两次输入的新密码不一致。');
}
export async function initialize(password, confirmation) {
  validNewPassword(password, confirmation);
  const salt = freshSalt(), key = await deriveKey(account, password, salt);
  const envelope = await encryptVault({entries: []}, key, salt);
  return {version: 1, id: crypto.randomUUID(), username: account, revision: 1, envelope};
}
export async function unlock(file, name, password) {
  if (name.trim() !== account) throw new Error('登录账号或密码不正确。');
  const key = await deriveKey(account, password, file.envelope.salt);
  try { return {key, data: await decryptVault(file.envelope, key)}; }
  catch { throw new Error('登录账号或密码不正确。'); }
}
export function backup(file) {
  return {format: 'keychain-private-backup', version: 1, username: account, exportedAt: new Date().toISOString(), envelope: validateEnvelope(file.envelope)};
}
export async function decodeBackup(text, password) {
  if (typeof text !== 'string' || text.length > 1200000) throw new Error('备份文件过大或格式不正确。');
  let file;
  try { file = JSON.parse(text); } catch { throw new Error('请选择钥匙串导出的加密 JSON 备份。'); }
  if (file.format !== 'keychain-private-backup' || file.version !== 1 || typeof file.username !== 'string' || !file.username || file.username.length > 100) throw new Error('请选择钥匙串导出的加密备份。');
  const envelope = validateEnvelope(file.envelope), key = await deriveKey(file.username, password, envelope.salt);
  try { return await decryptVault(envelope, key); }
  catch { throw new Error('备份密码不正确，或文件已损坏。'); }
}
export function mergeEntries(current, incoming) {
  const ids = new Set(current.map(x => x.id));
  return [...current, ...incoming.filter(x => !ids.has(x.id))];
}
