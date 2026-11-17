// 开发用的加载钩子：把 lib/cdp.js 换成走开发桥（或直连调试端口）的 tools/cdp-node.mjs，让适配器能在 Node 里跑。
// 用法见 tools/try-adapter.mjs
import { registerHooks } from 'node:module';
const shim = new URL('./cdp-node.mjs', import.meta.url).href;
registerHooks({
  resolve(spec, ctx, next) {
    const r = next(spec, ctx);
    return /\/lib\/cdp\.js$/.test(r.url) ? { ...r, url: shim } : r;
  },
});
