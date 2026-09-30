'use strict'

/* ============================================================================
 *  Github-Proxy — Cloudflare Worker
 *  配置区：部署前按需修改以下常量即可。
 * ==========================================================================*/

// 代理服务的 URL 路径前缀（默认 '/'，即 https://你的域名/）。
// 保留下方 @type 注解：Cloudflare 编辑器内置 TS 检查会把 '/' 推断为字面量类型，
// 使后续 `PREFIX === ''` 触发 TS2367「两种类型永不重叠」。
/** @type {string} */
const PREFIX = '/'

// 最大文件代理大小限制（字节）。0 表示无限制；
// 超限时 302 重定向回原链接（详见 handleUpstreamResponse）。
/** @type {number} */
const MAX_FILE_SIZE = 0

// 短链基准地址。留空（''）关闭。支持两种写法：
//   1) 单个字符串（原有写法）
//      const CUSTOM_BASE_URL = 'https://github.com/用户名/仓库名/分支名/'
//   2) 字符串数组（多地址）
//      const CUSTOM_BASE_URL = [
//          'https://github.com/用户名/仓库名/分支名/',
//          'https://raw.githubusercontent.com/用户名/仓库名/分支名/'
//      ]
// 取值与使用方式：
//   - 访问 https://你的域名/剩余文件名 时，会按数组顺序依次作为候选基准地址；
//   - GET / HEAD 请求在上游返回 404 或 5xx 时自动尝试下一个地址，取第一个可用结果；
//   - 其余方法（POST/PUT 等）只请求第一个地址，避免请求体被重复消费；
//   - 所有候选地址均失败时，返回最后一个地址的响应。
/** @type {string | string[]} */
const CUSTOM_BASE_URL = ''

// 自定义可反代的网站（域名，支持 '*.example.com' 通配）。
// 配置后即可通过 https://你的域名/example.com/路径 反代该站点。
/** @type {string[]} */
const CUSTOM_PROXY_SITES = []

// 代理「HTML 内容」时的同源防护策略（安全）。
// 背景：被反代的第三方 HTML 是在「本 Worker 的域名」下渲染的，若原样放行，
//       其内联脚本即获得本域执行权限，构成 XSS / Cookie 窃取面。
//   'sandbox'  → 追加 Content-Security-Policy: sandbox（可预览，但禁脚本 / 表单 / 顶层跳转）
//   'download' → 追加 Content-Disposition: attachment（直接下载，不在浏览器渲染）
//   'off'      → 不做处理（兼容性最好，风险自负）
/** @type {string} */
const HTML_GUARD = 'sandbox'

// 内置 GitHub 相关域名（路径路由使用，通常无需修改）
const GITHUB_DOMAINS = [
    'github.com',
    'raw.githubusercontent.com',
    'gist.github.com',
    'gist.githubusercontent.com',
    'raw.github.com'
]

// GitHub 资源 CDN：仅用于「重定向跟随」白名单，不参与路径路由。
// 例如 releases 下载会 302 到 objects.githubusercontent.com。
const GITHUB_ASSET_DOMAINS = [
    'objects.githubusercontent.com',
    'github-releases.githubusercontent.com',
    'codeload.github.com'
]

// GitHub 路径中的「视图段」：无域名短路径的第 3 段命中它时，按 github.com 路由（而非 raw）。
// 由常量生成正则，避免把这一串魔法字符串散落在判断逻辑里。
const GITHUB_VIEW_SEGMENTS = ['releases', 'archive', 'blob', 'raw', 'info', 'git-', 'tags']
const GITHUB_VIEW_RE = new RegExp('^(?:' + GITHUB_VIEW_SEGMENTS.join('|') + ')$', 'i')

// 安全加固：转发到上游之前需要剔除的请求头。
// 作用：避免把客户端身份、CDN 元数据与逐跳（hop-by-hop）头泄漏给第三方上游。
// 注意：authorization 会被保留，因此私有仓库 / Token 访问不受影响。
const STRIP_REQUEST_HEADERS = [
    'host',
    'cookie',
    'connection',
    'keep-alive',
    'transfer-encoding',
    'upgrade',
    'te',
    'trailer',
    'proxy-authorization',
    'proxy-connection',
    'cf-connecting-ip',
    'cf-ipcountry',
    'cf-ray',
    'cf-visitor',
    'x-forwarded-for',
    'x-forwarded-host',
    'x-forwarded-proto',
    'x-forwarded-port',
    'x-real-ip'
]

const CORS_HEADERS = {
    'access-control-allow-origin': '*',
    'access-control-allow-methods': 'GET,POST,PUT,PATCH,TRACE,DELETE,HEAD,OPTIONS',
    'access-control-max-age': '1728000',
    'access-control-expose-headers': '*'
}

/* ---------------------------------------------------------------------------
 *  域名白名单与地址安全校验
 * -------------------------------------------------------------------------*/

/**
 * 判断 host 是否命中列表（支持 '*.example.com' 通配）
 * @param {string} host
 * @param {string[]} list
 * @returns {boolean}
 */
function hostInList(host, list) {
    if (!host) return false
    host = String(host).toLowerCase()
    for (const entry of list) {
        const dom = String(entry).toLowerCase()
        if (!dom) continue
        if (dom.startsWith('*.')) {
            const base = dom.slice(2)
            if (host === base || host.endsWith('.' + base)) return true
        } else if (host === dom) {
            return true
        }
    }
    return false
}

// —— 以下三项为模块级预计算：配置均为常量，只在 Worker 冷启动时计算一次 ——
// 可用于「路径路由」的域名
const ALLOWED_HOSTS = GITHUB_DOMAINS.concat(CUSTOM_PROXY_SITES)

// 归一化短链基准地址：兼容单字符串与数组，统一补尾部 '/'
const CUSTOM_BASE_URLS = (Array.isArray(CUSTOM_BASE_URL) ? CUSTOM_BASE_URL : [CUSTOM_BASE_URL])
    .map((item) => (typeof item === 'string' ? item.trim() : ''))
    .filter((item) => item !== '')
    .map((item) => (item.charAt(item.length - 1) === '/' ? item : item + '/'))

