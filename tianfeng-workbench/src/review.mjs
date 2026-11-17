// 单期复盘（发布后第 1/3/7 天）和周报：只用天锋自己攒的数据（流量采样、每日流量、粉丝、站点）
import { db, episodes, getTasks, NAMES } from './db.mjs';
import { SITE } from './site.mjs';

const PL = ['bilibili', 'douyin', 'xhs', 'channels', 'youtube', 'x', 'instagram', 'zsz'];
const DAY = 864e5;
const fmt = (n) => n == null ? '–' : Math.round(n).toLocaleString('en-US');
const pct = (a, b, d = 1) => b ? (a / b * 100).toFixed(d) + '%' : '–';
const bj = (t) => new Date(t + 8 * 3600e3).toISOString();           // 北京时间的 ISO 串
const dayOf = (t) => bj(t).slice(0, 10);
const pubAt = (ep) => Date.parse(ep.schedule || ep.created_at);
const short = (n) => (n || '').split(/[｜|]/)[0].trim();
const pjOf = (id) => { try { return JSON.parse((db.prepare('SELECT project FROM snapshots WHERE episode_id=?').get(id) || {}).project || '{}'); } catch { return {}; } };
// 和网页一致：publish.json 里写了 nick 就用它，否则取标题第一个标点前那段
const nickOf = (e) => pjOf(e.id).nick || (short(e.name).split(/[，,？?！!：:。]/)[0].trim() || short(e.name)).slice(0, 16);

// 某期某平台在时间 t 时的数据：优先用 6 小时一次的采样，没有就用每日流量里不晚于那天的最后一条
function at(eid, p, t) {
  const s = db.prepare('SELECT * FROM samples WHERE episode_id=? AND platform=? AND ts<=? ORDER BY ts DESC LIMIT 1').get(eid, p, new Date(t).toISOString().slice(0, 16));
  const m = db.prepare('SELECT * FROM metrics WHERE episode_id=? AND platform=? AND day<=? ORDER BY day DESC LIMIT 1').get(eid, p, dayOf(t));
  const r = s && (!m || s.ts.slice(0, 10) >= m.day) ? s : m;
  return r ? { views: r.views || 0, likes: r.likes || 0, comments: r.comments || 0, favorites: r.favorites || 0, shares: r.shares || 0 } : null;
}
const inter = (m) => m ? m.likes + m.comments + m.favorites + m.shares : 0;
// 有没有这一期在这个年龄附近的真实数据（天锋上线前的期没有，不能硬比）
const hasDataBy = (eid, t) => !!db.prepare('SELECT 1 FROM metrics WHERE episode_id=? AND day<=? LIMIT 1').get(eid, dayOf(t));

function snapshot(ep, ageDays) {
  const t = Math.min(Date.now(), pubAt(ep) + ageDays * DAY);
  const rows = PL.map(p => ({ p, m: at(ep.id, p, t) })).filter(r => r.m && r.m.views != null);
  const views = rows.reduce((s, r) => s + r.m.views, 0), ints = rows.reduce((s, r) => s + inter(r.m), 0);
  return { t, rows, views, ints };
}
const fansGain = (from, to) => {
  const out = {}; let sum = 0;
  for (const p of PL) {
    const a = db.prepare('SELECT total FROM followers WHERE platform=? AND day<=? ORDER BY day DESC LIMIT 1').get(p, dayOf(from));
    const b = db.prepare('SELECT total FROM followers WHERE platform=? AND day<=? ORDER BY day DESC LIMIT 1').get(p, dayOf(to));
    if (a && b && p !== 'zsz') { out[p] = b.total - a.total; sum += out[p]; }
  }
  return { out, sum };
};
const siteSum = (from, to) => db.prepare('SELECT SUM(reg) reg, SUM(vip) vip, SUM(orders) orders, SUM(revenue) revenue FROM site_daily WHERE day>? AND day<=?').get(dayOf(from), dayOf(to));
const campaignOf = (ep) => (JSON.stringify(pjOf(ep.id).platforms || {}).match(/utm_campaign=([\w-]+)/) || [])[1] || '';

