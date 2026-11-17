// 加载钩子：把 tools/cdp.mjs（开发桥）换成 tools/cdp-direct.mjs（直连调试端口）。
// 用法：CDP_PORT=9333 node --import ./tools/direct-loader.mjs tools/x-article-quote.mjs ...
import { registerHooks } from 'node:module';
const direct = new URL('./cdp-direct.mjs', import.meta.url).href;
registerHooks({
  resolve(spec, ctx, next) {
    const r = next(spec, ctx);
    return /\/tools\/cdp\.mjs$/.test(r.url) ? { ...r, url: direct } : r;
  },
});