// 受信域名集合：可反代域名 + 短链基准地址所在域名
const TRUSTED_HOSTS = (() => {
    const hosts = ALLOWED_HOSTS.slice()
    for (const base of CUSTOM_BASE_URLS) {
        try {
            hosts.push(new URL(base).hostname)
        } catch (err) {
            /* 配置非法时忽略，交由运行时校验兜底 */
        }
    }
    return hosts
})()

/** @returns {string[]} 副本，避免调用方误改内部常量 */
function getAllowedHosts() { return ALLOWED_HOSTS.slice() }
/** @returns {string[]} */
function getCustomBaseUrls() { return CUSTOM_BASE_URLS.slice() }
/** @returns {string[]} */
function getTrustedHosts() { return TRUSTED_HOSTS.slice() }

/**
 * 归一化路径前缀：确保以 '/' 结尾（PREFIX 为空时保持为空）。
 * 刻意用函数声明 + 参数收窄：既规避模块级 const 的 TDZ，又避免
 * `prefix === ''` 这类字面量比较在 Cloudflare 编辑器里报 TS2367。
 * @param {string} prefix
 * @returns {string}
 */
function normalizePrefix(prefix) {
    const value = typeof prefix === 'string' ? prefix : ''
    if (value.length === 0) return ''
    return value.charAt(value.length - 1) === '/' ? value : value + '/'
}

/**
 * @param {string} host
 * @returns {boolean} 是否为允许反代的域名
 */
function isAllowedHost(host) {
    return hostInList(host, ALLOWED_HOSTS)
}

/**
 * @param {string} host
 * @returns {boolean} 是否为 GitHub 资源 CDN（重定向跟随白名单）
 */
function isAssetHost(host) {
    return hostInList(host, GITHUB_ASSET_DOMAINS)
}

/**
 * 安全加固：最终目标地址必须为 https 且落在受信域名内
 * @param {string} targetUrl
 * @param {string[]} trustedHosts
 * @returns {boolean}
 */
function isSafeTargetUrl(targetUrl, trustedHosts) {
    let parsed
    try {
        parsed = new URL(targetUrl)
    } catch (err) {
        return false
    }
    if (parsed.protocol !== 'https:') return false
    return hostInList(parsed.hostname, trustedHosts)
}

/* ---------------------------------------------------------------------------
 *  注入到前端的运行时配置
 * -------------------------------------------------------------------------*/

const UI_CONFIG = {
    prefix: PREFIX,
    maxFileSize: MAX_FILE_SIZE,
    allowedHosts: getAllowedHosts(),
    // 内置 GitHub 域名：前端只对它们做「去掉主机前缀」的简化（服务端启发式能还原）；
    // 自定义站点必须保留 host/path，否则服务端无法按首段域名路由。
    githubHosts: GITHUB_DOMAINS.slice(),
    customBaseCount: getCustomBaseUrls().length
}

/* ---------------------------------------------------------------------------
 *  样式（String.raw 保留反斜杠，避免转义歧义）
 * -------------------------------------------------------------------------*/

