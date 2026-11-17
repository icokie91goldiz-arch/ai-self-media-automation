// 开发用：在命令行里对真实上传页跑一个适配器的 fill()（只填写，不发布）。命令经开发桥执行，侧边栏要开着。
//   node --import ./tools/adapter-loader.mjs tools/try-adapter.mjs <平台> <工程目录> [tabId]
// 工程目录里要有 publish.json；不给 tabId 就新开一个上传页并切到前台。
// 直连调试端口：CDP_PORT=9333 node --import ... tools/try-adapter.mjs <平台> <工程目录> <标签页 id 前缀>
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { call } from './cdp.mjs';
import { bjTime } from '../lib/platforms/common.js';
import { waitFor, sleep, send, detach } from '../lib/cdp.js';

const [id, dir, tabArg] = process.argv.slice(2);
if (!id || !dir) { console.error('用法：node --import ./tools/adapter-loader.mjs tools/try-adapter.mjs <平台> <工程目录> [tabId]'); process.exit(2); }
const b = JSON.parse(readFileSync(join(dir, 'publish.json'), 'utf8'));
const p = b.platforms[id];
if (!p) throw new Error(`publish.json 里没有 ${id}`);
const ad = (await import(`../lib/platforms/${id}.js`)).default;

let tabId = process.env.CDP_PORT ? tabArg : +tabArg;
if (!tabId) { tabId = await call({ op: 'open', url: ad.url }); await call({ op: 'activate', tabId }); }
if (process.env.CDP_PORT) { await send(tabId, 'Page.bringToFront'); await send(tabId, 'Page.navigate', { url: ad.url }); await sleep(3000); }
if (!await waitFor(tabId, ad.ready, 60000, 1000)) throw new Error('上传页没准备好（没登录？）');
await sleep(1000);
const ctx = {
  tabId, p, video: join(dir, p.video || b.video), projectId: b.id, durationSec: b.durationSec || 0,
  cover: (k) => ((p.covers || []).includes(k) && b.covers[k]) ? join(dir, b.covers[k]) : null,
  log: (m) => console.log('✓', m), note: (m) => console.log('ℹ', m), fail: (m) => console.log('✗', m),
  schedule: process.env.NO_SCHEDULE ? null : (b.schedule ? bjTime(b.schedule) : null),
  withFocus: async (fn) => { if (!process.env.CDP_PORT) await call({ op: 'activate', tabId }); return fn(); },
};
await ad.fill(ctx);
console.log(`填写完成（tab ${tabId}）`);
await detach(tabId); process.exit(0);
