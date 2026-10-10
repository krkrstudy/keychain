import { deriveKey, encryptVault, decryptVault, validateEnvelope } from './crypto.js';
import { loadOffline, saveOffline, clearOffline } from './offline.js';
import { prepareOfflineShell } from './pwa.js';
const $ = selector => document.querySelector(selector);
const api = 'https://krkrstudy-keychain-api.miesenfidsky775.chatgpt.site';
let session = null, generation = 0, editingId = null, busy = false, lastActivity = Date.now();
let shellReady = false, registration = null, shellFailure = '';
class NetworkUnavailable extends Error {}
const dialogs = ['#entry-dialog', '#admin-dialog', '#delete-dialog'];
function message(id, text) { $(id).textContent = text; }
async function request(path, token = '', options = {}) {
  if (!navigator.onLine) throw new NetworkUnavailable('当前没有网络，联网后可同步或修改资料。');
  let response;
  try {
    response = await fetch(api + path, { cache: 'no-store', credentials: 'omit', redirect: 'error',
      ...options, headers: { Accept: 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}), ...options.headers }, signal: AbortSignal.timeout(8000) });
  } catch { throw new NetworkUnavailable('无法连接同步服务，请检查网络后重试。'); }
  if (!response.ok) {
    if (response.status === 409) throw new Error('资料已在其他设备更新。请先刷新列表，再重新修改。');
    if (response.status === 401) throw new Error(path === '/admin/login' ? '管理员密码不正确。' : '管理权限已过期，请重新输入管理员密码。');
    if (response.status === 429) throw new Error('尝试次数过多，请 15 分钟后重试。');
    if (response.status === 403) throw new Error('请求被拒绝，请使用正式网站访问。');
    if (response.status === 404) throw new Error('未找到同步服务，请稍后再试。');
    throw new Error('同步失败，请稍后重试。');
  }
  return response.json();
}
async function readVault() {
  const data = await request('/vault');
  if (!Number.isSafeInteger(data.revision) || data.revision < 0) throw new Error('密码库版本异常。');
  return { envelope: validateEnvelope(data.envelope), revision: data.revision };
}
function lock() {
  const credential = session?.adminSession;
  if (credential) request('/admin/logout', credential, { method: 'POST', keepalive: true }).catch(() => {});
  generation++; session = null; editingId = null;
  $('#entries').replaceChildren();
  for (const selector of dialogs) { $(selector).close(); $(selector).querySelector('form')?.reset(); }
  $('#login-form').reset(); $('#vault-view').hidden = true; $('#login-view').hidden = false;
  message('#login-message', ''); message('#vault-message', '');
  message('#delete-name', ''); message('#delete-message', ''); message('#entry-message', ''); message('#admin-message', '');
  updateOfflineUI();
  $('#login-password').focus();
}
function current(active, revision) { return session === active && generation === revision; }
function button(label, action) {
  const active = session, revision = generation;
  const b = document.createElement('button'); b.type = 'button'; b.textContent = label;
  b.disabled = busy; b.addEventListener('click', () => { if (active && current(active, revision)) action(); }); return b;
}
function render() {
  if (!session) return;
  $('#entry-count').textContent = `${session.data.entries.length} 个账号 · ${session.offline ? '离线副本 · 仅查看' : session.adminSession && navigator.onLine ? '管理员' : '仅查看'} · 5 分钟无操作自动锁定`;
  const canEdit = Boolean(session.adminSession && !session.offline && navigator.onLine);
  $('#add-button').hidden = !canEdit; $('#admin-button').hidden = Boolean(session.adminSession && !session.offline); $('#admin-button').disabled = !navigator.onLine || session.offline;
  $('#add-button').disabled = busy; $('#refresh-button').disabled = busy || !navigator.onLine;
  updateOfflineUI();
  const list = $('#entries'); list.replaceChildren();
  if (!session.data.entries.length) {
    const empty = document.createElement('div'); empty.className = 'empty';
    empty.textContent = session.adminSession ? '钥匙串还是空的，添加第一个账号吧。' : '暂时没有账号，等待管理员添加。'; list.append(empty);
  }
  for (const entry of session.data.entries) {
    const card = document.createElement('article'); card.className = 'entry';
    const title = document.createElement('h2'); title.textContent = entry.title;
    const username = document.createElement('p'); username.textContent = `账号：${entry.username}`;
    const password = document.createElement('p'); password.textContent = '密码：••••••••••••';
    const actions = document.createElement('div'); actions.className = 'actions';
    let revealed = false;
    const reveal = button('显示密码', () => { revealed = !revealed; password.textContent = revealed ? `密码：${entry.password}` : '密码：••••••••••••'; reveal.textContent = revealed ? '隐藏密码' : '显示密码'; });
    actions.append(reveal, button('复制账号', () => copy(entry.username)), button('复制密码', () => copy(entry.password)));
    if (canEdit) actions.append(button('编辑', () => edit(entry)), button('删除', () => {
      editingId = entry.id; message('#delete-name', `确定从钥匙串中删除“${entry.title}”吗？`); message('#delete-message', ''); $('#delete-dialog').showModal();
    }));
    card.append(title, username, password, actions); list.append(card);
  }
}
async function copy(value) {
  const active = session;
  if (!active) return;
  try { await navigator.clipboard.writeText(value); if (session === active) message('#vault-message', '已复制。使用后请留意清除剪贴板。'); }
  catch { if (session === active) message('#vault-message', '浏览器未允许复制，请显示密码后手动复制。'); }
}
function edit(entry) {
  if (!session?.adminSession || session.offline || !navigator.onLine || busy) return;
  editingId = entry?.id || null; $('#entry-form').reset();
  $('#entry-dialog h2').textContent = entry ? '编辑账号' : '添加账号';
  if (entry) { $('#entry-title').value = entry.title; $('#entry-user').value = entry.username; $('#entry-password').value = entry.password; }
  message('#entry-message', ''); $('#entry-dialog').showModal();
}
async function saveEntries(entries) {
  const active = session, revision = generation;
  if (!active?.adminSession || busy) throw new Error('请先开启管理员模式。');
  if (active.offline || !navigator.onLine) throw new Error('请联网刷新资料后再修改。');
  busy = true; render();
  try {
    const envelope = await encryptVault({ entries }, active.key, active.envelope.salt);
    if (!current(active, revision)) return false;
    const result = await request('/vault', active.adminSession, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ revision: active.revision, envelope }) });
    if (!current(active, revision)) return false;
    if (!Number.isSafeInteger(result.revision) || result.revision <= active.revision) throw new Error('同步版本异常，请刷新确认最新资料。');
    active.envelope = envelope; active.revision = result.revision; active.data = { entries }; updateSavedCopy(active);
    message('#vault-message', '已加密并同步。其他设备点击“刷新”即可看到。'); return true;
  } finally { busy = false; render(); }
}
$('#login-form').addEventListener('submit', async event => {
  event.preventDefault(); const revision = ++generation;
  const name = $('#login-name').value.trim(), password = $('#login-password').value;
  $('#login-password').value = ''; $('#login-submit').disabled = true; message('#login-message', '正在解锁…');
  try {
    let file, offline = false;
    try { file = await readVault(); }
    catch (error) {
      if (!(error instanceof NetworkUnavailable)) throw error;
      file = loadOffline();
      if (!file) throw new Error('无法联网，且此设备尚未保存离线副本。请先联网登录并保存。');
      offline = true;
    }
    const key = await deriveKey(name, password, file.envelope.salt);
    let data;
    try { data = await decryptVault(file.envelope, key); } catch { throw new Error('账号或登录密码不正确。'); }
    if (generation !== revision) return;
    session = { ...file, key, data, offline, adminSession: '' };
    if (!offline) updateSavedCopy(session);
    message('#vault-message', offline ? '正在查看此设备上次保存的副本，联网后请点击“刷新”。' : ''); lastActivity = Date.now();
    $('#login-form').reset(); $('#login-view').hidden = true; $('#vault-view').hidden = false; render(); $('#lock-button').focus();
  } catch (error) { if (generation === revision) message('#login-message', error.message); }
  finally { $('#login-submit').disabled = false; }
});
$('#lock-button').addEventListener('click', lock);
$('#add-button').addEventListener('click', () => edit());
$('#close-dialog').addEventListener('click', () => { $('#entry-dialog').close(); $('#entry-form').reset(); });
$('#admin-button').addEventListener('click', () => { if (!session || session.offline || !navigator.onLine) return; $('#admin-form').reset(); message('#admin-message', ''); $('#admin-dialog').showModal(); });
$('#close-admin').addEventListener('click', () => { $('#admin-dialog').close(); $('#admin-form').reset(); });
$('#cancel-delete').addEventListener('click', () => $('#delete-dialog').close());
$('#admin-form').addEventListener('submit', async event => {
  event.preventDefault(); const active = session, revision = generation;
  if (!active || active.offline || !navigator.onLine) { message('#admin-message', '请联网刷新后再开启管理员模式。'); return; }
  const password = $('#admin-password').value; $('#admin-password').value = ''; $('#admin-submit').disabled = true;
  message('#admin-message', '正在验证管理员密码…');
  try {
    const result = await request('/admin/login', '', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password }) });
    if (!current(active, revision)) { request('/admin/logout', result.session, { method: 'POST' }).catch(() => {}); return; }
    active.adminSession = result.session; active.adminExpiresAt = result.expiresAt;
    $('#admin-dialog').close(); render(); message('#vault-message', '管理员模式已开启。');
  } catch (error) { if (current(active, revision)) message('#admin-message', error.message); }
  finally { $('#admin-submit').disabled = false; }
});
$('#entry-form').addEventListener('submit', async event => {
  event.preventDefault(); if (!session || busy) return;
  const entry = { id: editingId || crypto.randomUUID(), title: $('#entry-title').value.trim(), username: $('#entry-user').value, password: $('#entry-password').value };
  if (!entry.title) { message('#entry-message', '请填写名称。'); return; }
  const entries = editingId ? session.data.entries.map(x => x.id === editingId ? entry : x) : [...session.data.entries, entry];
  const revision = generation; $('#entry-save').disabled = true; message('#entry-message', '正在加密并同步…');
  try { if (await saveEntries(entries)) { $('#entry-dialog').close(); $('#entry-form').reset(); } }
  catch (error) { if (revision === generation) message('#entry-message', error.message); }
  finally { $('#entry-save').disabled = false; }
});
$('#delete-form').addEventListener('submit', async event => {
  event.preventDefault(); if (!session || busy) return;
  const revision = generation; $('#confirm-delete').disabled = true;
  try { if (await saveEntries(session.data.entries.filter(x => x.id !== editingId))) $('#delete-dialog').close(); }
  catch (error) { if (revision === generation) message('#delete-message', error.message); }
  finally { $('#confirm-delete').disabled = false; }
});
$('#refresh-button').addEventListener('click', async () => {
  if (!session || busy) return;
  const active = session, revision = generation; busy = true; render(); message('#vault-message', '正在同步最新资料…');
  try {
    const file = await readVault();
    let data;
    try { data = await decryptVault(file.envelope, active.key); } catch { throw new Error('密码库已更换登录密码，请锁定后重新登录。'); }
    if (current(active, revision)) { Object.assign(active, file, { data, offline: false }); updateSavedCopy(active); message('#vault-message', '已同步最新资料。'); }
  } catch (error) { if (current(active, revision)) message('#vault-message', error.message); }
  finally { busy = false; render(); }
});
for (const selector of dialogs) $(selector).addEventListener('close', () => $(selector).querySelector('form')?.reset());
for (const type of ['pointerdown', 'keydown', 'touchstart']) document.addEventListener(type, () => {
  if (session && Date.now() - lastActivity >= 300000) lock();
  lastActivity = Date.now();
}, { capture: true, passive: true });
setInterval(() => {
  if (session && Date.now() - lastActivity >= 300000) lock();
  if (session?.adminSession && Date.now() >= session.adminExpiresAt * 1000) {
    session.adminSession = ''; for (const id of dialogs) $(id).close(); render();
    message('#vault-message', '管理权限已过期，请重新输入管理员密码。');
  }
}, 1000);
window.addEventListener('pagehide', lock);
function checkIdle() { if (session && Date.now() - lastActivity >= 300000) lock(); }
window.addEventListener('pageshow', checkIdle);
window.addEventListener('focus', checkIdle);
document.addEventListener('visibilitychange', checkIdle);