const PAGE_CSS = String.raw`
*,*::before,*::after{box-sizing:border-box}
[hidden]{display:none !important}
:root{
  --bg:#f7f5f1; --bg-2:#f2efe9; --surface:#ffffff; --surface-2:#f4f1eb;
  --text:#191713; --muted:#5f5950; --border:#e5e0d7; --border-strong:#d2cabd;
  --accent:#c2410c; --accent-ink:#ffffff; --accent-soft:rgba(194,65,12,.10);
  --ok:#1f7a55; --err:#b3261e;
  --radius-sm:8px; --radius-md:14px; --radius-lg:22px;
  --shadow-1:0 1px 2px rgba(25,23,19,.06),0 1px 3px rgba(25,23,19,.05);
  --shadow-2:0 10px 30px rgba(25,23,19,.09);
  --shadow-3:0 26px 64px rgba(25,23,19,.13);
  --ease:cubic-bezier(.16,1,.3,1);
  --dur-fast:150ms; --dur-base:300ms; --dur-slow:620ms;
  --font-display:"Sora","Segoe UI",sans-serif;
  --font-body:"IBM Plex Sans","Segoe UI",sans-serif;
  --font-mono:"IBM Plex Mono","SFMono-Regular",Consolas,monospace;
}
[data-theme="dark"]{
  --bg:#141210; --bg-2:#1a1714; --surface:#1c1916; --surface-2:#242019;
  --text:#f4f1ea; --muted:#a8a094; --border:#2f2a24; --border-strong:#413a32;
  --accent:#ff8a5c; --accent-ink:#1a0d05; --accent-soft:rgba(255,138,92,.14);
  --ok:#4cc793; --err:#ff7a70;
  --shadow-1:0 1px 2px rgba(0,0,0,.45);
  --shadow-2:0 12px 34px rgba(0,0,0,.5);
  --shadow-3:0 28px 70px rgba(0,0,0,.6);
}
html{-webkit-text-size-adjust:100%}
body{
  margin:0; min-height:100vh; background:var(--bg); color:var(--text);
  font-family:var(--font-body); font-size:16px; line-height:1.6;
  -webkit-font-smoothing:antialiased;
  display:flex; flex-direction:column;
}
body::before{
  content:""; position:fixed; inset:0; pointer-events:none; z-index:0;
  background:
    radial-gradient(42rem 30rem at 12% -8%, var(--accent-soft), transparent 62%),
    radial-gradient(38rem 26rem at 104% 2%, rgba(60,110,200,.10), transparent 60%);
}
body::after{
  content:""; position:fixed; inset:0; pointer-events:none; z-index:0; opacity:.035;
  background-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='120' height='120'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='.9' numOctaves='2'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E");
}
a{color:var(--accent); text-underline-offset:3px}
.wrap{position:relative; z-index:1; width:100%; max-width:860px; margin:0 auto; padding:0 24px}
::selection{background:var(--accent); color:var(--accent-ink)}
:focus-visible{outline:2px solid var(--accent); outline-offset:2px; border-radius:var(--radius-sm)}

/* ---- 顶栏 ---- */
.site-header{position:sticky; top:0; z-index:20; backdrop-filter:blur(12px);
  -webkit-backdrop-filter:blur(12px); background:color-mix(in srgb, var(--bg) 82%, transparent);
  border-bottom:1px solid var(--border)}
.header-inner{display:flex; align-items:center; justify-content:space-between; gap:16px; min-height:64px}
.brand{display:inline-flex; align-items:center; gap:10px; text-decoration:none; color:var(--text); font-weight:600}
.brand-logo{color:var(--accent); font-size:18px; line-height:1}
.brand-text{font-family:var(--font-display); letter-spacing:-.01em; font-size:17px}
.header-actions{display:flex; align-items:center; gap:12px}
.pill{display:inline-flex; align-items:center; gap:7px; font-size:12px; color:var(--muted);
  border:1px solid var(--border); border-radius:999px; padding:6px 12px; background:var(--surface)}
.dot{width:7px; height:7px; border-radius:50%; background:var(--ok); box-shadow:0 0 0 3px color-mix(in srgb, var(--ok) 22%, transparent)}
.ghost-btn{font-family:var(--font-body); font-size:13px; font-weight:500; color:var(--text);
  background:var(--surface); border:1px solid var(--border-strong); border-radius:999px;
  min-height:38px; padding:8px 16px; cursor:pointer; transition:border-color var(--dur-fast) var(--ease), color var(--dur-fast) var(--ease)}
.ghost-btn:hover{border-color:var(--accent); color:var(--accent)}

/* ---- 主体 ---- */
main{flex:1 0 auto; padding-bottom:8px}
.page-title{margin:44px 0 18px; font-family:var(--font-display); font-weight:700;
  font-size:clamp(1.5rem,3.4vw,1.95rem); letter-spacing:-.02em; line-height:1.2}

/* ---- 工具卡 ---- */
.tool{background:var(--surface); border:1px solid var(--border);
  border-radius:var(--radius-lg); padding:28px; box-shadow:var(--shadow-3)}
.field-head{display:flex; align-items:baseline; justify-content:space-between; gap:12px; flex-wrap:wrap; margin-bottom:10px}
.field-head label{font-size:13px; font-weight:600; letter-spacing:.02em}
.field-hint{font-size:12px; color:var(--muted)}
.input-shell{display:flex; align-items:center; gap:12px; padding:4px 6px 4px 16px;
  border:1.5px solid var(--border-strong); border-radius:var(--radius-md); background:var(--bg);
  transition:border-color var(--dur-base) var(--ease), box-shadow var(--dur-base) var(--ease)}
.input-shell:focus-within{border-color:var(--accent); box-shadow:0 0 0 4px var(--accent-soft)}
.input-icon{display:grid; place-items:center; color:var(--muted); flex-shrink:0}
#urlInput{flex:1; min-width:0; border:none; outline:none; background:transparent; color:var(--text);
  font-family:var(--font-mono); font-size:15px; padding:14px 0; caret-color:var(--accent)}
#urlInput::placeholder{color:var(--muted); opacity:.75}
.clear-btn{flex-shrink:0; width:38px; height:38px; border-radius:50%; border:none; cursor:pointer;
  background:var(--surface-2); color:var(--muted); font-size:19px; line-height:1;
  display:grid; place-items:center; transition:background var(--dur-fast) var(--ease), color var(--dur-fast) var(--ease)}
.clear-btn:hover{background:var(--accent); color:var(--accent-ink)}

.error{display:flex; gap:10px; align-items:flex-start; margin:14px 0 0; padding:12px 14px;
  border:1px solid color-mix(in srgb, var(--err) 34%, var(--border)); border-radius:var(--radius-sm);
  background:color-mix(in srgb, var(--err) 8%, transparent); color:var(--err); font-size:13.5px}
.error-icon{flex-shrink:0; width:18px; height:18px; border-radius:50%; background:var(--err); color:#fff;
  display:grid; place-items:center; font-size:11px; font-weight:700; margin-top:2px}

.result{margin-top:20px; padding-top:20px; border-top:1px dashed var(--border-strong);
  animation:rise var(--dur-base) var(--ease) both}
.result-head{display:flex; align-items:baseline; justify-content:space-between; gap:12px; flex-wrap:wrap; margin-bottom:10px}
.result-label{font-size:13px; font-weight:600}
.result-meta{display:flex; align-items:center; flex-wrap:wrap; gap:4px; font-size:12px; color:var(--muted); word-break:break-all}
.repo-link{display:inline-flex; align-items:center; gap:3px; font-family:var(--font-mono); font-size:12px;
  color:var(--accent); text-decoration:none; border-bottom:1px dashed var(--accent);
  padding:3px 2px; margin:-3px -2px; border-radius:4px; cursor:pointer;
  transition:border-bottom-style var(--dur-fast) var(--ease), background var(--dur-fast) var(--ease)}
.repo-link:hover{border-bottom-style:solid; background:var(--accent-soft)}
.repo-link:focus-visible{outline:2px solid var(--accent); outline-offset:2px}
.repo-arrow{color:var(--accent); font-size:12px; line-height:1}
.repo-file{color:var(--muted); font-family:var(--font-mono); font-size:12px}
.result-field{display:flex; align-items:center; gap:10px; padding:12px 16px; border-radius:var(--radius-md);
  background:var(--surface-2); border:1px solid var(--border)}
#resultValue{flex:1; min-width:0; border:none; outline:none; background:transparent; color:var(--accent);
  font-family:var(--font-mono); font-size:14.5px; font-weight:500; text-overflow:ellipsis}
.actions{display:flex; gap:12px; margin-top:16px; flex-wrap:wrap}
.btn{font-family:var(--font-body); font-size:14.5px; font-weight:600; cursor:pointer;
  min-height:48px; padding:12px 24px; border-radius:var(--radius-md); border:1px solid var(--border-strong);
  background:var(--surface); color:var(--text); flex:1; min-width:160px;
  transition:transform var(--dur-fast) var(--ease), border-color var(--dur-fast) var(--ease),
    background var(--dur-fast) var(--ease), color var(--dur-fast) var(--ease), box-shadow var(--dur-fast) var(--ease)}
.btn:hover{border-color:var(--accent); color:var(--accent)}
.btn:active{transform:translateY(1px)}
.btn.primary{background:var(--accent); color:var(--accent-ink); border-color:var(--accent); box-shadow:var(--shadow-2)}
.btn.primary:hover{color:var(--accent-ink); filter:brightness(1.06)}

/* ---- 配置卡片 ---- */
.facts{display:grid; grid-template-columns:repeat(4,1fr); gap:14px; margin-top:22px}
.fact{background:var(--surface); border:1px solid var(--border); border-radius:var(--radius-md);
  padding:16px; display:flex; flex-direction:column; gap:6px; box-shadow:var(--shadow-1);
  transition:border-color var(--dur-base) var(--ease), transform var(--dur-base) var(--ease)}
.fact:hover{border-color:var(--accent); transform:translateY(-2px)}
.fact-k{font-size:11px; letter-spacing:.1em; text-transform:uppercase; color:var(--muted)}
.fact-v{font-family:var(--font-display); font-weight:600; font-size:16px; font-variant-numeric:tabular-nums}
.fact-v[title]{cursor:help; border-bottom:1px dotted var(--border-strong)}

/* ---- 页脚 ---- */
.site-footer{flex-shrink:0; margin-top:44px; border-top:1px solid var(--border)}
.footer-inner{display:flex; align-items:center; justify-content:space-between; gap:16px;
  flex-wrap:wrap; padding-top:22px; padding-bottom:32px; font-size:12.5px; color:var(--muted)}

/* ---- Toast ---- */
.toast{position:fixed; left:50%; bottom:28px; transform:translate(-50%,20px); z-index:50;
  background:var(--text); color:var(--bg); font-size:13.5px; font-weight:500;
  padding:11px 20px; border-radius:999px; box-shadow:var(--shadow-3);
  opacity:0; pointer-events:none; transition:opacity var(--dur-base) var(--ease), transform var(--dur-base) var(--ease)}
.toast.show{opacity:1; transform:translate(-50%,0)}

/* ---- 动效 ---- */
@keyframes rise{from{opacity:0; transform:translateY(12px)} to{opacity:1; transform:none}}
@keyframes reveal{to{opacity:1; transform:none}}
.reveal{opacity:0; transform:translateY(16px); animation:reveal var(--dur-slow) var(--ease) forwards}
.reveal:nth-child(1){animation-delay:40ms}
.reveal:nth-child(2){animation-delay:130ms}
.reveal:nth-child(3){animation-delay:220ms}
@media (prefers-reduced-motion:reduce){
  *,*::before,*::after{animation:none !important; transition:none !important}
  .reveal{opacity:1; transform:none}
}

/* ---- 响应式 ---- */
@media (max-width:760px){
  .facts{grid-template-columns:repeat(2,1fr)}
  .page-title{margin:32px 0 16px}
  .tool{padding:22px}
}
@media (max-width:520px){
  .wrap{padding:0 16px}
  .header-inner{min-height:58px}
  .pill{display:none}
  #urlInput{font-size:14px}
  .btn{min-width:100%}
  .facts{grid-template-columns:1fr}
  .footer-inner{flex-direction:column; align-items:flex-start; gap:6px}
}
`

