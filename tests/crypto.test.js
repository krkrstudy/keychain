import test from 'node:test';
import assert from 'node:assert/strict';
import { deriveKey, freshSalt, encryptVault, decryptVault, decode, encode, validateEnvelope, validateEntries } from '../crypto.js';
test('credentials unlock; wrong password/account and tampered data fail', async () => {
  const salt = freshSalt();
  const key = await deriveKey('test', 'test-only-strong-password', salt);
  const data = { entries: [{ id: 'a', title: '测试', username: 'a@example.com', password: 'secret-测试' }] };
  const a = await encryptVault(data, key, salt);
  const b = await encryptVault(data, key, salt);
  assert.notEqual(a.iv, b.iv);
  assert.notEqual(a.ciphertext, b.ciphertext);
  assert.deepEqual(await decryptVault(a, key), data);
  assert.equal(JSON.stringify(a).includes('secret'), false);
  const wrongPassword = await deriveKey('test', 'wrong', salt);
  const wrongAccount = await deriveKey('other', 'test-only-strong-password', salt);
  await assert.rejects(decryptVault(a, wrongPassword));
  await assert.rejects(decryptVault(a, wrongAccount));
  const damaged = decode(a.ciphertext); damaged[0] ^= 1;
  await assert.rejects(decryptVault({ ...a, ciphertext: encode(damaged) }, key));
  assert.equal(key.extractable, false);
  assert.throws(() => validateEnvelope({ ...a, iterations: 1 }));
});
test('invalid and duplicate entries fail', () => {
  assert.throws(() => validateEntries({ entries: [{ id: 'a' }] }));
  const item = { id: 'a', title: 'one', username: 'user', password: 'pass' };
  assert.throws(() => validateEntries({ entries: [item, item] }));
});
