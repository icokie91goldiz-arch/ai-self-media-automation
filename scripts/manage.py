#!/usr/bin/env python3
"""Local deployment controls for 天锋 AI自动化系统. Never prints credentials."""
from pathlib import Path
import os,sys,json,secrets,shutil,subprocess,plistlib,time,urllib.request,urllib.parse
ROOT=Path(__file__).resolve().parent.parent
WB=ROOT/'tianfeng-workbench'
PRIVATE=Path.home()/'Library/Application Support/TianfengAutomation'
CFG=PRIVATE/'config.json'
LABEL='com.tianfeng.automation.workbench'
DEMO_LABEL='com.tianfeng.automation.demo'

def check_volume():
    if not ROOT.is_dir() or (str(ROOT).startswith('/Volumes/项目盘NAS8T/') and not Path('/Volumes/项目盘NAS8T').is_mount()):
        raise RuntimeError('请先连接项目盘NAS8T，再启动天锋。')
    if not os.access(ROOT,os.W_OK):raise RuntimeError('项目目录不可写。')

def node():
    candidates=[os.environ.get('TIANFENG_NODE'),shutil.which('node'),str(Path.home()/'.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node'),'/opt/homebrew/bin/node','/usr/local/bin/node']
    for c in candidates:
        if c and Path(c).is_file():
            v=subprocess.check_output([c,'--version'],text=True).strip().lstrip('v').split('.')
            if tuple(map(int,v[:2])) >= (22,5):return c
    raise RuntimeError('需要 Node.js 22.5 以上，请安装后重试。')

def prepare():
    check_volume()
    PRIVATE.mkdir(parents=True,exist_ok=True,mode=0o700);os.chmod(PRIVATE,0o700)
    for p in [PRIVATE/'logs',PRIVATE/'data',ROOT/'发布工程',WB/'data']:p.mkdir(parents=True,exist_ok=True)
    if not CFG.exists():
        data={'name':'天锋','setupRequired':True,'pluginDir':str(ROOT/'tianfeng-publisher'),'driver':'direct','chromePort':9333,'chromeProfile':str(PRIVATE/'chrome-profile'),'rootPath':str(ROOT/'发布工程'),'platforms':['douyin','xhs','channels'],'batches':[['douyin','xhs'],['channels']],'auto':[],'manual':['bilibili','douyin','xhs','channels','youtube','x','instagram','zsz'],'keepAlive':[],'keepAliveMinutes':60,'sampleHours':6,'web':{'port':8787,'host':'127.0.0.1','key':secrets.token_urlsafe(32),'owner':'天锋'}}
        fd=os.open(CFG,os.O_CREAT|os.O_EXCL|os.O_WRONLY,0o600)
        with os.fdopen(fd,'w') as f:json.dump(data,f,ensure_ascii=False,indent=2);f.write('\n')
    os.chmod(CFG,0o600)
    return json.loads(CFG.read_text())

def environment():
    prepare();e=os.environ.copy();e.update({'MAITIAN_CONFIG':str(CFG),'MAITIAN_DB':str(WB/'data/hub.db'),'TIANFENG_STATE':str(PRIVATE),'TZ':'Asia/Shanghai','PATH':str(Path(node()).parent)+':/usr/bin:/bin:/usr/sbin:/sbin'})
    return e

def agent(action='web'):
    c=prepare();n=node();demo=action=='demo';label=DEMO_LABEL if demo else LABEL
    plist=Path.home()/'Library/LaunchAgents'/f'{label}.plist';plist.parent.mkdir(parents=True,exist_ok=True)
    env=environment()
    fields={'Label':label,'ProgramArguments':[n,str(WB/'src/demo.mjs')] if demo else [n,str(WB/'src/hub.mjs'),action], 'WorkingDirectory':str(WB),'EnvironmentVariables':{k:env[k] for k in ['MAITIAN_CONFIG','MAITIAN_DB','TIANFENG_STATE','TZ','PATH']},'RunAtLoad':not demo,'KeepAlive':False if demo else {'SuccessfulExit':False},'ThrottleInterval':30,'StandardOutPath':str(PRIVATE/'logs'/f'{label}.log'),'StandardErrorPath':str(PRIVATE/'logs'/f'{label}.log')}
    service=f'gui/{os.getuid()}/{label}'
    subprocess.run(['launchctl','bootout',service],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
    with plist.open('wb') as f:plistlib.dump(fields,f)
    os.chmod(plist,0o600)
    for attempt in range(20):
        result=subprocess.run(['launchctl','bootstrap',f'gui/{os.getuid()}',str(plist)],stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True)
        if result.returncode==0:break
        time.sleep(.5)
    else:raise RuntimeError('服务注册失败：'+result.stderr.strip())
    if demo:subprocess.run(['launchctl','kickstart',service],check=True)
    for _ in range(120):
        if healthy(demo):print('天锋演示已启动（样例数据）' if demo else '天锋工作台已启动：http://127.0.0.1:8787/');return
        time.sleep(.25)
    raise RuntimeError('服务未就绪，请查看用户配置目录中的 logs。')

def healthy(demo=False):
    try:
        c=json.loads(CFG.read_text());key='demo' if demo else c['web']['key'];port=8788 if demo else c['web']['port']
        req=urllib.request.Request(f'http://127.0.0.1:{port}/api/overview',headers={'Cookie':'mt_key='+key})
        with urllib.request.urlopen(req,timeout=2) as r:d=json.load(r)
        return d.get('name','').startswith('天锋') and bool(d.get('demo'))==demo
    except Exception:return False

def open_board(demo=False):
    c=prepare()
    if not healthy(demo):agent('demo' if demo else 'web')
    port=8788 if demo else c['web']['port'];key='demo' if demo else c['web']['key']
    subprocess.run(['open',f'http://127.0.0.1:{port}/?key={urllib.parse.quote(key)}'],check=True)
    print('已打开天锋演示（所有数字均为样例）' if demo else '已打开天锋工作台。')

def stop():
    for label in [LABEL,DEMO_LABEL]:
        subprocess.run(['launchctl','bootout',f'gui/{os.getuid()}/{label}'],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
    print('天锋服务已停止；再次双击启动入口可恢复。')

if __name__=='__main__':
    try:
        action=sys.argv[1] if len(sys.argv)>1 else 'open'
        if action in ['start','restart']:agent('web')
        elif action=='daemon':agent('daemon')
        elif action=='demo-start':agent('demo')
        elif action=='demo':open_board(True)
        elif action=='open':open_board()
        elif action=='stop':stop()
        elif action=='status':print(json.dumps({'工作台在线':healthy(),'演示在线':healthy(True),'账号配置目录':str(PRIVATE)},ensure_ascii=False))
        elif action=='prepare':prepare();print('天锋本机配置已准备。')
        elif action=='tool':
            name=sys.argv[2] if len(sys.argv)>2 else ''
            if name not in ['make-publish.mjs','validate.mjs']:raise RuntimeError('仅支持发布工程生成和校验工具。')
            sys.exit(subprocess.call([node(),str(ROOT/'tianfeng-publisher/tools'/name),*sys.argv[3:]],cwd=ROOT,env=environment()))
        elif action in ['login','doctor','hub']:
            prepare();args=sys.argv[2:] if action=='hub' else [action]
            sys.exit(subprocess.call([node(),str(WB/'src/hub.mjs'),*args],cwd=WB,env=environment()))
        else:raise RuntimeError('未知操作：'+action)
    except Exception as e:
        print('天锋启动失败：'+str(e),file=sys.stderr);sys.exit(1)