/* ---------------------------------------------------------------------------
 *  客户端脚本（String.raw：反斜杠原样保留，杜绝模板字符串吞掉 \ 的问题）
 * -------------------------------------------------------------------------*/

const CLIENT_JS = String.raw`
(function () {
    'use strict'

    var CFG = window.__PROXY_CONFIG__ || {}
    var PREFIX = CFG.prefix || '/'
    var HOSTS = (CFG.allowedHosts && CFG.allowedHosts.length ? CFG.allowedHosts : ['github.com', 'raw.githubusercontent.com']).slice()
    var HOST_ENTRIES = HOSTS.map(function (h) { return String(h).toLowerCase() })
    // 只对内置 GitHub 域名剥离主机前缀（服务端启发式可还原）；
    // 自定义站点保留 host/path，交给服务端按首段域名路由。
    var STRIP_ENTRIES = (CFG.githubHosts && CFG.githubHosts.length ? CFG.githubHosts : HOSTS)
        .map(function (h) { return String(h).toLowerCase() })
    var THEME_KEY = 'ghproxy_theme'

    function $(id) { return document.getElementById(id) }

    var root = document.documentElement
    var input = $('urlInput')
    var clearBtn = $('clearBtn')
    var errorBox = $('errorBox')
    var errorText = $('errorText')
    var resultBox = $('resultBox')
    var resultValue = $('resultValue')
    var resultMeta = $('resultMeta')
    var copyBtn = $('copyBtn')
    var openBtn = $('openBtn')
    var themeBtn = $('themeBtn')
    var toast = $('toast')

    /* ---------- 主题 ---------- */
    var theme = root.getAttribute('data-theme') || 'light'
    function applyTheme(t) {
        theme = t
        root.setAttribute('data-theme', t)
        if (themeBtn) {
            themeBtn.textContent = t === 'dark' ? '浅色模式' : '深色模式'
            themeBtn.setAttribute('aria-pressed', t === 'dark' ? 'true' : 'false')
        }
    }
    applyTheme(theme)
    if (themeBtn) {
        themeBtn.addEventListener('click', function () {
            var next = theme === 'dark' ? 'light' : 'dark'
            try { localStorage.setItem(THEME_KEY, next) } catch (e) {}
            applyTheme(next)
        })
    }

    /* ---------- 地址解析 ---------- */
    function stripScheme(v) { return String(v).replace(/^https?:\/\//i, '') }

    /* 主机是否命中列表；支持 '*.example.com' 通配（子域与根域均命中） */
    function inList(host, list) {
        for (var i = 0; i < list.length; i++) {
            var entry = list[i]
            if (entry.indexOf('*.') === 0) {
                var base = entry.slice(2)
                if (host === base || host.slice(-(base.length + 1)) === '.' + base) return true
            } else if (host === entry) {
                return true
            }
        }
        return false
    }
    function matchHost(host) { return inList(host, HOST_ENTRIES) }
    function stripHostPrefix(s) {
        var host = s.split('/')[0].toLowerCase()
        if (!inList(host, STRIP_ENTRIES)) return s
        var idx = s.indexOf('/')
        return idx === -1 ? '' : s.slice(idx)
    }
    function isShortForm(v) { return /^[A-Za-z0-9_-]+\/[A-Za-z0-9_.-]+(\/.*)?$/.test(v) }
    function validate(v) {
        var s = stripScheme(v).toLowerCase()
        if (matchHost(s.split('/')[0])) return true
        return isShortForm(v)
    }
    function buildEndpoint(v) {
        var target = stripHostPrefix(stripScheme(v))
        var path = target.replace(/^\/+/, '')
        var prefix = PREFIX.charAt(PREFIX.length - 1) === '/' ? PREFIX : PREFIX + '/'
        return location.origin + prefix + path
    }
    /* 从输入中解析出「所属仓库」信息；无法识别时返回 null。
       返回：{ owner, name, file, url }，其中 url 恒为 https://github.com/owner/name */
    var REPO_NAME_RE = /^[A-Za-z0-9_.-]+$/
    function makeRepo(owner, name, rest, kind) {
        if (!REPO_NAME_RE.test(owner) || !REPO_NAME_RE.test(name)) return null
        if (owner === '.' || owner === '..' || name === '.' || name === '..') return null
        var file = ''
        if (rest) {
            var parts = rest.split('/')
            if (parts.length > 2 && (parts[0] === 'blob' || parts[0] === 'raw')) {
                file = parts.slice(2).join('/')
            } else if (kind === 'raw' && parts.length > 1) {
                file = parts.slice(1).join('/')
            } else {
                file = parts[parts.length - 1]
            }
        }
        return { owner: owner, name: name, file: file, url: 'https://github.com/' + owner + '/' + name }
    }
    function parseRepo(v) {
        var s = stripScheme(String(v).trim()).replace(/[?#].*$/, '')
        if (!s) return null
        var m
        m = s.match(/^(?:www\.)?github\.com\/([^\/]+)\/([^\/]+)(?:\/(.*))?$/i)
        if (m) return makeRepo(m[1], m[2], m[3] || '', 'github')
        m = s.match(/^raw\.githubusercontent\.com\/([^\/]+)\/([^\/]+)(?:\/(.*))?$/i)
        if (m) return makeRepo(m[1], m[2], m[3] || '', 'raw')
        // 其余显式域名（含 gist）不按仓库解析
        if (/^gist\./i.test(s) || /^[^\/]+\.[a-z]{2,}(\/|$)/i.test(s)) return null
        // 无主机的短形式 user/repo[...]
        m = s.match(/^([^\/]+)\/([^\/]+)(?:\/(.*))?$/)
        if (m) return makeRepo(m[1], m[2], m[3] || '', 'short')
        return null
    }

    /* 在新标签页打开地址。
       注意：window.open 的 features 若包含 noopener/noreferrer，规范要求返回 null，
       无法据此判断是否被拦截，因此这里不带 features，改为打开后手动切断 opener。 */
    function openInNewTab(url) {
        var win = null
        try {
            win = window.open(url, '_blank')
        } catch (err) {
            return { ok: false, reason: 'error' }
        }
        if (!win) return { ok: false, reason: 'blocked' }
        try { win.opener = null } catch (err) {}
        return { ok: true }
    }

    /* 在新窗口打开仓库页；失败时给出提示 */
    function jumpToRepo(url) {
        var res = openInNewTab(url)
        if (res.ok) return
        showToast(res.reason === 'blocked'
            ? '新窗口被浏览器拦截，请允许弹窗后重试'
            : '打开仓库页面失败，请手动访问 ' + url)
    }

    /* 渲染结果说明：仓库信息可点击跳转，文件名作为附加信息 */
    function renderMeta(v) {
        if (!resultMeta) return
        while (resultMeta.firstChild) resultMeta.removeChild(resultMeta.firstChild)
        var repo = parseRepo(v)
        if (!repo) {
            resultMeta.appendChild(document.createTextNode('标准路径路由'))
            return
        }
        resultMeta.appendChild(document.createTextNode('仓库 '))
        var link = document.createElement('a')
        link.className = 'repo-link'
        link.setAttribute('href', repo.url)
        link.setAttribute('target', '_blank')
        link.setAttribute('rel', 'noopener noreferrer')
        link.setAttribute('title', '在新窗口打开 ' + repo.url)
        link.appendChild(document.createTextNode(repo.owner + '/' + repo.name))
        var arrow = document.createElement('span')
        arrow.className = 'repo-arrow'
        arrow.setAttribute('aria-hidden', 'true')
        arrow.appendChild(document.createTextNode(' \u2197'))
        link.appendChild(arrow)
        link.addEventListener('click', function (e) {
            if (e && typeof e.preventDefault === 'function') e.preventDefault()
            jumpToRepo(repo.url)
        })
        resultMeta.appendChild(link)
        if (repo.file) {
            resultMeta.appendChild(document.createTextNode(' \u00b7 '))
            var fileEl = document.createElement('span')
            fileEl.className = 'repo-file'
            fileEl.appendChild(document.createTextNode(repo.file))
            resultMeta.appendChild(fileEl)
        }
    }

    /* ---------- 渲染 ---------- */
    function render() {
        if (!input) return
        var v = input.value.trim()
        if (clearBtn) clearBtn.hidden = !v
        if (!v) {
            resultBox.hidden = true
            errorBox.hidden = true
            // 清空残留结果，避免 Enter 打开上一次的地址
            if (resultValue) resultValue.value = ''
            return
        }
        if (!validate(v)) {
            resultBox.hidden = true
            errorBox.hidden = false
            errorText.textContent = '无法识别该地址。请粘贴 GitHub 链接，或使用 user/repo 形式。'
            if (resultValue) resultValue.value = ''
            return
        }
        errorBox.hidden = true
        resultBox.hidden = false
        resultValue.value = buildEndpoint(v)
        renderMeta(v)
    }

    /* ---------- 交互反馈 ---------- */
    var toastTimer
    function showToast(msg) {
        if (!toast) return
        toast.textContent = msg
        toast.classList.add('show')
        clearTimeout(toastTimer)
        toastTimer = setTimeout(function () { toast.classList.remove('show') }, 2000)
    }
    function legacyCopy() {
        resultValue.select()
        try { document.execCommand('copy') } catch (e) {}
    }
    function copyEndpoint() {
        if (!resultValue.value) return
        var text = resultValue.value
        var done = function () { showToast('链接已复制到剪贴板') }
        if (navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(text).then(done, function () { legacyCopy(); done() })
        } else {
            legacyCopy()
            done()
        }
    }
    function openEndpoint() {
        if (!resultValue.value) return
        var res = openInNewTab(resultValue.value)
        if (!res.ok) {
            showToast(res.reason === 'blocked'
                ? '新窗口被浏览器拦截，请允许弹窗后重试'
                : '打开失败，请改用「复制链接」后手动访问')
        }
    }

    input.addEventListener('input', render)
    input.addEventListener('keydown', function (e) {
        if (e.key === 'Enter') {
            e.preventDefault()
            if (resultValue.value) openEndpoint()
        } else if (e.key === 'Escape') {
            input.value = ''
            render()
        }
    })
    if (clearBtn) clearBtn.addEventListener('click', function () { input.value = ''; render(); input.focus() })
    if (copyBtn) copyBtn.addEventListener('click', copyEndpoint)
    if (openBtn) openBtn.addEventListener('click', openEndpoint)

    /* ---------- 配置概览 ---------- */
    function formatBytes(n) {
        if (!n) return '0 B'
        var u = ['B', 'KB', 'MB', 'GB'], k = 0
        while (n >= 1024 && k < u.length - 1) { n = n / 1024; k++ }
        return (Math.round(n * 10) / 10) + ' ' + u[k]
    }
    var limitText = $('limitText')
    var hostsText = $('hostsText')
    var baseText = $('baseText')
    var yearText = $('year')
    if (limitText) limitText.textContent = CFG.maxFileSize > 0 ? formatBytes(CFG.maxFileSize) : '不限制'
    if (hostsText) {
        hostsText.textContent = HOSTS.length + ' 个'
        // 悬停展示完整域名列表
        hostsText.setAttribute('title', HOSTS.join('、'))
    }
    if (baseText) baseText.textContent = CFG.customBaseCount > 0 ? CFG.customBaseCount + ' 个' : '未配置'
    if (yearText) yearText.textContent = String(new Date().getFullYear())

    render()
    if (input) input.focus()
})()
`

