// 飞书验证码登录：打开天锋 → 点「发送验证码」→ 6 位码推到飞书群 → 输入后这台设备记住 30 天。
// 开启：config.web.login = "feishu"（需要已配 feishuWebhook）。口令 ?key= 仍然可用，作备用。
// 安全：验证码 5 分钟有效、只能用一次、输错 5 次作废；60 秒内只能发一次、每小时最多 10 次；
// 会话 token 随机 32 字节，库里只存哈希（data/sessions.json，不进 git）。
import crypto from 'node:crypto'; import fs from 'node:fs'; import path from 'node:path';
import { notify } from './feishu.mjs';

const CODE_TTL = 5 * 60e3, SESSION_DAYS = 30, MAX_TRIES = 5, RESEND_MS = 60e3, MAX_PER_HOUR = 10;
const sha = s => crypto.createHash('sha256').update(s).digest('hex');
let FILE = null, sessions = {}, pending = null, sends = [];

export function initLogin(root) {
  FILE = path.join(root, 'data', 'sessions.json');
  try { sessions = JSON.parse(fs.readFileSync(FILE, 'utf8')); } catch { sessions = {}; }
}
const save = () => { const now = Date.now(); for (const k in sessions) if (sessions[k].exp < now) delete sessions[k]; fs.writeFileSync(FILE, JSON.stringify(sessions), { mode: 0o600 }); };
const cookie = (req, name) => ((req.headers.cookie || '').match(new RegExp(`(?:^|;\\s*)${name}=([^;]+)`)) || [])[1];
const isHttps = req => req.headers['x-forwarded-proto'] === 'https' || /https/.test(req.headers['cf-visitor'] || '');
const ip = req => req.headers['cf-connecting-ip'] || req.socket.remoteAddress || '';

export function sessionOk(req) {
  const t = cookie(req, 'mt_sess'); if (!t) return false;
  const s = sessions[sha(t)]; return !!(s && s.exp > Date.now());
}

function readBody(req) { return new Promise(r => { let b = ''; req.on('data', d => { b += d; if (b.length > 2000) req.destroy(); }); req.on('end', () => { try { r(JSON.parse(b || '{}')); } catch { r({}); } }); }); }

// 处理 /login 相关请求；不是登录路由返回 false
export async function handleLogin(req, res, u, send) {
  if (u.pathname === '/login' && req.method === 'GET') { send(res, 200, PAGE, 'text/html; charset=utf-8'); return true; }
  if (u.pathname === '/login/send' && req.method === 'POST') {
    const now = Date.now(); sends = sends.filter(t => now - t < 3600e3);
    if (pending && now - pending.at < RESEND_MS) { send(res, 429, { error: `刚发过，${Math.ceil((RESEND_MS - (now - pending.at)) / 1000)} 秒后再试` }); return true; }
    if (sends.length >= MAX_PER_HOUR) { send(res, 429, { error: '这一小时发得太多了，晚点再试' }); return true; }
    const code = String(crypto.randomInt(0, 1e6)).padStart(6, '0');
    pending = { hash: sha(code), at: now, tries: 0 }; sends.push(now);
    const who = ip(req), ua = String(req.headers['user-agent'] || '').match(/iPhone|iPad|Android|Macintosh|Windows/)?.[0] || '未知设备';
    await notify(`🔐 天锋登录验证码\n验证码：${code}\n5 分钟内有效 · ${ua} · ${who}\n不是你本人在登录就忽略，别把验证码告诉别人`, { quiet: true });
    send(res, 200, { ok: true }); return true;
  }
  if (u.pathname === '/login/verify' && req.method === 'POST') {
    const { code } = await readBody(req);
    if (!pending || Date.now() - pending.at > CODE_TTL) { pending = null; send(res, 400, { error: '验证码失效了，重新发一个' }); return true; }
    const ok = typeof code === 'string' && crypto.timingSafeEqual(Buffer.from(sha(code.trim())), Buffer.from(pending.hash));
    if (!ok) { if (++pending.tries >= MAX_TRIES) { pending = null; send(res, 400, { error: '错太多次了，重新发一个' }); } else send(res, 400, { error: `验证码不对，还能试 ${MAX_TRIES - pending.tries} 次` }); return true; }
    pending = null;
    const t = crypto.randomBytes(32).toString('base64url');
    sessions[sha(t)] = { exp: Date.now() + SESSION_DAYS * 864e5, at: new Date().toISOString(), ip: ip(req) }; save();
    send(res, 200, { ok: true }, 'application/json; charset=utf-8', { 'set-cookie': `mt_sess=${t}; Path=/; Max-Age=${SESSION_DAYS * 86400}; HttpOnly; SameSite=Lax${isHttps(req) ? '; Secure' : ''}` });
    return true;
  }
  return false;
}

