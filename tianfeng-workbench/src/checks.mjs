// 发布前查重、填写后回读、自动提交。每个函数都失败即停，不硬来。
import { evaluate, withTab, sleep, click } from './driver.mjs';
import { SITE } from './site.mjs';

const firstLine = (t) => t.split('\n')[0].trim();

// X：定时列表和个人主页里有没有这条
export async function xExisting(text) {
  const first = firstLine(text);
  const scheduled = await withTab('https://x.com/compose/post/unsent/scheduled', async (id) => {
    let t = '';
    for (let i = 0; i < 10 && !t; i++) { await sleep(3000); t = await evaluate(id, `(document.querySelector('[role=dialog]')||{innerText:''}).innerText`); }
    return { has: t.includes(first), when: (t.match(/Will send on[^\n]*/) || [''])[0] };
  }, { wait: 2000 });
  if (scheduled.has) return { state: 'scheduled', detail: scheduled.when };
  const posted = await withTab('https://x.com/home', async (id) => {
    const me = await evaluate(id, `(document.querySelector('a[data-testid=AppTabBar_Profile_Link]')||{}).href||''`);
    if (!me) return null;
    await evaluate(id, `(location.href=${JSON.stringify(me)},1)`); await sleep(8000);
    return evaluate(id, `(()=>{const a=[...document.querySelectorAll('article')].find(a=>((a.querySelector('[data-testid=tweetText]')||{}).innerText||'').trim().startsWith(${JSON.stringify(first)}));if(!a)return null;const t=a.querySelector('time');return t&&t.parentElement.href})()`);
  });
  return posted ? { state: 'published', detail: posted, url: posted } : null;
}

// X：视频处理完后核对文案和定时，点一次 Schedule，再去定时列表确认
export async function xSubmit(tabId, text, scheduleIso) {
  const BOX = `document.querySelector('[data-testid=tweetTextarea_0]')`, BTN = `document.querySelector('[data-testid=tweetButton]')`;
  for (let i = 0; i < 180; i++) {   // 最多等 30 分钟（视频处理）
    const s = await evaluate(tabId, `(()=>{const b=${BTN};return {box:!!${BOX},dlg:/compose\\/post/.test(location.href),ok:!!b&&b.getAttribute('aria-disabled')!=='true'&&!b.disabled}})()`).catch(() => null);
    if (s && (!s.box || !s.dlg)) return { ok: false, reason: 'X 发帖框不见了（页面被关或跳走），要重建' };
    if (s && s.ok) break;
    if (i === 179) return { ok: false, reason: 'X 视频处理超过 30 分钟，按钮一直不可点' };
    await sleep(10000);
  }
  const got = await evaluate(tabId, `${BOX}.innerText`);
  if (got.replace(/\s+/g, '') !== text.replace(/\s+/g, '')) return { ok: false, reason: 'X 发帖框里的文案和 publish.json 不一致' };
  if (scheduleIso) {
    const d = new Date(scheduleIso), tz = { timeZone: 'Asia/Shanghai' };
    const day = new Intl.DateTimeFormat('en-US', { ...tz, month: 'short', day: 'numeric', year: 'numeric' }).format(d);
    const hm = new Intl.DateTimeFormat('en-US', { ...tz, hour: 'numeric', minute: '2-digit', hour12: true }).format(d);
    const sched = await evaluate(tabId, `(document.body.innerText.match(/Will send on[^\\n]*/)||[''])[0]`);
    if (!sched.includes(day) || !sched.includes(hm)) return { ok: false, reason: `X 定时不对：页面是「${sched || '没设'}」，应该是 ${day} ${hm}` };
    const label = await evaluate(tabId, `${BTN}.innerText.trim()`);
    if (label !== 'Schedule') return { ok: false, reason: `X 按钮是「${label}」不是 Schedule，没点` };
  }
  await evaluate(tabId, `${BTN}.click()`);
  await sleep(6000);
  const after = await xExisting(text);
  if (after) return { ok: true, ...after };
  return { ok: false, reason: 'X 点了提交，但定时列表和主页里都没找到这条，请人工看一眼（不要再点第二次）' };
}