/* ---------------------------------------------------------------------------
 *  页面骨架
 * -------------------------------------------------------------------------*/

const UI_HTML = `<!DOCTYPE html>
<html lang="zh-CN" data-theme="light">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta name="robots" content="noindex, nofollow">
<meta name="color-scheme" content="light dark">
<title>GitHub 加速</title>
<script>(function(){try{var t=localStorage.getItem('ghproxy_theme');if(!t&&window.matchMedia&&window.matchMedia('(prefers-color-scheme: dark)').matches)t='dark';if(t)document.documentElement.setAttribute('data-theme',t)}catch(e){}})()</script>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Sora:wght@600;700&family=IBM+Plex+Sans:wght@400;500;600&family=IBM+Plex+Mono:wght@400;500&display=swap" rel="stylesheet">
<style>${PAGE_CSS}</style>
</head>
<body>

<header class="site-header">
  <div class="wrap header-inner">
    <a class="brand" href="./">
      <span class="brand-logo" aria-hidden="true">&#9670;</span>
      <span class="brand-text">Github-Proxy</span>
    </a>
    <div class="header-actions">
      <span class="pill"><span class="dot" aria-hidden="true"></span>服务运行中</span>
      <button class="ghost-btn" id="themeBtn" type="button" aria-pressed="false">深色模式</button>
    </div>
  </div>
</header>

<main class="wrap">
  <h1 class="page-title reveal">GitHub 加速</h1>

  <section class="tool reveal" aria-label="链接转换工具">
    <div class="field-head">
      <label for="urlInput">目标地址</label>
      <span class="field-hint">支持 github.com · raw.githubusercontent.com · gist</span>
    </div>

    <div class="input-shell">
      <span class="input-icon" aria-hidden="true">
        <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>
      </span>
      <input type="text" id="urlInput" placeholder="https://github.com/user/repo/releases/download/v1.0/app.zip" autocomplete="off" spellcheck="false" aria-describedby="errorBox">
      <button class="clear-btn" id="clearBtn" type="button" hidden aria-label="清空输入">&times;</button>
    </div>

    <p class="error" id="errorBox" role="alert" hidden>
      <span class="error-icon" aria-hidden="true">!</span>
      <span id="errorText"></span>
    </p>

    <div class="result" id="resultBox" hidden>
      <div class="result-head">
        <span class="result-label">代理地址</span>
        <span class="result-meta" id="resultMeta"></span>
      </div>
      <div class="result-field">
        <input type="text" id="resultValue" readonly aria-label="代理地址">
      </div>
      <div class="actions">
        <button class="btn primary" id="openBtn" type="button">打开 / 下载</button>
        <button class="btn" id="copyBtn" type="button">复制链接</button>
      </div>
    </div>
  </section>

  <section class="facts reveal" aria-label="服务配置概览">
    <div class="fact"><span class="fact-k">文件大小上限</span><span class="fact-v" id="limitText">—</span></div>
    <div class="fact"><span class="fact-k">超限处理</span><span class="fact-v">返回原链接</span></div>
    <div class="fact"><span class="fact-k">可反代域名</span><span class="fact-v" id="hostsText">—</span></div>
    <div class="fact"><span class="fact-k">短链基准</span><span class="fact-v" id="baseText">—</span></div>
  </section>
</main>

<footer class="site-footer">
  <div class="wrap footer-inner">
    <span>&copy; <span id="year"></span> Github-Proxy &middot; Cloudflare Workers</span>
    <span>单文件部署 &middot; 不记录访问日志</span>
  </div>
</footer>

<div class="toast" id="toast" role="status" aria-live="polite"></div>

<script>window.__PROXY_CONFIG__ = ${JSON.stringify(UI_CONFIG)};</script>
<script>${CLIENT_JS}</script>
</body>
</html>
`

