// 安装向导：检查环境 → 问几个问题 → 生成 config.json → 可选装开机自启、打开登录页
//   node src/init.mjs
import fs from 'node:fs'; import path from 'node:path'; import os from 'node:os'; import crypto from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import readline from 'node:readline/promises';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CFG = process.env.MAITIAN_CONFIG || path.join(ROOT, 'config.json');
// TTY 下用 rl.question：readline 把终端切到 raw 模式并逐字回显输入；
// 管道输入时 readline 会在提问前把行读完、rl.question 会丢行，所以非 TTY 时自己排队读行
const tty = !!process.stdin.isTTY;
const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: tty });
const lines = [], waiters = []; let closed = false;
if (!tty) {
  rl.on('line', (l) => { const w = waiters.shift(); w ? w(l) : lines.push(l); });
  rl.on('close', () => { closed = true; while (waiters.length) waiters.shift()(''); });
}
const readLine = () => lines.length ? Promise.resolve(lines.shift()) : closed ? Promise.resolve('') : new Promise(r => waiters.push(r));
const prompt = async (q) => {
  if (tty) return await rl.question(q);
  process.stdout.write(q); const l = await readLine(); process.stdout.write(l + '\n'); return l;
};
const ask = async (q, def = '') => (await prompt(`${q}${def ? `（回车用：${def}）` : ''}\n> `)).trim() || def;
// 非终端（管道或无输入）时默认一律「否」，免得误装开机自启
const yes = async (q, def = true) => { def = def && !!process.stdin.isTTY; const a = (await prompt(`${q} ${def ? '[Y/n]' : '[y/N]'} `)).trim() || (def ? 'y' : 'n'); return /^(y|yes|是|好)$/i.test(a); };
const ok = (t) => console.log(`  ✅ ${t}`), bad = (t) => console.log(`  ❌ ${t}`), tip = (t) => console.log(`  ·  ${t}`);
const home = (p) => p.replace(/^~(?=\/|$)/, os.homedir());

console.log('\n天锋 · 安装向导\n');
console.log('一、检查环境');
const [maj, min] = process.versions.node.split('.').map(Number);
if (maj > 22 || (maj === 22 && min >= 5)) ok(`Node.js ${process.versions.node}`); else { bad(`Node.js ${process.versions.node}，需要 22.5 以上（用到内置 node:sqlite）`); process.exit(1); }
if (process.platform !== 'darwin') tip('目前只在 macOS 上实测过；其他系统需要自己改开机自启和 NAS 挂载部分');
const chrome = ['/Applications/Google Chrome.app', path.join(os.homedir(), 'Applications/Google Chrome.app')].find(fs.existsSync);
chrome ? ok('Google Chrome') : bad('没找到 Google Chrome，请先安装');
let cf = false; try { execFileSync('which', ['cloudflared'], { stdio: 'pipe' }); cf = true; ok('cloudflared（可选，远程访问用）'); } catch { tip('没装 cloudflared：想在手机上远程看天锋，之后 brew install cloudflared'); }

if (fs.existsSync(CFG) && !(await yes('\n已经有 config.json，要重新生成吗？（旧的会备份成 config.json.bak）', false))) {
  console.log('\n保留现有配置。'); rl.close(); process.exit(0);
}

