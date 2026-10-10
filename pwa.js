export async function prepareOfflineShell() {
  if (!('serviceWorker' in navigator)) throw new Error('此浏览器不支持离线网页。请使用 Safari 或 Chrome。');
  const registration = await navigator.serviceWorker.register('./sw.js', { scope: './', updateViaCache: 'none' });
  await Promise.race([navigator.serviceWorker.ready, new Promise((_, reject) => setTimeout(() => reject(new Error('离线网页准备未完成，请联网后重试保存。')), 15000))]);
  const waiting = () => {
    if (!registration.waiting) return;
    document.querySelector('#update-app').hidden = false;
  };
  waiting();
  registration.addEventListener('updatefound', () => {
    registration.installing?.addEventListener('statechange', waiting);
  });
  const worker = registration.active;
  if (!worker) throw new Error('离线网页尚未准备好，请稍后重试。');
  const complete = await new Promise(resolve => {
    const channel = new MessageChannel();
    const timer = setTimeout(() => resolve(false), 5000);
    channel.port1.onmessage = event => { clearTimeout(timer); channel.port1.close(); resolve(event.data?.complete === true); };
    worker.postMessage({ type: 'CHECK_SHELL' }, [channel.port2]);
  });
  if (!complete) throw new Error('网页资源未完整保存，请联网重试。');
  return registration;
}