function updateSavedCopy(file) {
  if (!loadOffline()) return;
  try { saveOffline(file); }
  catch (error) { shellFailure = error.message + ' 离线副本尚未更新。'; }
}
function updateOfflineUI() {
  const copy = loadOffline();
  $('#save-offline').hidden = !session;
  $('#save-offline').disabled = busy || session?.offline || !navigator.onLine;
  $('#save-offline').textContent = copy ? '更新离线副本' : '保存离线副本';
  $('#clear-offline').hidden = !copy; $('#clear-offline').disabled = busy;
  const time = copy ? new Date(copy.savedAt).toLocaleString('zh-CN', {hour12: false}) : '';
  message('#offline-status', shellFailure || (copy && shellReady
    ? `已保存，可离线解锁 · 副本更新时间：${time}`
    : copy ? '加密副本已保存；网页资源未就绪，请联网完成准备。'
    : shellReady ? '网页已准备好。登录后保存加密副本，即可离线使用。' : '正在准备离线网页…'));
}
async function prepareShell() {
  try { registration = await prepareOfflineShell(); shellReady = true; shellFailure = ''; }
  catch (error) { shellFailure = error.message; }
  updateOfflineUI();
}
$('#save-offline').addEventListener('click', async () => {
  if (!session || session.offline || !navigator.onLine || busy) return;
  const active = session, revision = generation;
  busy = true; render();
  try {
    registration = await prepareOfflineShell(); shellReady = true;
    const file = await readVault();
    const data = await decryptVault(file.envelope, active.key);
    if (!current(active, revision)) return;
    Object.assign(active, file, {data});
    saveOffline(file); shellFailure = '';
    navigator.storage?.persist?.().catch(() => {});
    message('#vault-message', '离线副本已保存。断网后输入查看账号和密码即可解锁。');
  } catch (error) { if (current(active, revision)) message('#vault-message', error.message); }
  finally { busy = false; render(); }
});
$('#clear-offline').addEventListener('click', () => {
  try { clearOffline(); shellFailure = ''; updateOfflineUI(); }
  catch (error) { shellFailure = error.message; updateOfflineUI(); }
});
$('#update-app').addEventListener('click', () => {
  if (!registration?.waiting || busy) return;
  lock();
  navigator.serviceWorker.addEventListener('controllerchange', () => location.reload(), {once: true});
  registration.waiting.postMessage({type: 'ACTIVATE_UPDATE'});
});
for (const event of ['online', 'offline']) window.addEventListener(event, () => {
  if (session) render(); else updateOfflineUI();
  if (navigator.onLine && !shellReady) prepareShell();
});
updateOfflineUI();
prepareShell();
if (!window.isSecureContext || !crypto.subtle) { $('#login-submit').disabled = true; message('#login-message', '请通过 HTTPS 安全网址访问。'); }