/* ---------------------------------------------------------------------------
 *  Worker 入口
 * -------------------------------------------------------------------------*/

export default {
    /**
     * @param {Request} request
     * @returns {Promise<Response>}
     */
    async fetch(request) {
        try {
            if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS_HEADERS })
            const url = new URL(request.url)
            const prefix = normalizePrefix(PREFIX)
            const path = url.pathname.slice(prefix.length)
            if (path === '' || path === '/') {
                return new Response(UI_HTML, {
                    headers: {
                        'Content-Type': 'text/html;charset=UTF-8',
                        // 首页是纯静态资源，允许短暂缓存以减少回源与冷启动开销
                        'Cache-Control': 'public, max-age=300'
                    }
                })
            }
            if (path === 'favicon.ico') return new Response(null, { status: 204 })

            const targetUrls = resolveTargetUrls(path)
            if (targetUrls.length === 0) {
                return new Response('[FATAL] Invalid Request Format\n', { status: 400, headers: { 'Content-Type': 'text/plain; charset=utf-8' } })
            }

            const finalUrls = targetUrls.map((t) => (url.search ? t + url.search : t))
            return await proxyRequest(request, finalUrls, url.origin, prefix)
        } catch (err) {
            // 记录到 Workers 日志，便于排查；对外只暴露通用错误。
            // 注意：strict 下 catch 变量为 unknown，需先收窄再用。
            const detail = err instanceof Error ? err.stack : String(err)
            console.error('[gh-proxy] 请求处理失败:', detail)
            return new Response('[FATAL] 502 Bad Gateway - Proxy Service Error\n', { status: 502, headers: { 'Content-Type': 'text/plain; charset=utf-8' } })
        }
    }
}