// YouTube：Studio 列表里同标题的行
export async function ytRows(title) {
  return withTab('https://studio.youtube.com/', async (id) => {
    const url = await evaluate(id, `location.href`);
    const m = url.match(/channel\/([^/?]+)/); if (!m) return null;
    await evaluate(id, `(location.href='https://studio.youtube.com/channel/${m[1]}/videos/upload',1)`);
    // Studio 列表加载很慢：等到出现行（最多 60 秒），否则会误读成 0 条（2026-11-12 第 37 期）
    for (let i = 0; i < 12; i++) { await sleep(5000); if (await evaluate(id, `document.querySelectorAll('ytcp-video-row').length`).catch(() => 0)) break; }
    // 只取状态和日期，不要简介
    return evaluate(id, `[...document.querySelectorAll('ytcp-video-row')].filter(r=>r.innerText.includes(${JSON.stringify(title)})).map(r=>{const t=r.innerText.replace(/\\s+/g,' ');const st=(t.match(/已安排|定时|首播|公开|不公开|私享|草稿|待处理/g)||[]).join('/');const d=(t.match(/\\d{4}年\\d+月\\d+日/)||[''])[0];const a=r.querySelector('a[href*="/video/"]');return (st||'状态未知')+(d?' '+d:'')+(a?' https://youtu.be/'+a.href.split('/video/')[1].split('/')[0]:'')})`);
  }, { wait: 9000 });
}

// YouTube：上传对话框还开着、定时回读一致时，点一次「预定」
export async function ytSubmit(tabId, title, scheduleIso) {
  const D = `document.querySelector('ytcp-uploads-dialog')`;
  if (!await evaluate(tabId, `!!${D}`).catch(() => false)) {
    // 第 4 期（2026-11-13）：对话框关了但定时已经保存成「已排定时间」，先看 Studio 列表再下结论
    const rows = await ytRows(title).catch(() => null);
    if (rows && rows.length === 1 && /已安排|定时|首播/.test(rows[0]) && !/草稿|待处理/.test(rows[0])) return { ok: true, state: 'scheduled', detail: `${rows[0].replace(/ https:\S+/, '')}（上传对话框已关，Studio 列表核对）`, url: (rows[0].match(/https:\S+/) || [])[0] };
    return { ok: false, reason: `YouTube 上传对话框已经关了，Studio 里是「${rows ? rows.join(' / ') : '没读到'}」；是草稿的话要点「编辑草稿」重新设定时` };
  }
  if (scheduleIso) {
    const d = new Date(Date.parse(scheduleIso) + 8 * 3600e3), p = (n) => String(n).padStart(2, '0');
    const want = `${d.getUTCFullYear()}年${d.getUTCMonth() + 1}月${d.getUTCDate()}日 ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}`;
    const got = await evaluate(tabId, `(()=>{const a=document.querySelector('#datepicker-trigger');const i=document.querySelector('ytcp-visibility-scheduler input, ytcp-datetime-picker input');return (a?a.innerText.trim():'')+' '+(i?i.value:'')})()`);
    if (got !== want) return { ok: false, reason: `YouTube 定时不对：页面是「${got.trim() || '没设'}」，应该是 ${want}` };
  }
  const btn = await evaluate(tabId, `(()=>{const b=${D}.querySelector('#done-button');return b?b.innerText.trim()+'|'+(b.hasAttribute('disabled')||b.getAttribute('aria-disabled')==='true'):''})()`);
  const want = scheduleIso ? '预定' : '发布';
  if (btn !== `${want}|false`) return { ok: false, reason: `YouTube 提交按钮状态是「${btn}」，不是可点的「${want}」，没点` };
  await evaluate(tabId, `${D}.querySelector('#done-button').click()`);
  await sleep(8000);
  const text = await evaluate(tabId, `document.body.innerText`).catch(() => '');
  const link = (text.match(/https:\/\/youtu\.be\/[\w-]+/) || [''])[0];
  // Studio 列表刷新慢：点完常常还显示「待处理」（2026-11-15 天锋开源这期），每 30 秒查一次，最多 3 分钟
  let rows = null;
  for (let i = 0; i < 7; i++) {
    if (i) await sleep(30000);
    rows = await ytRows(title).catch(() => null);
    if (rows && rows.length === 1 && /已安排|定时|公开|首播/.test(rows[0]) && !/待处理|草稿/.test(rows[0])) return { ok: true, state: scheduleIso ? 'scheduled' : 'published', detail: rows[0].replace(/ https:\S+/, ''), url: link || (rows[0].match(/https:\S+/) || [])[0] };
    if (rows && rows.length > 1) break;   // 多了一条，别再等，交给人看
  }
  return { ok: false, reason: `YouTube 点了「${want}」，但 Studio 里的状态没确认上（${rows ? rows.length + ' 条：' + rows.join(' / ') : '列表没读到'}），请人工看一眼，不要重复提交` };
}

