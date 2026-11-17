// 开发用：lib/cdp.js 的 Node 版，命令经开发桥（tools/bridge-server.mjs + 侧边栏）转给插件执行。
// 配合 tools/try-adapter.mjs 在命令行里直接跑适配器的 fill()，对着真实上传页调试。
// 设了 CDP_PORT（比如 9333）就不走开发桥，直连那个用 --remote-debugging-port 启动的 Chrome，tabId 是标签页 id 的前缀。
import { call } from './cdp.mjs';

export const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const PORT = process.env.CDP_PORT;
const conns = new Map();
async function direct(tabId, method, params) {
  if (!conns.has(tabId)) {
    const t = (await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json()).find(x => x.id.startsWith(String(tabId)));
    if (!t) throw new Error(`找不到标签页 ${tabId}`);
    const ws = new WebSocket(t.webSocketDebuggerUrl); const c = { ws, id: 0, pend: new Map() };
    ws.onmessage = (e) => { const m = JSON.parse(e.data); const f = c.pend.get(m.id); if (f) { c.pend.delete(m.id); f(m); } };
    await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
    conns.set(tabId, c);
    await direct(tabId, 'Emulation.setFocusEmulationEnabled', { enabled: true }).catch(() => {});
  }
  const c = conns.get(tabId), id = ++c.id;
  const m = await new Promise(r => { c.pend.set(id, r); c.ws.send(JSON.stringify({ id, method, params })); });
  if (m.error) throw new Error(m.error.message);
  return m.result;
}
export const send = (tabId, method, params = {}) => PORT ? direct(tabId, method, params) : call({ op: 'cdp', tabId, method, params });
export const detach = (tabId) => { if (PORT) { conns.get(tabId)?.ws.close(); conns.delete(tabId); return; } return call({ op: 'detach', tabId }); };

export async function evaluate(tabId, expression) {
  const r = await send(tabId, 'Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true, userGesture: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
  return r.result.value;
}
export async function waitFor(tabId, expression, timeoutMs = 20000, intervalMs = 500) {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    try { const v = await evaluate(tabId, expression); if (v) return v; } catch { /* 页面还在加载 */ }
    await sleep(intervalMs);
  }
  return null;
}
export async function setFiles(tabId, expr, files) {
  const r = await send(tabId, 'Runtime.evaluate', { expression: expr });
  if (!r.result || !r.result.objectId) throw new Error('找不到上传框');
  await send(tabId, 'DOM.setFileInputFiles', { objectId: r.result.objectId, files });
}
export const insertText = (tabId, text) => send(tabId, 'Input.insertText', { text });
const KEYS = { Enter: 13, Escape: 27 };
export async function pressKey(tabId, key = 'Enter') {
  const base = { key, code: key, windowsVirtualKeyCode: KEYS[key], nativeVirtualKeyCode: KEYS[key] };
  const text = key === 'Enter' ? { text: '\r' } : {};
  await send(tabId, 'Input.dispatchKeyEvent', { type: 'rawKeyDown', ...base, ...text });
  if (key === 'Enter') await send(tabId, 'Input.dispatchKeyEvent', { type: 'char', ...base, text: '\r' });
  await send(tabId, 'Input.dispatchKeyEvent', { type: 'keyUp', ...base });
}
export async function typeLines(tabId, text) {
  const lines = text.split('\n');
  for (const [i, l] of lines.entries()) {
    if (l) await insertText(tabId, l);
    if (i < lines.length - 1) await pressKey(tabId, 'Enter');
    await sleep(50);
  }
}
export async function rectOf(tabId, expr) {
  return evaluate(tabId, `(()=>{const e=${expr}; if(!e) return null; e.scrollIntoView({block:'center'});
    const r=e.getBoundingClientRect(); return {x:r.x+r.width/2, y:r.y+r.height/2}})()`);
}
const mouse = (tabId, type, x, y, extra = {}) => send(tabId, 'Input.dispatchMouseEvent', { type, x, y, button: 'left', ...extra });
export async function hover(tabId, expr) {
  const r = await rectOf(tabId, expr);
  if (!r) throw new Error('找不到要悬停的元素');
  await mouse(tabId, 'mouseMoved', r.x, r.y, { button: 'none' });
}
export async function click(tabId, expr) {
  const r = await rectOf(tabId, expr);
  if (!r) return false;
  await mouse(tabId, 'mouseMoved', r.x, r.y, { button: 'none' });
  await mouse(tabId, 'mousePressed', r.x, r.y, { clickCount: 1 });
  await mouse(tabId, 'mouseReleased', r.x, r.y, { clickCount: 1 });
  return true;
}
export const byText = (text, root = 'document.body') => `(()=>{const w=document.createTreeWalker(${root},NodeFilter.SHOW_TEXT);let n;const h=[];
  while((n=w.nextNode())) if(n.nodeValue.trim()===${JSON.stringify(text)}) h.push(n.parentElement);
  return h.filter(e=>e.getClientRects().length).at(-1)||null})()`;
export const clickText = (tabId, text, root) => click(tabId, byText(text, root));
export const firstByText = (text, root = 'document.body') => byText(text, root).replace('.at(-1)', '[0]');
export const setValue = (tabId, expr, value) => evaluate(tabId, `(()=>{const el=${expr}; if(!el) return null;
  Object.getOwnPropertyDescriptor(el.constructor.prototype,'value').set.call(el, ${JSON.stringify(value)});
  el.dispatchEvent(new Event('input',{bubbles:true})); el.dispatchEvent(new Event('change',{bubbles:true})); return el.value})()`);
export const focusEnd = (tabId, expr) => evaluate(tabId, `(()=>{const e=${expr}; if(!e) return false; e.focus();
  const s=getSelection(); s.selectAllChildren(e); s.collapseToEnd(); return true})()`);
export const focusSelectAll = (tabId, expr) => evaluate(tabId, `(()=>{const e=${expr}; if(!e) return false; e.focus();
  const s=getSelection(); s.selectAllChildren(e); return true})()`);
export const fire = (tabId, expr) => evaluate(tabId, `(()=>{const e=${expr}; if(!e) return false;
  for (const t of ['pointerdown','mousedown','pointerup','mouseup','click']) e.dispatchEvent(new MouseEvent(t,{bubbles:true,cancelable:true,view:window}));
  return true})()`);