/* ---------------------------------------------------------------------------
 *  目标地址解析
 * -------------------------------------------------------------------------*/

/**
 * 解析路径得到候选目标地址，并过滤掉不安全的地址（非 https 或非受信域名）。
 * 通常返回 1 个；配置多地址短链时可能多个。
 * @param {string} path
 * @returns {string[]} 候选目标地址
 */
function resolveTargetUrls(path) {
    const candidates = buildCandidates(path)
    const trustedHosts = getTrustedHosts()
    return candidates.filter((targetUrl) => isSafeTargetUrl(targetUrl, trustedHosts))
}

/**
 * 仅当「指定索引处的路径段」恰为路由段 blob 时改写为 raw。
 * 用位置而非「首次出现」判断，避免误伤文件名中的 /blob/（如 docs/blob/a.md）。
 * 说明：带主机（github.com/u/r/blob/...）与补主机前缀后的路径，其路由段都位于索引 3。
 * @param {string} path
 * @param {number} index
 * @returns {string}
 */
function rewriteBlobToRaw(path, index) {
    const segments = path.split('/')
    if (segments[index] && segments[index].toLowerCase() === 'blob') {
        segments[index] = 'raw'
        return segments.join('/')
    }
    return path
}

/**
 * @param {string} path
 * @returns {string[]}
 */
function buildCandidates(path) {
    path = path.replace(/^https?:\/+/, '').replace(/^\/+/, '')
    const segments = path.split('/')
    const first = (segments[0] || '').toLowerCase()

    // 1) 路径首段是「已允许的域名」——直接反代（支持自定义站点）
    //    仅 github.com 的 blob 视图改写为 raw，其余域名一律原样透传
    if (isAllowedHost(first)) {
        const normalized = first === 'github.com' ? rewriteBlobToRaw(path, 3) : path
        return ['https://' + normalized]
    }

    // 2) 无域名（或非白名单域名）——沿用 GitHub 启发式路由，保持向后兼容
    if (!GITHUB_DOMAINS.some((domain) => path.toLowerCase().startsWith(domain + '/'))) {
        if (segments.length >= 2 && /^[0-9a-fA-F]{32}$/.test(segments[1])) {
            path = (segments.length >= 3 && segments[2].toLowerCase() === 'raw')
                ? 'gist.githubusercontent.com/' + path
                : 'gist.github.com/' + path
        } else if (segments.length >= 3 && GITHUB_VIEW_RE.test(segments[2])) {
            // 补上 github.com/ 前缀后，原 segments[2] 的路由段落在索引 3
            path = rewriteBlobToRaw('github.com/' + path, 3)
        } else if (segments.length >= 4) {
            path = 'raw.githubusercontent.com/' + path
        } else {
            // 短链：按配置顺序生成多个候选地址
            if (CUSTOM_BASE_URLS.length) return CUSTOM_BASE_URLS.map((base) => base + path)
            path = 'github.com/' + path
        }
    }

    return ['https://' + path]
}

/* ---------------------------------------------------------------------------
 *  代理请求
 * -------------------------------------------------------------------------*/

/**
 * 安全加固：剔除不应转发给上游的请求头
 * @param {Headers} sourceHeaders
 * @returns {Headers}
 */
function buildUpstreamHeaders(sourceHeaders) {
    const headers = new Headers(sourceHeaders)
    for (const name of STRIP_REQUEST_HEADERS) headers.delete(name)
    return headers
}

/**
 * 统一写入 CORS 头
 * @param {Headers} headers
 * @returns {Headers}
 */
function applyCors(headers) {
    for (const [key, value] of Object.entries(CORS_HEADERS)) headers.set(key, value)
    return headers
}

/**
 * 统一响应加固：移除上游 CSP / clear-site-data，补齐安全头（所有返回分支共用）
 * @param {Headers} headers
 * @returns {Headers}
 */
function applyResponseHardening(headers) {
    headers.delete('content-security-policy')
    headers.delete('content-security-policy-report-only')
    headers.delete('clear-site-data')
    headers.set('x-frame-options', 'DENY')
    headers.set('x-content-type-options', 'nosniff')
    headers.set('referrer-policy', 'no-referrer')
    return headers
}

/**
 * 代理 HTML 时的同源防护（策略见文件顶部 HTML_GUARD 说明）。
 * 只对 text/html 生效，二进制 / 文本 / JSON 等一律不干预。
 * @param {Headers} headers
 * @returns {Headers}
 */
