import { deriveKey, encryptVault, freshSalt } from './crypto.js';
import { readLocal, writeLocal } from './store.js';
import { initialize, unlock, validNewPassword, backup, decodeBackup, mergeEntries } from './private-vault.js';
import { loadOffline } from './offline.js';
import { prepareOfflineShell } from './pwa.js';
const $ = s => document.querySelector(s);
let session = null, initialized = false, ready = false, busy = false, generation = 0, lastActivity = Date.now();
let editingId = null, pendingSetup = false, legacyImport = false, registration = null, shellReady = false;
const dialogs = ['#setup-dialog','#entry-dialog','#delete-dialog','#import-dialog','#password-dialog'];
function message(id, text) { $(id).textContent = text; }
function active(s, g) { return session === s && generation === g; }
function setBusy(value) {
  busy = value;
  for (const id of ['#login-submit','#setup-submit','#entry-save','#confirm-delete','#import-submit','#password-submit','#add-button','#export-button','#import-button','#legacy-button','#password-button','#setup-close']) $(id).disabled = value;
  for (const button of document.querySelectorAll('.entry button')) button.disabled = value;
}
function lock() {
  generation++; session = null; editingId = null; pendingSetup = false;
  $('#entries').replaceChildren();
  for (const id of dialogs) { $(id).close(); $(id).querySelector('form')?.reset(); }
  for (const id of ['#login-message','#vault-message','#delete-name','#entry-message','#import-message','#password-message','#setup-message','#delete-message']) message(id,'');
  $('#login-form').reset(); $('#login-name').value = 'admin';
  $('#vault-view').hidden = true; $('#login-view').hidden = false;
}
function itemButton(text, action) {
  const s = session, g = generation;
  const button = document.createElement('button'); button.type = 'button'; button.textContent = text; button.disabled = busy;
  button.addEventListener('click', () => { if (s && active(s,g) && !busy) action(); }); return button;
}
function render() {
  if (!session) return;
  message('#entry-count', `${session.data.entries.length} 个账号 · 本设备独立保存 · 5 分钟无操作自动锁定`);
  $('#legacy-button').hidden = !loadOffline();
  const list = $('#entries'); list.replaceChildren();
  if (!session.data.entries.length) {
    const p = document.createElement('p'); p.className = 'empty'; p.textContent = '还没有保存账号。可以添加账号，或导入加密备份。'; list.append(p);
  }
  for (const entry of session.data.entries) {
    const card = document.createElement('article'); card.className = 'entry';
    const h = document.createElement('h2'); h.textContent = entry.title;
    const user = document.createElement('p'); user.textContent = `账号：${entry.username}`;
    const pass = document.createElement('p'); pass.textContent = '密码：••••••••••••';
    const actions = document.createElement('div'); actions.className = 'actions';
    let revealed = false;
    const reveal = itemButton('显示密码', () => { revealed = !revealed; pass.textContent = revealed ? `密码：${entry.password}` : '密码：••••••••••••'; reveal.textContent = revealed ? '隐藏密码' : '显示密码'; });
    actions.append(reveal,itemButton('复制账号',()=>copy(entry.username)),itemButton('复制密码',()=>copy(entry.password)),itemButton('编辑',()=>edit(entry)),itemButton('删除',()=>{
      editingId = entry.id; message('#delete-name',`确定删除“${entry.title}”吗？`); message('#delete-message',''); $('#delete-dialog').showModal();
    }));
    card.append(h,user,pass,actions); list.append(card);
  }
}
async function copy(value) {
  const s = session; if (!s) return;
  try { await navigator.clipboard.writeText(value); if(session===s) message('#vault-message','已复制。'); }
  catch { if(session===s) message('#vault-message','浏览器未允许复制，请显示后手动复制。'); }
}
function loginCopy() {
  $('#login-title').textContent = initialized ? '打开你的钥匙串' : '首次使用，设置你的密码';
  message('#login-hint',initialized ? '账号为 admin，输入你在此设备设置的密码。' : '初始账号 admin，初始密码 123456。验证后必须设置新密码，才能进入。');
  $('#login-submit').textContent = initialized ? '登录并解锁' : '验证并设置新密码';
  message('#setup-note','仅保存在本设备 · 请定期导出加密备份');
}
$('#login-form').addEventListener('submit',async event=>{
  event.preventDefault(); if(!ready||busy) return;
  const name=$('#login-name').value.trim(),password=$('#login-password').value,g=++generation;
  $('#login-password').value='';setBusy(true);message('#login-message','正在验证…');
  try {
    const file=await readLocal();
    if(g!==generation)return;
    initialized=Boolean(file);loginCopy();
    if(!file){
      if(name!=='admin'||password!=='123456')throw new Error('首次使用请填写账号 admin 和初始密码 123456。');
      pendingSetup=true;$('#setup-form').reset();message('#setup-message','');$('#setup-dialog').showModal();message('#login-message','请先完成新密码设置。');return;
    }
    const result=await unlock(file,name,password);if(g!==generation)return;
    session={file,...result};lastActivity=Date.now();$('#login-form').reset();$('#login-view').hidden=true;$('#vault-view').hidden=false;render();message('#vault-message','资料已在本设备解锁。');$('#lock-button').focus();
  }catch(e){if(g===generation)message('#login-message',e.message);}
  finally{setBusy(false);}
});
$('#setup-form').addEventListener('submit',async event=>{
  event.preventDefault();if(!pendingSetup||busy)return;
  const password=$('#setup-password').value,confirmation=$('#setup-confirm').value,g=generation;
  $('#setup-password').value='';$('#setup-confirm').value='';setBusy(true);message('#setup-message','正在设置并加密…');
  try{
    const file=await initialize(password,confirmation);if(g!==generation)return;
    await writeLocal(file,null);initialized=true;pendingSetup=false;$('#setup-dialog').close();loginCopy();$('#login-name').value='admin';message('#login-message','新密码已设置，请使用新密码登录。');
    navigator.storage?.persist?.().catch(()=>{});
  }catch(e){if(g===generation)message('#setup-message',e.message);}
  finally{setBusy(false);}
});
$('#setup-close').addEventListener('click',()=>{if(!busy){pendingSetup=false;generation++;$('#setup-dialog').close();message('#login-message','请完成新密码设置后再登录。');}});
function edit(entry){
  if(!session||busy)return;editingId=entry?.id||null;$('#entry-form').reset();$('#entry-dialog h2').textContent=entry?'编辑账号':'添加账号';
  if(entry){$('#entry-title').value=entry.title;$('#entry-user').value=entry.username;$('#entry-password').value=entry.password;}
  message('#entry-message','');$('#entry-dialog').showModal();
}
async function save(entries){
  const s=session,g=generation;if(!s||busy)throw new Error('请先登录。');setBusy(true);render();
  try{
    const envelope=await encryptVault({entries},s.key,s.file.envelope.salt);if(!active(s,g))return false;
    const file=await writeLocal({...s.file,revision:s.file.revision+1,envelope},s.file);if(!active(s,g))return false;
    s.file=file;s.data={entries};message('#vault-message','已加密保存在本设备。');return true;
  }finally{setBusy(false);render();}
}
$('#add-button').addEventListener('click',()=>edit());$('#lock-button').addEventListener('click',lock);
$('#entry-form').addEventListener('submit',async event=>{
  event.preventDefault();if(!session||busy)return;
  const entry={id:editingId||crypto.randomUUID(),title:$('#entry-title').value.trim(),username:$('#entry-user').value,password:$('#entry-password').value};
  if(!entry.title){message('#entry-message','请填写名称。');return;}
  const entries=editingId?session.data.entries.map(x=>x.id===editingId?entry:x):[...session.data.entries,entry],g=generation;
  message('#entry-message','正在加密保存…');try{if(await save(entries))$('#entry-dialog').close();}catch(e){if(g===generation)message('#entry-message',e.message);}
});
$('#delete-form').addEventListener('submit',async event=>{
  event.preventDefault();if(!session||busy)return;const g=generation;
  try{if(await save(session.data.entries.filter(x=>x.id!==editingId)))$('#delete-dialog').close();}catch(e){if(g===generation)message('#delete-message',e.message);}
});
$('#export-button').addEventListener('click',()=>{
  if(!session||busy)return;const blob=new Blob([JSON.stringify(backup(session.file),null,2)],{type:'application/json'}),url=URL.createObjectURL(blob),a=document.createElement('a');
  a.href=url;a.download=`钥匙串加密备份-${new Date().toISOString().slice(0,10)}.json`;a.click();setTimeout(()=>URL.revokeObjectURL(url),10000);
  message('#vault-message','加密备份已导出。导入时需要此时使用的登录密码，请妥善保管。');
});
function openImport(legacy){
  if(!session||busy)return;legacyImport=legacy;$('#import-form').reset();$('#backup-file').hidden=legacy;$('#backup-file').required=!legacy;
  $('#backup-file-label').hidden=legacy;$('#import-title').textContent=legacy?'导入旧版资料':'导入加密备份';
  message('#import-hint',legacy?'此浏览器保存了旧版加密副本。输入旧版查看密码后，将资料导入当前本地库。':'选择加密备份，并输入导出该备份时使用的登录密码。已有账号保留，新账号合并导入。');
  message('#import-message','');$('#import-dialog').showModal();
}
$('#import-button').addEventListener('click',()=>openImport(false));$('#legacy-button').addEventListener('click',()=>openImport(true));
$('#import-form').addEventListener('submit',async event=>{
  event.preventDefault();if(!session||busy)return;const s=session,g=generation,password=$('#backup-password').value,file=$('#backup-file').files[0];$('#backup-password').value='';setBusy(true);message('#import-message','正在解密备份…');
  try{
    let text;
    if(legacyImport){const old=loadOffline();if(!old)throw new Error('未找到旧版副本。');text=JSON.stringify({format:'keychain-private-backup',version:1,username:'viewer',envelope:old.envelope});}
    else{if(!file||file.size>1200000)throw new Error('请选择有效的加密备份文件。');text=await file.text();}
    const data=await decodeBackup(text,password);if(!active(s,g))return;
    const entries=mergeEntries(s.data.entries,data.entries),count=entries.length-s.data.entries.length;
    if(entries.length>1000)throw new Error('导入后超过 1000 个账号，请减少后重试。');
    setBusy(false);if(await save(entries)){$('#import-dialog').close();message('#vault-message',`已导入 ${count} 个账号；本地已有的同一账号记录保持不变。`);}
  }catch(e){if(active(s,g))message('#import-message',e.message);}
  finally{setBusy(false);render();}
});
$('#password-button').addEventListener('click',()=>{if(session&&!busy){$('#password-form').reset();message('#password-message','');$('#password-dialog').showModal();}});
$('#password-form').addEventListener('submit',async event=>{
  event.preventDefault();if(!session||busy)return;const s=session,g=generation,old=$('#current-password').value,next=$('#new-password').value,confirm=$('#confirm-password').value;
  $('#password-form').reset();setBusy(true);message('#password-message','正在修改并重新加密…');
  try{
    validNewPassword(next,confirm);if(next===old)throw new Error('新密码不能与当前密码相同。');await unlock(s.file,'admin',old);
    const salt=freshSalt(),key=await deriveKey('admin',next,salt),envelope=await encryptVault(s.data,key,salt);if(!active(s,g))return;
    await writeLocal({...s.file,revision:s.file.revision+1,envelope},s.file);if(!active(s,g))return;
    lock();message('#login-message','密码已修改，请使用新密码重新登录。');
  }catch(e){if(active(s,g))message('#password-message',e.message);}
  finally{setBusy(false);}
});
for(const id of dialogs){const dialog=$(id);dialog.addEventListener('cancel',event=>{if(busy)event.preventDefault();if(id==='#setup-dialog'&&!busy){pendingSetup=false;generation++;}});dialog.addEventListener('close',()=>dialog.querySelector('form')?.reset());}
for(const [button,dialog]of[['#close-dialog','#entry-dialog'],['#cancel-delete','#delete-dialog'],['#close-import','#import-dialog'],['#close-password','#password-dialog']])$(button).addEventListener('click',()=>{if(!busy)$(dialog).close();});
function checkIdle(){if(session&&Date.now()-lastActivity>=300000)lock();}
for(const event of ['pointerdown','keydown','touchstart'])document.addEventListener(event,()=>{checkIdle();lastActivity=Date.now();},{capture:true,passive:true});
setInterval(checkIdle,1000);window.addEventListener('pagehide',lock);window.addEventListener('pageshow',checkIdle);window.addEventListener('focus',checkIdle);document.addEventListener('visibilitychange',checkIdle);
async function prepare(){
  $('#prepare-offline').disabled=true;message('#offline-status','正在准备离线网页…');
  try{registration=await prepareOfflineShell();shellReady=true;message('#offline-status','已准备好，可离线登录、添加和编辑账号。');}
  catch(e){shellReady=false;message('#offline-status',e.message+' 本地登录仍可使用。');}
  finally{$('#prepare-offline').disabled=false;$('#prepare-offline').textContent=shellReady?'重新检查离线准备':'重试离线准备';}
}
$('#prepare-offline').addEventListener('click',prepare);window.addEventListener('online',()=>{if(!shellReady)prepare();});
$('#update-app').addEventListener('click',()=>{if(!registration?.waiting||busy)return;lock();navigator.serviceWorker.addEventListener('controllerchange',()=>location.reload(),{once:true});registration.waiting.postMessage({type:'ACTIVATE_UPDATE'});});
$('#login-submit').disabled=true;
if(!window.isSecureContext||!crypto.subtle)message('#login-message','请使用 HTTPS 安全网址，在 Safari 或 Chrome 中打开。');
else readLocal().then(file=>{initialized=Boolean(file);ready=true;loginCopy();$('#login-submit').disabled=false;}).catch(e=>message('#login-message',e.message));
prepare();