console.log('\n二、几个问题（不知道的直接回车，之后可以改 config.json）');
const ex = JSON.parse(fs.readFileSync(path.join(ROOT, 'config.example.json'), 'utf8'));
const cfg = { ...ex };
const guess = ['../tianfeng-publisher', '../mdldm-maitian-publisher', '../obsidian-x-publisher', '~/mdldm-maitian-publisher'].map(p => path.resolve(ROOT, home(p))).find(p => fs.existsSync(path.join(p, 'lib/publish.js')));
let plugin = home(await ask('1. 天锋发布助手（插件仓库）在哪？没装的话先 git clone https://github.com/CzzzzzzJ/mdldm-maitian-publisher.git', guess || path.resolve(ROOT, '../mdldm-maitian-publisher')));
fs.existsSync(path.join(plugin, 'lib/publish.js')) ? ok('找到插件') : bad('这个目录里没有 lib/publish.js；只看数据（L1）可以先不管，要分发时再改 pluginDir');
cfg.pluginDir = plugin;
cfg.rootPath = home(await ask('2. 发布工程放在哪个文件夹？（每期一个子目录，里面有成片、封面、publish.json；NAS 或本地都行）', path.join(os.homedir(), 'Movies/发布工程')));
fs.mkdirSync(cfg.rootPath, { recursive: true });
const nas = await ask('3. 如果发布工程在 NAS 上，填 SMB 地址，掉线时自动重挂（比如 smb://用户名@192.168.1.10/共享名；不用就回车）');
if (nas) cfg.nasUrl = nas; else delete cfg.nasUrl;
const hook = await ask('4. 飞书群机器人的 Webhook 地址（通知卡片发到这里；不用就回车）');
if (hook) cfg.feishuWebhook = hook; else delete cfg.feishuWebhook;
const xh = await ask('5. 你的 X 用户名（不带 @，用来采粉丝；不用就回车）');
if (xh) cfg.xHandle = xh.replace(/^@/, ''); else delete cfg.xHandle;
cfg.web = { port: +(await ask('6. 天锋网页用哪个端口？', '8787')), key: crypto.randomBytes(12).toString('base64url') };
if (await yes('7. 有自己的网站（课程站/会员站）要看转化吗？', false)) {
  cfg.site = { name: await ask('   站点叫什么？', '知识站'), base: await ask('   站点地址', 'https://example.com'), adminPath: await ask('   管理后台路径', '/admin'),
    coursesApi: await ask('   课程列表接口', '/api/courses?admin=1'), dashboardApi: await ask('   数据汇总接口', '/api/admin/dashboard'), coursePath: '/series/{seriesId}?courseId={id}' };
  tip('接口返回格式见 src/site.mjs 顶部注释；站点要记下访客第一次带来的 utm_campaign 才能按期看转化');
} else delete cfg.site;
delete cfg.board; delete cfg.extensionId;
cfg.chromeProfile = process.env.TIANFENG_STATE ? path.join(process.env.TIANFENG_STATE, 'chrome-profile') : path.join(ROOT, 'chrome-profile');

if (fs.existsSync(CFG)) fs.copyFileSync(CFG, CFG + '.bak');
fs.writeFileSync(CFG, JSON.stringify(cfg, null, 2) + '\n');
ok(`已写入 config.json（网页口令：${cfg.web.key}）`);

console.log('\n三、收尾');
if (process.platform === 'darwin' && await yes('装成开机自启的守护进程？（推荐，之后自动采数据、发通知）')) {
  spawnSync(path.join(ROOT, 'scripts/install-launchd.sh'), cf && await yes('顺带装远程访问隧道（cloudflared）？', false) ? ['--tunnel'] : [], { stdio: 'inherit' });
}
if (chrome && await yes('现在打开专用 Chrome 和各平台页面去登录？（每个平台扫码或登录一次）')) {
  spawnSync(process.execPath, [path.join(ROOT, 'src/hub.mjs'), 'login'], { stdio: 'inherit' });
}
console.log(`
完成。接下来：
  · 打开 http://localhost:${cfg.web.port}/?key=${cfg.web.key}
  · 登录完各平台后跑一次体检：node src/hub.mjs doctor
  · 只看数据（L1）：已经发过的期用 node src/hub.mjs adopt <工程目录> 登记
  · 分发（L2）：按 skills/maitian-publish 准备发布工程，node src/hub.mjs plan <工程目录>，到点前 node src/hub.mjs run <工程目录>
  · 想先看看效果：node src/demo.mjs（假数据，不碰你的配置）
`);
rl.close();