function applyHtmlGuard(headers) {
    if (HTML_GUARD === 'off') return headers
    const contentType = headers.get('content-type') || ''
    if (!/text\/html/i.test(contentType)) return headers
    if (HTML_GUARD === 'download') {
        headers.set('content-disposition', 'attachment')
    } else {
        headers.set('content-security-policy', 'sandbox')
    }
    return headers
}

/**
 * 所有返回分支共用的响应头收尾：安全头 → HTML 同源防护。
 * @param {Headers} headers
 * @returns {Headers}
 */
function hardenResponseHeaders(headers) {
    applyResponseHardening(headers)
    applyHtmlGuard(headers)
    return headers
}

/**
 * 将上游 Location 归一化为本 Worker 的路径（去掉协议与多余前导斜杠）
 * @param {string} redirectUrl
 * @returns {string}
 */
function normalizeRedirectPath(redirectUrl) {
    return String(redirectUrl).replace(/^https?:\/\//i, '').replace(/^\/+/, '')
}

/**
 * 向上游发起请求，必要时在多个候选地址之间回退。
 * @param {Request} originalRequest
 * @param {string[]} targetUrls
 * @param {string} workerOrigin
 * @param {string} prefix
 * @returns {Promise<Response>}
 */
async function proxyRequest(originalRequest, targetUrls, workerOrigin, prefix) {
    // 仅无请求体的方法允许在多个候选地址间回退，避免请求体被重复消费
    const canRetry = originalRequest.method === 'GET' || originalRequest.method === 'HEAD'
    // 注解为 RequestInit：否则 'manual' 会被推断成 string，赋值给 fetch 的 redirect 会类型不符
    /** @type {RequestInit} */
    const init = {
        method: originalRequest.method,
        headers: buildUpstreamHeaders(originalRequest.headers),
        redirect: 'manual',
        body: originalRequest.body
    }

    let response = null
    let targetUrl = targetUrls[0]
    for (let i = 0; i < targetUrls.length; i++) {
        targetUrl = targetUrls[i]
        response = await fetch(targetUrl, init)
        const isLast = i === targetUrls.length - 1
        // 上游不可用（404 / 5xx）且仍有候选地址时，继续尝试下一个
        if (!canRetry || isLast || (response.status !== 404 && response.status < 500)) break
        // 放弃该响应前先取消其响应体，避免连接被长时间占用
        if (response.body && typeof response.body.cancel === 'function') {
            try { await response.body.cancel() } catch (err) { /* 取消失败可忽略 */ }
        }
    }

    if (!response) {
        return new Response('[FATAL] 502 Bad Gateway - No Upstream Response\n', { status: 502, headers: { 'Content-Type': 'text/plain; charset=utf-8' } })
    }

    return handleUpstreamResponse(response, targetUrl, init, workerOrigin, prefix)
}

/**
 * 统一处理上游响应：超限回落、错误、重定向收敛、响应头加固。
 * 从 proxyRequest 中抽出，便于单独阅读与测试。
 * @param {Response} response
 * @param {string} targetUrl
 * @param {RequestInit} init
 * @param {string} workerOrigin
 * @param {string} prefix
 * @returns {Promise<Response>}
 */
async function handleUpstreamResponse(response, targetUrl, init, workerOrigin, prefix) {
    const responseHeaders = new Headers(response.headers)

    // ---- 文件大小限制 ----
    // 触发条件：MAX_FILE_SIZE > 0，且上游返回了 content-length，且该值超过上限。
    // 返回形式：302 重定向，Location 指向原始地址（原链接），
    //           并附带 X-Proxy-Fallback: size-exceeded 标记，交由上游直连。
    if (MAX_FILE_SIZE > 0 && responseHeaders.has('content-length')) {
        const contentLength = parseInt(String(responseHeaders.get('content-length') || ''), 10)
        if (!isNaN(contentLength) && contentLength > MAX_FILE_SIZE) {
            const fallbackHeaders = hardenResponseHeaders(applyCors(new Headers()))
            fallbackHeaders.set('location', targetUrl)
            fallbackHeaders.set('cache-control', 'no-store')
            fallbackHeaders.set('x-proxy-fallback', 'size-exceeded')
            return new Response(null, { status: 302, headers: fallbackHeaders })
        }
    }

    // 上游不可用：只回状态码，不回显上游地址（避免向客户端泄露内部目标）
    if (response.status === 404 || response.status >= 500) {
        const errorMsg = `[FATAL ERROR] ${response.status}\n=========================================\nStatus : Upstream resource offline or not found\n\nEOF\n`
        const headers = hardenResponseHeaders(applyCors(new Headers()))
        headers.set('Content-Type', 'text/plain; charset=utf-8')
        return new Response(errorMsg, { status: response.status, headers })
    }

    // ---- 重定向处理（安全加固：收敛服务端跟随范围）----
    // 1) 受信反代域名 → 重写回本 worker，继续走代理；
    // 2) GitHub 资源 CDN → 服务端跟随（releases 下载等既有行为）；
    // 3) 其余目标 → 不服务端跟随，直接把重定向交还客户端，避免 SSRF。
    if (responseHeaders.has('location')) {
        const rawLocation = String(responseHeaders.get('location') || '')
        // 相对 Location 需先按 targetUrl 解析为绝对地址，才能可靠判定目标主机
        let resolved = null
        try { resolved = new URL(rawLocation, targetUrl) } catch (err) { resolved = null }
        const redirectHost = resolved ? resolved.hostname.toLowerCase() : ''
        if (resolved && isAllowedHost(redirectHost)) {
            responseHeaders.set('location', workerOrigin + prefix + normalizeRedirectPath(resolved.href))
        } else if (resolved && isAssetHost(redirectHost)) {
            init.redirect = 'follow'
            return fetch(resolved.href, init)
        } else {
            hardenResponseHeaders(applyCors(responseHeaders))
            return new Response(null, { status: response.status, headers: responseHeaders })
        }
    }

    hardenResponseHeaders(applyCors(responseHeaders))

    return new Response(response.body, { status: response.status, headers: responseHeaders })
}
