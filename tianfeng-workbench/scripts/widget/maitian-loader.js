// 天锋 · iPhone 小组件加载器（Scriptable）—— 只需粘贴一次，以后自动更新
// 每次刷新从天锋拉最新的小组件代码（/api/widget/code）来运行；拉不到就用上次存下的那份。
// 天锋地址和小组件口令：从天锋的 /widget 页面复制的版本已经填好。
const MAITIAN = '__MAITIAN_URL__';
const TOKEN = '__WIDGET_TOKEN__';

const fm = FileManager.local(), CORE = fm.joinPath(fm.documentsDirectory(), 'maitian-core.js');
let code = null;
try {
  const r = new Request(`${MAITIAN}/api/widget/code?t=${encodeURIComponent(TOKEN)}`); r.timeoutInterval = 6;
  code = await r.loadString();
  if (r.response.statusCode !== 200 || !/Script\.complete\(\)/.test(code)) throw new Error('代码不完整');
  fm.writeString(CORE, code);
} catch (e) {
  code = fm.fileExists(CORE) ? fm.readString(CORE) : null;
}
if (!code) {
  const w = new ListWidget(); w.url = MAITIAN;
  const t = w.addText('✦ 连不上天锋'); t.font = Font.boldSystemFont(14);
  if (config.runsInWidget) Script.setWidget(w); else await w.presentSmall();
  Script.complete();
} else {
  const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
  await new AsyncFunction(code)();
}