// 结构化复盘：网页和飞书卡片共用
export function review(ep, ageDays) {
  const cur = snapshot(ep, ageDays);
  const prev = episodes().filter(e => e.id !== ep.id && pubAt(e) < pubAt(ep) && hasDataBy(e.id, pubAt(e) + ageDays * DAY))
    .sort((a, b) => pubAt(b) - pubAt(a))[0];
  const pv = prev ? snapshot(prev, ageDays) : null;
  const fans = fansGain(pubAt(ep), cur.t);
  const camp = campaignOf(ep), conv = camp && db.prepare('SELECT * FROM site_campaigns WHERE campaign=?').get(camp);
  const site = SITE ? siteSum(pubAt(ep), cur.t) : null;
  return { ep: { id: ep.id, episode: ep.episode, name: ep.name, nick: nickOf(ep) }, ageDays, cur, prev: prev && { id: prev.id, nick: nickOf(prev), ...pv }, fans, conv, site };
}

export function reviewText(r) {
  const { ep, ageDays, cur, prev, fans, conv, site } = r;
  const L = [`📈 第 ${ep.episode ?? '?'} 期发布 ${ageDays} 天复盘｜${ep.nick}`];
  L.push(`全平台播放 ${fmt(cur.views)}，互动 ${fmt(cur.ints)}，互动率 ${pct(cur.ints, cur.views)}`);
  if (prev && prev.views) {
    const k = cur.views / prev.views;
    L.push(`同龄对比：上一期「${prev.nick}」第 ${ageDays} 天是 ${fmt(prev.views)}，这一期是它的 ${k >= 1 ? k.toFixed(1) + ' 倍' : pct(cur.views, prev.views, 0)}`);
  }
  L.push('');
  const sorted = [...cur.rows].sort((a, b) => b.m.views - a.m.views);
  for (const { p, m } of sorted) {
    const pm = prev && prev.rows.find(x => x.p === p);
    const cmp = pm && pm.m.views ? `，上一期同龄 ${fmt(pm.m.views)}` : '';
    L.push(`${NAMES[p]}：播放 ${fmt(m.views)}（占 ${pct(m.views, cur.views, 0)}）${p === 'zsz' || !inter(m) ? '' : `｜互动率 ${pct(inter(m), m.views)}`}${cmp}`);
  }
  const best = sorted[0], bestRate = [...cur.rows].filter(x => x.m.views >= 100).sort((a, b) => inter(b.m) / b.m.views - inter(a.m) / a.m.views)[0];
  L.push('');
  if (best) L.push(`结论：播放主要来自 ${NAMES[best.p]}${bestRate && bestRate.p !== best.p ? `，互动最好的是 ${NAMES[bestRate.p]}（${pct(inter(bestRate.m), bestRate.m.views)}）` : ''}。`);
  if (Object.keys(fans.out).length) L.push(`发布后各平台涨粉 ${fans.sum >= 0 ? '+' : ''}${fmt(fans.sum)}（${Object.entries(fans.out).sort((a, b) => b[1] - a[1]).map(([p, v]) => `${NAMES[p]} ${v >= 0 ? '+' : ''}${fmt(v)}`).join('、')}）`);
  if (conv) L.push(`转化（按期归因）：注册 ${fmt(conv.reg)}｜会员 ${fmt(conv.vip)}｜订单 ${fmt(conv.orders)}｜收入 ¥${fmt(conv.revenue)}`);
  else if (site && site.reg != null) L.push(`${SITE.name}同期：新注册 ${fmt(site.reg)}｜新会员 ${fmt(site.vip)}｜收入 ¥${fmt(site.revenue)}（站点还没按期记录来源，这是同期总数）`);
  return L.join('\n');
}

