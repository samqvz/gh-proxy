# github-proxy

* `github-proxy` 是一个部署在 Cloudflare Workers 的 GitHub 代理服务，适合个人或小团队使用，底层路由逻辑基于 [hunshcn/gh-proxy](https://github.com/hunshcn/gh-proxy) 重构。如有大需求请参考原项目另外的部署方式。
* 修改原因：把一些常用的网站交由自己把控，避免不稳定等情况（不想看到广告）。

---

## 简介

* 单文件部署，操作简单。
* 主要用于解决 GitHub 资源加载缓慢、API 速率限制以及前端跨域（CORS）拦截等问题。
* 访问首页即为一个可视化转换工具：粘贴链接 → 实时得到代理地址 → 一键复制 / 下载。
* 部署前，可以在 `index.js` 文件顶部根据自己的需求修改配置常量。

## 配置项

```javascript
// 1. 路径前缀（默认 '/'，即 https://你的域名/）
//    想用子路径（如 https://你的域名/proxy/）则改为 '/proxy/'
const PREFIX = '/'

// 2. 最大文件代理大小限制（字节）。0 表示无限制。
//    超过上限时自动 302 重定向到原始地址（原链接）。
const MAX_FILE_SIZE = 0

// 3. 短链基准地址。支持「单个字符串」或「字符串数组」，留空（''）关闭。
const CUSTOM_BASE_URL = ''
// const CUSTOM_BASE_URL = 'https://github.com/用户名/仓库名/分支名/'
// const CUSTOM_BASE_URL = [
//     'https://github.com/用户名/仓库名/分支名/',
//     'https://raw.githubusercontent.com/用户名/仓库名/分支名/'
// ]

// 4. 自定义可反代的网站（域名，支持 '*.example.com' 通配）
const CUSTOM_PROXY_SITES = []

// 5. 代理 HTML 内容时的同源防护：'sandbox' | 'download' | 'off'
const HTML_GUARD = 'sandbox'
```

### 1. 超限处理逻辑

* **触发条件**：`MAX_FILE_SIZE > 0`，且上游响应携带 `content-length` 头，且该值**大于**上限。
* **返回形式**：`302 Found` 重定向，`Location` 指向**原始地址（原链接）**，请求被交还上游直连；
  同时附带响应头 `X-Proxy-Fallback: size-exceeded` 与 `Cache-Control: no-store`，便于识别并避免缓存。
* **未超限**：正常透传，行为不变。
* **注意**：若上游未返回 `content-length`（例如分块传输），则无法预先判断大小，此时不做拦截。

### 2. 短链基准地址（`CUSTOM_BASE_URL`）

支持**单个字符串**（原有写法，完全兼容）与**字符串数组**（多地址）两种写法，值会自动补上结尾的 `/`。

**取值方式**

* 访问 `https://你的域名/剩余文件名`（即路径不足以判定为 GitHub 路径时），会把 `剩余文件名` 拼接到基准地址之后。
* 单字符串：等价于只含一个元素的数组。
* 数组：元素即为**候选基准地址**，按数组顺序使用；空白项会被自动忽略。

**使用方式（多地址回退）**

| 请求方法 | 行为 |
|---|---|
| `GET` / `HEAD` | 按顺序依次请求各候选地址；当上游返回 **404 或 5xx** 时自动尝试下一个；取第一个可用结果。全部失败则返回**最后一个**地址的响应。 |
| 其他方法（POST/PUT 等） | 只请求**第一个**候选地址（避免请求体被重复消费）。 |

**示例**

* 原链接：`https://github.com/用户名/仓库名/分支名/剩余文件名`
* 配置：`'https://github.com/用户名/仓库名/分支名/'`
* 即可以此访问：`https://你的域名/剩余文件名`
* 配置多个镜像时，主地址不可用会自动切到备用地址，无需客户端改动。

> 安全提示：短链基准地址所在的域名会被自动视为受信域名，因此请只填写你信任的地址。

### 3. 自定义可反代网站（`CUSTOM_PROXY_SITES`）

* 填入域名后，即可通过 `https://你的域名/example.com/路径` 反代该站点。
* 支持 `*.example.com` 通配子域。
* 只有内置 GitHub 域名与本列表中的域名可被反代，避免服务沦为开放代理。
* 首页转换工具会自动区分两类域名：内置 GitHub 域名会去掉主机前缀（`github.com/u/r/...` → `你的域名/u/r/...`），
  而**自定义站点会保留 `host/路径`**（`example.com/a` → `你的域名/example.com/a`），因为服务端需要靠路径首段来判断该反代哪个站点。

### 4. HTML 同源防护（`HTML_GUARD`）

被反代的第三方 HTML 是在**本 Worker 的域名下**渲染的，若原样放行，其内联脚本即获得本域执行权限，构成 XSS / Cookie 窃取面。因此对 `content-type: text/html` 的响应额外加一层防护：

| 取值 | 行为 | 适用 |
|---|---|---|
| `'sandbox'`（默认） | 追加 `Content-Security-Policy: sandbox`，页面可预览，但禁止脚本、表单提交与顶层跳转 | 只读预览场景 |
| `'download'` | 追加 `Content-Disposition: attachment`，直接下载而非在浏览器渲染 | 只想当下载站 |
| `'off'` | 不做任何处理 | 需要完整渲染第三方页面（风险自负） |

> 只对 `text/html` 生效；二进制、纯文本、JSON 等响应一律不干预。

### 5. 安全加固

在不改变反向代理语义的前提下，服务内置以下防护：

| 措施 | 具体做法 | 作用范围 |
|---|---|---|
| 目标地址二次校验 | 解析最终目标 URL，要求协议为 `https` 且 hostname 落在受信域名集合（可反代域名 + 短链基准域名）内，否则返回 `400` | 全部代理请求；可拦截 `https://github.com@evil.com/x` 这类 userinfo 混淆写法 |
| 重定向收敛 | 受信域名 → 重写回本 Worker 继续代理；GitHub 资源 CDN（`objects.githubusercontent.com` 等）→ 服务端跟随；**其余目标 → 原样回传客户端，不做服务端跟随** | 上游 302 处理，防止服务端被诱导请求任意外部地址（SSRF） |
| 请求头净化 | 转发前剔除 `host`、`cookie`、`connection`、`keep-alive`、`transfer-encoding`、`upgrade`、`te`、`trailer`、`proxy-*`，以及 `cf-connecting-ip`、`cf-ray`、`cf-visitor`、`x-forwarded-*`、`x-real-ip` | 所有转发至上游的请求；`authorization` 会保留，私有仓库 / Token 访问不受影响 |
| 出站域名白名单 | 仅内置 GitHub 域名、`CUSTOM_PROXY_SITES` 与短链基准域名可出站 | 从源头消除「开放代理」与内网探测风险 |
| 强制 HTTPS | 目标地址一律以 `https://` 构造 | 全链路 |
| 响应头加固 | 补充 `referrer-policy: no-referrer`；保留 `x-frame-options: DENY`、`x-content-type-options: nosniff`；移除上游的 CSP 与 `clear-site-data` | 所有代理响应 |
| HTML 同源防护 | 对 `text/html` 响应追加 `Content-Security-Policy: sandbox`（或按 `HTML_GUARD` 改为下载 / 不处理） | 见「HTML 同源防护」一节 |
| 错误信息收敛 | 上游 404 / 5xx 只回状态码，不回显上游地址 | 所有错误响应 |

**已知的行为变化**（均为安全收敛，如确有需要可在源码中调整）：

* 客户端 `cookie` 不再转发给上游。
* 指向不受信域名的上游重定向不再由服务端跟随，而是直接交还客户端。

### 6. 前端交互

首页为纯前端实现的可视化转换工具，与后端逻辑解耦，仅通过同域路径访问：

* **实时转换**：输入目标地址即实时生成代理地址，支持 `github.com`、`raw.githubusercontent.com`、gist 等链接以及 `user/repo` 短形式。
* **仓库跳转**：当输入可识别出所属仓库时，结果区会展示可点击的**仓库链接**（指向 `https://github.com/所有者/仓库名`）。点击后以**新窗口**打开；若新窗口被浏览器拦截或打开失败，会在页面底部给出提示。
* **一键操作**：支持复制代理地址、直接打开 / 下载，以及 `Enter` 打开、`Esc` 清空等键盘操作。
* **主题与无障碍**：支持浅色 / 深色主题切换并记忆偏好；适配 `prefers-reduced-motion`，并保证文本对比度满足 WCAG AA。

## 部署流程 (Cloudflare Workers)

1. 登录 Cloudflare 控制台。
2. 导航至 `Workers 和 Pages`，点击 `创建应用程序` -> `创建 Worker`。
3. 设定项目名称并点击 `部署`。
4. 点击 `编辑代码`，清空编辑器内的所有默认代码。
5. 将本项目中的 `index.js` 完整代码复制并粘贴到左侧编辑器中。
6. 点击右上角 `保存并部署`。
7. 在 `域` 页面可以找到默认生成的 `workers.dev` 访问链接。建议在此页面添加 `自定义域` 以防默认域名被 DNS 污染，并关闭默认生成的 `workers.dev` 访问权限。

## 限制说明

运行于 Cloudflare 免费生态：

* 每日请求上限：100,000 次。
* 并发速率限制：1,000 次 / 分钟。

## 许可证

本项目基于 MIT License 开源，详见 [LICENSE](./LICENSE)。