// 知识站：同标题课程数量和状态
export async function zszCourses(title) {
  if (!SITE) return [];
  return withTab(SITE.admin, (id) => evaluate(id, `fetch(${JSON.stringify(SITE.coursesApi)},{credentials:'include'}).then(r=>r.json()).then(d=>(d.courses||[]).filter(c=>c.title===${JSON.stringify(title)}).map(c=>({id:c._id,vis:c.visibilityStatus,seriesId:c.seriesId})))`));
}

// 抖音：真正识别成话题的个数
// 编辑器类名会变，整页找 data-mention 节点并去重（2026-11-12 第 37 期旧选择器读成 0/5，实际 5/5）
export const douyinTopics = (tabId) => evaluate(tabId, `[...new Set([...document.querySelectorAll('[data-mention]')].map(e=>e.innerText.trim()).filter(Boolean))]`);

// Instagram：左侧栏头像 → 用户名
const IG_USER = `(()=>{const i=[...document.querySelectorAll('a[href] img[alt]')].find(i=>/的头像|profile picture/i.test(i.alt)&&i.getBoundingClientRect().x<150);return i?i.closest('a').getAttribute('href').replace(/\\//g,''):null})()`;
const igHead = (caption) => [...firstLine(caption)].slice(0, 30).join('');

// Instagram：定时内容页（/scheduled_content/，按周显示）里有没有这一期。从本周往后翻到定时所在那周
// 定时中的 Reels 不在主页列表里（2026-11-15 天锋开源这期发现），查重必须先看这里
export async function igScheduled(caption, scheduleIso) {
  const head = igHead(caption);
  const weeks = scheduleIso ? Math.max(0, Math.ceil((Date.parse(scheduleIso) - Date.now()) / (7 * 86400e3))) + 1 : 2;
  return withTab('https://www.instagram.com/scheduled_content/', async (id) => {
    let n = -1;
    for (let w = 0; w <= Math.min(weeks, 12); w++) {
      if (w) { if (!await click(id, `[...document.querySelectorAll('main [role=button],main button')].find(b=>(b.getAttribute('aria-label')||b.innerText).trim()==='下周'||/next week/i.test(b.getAttribute('aria-label')||''))`)) break; }
      for (let i = 0; i < 6; i++) { await sleep(2500); n = await evaluate(id, `(()=>{const m=document.querySelector('main');if(!m||!/周视图|Week/.test(m.innerText))return -1;return m.innerText.split(${JSON.stringify(head)}).length-1})()`).catch(() => -1); if (n >= 0) break; }
      if (n < 0) throw new Error('Instagram 定时内容页没打开（没登录或页面改版）');
      if (n > 0) return { state: 'scheduled', detail: n > 1 ? `定时内容里有 ${n} 条同标题，可能发重了` : '定时内容里已有这一期', count: n };
    }
    return null;
  }, { wait: 6000 });
}