const PAGE = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>登录天锋</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{min-height:100vh;display:flex;align-items:center;justify-content:center;font-family:-apple-system,'PingFang SC',sans-serif;color:#1c1a16;padding:20px;
background:radial-gradient(700px 420px at 20% 15%,#f7f0e1,transparent 62%),radial-gradient(800px 520px at 90% 90%,#dfe8d6,transparent 60%),linear-gradient(135deg,#efe7d8,#e4e7dc 52%,#d9e3e8)}
.c{width:100%;max-width:380px;background:rgba(255,255,255,.9);border-radius:22px;padding:34px 28px;box-shadow:0 24px 60px -30px rgba(30,30,20,.5);text-align:center}
.mm{margin:0 auto 10px;display:block}
h1{font-size:30px;font-weight:900}
p{color:#6b6250;font-size:15px;margin:8px 0 22px;line-height:22px}
button{width:100%;height:48px;border:0;border-radius:14px;font-size:17px;font-weight:800;cursor:pointer;background:#1c1a16;color:#fff}
button:disabled{opacity:.45}
input{width:100%;height:56px;border:2px solid #e3dccd;border-radius:14px;font:800 28px 'SF Mono',Menlo,monospace;letter-spacing:12px;text-align:center;margin:14px 0 12px;outline:none}
input:focus{border-color:#F2B21B}
.msg{min-height:22px;font-size:14px;margin-top:12px;color:#8a5a00}
.ok{color:#2e7d32}
</style></head><body><div class="c">
<svg class="mm" viewBox="0 0 12 13" width="72" height="78" shape-rendering="crispEdges">${mascot()}</svg>
<h1>天锋</h1><p>验证码会发到你的飞书群</p>
<button id="send">发送验证码</button>
<input id="code" inputmode="numeric" autocomplete="one-time-code" maxlength="6" placeholder="······">
<button id="go" disabled>进入天锋</button>
<div class="msg" id="msg"></div>
</div><script>
const $=id=>document.getElementById(id), msg=(t,ok)=>{$('msg').textContent=t;$('msg').className='msg'+(ok?' ok':'')};
let wait=0;
$('send').onclick=async()=>{ $('send').disabled=true;
  const r=await fetch('/login/send',{method:'POST'}).then(r=>r.json()).catch(()=>({error:'网络不通'}));
  if(r.ok){msg('已发到飞书，5 分钟内有效',1);$('code').focus();wait=60;const t=setInterval(()=>{$('send').textContent=--wait>0?wait+' 秒后可重发':'重新发送';if(wait<=0){clearInterval(t);$('send').disabled=false;}},1000);}
  else{msg(r.error||'发送失败');$('send').disabled=false;} };
$('code').oninput=()=>{$('code').value=$('code').value.replace(/\\D/g,'');$('go').disabled=$('code').value.length!==6;if($('code').value.length===6)$('go').click();};
$('go').onclick=async()=>{ $('go').disabled=true;
  const r=await fetch('/login/verify',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({code:$('code').value})}).then(r=>r.json()).catch(()=>({error:'网络不通'}));
  if(r.ok){msg('登录成功',1);location.href='/';} else {msg(r.error||'验证失败');$('code').value='';$('code').focus();} };
</script></body></html>`;

function mascot() {
  const P = { B: '#F2B21B', D: '#C98B0B', L: '#5DBB46', S: '#3E8E2F', K: '#2A2622' };
  const rows = ['....L..LL...', '..LLL.LLLL..', '.LLL..L.LL..', '.....SS.....', '...BBBBBB...', '..BBBBBBBB..', '.BBKBBBBKBB.', '.BBKBBBBKBB.', '.BBBBBBBBBB.', '.BBBBBBBBBB.', '..DDDDDDDD..', '...D....D...', '...D....D...'];
  return rows.map((r, y) => [...r].map((c, x) => P[c] ? `<rect x="${x}" y="${y}" width="1.04" height="1.04" fill="${P[c]}"/>` : '').join('')).join('');
}