// 周报：上周一到周日
export function weekly(now = Date.now()) {
  const d = new Date(now + 8 * 3600e3); const dow = (d.getUTCDay() + 6) % 7;          // 周一 = 0
  const thisMon = Date.parse(d.toISOString().slice(0, 10) + 'T00:00:00+08:00') - dow * DAY;
  const from = thisMon - 7 * DAY, to = thisMon - 1;                                    // 上周
  const pFrom = from - 7 * DAY, pTo = from - 1;                                         // 上上周
  const gain = (a, b) => {
    let sum = 0; const per = {}; const byEp = [];
    for (const e of episodes()) {
      let es = 0;
      for (const p of PL) { const x = at(e.id, p, b), y = at(e.id, p, a); if (x) { const g = x.views - (y ? y.views : 0); per[p] = (per[p] || 0) + g; es += g; } }
      sum += es; if (es > 0) byEp.push({ e, es });
    }
    return { sum, per, byEp: byEp.sort((x, y) => y.es - x.es) };
  };
  const cur = gain(from, to), prv = gain(pFrom, pTo);
  const pubs = episodes().filter(e => pubAt(e) >= from && pubAt(e) <= to).sort((a, b) => pubAt(a) - pubAt(b));
  const fans = fansGain(from, to), fansP = fansGain(pFrom, pTo);
  const site = SITE ? siteSum(from, to) : null, siteP = SITE ? siteSum(pFrom, pTo) : null;
  const vs = (a, b) => b ? `（上周 ${fmt(b)}，${a >= b ? '+' : ''}${pct(a - b, b, 0)}）` : '';
  const L = [`🗓 天锋周报｜${dayOf(from).slice(5)} ～ ${dayOf(to).slice(5)}`];
  L.push(`发了 ${pubs.length} 期${pubs.length ? '：' + pubs.map(e => `「${nickOf(e)}」`).join('、') : ''}`);
  const hasM = db.prepare('SELECT 1 FROM metrics WHERE day>=? AND day<=? LIMIT 1').get(dayOf(from), dayOf(to));
  L.push(hasM ? `全平台新增播放 ${fmt(cur.sum)}${vs(cur.sum, prv.sum)}` : '这一周天锋还没有流量数据（从接入天锋那天起才有）');
  L.push(`各平台涨粉 ${fans.sum >= 0 ? '+' : ''}${fmt(fans.sum)}${vs(fans.sum, fansP.sum)}`);
  if (site && site.reg != null) L.push(`${SITE.name}：新注册 ${fmt(site.reg)}${vs(site.reg, siteP && siteP.reg)}｜新会员 ${fmt(site.vip)}｜收入 ¥${fmt(site.revenue)}`);
  L.push('');
  for (const [p, v] of Object.entries(cur.per).sort((a, b) => b[1] - a[1])) L.push(`${NAMES[p]}：新增播放 ${fmt(v)}${fans.out[p] != null ? `｜涨粉 ${fans.out[p] >= 0 ? '+' : ''}${fmt(fans.out[p])}` : ''}`);
  if (cur.byEp[0]) { L.push(''); L.push(`这周最能打：「${nickOf(cur.byEp[0].e)}」新增 ${fmt(cur.byEp[0].es)} 播放`); }
  return { key: dayOf(from), text: L.join('\n') };
}

// 守护进程每天采完流量后调：到了第 1/3/7 天的期出复盘；周一出周报。done(key) 返回 true 表示这次第一次做
export function due(done) {
  const out = [];
  for (const ep of episodes()) {
    const t0 = pubAt(ep); if (!t0 || t0 > Date.now()) continue;
    if (!getTasks(ep.id).some(t => t.state === 'published')) continue;
    for (const age of [1, 3, 7]) if (Date.now() >= t0 + age * DAY && Date.now() < t0 + (age + 2) * DAY && done(`review:${ep.id}:${age}`)) out.push(reviewText(review(ep, age)));
  }
  const d = new Date(Date.now() + 8 * 3600e3);
  if (d.getUTCDay() === 1) { const w = weekly(); if (done(`weekly:${w.key}`)) out.push(w.text); }
  return out;
}
