// tools/cdp.mjs 的直连版：不走开发桥，直接连 --remote-debugging-port 启动的 Chrome（默认天锋专用 Chrome 9333）。
// 用法：CDP_PORT=9333 node --import ./tools/direct-loader.mjs tools/<脚本>.mjs ...
// tabId 是 Chrome 标签页 id（字符串，可用前缀）。
const PORT = process.env.CDP_PORT || 9333;
const BASE = `http://127.0.0.1:${PORT}`;
const conns = new Map();
const list = async () => (await (await fetch(`${BASE}/json/list`)).json()).filter(t => t.type === 'page');
async function resolve(tabId) {
  const t = (await list()).find(t => t.id.startsWith(String(tabId)));
  if (!t) throw new Error(`找不到标签页 ${tabId}`);
  return t;
}
async function conn(tabId) {
  const key = String(tabId);
  if (conns.has(key)) return conns.get(key);
  const t = await resolve(tabId);
  const ws = new WebSocket(t.webSocketDebuggerUrl); const c = { ws, id: 0, pend: new Map() };
  ws.onmessage = (e) => { const m = JSON.parse(e.data); const f = c.pend.get(m.id); if (f) { c.pend.delete(m.id); f(m); } };
  ws.onclose = () => conns.delete(key);
  await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
  conns.set(key, c);
  return c;
}
async function cdp(tabId, method, params = {}, timeout = 120000) {
  const c = await conn(tabId), id = ++c.id;
  const m = await Promise.race([
    new Promise(r => { c.pend.set(id, r); c.ws.send(JSON.stringify({ id, method, params })); }),
    new Promise((_, j) => setTimeout(() => j(new Error(`CDP 超时 ${method}`)), timeout)),
  ]);
  if (m.error) throw new Error(m.error.message);
  return m.result;
}
export async function call(cmd) {
  switch (cmd.op) {
    case 'ping': { const v = await (await fetch(`${BASE}/json/version`)).json(); return { ok: true, version: v.Browser }; }
    case 'tabs': return (await list()).map(t => ({ id: t.id, url: t.url, title: t.title }));
    case 'open': return (await (await fetch(`${BASE}/json/new?${encodeURIComponent(cmd.url)}`, { method: 'PUT' })).json()).id;
    case 'close': for (const id of [].concat(cmd.tabIds)) { const t = await resolve(id).catch(() => null); if (t) { conns.get(String(id))?.ws.close(); await fetch(`${BASE}/json/close/${t.id}`); } } return { ok: true };
    case 'activate': { const t = await resolve(cmd.tabId); await fetch(`${BASE}/json/activate/${t.id}`); return { ok: true }; }
    case 'cdp': return cdp(cmd.tabId, cmd.method, cmd.params || {}, cmd.timeout);
    case 'detach': conns.get(String(cmd.tabId))?.ws.close(); conns.delete(String(cmd.tabId)); return { ok: true };
    default: throw new Error(`直连模式不支持 ${cmd.op}`);
  }
}
export async function evaluate(tabId, expression, timeout) {
  const r = await call({ op: 'cdp', tabId, method: 'Runtime.evaluate', timeout,
    params: { expression, returnByValue: true, awaitPromise: true, userGesture: true } });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
  return r.result.value;
}
export function closeAll() { for (const c of conns.values()) c.ws.close(); conns.clear(); }
