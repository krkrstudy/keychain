import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, readdirSync } from 'node:fs';
import { randomBytes, pbkdf2Sync } from 'node:crypto';
import worker from '../src/index.js';
function setup() {
  const sql = new DatabaseSync(':memory:');
  for (const name of readdirSync(new URL('../drizzle/', import.meta.url)).filter(x=>x.endsWith('.sql'))) sql.exec(readFileSync(new URL('../drizzle/'+name,import.meta.url),'utf8'));
  const DB = { prepare(query) { const statement = sql.prepare(query); return {bind(...args) {return {async first(){return statement.get(...args)||null;},async run(){return statement.run(...args);}};},async first(){return statement.get()||null;}};}};
  const salt = randomBytes(16), password = 'test-admin-password';
  const envelope = {version:1,algorithm:'AES-GCM',iterations:600000,salt:randomBytes(16).toString('base64'),iv:randomBytes(12).toString('base64'),ciphertext:randomBytes(32).toString('base64')};
  const env = {DB,ADMIN_AUTH:JSON.stringify({salt:salt.toString('base64'),verifier:pbkdf2Sync(password,salt,100000,32,'sha256').toString('base64')}),INITIAL_VAULT:JSON.stringify(envelope)};
  async function request(path,method='GET',body,token='',origin='https://krkrstudy.github.io') {
    const headers={'Content-Type':'application/json',Origin:origin,'CF-Connecting-IP':'192.0.2.1'};
    if(token)headers.Authorization=`Bearer ${token}`;
    const response=await worker.fetch(new Request('https://example.test'+path,{method,headers,body:body===undefined?undefined:JSON.stringify(body)}),env);
    return {status:response.status,headers:response.headers,data:response.status===204?null:await response.json()};
  }
  return {sql,request,envelope,password};
}
test('server protects edits, validates data, synchronizes revisions, and revokes sessions',async()=>{
  const {sql,request,envelope,password}=setup();
  assert.equal((await request('/vault','OPTIONS')).status,204);
  assert.equal((await request('/admin/login','POST',{password},'','https://evil.test')).status,403);
  const initial=await request('/vault'); assert.equal(initial.data.revision,0);assert.deepEqual(initial.data.envelope,envelope);
  assert.equal(initial.headers.get('Access-Control-Allow-Origin'),'https://krkrstudy.github.io');
  assert.equal(initial.headers.get('Cache-Control'),'no-store');
  assert.equal((await request('/vault','PUT',{revision:0,envelope})).status,401);
  assert.equal((await request('/vault','PUT',{revision:0,envelope},'a'.repeat(43))).status,401);
  assert.equal((await request('/admin/login','POST',{password:'wrong'})).status,401);
  const login=await request('/admin/login','POST',{password});assert.equal(login.status,200);const token=login.data.session;
  assert.equal(sql.prepare('SELECT digest FROM admin_sessions').get().digest.includes(token),false);
  assert.equal((await request('/vault','PUT',{revision:0,envelope:{...envelope,password:'plaintext'}},token)).status,400);
  const results=await Promise.all([request('/vault','PUT',{revision:0,envelope},token),request('/vault','PUT',{revision:0,envelope},token)]);
  assert.deepEqual(results.map(x=>x.status).sort(),[200,409]);
  assert.equal((await request('/vault')).data.revision,1);
  assert.equal((await request('/vault','PUT',{revision:1,envelope},token)).data.revision,2);
  assert.equal((await request('/vault','PUT',{revision:1,envelope},token)).status,409);
  assert.equal((await request('/admin/logout','POST',undefined,token)).status,200);
  assert.equal((await request('/vault','PUT',{revision:2,envelope},token)).status,401);
  const next=(await request('/admin/login','POST',{password})).data.session;
  sql.prepare('UPDATE admin_sessions SET expires_at=0').run();
  assert.equal((await request('/vault','PUT',{revision:2,envelope},next)).status,401);
  sql.close();
});
test('failed administrator passwords are rate-limited',async()=>{
  const {sql,request,password}=setup();
  for(let i=0;i<10;i++)assert.equal((await request('/admin/login','POST',{password:'wrong'})).status,401);
  assert.equal((await request('/admin/login','POST',{password})).status,429);
  sql.prepare('UPDATE login_attempts SET reset_at=0').run();
  assert.equal((await request('/admin/login','POST',{password})).status,200);
  sql.close();
});