// Instagram：先看定时内容，再看自己主页 Reels 列表（逐条打开最近几条，配文第一行对得上就算）
export async function igExisting(caption, scheduleIso) {
  const head = igHead(caption);
  const sch = await igScheduled(caption, scheduleIso).catch(() => null);
  if (sch) return sch;
  return withTab('https://www.instagram.com/', async (id) => {
    let u = null;
    for (let i = 0; i < 10 && !u; i++) { u = await evaluate(id, IG_USER).catch(() => null); if (!u) await sleep(2000); }
    if (!u) throw new Error('Instagram 没登录或页面没打开');
    await evaluate(id, `(location.href='/${u}/reels/',1)`);
    let hrefs = [];
    for (let i = 0; i < 10 && !hrefs.length; i++) { await sleep(2500); hrefs = await evaluate(id, `[...new Set([...document.querySelectorAll('a[href*="/reel/"]')].map(a=>a.getAttribute('href').replace(/^.*?(\\/reel\\/[^/]+\\/).*$/,'$1')))].slice(0,4)`).catch(() => []); }
    for (const h of hrefs) {
      await evaluate(id, `(location.href='${h}',1)`);
      for (let i = 0; i < 8; i++) {
        await sleep(2000);
        if (await evaluate(id, `document.body.innerText.includes(${JSON.stringify(head)})`).catch(() => false)) return { state: 'published', detail: 'Instagram 上已有这一期', url: `https://www.instagram.com${h}` };
      }
    }
    return null;
  }, { wait: 6000 });
}

// Instagram：核对配文和定时，点一次「分享 / 预设发布时间」，等上传完。视频是点了之后才开始传的，十几分钟的要传十来分钟。
// 失败也不重试（IG 只会说「无法分享」，重试有发重的风险）
export async function igSubmit(tabId, caption, scheduleIso) {
  const DLG = `[...document.querySelectorAll('[role=dialog]')].map(d=>d.innerText).join('\\n')`;
  const BOX = `document.querySelector('[role=dialog] [contenteditable=true]')`;
  if (!await evaluate(tabId, `!!${BOX}`).catch(() => false)) return { ok: false, reason: 'Instagram 发帖窗口不见了（页面被关或刷新），要重新填' };
  const norm = (t) => String(t || '').replace(/\s+/g, '');
  if (norm(await evaluate(tabId, `${BOX}.innerText`)) !== norm(caption)) return { ok: false, reason: 'Instagram 配文和 publish.json 不一致' };
  const want = scheduleIso ? '预设发布时间' : '分享';
  if (scheduleIso) {
    const d = new Date(Date.parse(scheduleIso) + 8 * 3600e3);
    const exp = `${d.getUTCFullYear()}-${d.getUTCMonth() + 1}-${d.getUTCDate()} ${d.getUTCHours()}:${d.getUTCMinutes()}`;
    const got = await evaluate(tabId, `(()=>{const t=${DLG};const m=t.match(/(\\d{4})年(\\d{1,2})月(\\d{1,2})日/);const h=document.querySelector('[role=dialog] input[aria-label=Hours]'),mi=document.querySelector('[role=dialog] input[aria-label=Minutes]');return (m?[+m[1],+m[2],+m[3]].join('-'):'')+' '+(h?+h.getAttribute('aria-valuenow'):'')+':'+(mi?+mi.getAttribute('aria-valuenow'):'')})()`);
    if (got !== exp) return { ok: false, reason: `Instagram 定时不对：页面是 ${got}，应该是 ${exp}` };
  }
  const BTN = `[...document.querySelectorAll('[role=dialog] div, [role=dialog] button')].filter(e=>e.childElementCount===0&&e.getClientRects().length&&e.innerText.trim()===${JSON.stringify(want)}).at(-1)`;
  if (!await evaluate(tabId, `!!(${BTN})`)) return { ok: false, reason: `Instagram 找不到「${want}」按钮，没点` };
  await click(tabId, BTN);
  for (let i = 0; i < 240; i++) {   // 最多等 40 分钟
    await sleep(10000);
    const t = await evaluate(tabId, DLG).catch(() => '');
    if (/无法分享|出错了|无法发布|couldn.t be shared|went wrong/i.test(t)) return { ok: false, reason: `Instagram 上传失败：${t.replace(/\n/g, ' ').slice(0, 60)}（没有重试，避免发重；请人工看一眼）` };
    if (/已分享|已预设|已安排|预设好|has been shared|scheduled/i.test(t)) {
      if (scheduleIso) return { ok: true, state: 'scheduled', detail: `已预设 ${scheduleIso.slice(0, 16).replace('T', ' ')}` };
      const e = await igExisting(caption).catch(() => null);
      return { ok: true, state: 'published', detail: '已分享', url: e && e.url };
    }
  }
  return { ok: false, reason: 'Instagram 点了之后 40 分钟还没传完，请人工看一眼（不要再点第二次）' };
}
