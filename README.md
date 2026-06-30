# github-proxy

* `github-proxy` 是一个部署在 Cloudflare  Workers 的 GitHub 代理服务，适合个人或小团队使用，底层路由逻辑基于 [hunshcn/gh-proxy](https://github.com/hunshcn/gh-proxy)重构。如有大需求请参考原项目另外的部署方式。
* 修改原因：把一些常用的网站交由自己把控，避免不稳定等情况（还有就是，不想看到广告）。

---

## 简体中文

### 简介
* 单文件部署，操作简单，无需额外设置。
* 主要用于解决 GitHub 资源加载缓慢、API 速率限制以及前端跨域（CORS）拦截等问题。
* 部署前，可以在 `index.js` 文件的顶部，根据自己的实际需求修改以下常量：

```javascript
// 代理服务的 URL 路径前缀设置 (默认: '/')，即为 `https://你的域名/`。
// 如果想将其设置特定的子路径，例如 `https://你的域名/proxy/`，请将其修改为 '/proxy/'。
const PREFIX = '/'

// 最大文件代理大小限制 (单位：字节)。0 表示无限制。
// 提示：如果使用此项目并作为公开节点提供服务，建议设置此值以防带宽滥用。
// 例如：限制为 50MB，则修改为 52428800 (50 * 1024 * 1024)。
const MAX_FILE_SIZE = 0 
```

### 部署流程 (Cloudflare Workers)
1. 登录 Cloudflare 控制台。
2. 导航至 `Workers 和 Pages`，点击 `创建应用程序` -> `创建 Worker`。
3. 设定项目名称并点击 `部署`。
4. 点击 `编辑代码`，清空编辑器内的所有默认代码。
5. 将本项目中的 `index.js` 完整代码复制并粘贴到左侧编辑器中。
6. 点击右上角 `保存并部署`。
7. 在 `域` 页面可以找到默认生成的 `workers.dev` 访问链接。建议在此页面添加 `自定义域` 以防默认域名被 DNS 污染，并关闭默认生成的 `workers.dev` 访问权限。

### 限制说明
运行于 Cloudflare 免费生态：
* 每日请求上限：100,000 次。
* 并发速率限制：1,000 次 / 分钟。

---

## English

### Description
* Single-file deployment; simple to operate, with no additional configuration required.
* It is built to bypass network restrictions, mitigate API rate limits, and resolve Cross-Origin Resource Sharing (CORS) issues when fetching GitHub assets. 
* Before deployment, you can modify the following constants at the top of the `index.js` file according to your specific needs::

```javascript
// Proxy service URL path prefix setting (Default: '/'), which maps to `https://yourdomain.com/`.
// If you want to set it to a specific subpath, e.g., `https://yourdomain.com/proxy/`, please change it to '/proxy/'.
const PREFIX = '/'

// Maximum file proxy size limit (in bytes). 0 means unlimited.
// Tip: If you are hosting this project as a public node, it is highly recommended to set this value to prevent bandwidth abuse.
// For example: To limit the size to 50MB, modify it to 52428800 (50 * 1024 * 1024).
const MAX_FILE_SIZE = 0 
```

### Deployment (Cloudflare Workers)
1. Log in to the Cloudflare Dashboard.
2. Go to `Workers & Pages`, click `Create application`, then `Create Worker`.
3. Name your worker and click `Deploy`.
4. Click `Edit code` and delete all default code in the editor.
5. Paste the entire contents of `index.js` from this repository into the editor.
6. Click `Save and deploy`.
7. Navigate to `Domains` find your default `.workers.dev` route. It is highly recommended to add a `Custom Domain` on this page for better accessibility, And disable the default `workers.dev` access.

### Limits
Subject to Cloudflare's free tier quotas:
* Daily request limit: 100,000 requests.
* Burst rate limit: 1,000 requests per minute.