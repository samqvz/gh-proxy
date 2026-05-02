'use strict'

const PREFIX = '/'
const Config = { jsdelivr: 0 }
const whiteList = []

const PREFLIGHT_INIT = {
    status: 204,
    headers: new Headers({
        'access-control-allow-origin': '*',
        'access-control-allow-methods': 'GET,POST,PUT,PATCH,TRACE,DELETE,HEAD,OPTIONS',
        'access-control-max-age': '1728000',
    }),
}

const exp1 = /^(?:https?:\/\/)?github\.com\/.+?\/.+?\/(?:releases|archive)\/.*$/i
const exp2 = /^(?:https?:\/\/)?github\.com\/.+?\/.+?\/(?:blob|raw)\/.*$/i
const exp3 = /^(?:https?:\/\/)?github\.com\/.+?\/.+?\/(?:info|git-).*$/i
const exp4 = /^(?:https?:\/\/)?raw\.(?:githubusercontent|github)\.com\/.+?\/.+?\/.+?\/.+$/i
const exp5 = /^(?:https?:\/\/)?gist\.(?:githubusercontent|github)\.com\/.+?\/.+?\/.+$/i
const exp6 = /^(?:https?:\/\/)?github\.com\/.+?\/.+?\/tags.*$/i

const UI_HTML = `
<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
    <title>GitHub Proxy</title>
    <style>
        :root {
            --bg-gradient: linear-gradient(-45deg, #f3f4f6, #e5e7eb, #d1d5db, #f9fafb);
            --panel-r: 255; --panel-g: 255; --panel-b: 255;
            --panel-alpha: 0.7;
            --panel-blur: 0px; 
            --text-color: #1f2937;
            --primary: #0969da;
            --primary-hover: #0550ae;
            --border: rgba(209, 213, 219, 0.5);
            --card-shadow: 0 8px 32px 0 rgba(31, 38, 135, 0.07);
            --error-color: #ef4444;
        }
        [data-theme="dark"] {
            --bg-gradient: linear-gradient(-45deg, #0f172a, #1e293b, #334155, #0f172a);
            --panel-r: 30; --panel-g: 41; --panel-b: 59;
            --panel-alpha: 0.6;
            --text-color: #f1f5f9;
            --primary: #58a6ff;
            --primary-hover: #318bf8;
            --border: rgba(255, 255, 255, 0.1);
            --card-shadow: 0 8px 32px 0 rgba(0, 0, 0, 0.4);
        }
        body {
            font-family: 'Inter', -apple-system, sans-serif;
            background: var(--bg-gradient); background-size: 400% 400%;
            animation: gradientBG 15s ease infinite; color: var(--text-color);
            display: flex; justify-content: center; align-items: center;
            min-height: 100vh; margin: 0; overflow: hidden; perspective: 1000px;
            transition: background 0.5s ease;
        }
        @keyframes gradientBG { 0% { background-position: 0% 50%; } 50% { background-position: 100% 50%; } 100% { background-position: 0% 50%; } }
        
        .container, .modal {
            backdrop-filter: blur(var(--panel-blur)); 
            -webkit-backdrop-filter: blur(var(--panel-blur));
            background: rgba(var(--panel-r), var(--panel-g), var(--panel-b), var(--panel-alpha)); 
            border: 1px solid var(--border);
            border-radius: 20px; box-shadow: var(--card-shadow); 
            transition: background 0.1s ease, backdrop-filter 0.2s ease, -webkit-backdrop-filter 0.2s ease;
        }
        .container {
            padding: 40px; width: 90%; max-width: 500px; position: relative;
            transform-style: preserve-3d; transition: transform 0.1s ease-out, background 0.1s ease;
        }
        
        h2 { margin: 0 0 30px 0; text-align: center; font-weight: 800; letter-spacing: -1px; text-shadow: 0 2px 4px rgba(0,0,0,0.05); transform: translateZ(20px); }
        .form-group { margin-bottom: 25px; transform: translateZ(30px); }
        label { display: block; margin-bottom: 10px; font-weight: 600; font-size: 13px; opacity: 0.8; }
        
        input[type="text"] {
            width: 100%; padding: 14px 16px; border: 1px solid var(--border); box-sizing: border-box;
            border-radius: 12px; background: rgba(255,255,255,0.05); color: var(--text-color);
            font-size: 14px; outline: none; transition: 0.3s;
        }
        input[type="text"]:focus { border-color: var(--primary); box-shadow: 0 0 0 4px rgba(9, 105, 218, 0.15); }
        [data-theme="dark"] input[type="text"]:focus { box-shadow: 0 0 0 4px rgba(88, 166, 255, 0.15); }
        
        input.error { border-color: var(--error-color) !important; box-shadow: 0 0 0 4px rgba(239, 68, 68, 0.15) !important; }
        .error-msg { color: var(--error-color); font-size: 12px; margin-top: 8px; display: none; }

        #infoCard {
            display: none; background: rgba(9, 105, 218, 0.05); transform: translateZ(35px);
            border: 1px dashed var(--primary); border-radius: 12px;
            padding: 15px; margin-top: -15px; margin-bottom: 20px; font-size: 12px;
        }
        [data-theme="dark"] #infoCard { background: rgba(88, 166, 255, 0.05); }
        
        .info-tag { background: var(--primary); color: #fff; padding: 2px 6px; border-radius: 4px; margin-right: 5px; }

        .btn-group { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin-top: 20px; transform: translateZ(40px); }
        .btn {
            background: var(--primary); color: #fff; border: none; box-sizing: border-box;
            padding: 14px; border-radius: 12px; cursor: pointer;
            font-size: 14px; font-weight: 700; transition: 0.3s;
            box-shadow: 0 4px 15px rgba(9, 105, 218, 0.2);
        }
        [data-theme="dark"] .btn { box-shadow: 0 4px 15px rgba(88, 166, 255, 0.15); }
        
        .btn:hover { background: var(--primary-hover); transform: translateY(-2px); box-shadow: 0 6px 20px rgba(9, 105, 218, 0.3); }
        [data-theme="dark"] .btn:hover { box-shadow: 0 6px 20px rgba(88, 166, 255, 0.25); }
        
        .btn-outline { background: transparent; border: 1px solid var(--primary); color: var(--text-color); box-shadow: none; }
        .btn-outline:hover { background: var(--primary); color: #fff; border-color: var(--primary); }
        
        .qr-section { display: none; text-align: center; margin-top: 20px; padding-top: 20px; border-top: 1px solid var(--border); transform: translateZ(20px); }
        .qr-img { background: white; padding: 10px; border-radius: 8px; margin-bottom: 10px; }

        .history-box { margin-top: 30px; transform: translateZ(15px); }
        .history-item {
            background: rgba(0,0,0,0.03); padding: 10px 15px; border-radius: 10px;
            font-size: 12px; margin-bottom: 8px; cursor: pointer; transition: 0.2s;
            display: flex; justify-content: space-between; align-items: center; border: 1px solid transparent;
        }
        .history-item:hover { background: rgba(9, 105, 218, 0.05); border-color: var(--primary); }
        [data-theme="dark"] .history-item:hover { background: rgba(88, 166, 255, 0.05); }

        .top-actions { position: absolute; top: 20px; right: 20px; display: flex; gap: 5px; transform: translateZ(50px); }
        
        .icon-btn {
            background: none; border: none; color: var(--text-color);
            cursor: pointer; 
            font-size: 22px;
            padding: 12px;
            margin: -12px;
            opacity: 0.8; transition: 0.2s;
            -webkit-tap-highlight-color: transparent;
        }
        .icon-btn:hover { opacity: 1; transform: scale(1.1); }

        .modal-overlay {
            position: fixed; top: 0; left: 0; width: 100%; height: 100%;
            background: rgba(0,0,0,0.4); z-index: 100; display: none;
            justify-content: center; align-items: center; opacity: 0; transition: 0.3s;
        }
        .modal { 
            padding: 30px; width: 70%; max-width: 400px; transform: translateY(20px); transition: 0.3s;
            background: rgba(var(--panel-r), var(--panel-g), var(--panel-b), 0.70); 
            backdrop-filter: blur(12px);
            -webkit-backdrop-filter: blur(12px);
        }
        .modal h3 { margin-top: 0; margin-bottom: 20px; font-weight: 700; display: flex; align-items: center; gap: 8px; }
        
        .modal-close { 
            position: absolute; top: 15px; right: 20px; cursor: pointer; 
            font-size: 28px; opacity: 0.5; padding: 10px; margin: -10px;
            -webkit-tap-highlight-color: transparent;
        }
        .modal-close:hover { opacity: 1; }
        
        input[type=range] {
            -webkit-appearance: none; background: rgba(0,0,0,0.1); border-radius: 5px; height: 6px; outline: none; margin-top: 5px;
        }
        [data-theme="dark"] input[type=range] { background: rgba(255,255,255,0.2); }
        input[type=range]::-webkit-slider-thumb {
            -webkit-appearance: none; appearance: none; width: 16px; height: 16px; border-radius: 50%; 
            background: var(--primary); cursor: pointer; transition: 0.2s;
        }
        input[type=range]::-webkit-slider-thumb:hover { transform: scale(1.2); }
        
        .toast {
            position: fixed; bottom: 30px; left: 50%; transform: translateX(-50%);
            background: #1f2937; color: white; padding: 12px 24px;
            border-radius: 50px; opacity: 0; transition: 0.3s; z-index: 1000; box-shadow: 0 10px 30px rgba(0,0,0,0.5);
        }
        
        .credits {
            text-align: center; margin-top: 35px; font-size: 12px; opacity: 0.75; line-height: 1.8; transform: translateZ(10px);
        }
        .credits a {
            color: var(--primary); text-decoration: none; font-weight: 600; border-bottom: 1px dashed var(--primary); transition: 0.2s;
        }
        .credits a:hover { opacity: 0.7; }
    </style>
</head>
<body>
    <div class="container" id="mainContainer">
        <div class="top-actions">
            <button class="icon-btn" onclick="openBgModal()" title="自定义壁纸">🖼️</button>
            <button class="icon-btn" onclick="toggleTheme()" title="切换主题">🌓</button>
        </div>
        
        <h2>GitHub Proxy</h2>
        
        <div class="form-group">
            <label>GITHUB URL</label>
            <div class="input-wrapper">
                <input type="text" id="url" placeholder="粘贴链接，按回车直接下载..." oninput="handleInput()" inputmode="url">
            </div>
            <div class="error-msg" id="errorMsg">❌ 不支持的链接格式，请检查（仅支持 GitHub 或 Gist 相关链接）</div>
        </div>

        <div id="infoCard"></div>
        
        <div class="form-group">
            <label>PROXY LINK</label>
            <input type="text" id="result" readonly placeholder="加速链接自动生成...">
        </div>
        
        <div class="btn-group">
            <button class="btn btn-outline" onclick="copyLink()">复制链接</button>
            <button class="btn btn-outline" onclick="openLink()">立即下载</button>
        </div>
        <button class="btn btn-outline" style="width: 100%; margin-top: 10px;" onclick="toggleQr()">生成二维码</button>

        <div class="qr-section" id="qrSection">
            <div id="qrContent"></div>
            <div style="font-size: 11px; opacity: 0.6;">手机扫码下载</div>
        </div>

        <div class="history-box" id="historyBox"></div>

        <div class="credits">
            基于 <a href="https://github.com/hunshcn/gh-proxy" target="_blank">@hunshcn/gh-proxy</a><br>
            UI 重构与增强 <a href="https://github.com/samqvz/gh-proxy" target="_blank">@samqvz</a>
        </div>
    </div>

    <div class="modal-overlay" id="bgModalOverlay">
        <div class="modal" id="bgModal">
            <div class="modal-close" onclick="closeBgModal()">×</div>
            <h3 style="font-size: 16px;">设置</h3>
            
            <div style="margin-bottom: 15px;">
                <label style="display: flex; justify-content: space-between; font-size: 12px; margin-bottom: 4px;">
                    <span>面板透明度</span>
                    <span id="transparencyVal">默认</span>
                </label>
                <input type="range" id="transparencySlider" min="0" max="100" value="30" style="width: 100%; cursor: pointer;" oninput="adjustTransparency(this.value)">
            </div>

            <div style="margin-bottom: 20px; padding-bottom: 20px; border-bottom: 1px solid var(--border);">
                <label style="display: flex; justify-content: space-between; font-size: 12px; margin-bottom: 4px;">
                    <span>面板模糊度</span>
                    <span id="blurVal">0px</span>
                </label>
                <input type="range" id="blurSlider" min="0" max="50" value="0" style="width: 100%; cursor: pointer;" oninput="adjustBlur(this.value)">
            </div>
            
            <button class="btn btn-outline" style="width: 100%; margin-bottom: 15px;" onclick="document.getElementById('bgUpload').click()">
                上传本地图片
            </button>
            <input type="file" id="bgUpload" accept="image/*" style="display:none" onchange="handleBgUpload(event)">
            
            <div style="text-align: center; margin-bottom: 15px; font-size: 12px; opacity: 0.5;">或者使用网络图片 URL</div>
            
            <input type="text" id="bgApiUrl" placeholder="输入图片 URL" style="margin-bottom: 10px;">
            <button class="btn btn-outline" style="width: 100%; margin-bottom: 15px;" onclick="applyBgApi()">应用网络壁纸</button>
            
            <button class="btn btn-outline" style="width: 100%; color: var(--error-color); border-color: var(--error-color);" onmouseover="this.style.background='var(--error-color)'; this.style.color='#fff'" onmouseout="this.style.background='transparent'; this.style.color='var(--error-color)'" onclick="clearBg()">
                恢复默认背景与设置
            </button>
        </div>
    </div>
    
    <div id="toast" class="toast">操作成功</div>

    <script>
        const theme = localStorage.getItem('theme') || 'light';
        document.documentElement.setAttribute('data-theme', theme);
        
        function toggleTheme() {
            const next = document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
            document.documentElement.setAttribute('data-theme', next);
            localStorage.setItem('theme', next);
            
            if (!localStorage.getItem('panel_transparency')) {
                document.getElementById('transparencyVal').innerText = next === 'dark' ? '40%' : '30%';
                document.getElementById('transparencySlider').value = next === 'dark' ? 40 : 30;
            }
        }

        const savedTransparency = localStorage.getItem('panel_transparency');
        if (savedTransparency !== null) {
            document.documentElement.style.setProperty('--panel-alpha', (100 - savedTransparency) / 100);
            document.getElementById('transparencySlider').value = savedTransparency;
            document.getElementById('transparencyVal').innerText = savedTransparency + '%';
        } else {
            document.getElementById('transparencyVal').innerText = theme === 'dark' ? '40%' : '30%';
            document.getElementById('transparencySlider').value = theme === 'dark' ? 40 : 30;
        }

        function adjustTransparency(val) {
            document.documentElement.style.setProperty('--panel-alpha', (100 - val) / 100);
            document.getElementById('transparencyVal').innerText = val + '%';
            localStorage.setItem('panel_transparency', val);
        }

        const savedBlur = localStorage.getItem('panel_blur');
        if (savedBlur !== null) {
            document.documentElement.style.setProperty('--panel-blur', savedBlur + 'px');
            document.getElementById('blurSlider').value = savedBlur;
            document.getElementById('blurVal').innerText = savedBlur + 'px';
        } else {
            document.documentElement.style.setProperty('--panel-blur', '0px');
            document.getElementById('blurSlider').value = 0;
            document.getElementById('blurVal').innerText = '0px';
        }

        function adjustBlur(val) {
            document.documentElement.style.setProperty('--panel-blur', val + 'px');
            document.getElementById('blurVal').innerText = val + 'px';
            localStorage.setItem('panel_blur', val);
        }

        const savedBg = localStorage.getItem('custom_bg');
        if (savedBg) applyCustomBg(savedBg, false);

        function applyCustomBg(imgData, save = true) {
            document.body.style.backgroundImage = 'url("' + imgData + '")';
            document.body.style.backgroundSize = 'cover';
            document.body.style.backgroundPosition = 'center';
            document.body.style.backgroundAttachment = 'fixed';
            document.body.style.animation = 'none';
            if (save) {
                try {
                    localStorage.setItem('custom_bg', imgData);
                } catch (e) {
                    showToast('提示: 图片较大，本次生效但无法本地保存');
                }
            }
        }

        function clearBg() {
            document.body.style = ''; 
            localStorage.removeItem('custom_bg');
            
            localStorage.removeItem('panel_transparency');
            document.documentElement.style.removeProperty('--panel-alpha');
            const currentTheme = document.documentElement.getAttribute('data-theme');
            document.getElementById('transparencyVal').innerText = currentTheme === 'dark' ? '40%' : '30%';
            document.getElementById('transparencySlider').value = currentTheme === 'dark' ? 40 : 30;
            
            localStorage.removeItem('panel_blur');
            document.documentElement.style.setProperty('--panel-blur', '0px');
            document.getElementById('blurVal').innerText = '0px';
            document.getElementById('blurSlider').value = 0;

            showToast('已恢复默认背景与设置');
            closeBgModal();
        }

        function handleBgUpload(e) {
            const file = e.target.files[0];
            if (!file) return;
            const reader = new FileReader();
            reader.onload = (event) => {
                applyCustomBg(event.target.result);
                showToast('本地壁纸应用成功');
                closeBgModal();
            };
            reader.readAsDataURL(file);
        }

        function applyBgApi() {
            let url = document.getElementById('bgApiUrl').value.trim();
            if (!url) return;

            if (url.indexOf('http://') !== 0 && url.indexOf('https://') !== 0) {
                url = 'https://' + url;
            }

            applyCustomBg(url);
            showToast('网络壁纸已应用');
            closeBgModal();
        }

        function openBgModal() {
            const overlay = document.getElementById('bgModalOverlay');
            overlay.style.display = 'flex';
            setTimeout(() => {
                overlay.style.opacity = '1';
                document.getElementById('bgModal').style.transform = 'translateY(0)';
            }, 10);
        }

        function closeBgModal() {
            const overlay = document.getElementById('bgModalOverlay');
            overlay.style.opacity = '0';
            document.getElementById('bgModal').style.transform = 'translateY(20px)';
            setTimeout(() => { overlay.style.display = 'none'; }, 300);
        }
        
        document.getElementById('bgModalOverlay').addEventListener('click', (e) => {
            if (e.target === document.getElementById('bgModalOverlay')) closeBgModal();
        });

        window.onload = () => {
            if(window.innerWidth >= 768) {
                const card = document.getElementById('mainContainer');
                document.addEventListener('mousemove', (e) => {
                    const xAxis = (window.innerWidth / 2 - e.pageX) / 45;
                    const yAxis = (window.innerHeight / 2 - e.pageY) / 45;
                    card.style.transform = 'rotateY(' + xAxis + 'deg) rotateX(' + yAxis + 'deg)';
                });
                document.addEventListener('mouseleave', () => {
                    card.style.transform = 'rotateY(0deg) rotateX(0deg)';
                    card.style.transition = 'transform 0.5s ease';
                    setTimeout(() => { card.style.transition = 'transform 0.1s ease-out'; }, 500);
                });
            }
            renderHistory();
        };

        document.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') openLink();
            if (e.key === 'Escape') { document.getElementById('url').value = ''; handleInput(); }
        });

        function parseUrl(url) {
            const reg = /github\\.com\\/([^/]+\\/[^/]+)\\/(?:blob|raw)\\/([^/]+)\\/(.+)/i;
            const match = url.match(reg);
            if (match) return { repo: match[1], branch: match[2], file: match[3] };
            return null;
        }

        function handleInput() {
            const val = document.getElementById('url').value.trim();
            const resInput = document.getElementById('result');
            const infoCard = document.getElementById('infoCard');
            const urlInput = document.getElementById('url');
            const errorMsg = document.getElementById('errorMsg');
            
            if (!val) {
                resInput.value = '';
                infoCard.style.display = 'none';
                urlInput.classList.remove('error');
                errorMsg.style.display = 'none';
                return;
            }

            const valLower = val.toLowerCase();
            const isValid = valLower.indexOf('github.com') > -1 || valLower.indexOf('githubusercontent.com') > -1 || valLower.indexOf('gist.') > -1;
            
            if (!isValid) {
                urlInput.classList.add('error');
                errorMsg.style.display = 'block';
                resInput.value = '';
                infoCard.style.display = 'none';
                return;
            }

            urlInput.classList.remove('error');
            errorMsg.style.display = 'none';

            const info = parseUrl(val);
            if (info) {
                infoCard.style.display = 'block';
                infoCard.innerHTML = '<span class="info-tag">仓库</span>' + info.repo + '<br><span class="info-tag" style="margin-top:5px;display:inline-block">文件</span>' + info.file.split('/').pop();
            } else {
                infoCard.style.display = 'none';
            }

            let target = val.startsWith('http') ? val : 'https://' + val;
            resInput.value = window.location.origin + '/' + target;
        }

        function copyLink() {
            const res = document.getElementById('result');
            if (!res.value) return;
            res.select();
            document.execCommand('copy');
            saveHistory(document.getElementById('url').value);
            showToast('已复制');
        }

        function openLink() {
            const res = document.getElementById('result');
            if (!res.value) return;
            saveHistory(document.getElementById('url').value);
            window.open(res.value, '_blank');
        }

        function toggleQr() {
            const res = document.getElementById('result').value;
            if (!res) return;
            const sec = document.getElementById('qrSection');
            const cont = document.getElementById('qrContent');
            if (sec.style.display === 'block') {
                sec.style.display = 'none';
            } else {
                sec.style.display = 'block';
                cont.innerHTML = '<img class="qr-img" src="https://api.qrserver.com/v1/create-qr-code/?size=150x150&data=' + encodeURIComponent(res) + '" />';
            }
        }

        function saveHistory(url) {
            let h = JSON.parse(localStorage.getItem('gh_history') || '[]');
            h = h.filter(x => x !== url);
            h.unshift(url);
            localStorage.setItem('gh_history', JSON.stringify(h.slice(0, 3)));
            renderHistory();
        }

        function renderHistory() {
            const h = JSON.parse(localStorage.getItem('gh_history') || '[]');
            const box = document.getElementById('historyBox');
            if (h.length === 0) return;
            
            let htmlParts = ['<label style="margin-bottom:8px;">RECENT HISTORY</label>'];
            for (let i = 0; i < h.length; i++) {
                let u = h[i];
                htmlParts.push('<div class="history-item" onclick="useHistory(\\'' + u + '\\')">');
                htmlParts.push('<span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:80%">' + u + '</span>');
                htmlParts.push('<span>↗</span></div>');
            }
            box.innerHTML = htmlParts.join('');
        }

        function useHistory(u) { document.getElementById('url').value = u; handleInput(); }

        function showToast(m) {
            const t = document.getElementById('toast');
            t.innerText = m; t.style.opacity = 1;
            setTimeout(() => { t.style.opacity = 0; }, 2000);
        }
    </script>
</body>
</html>
`

function makeRes(body, status = 200, headers = {}) {
    headers['access-control-allow-origin'] = '*'
    return new Response(body, { status, headers })
}

function newUrl(urlStr) {
    try { return new URL(urlStr) } catch (err) { return null }
}

function checkUrl(u) {
    return exp1.test(u) || exp2.test(u) || exp3.test(u) || exp4.test(u) || exp5.test(u) || exp6.test(u)
}

export default {
    async fetch(request, env, ctx) {
        try {
            return await fetchHandler(request)
        } catch (err) {
            return makeRes('cfworker error:\n' + err.stack, 502)
        }
    }
}

async function fetchHandler(req) {
    const urlStr = req.url
    const urlObj = new URL(urlStr)
    let path = urlObj.searchParams.get('q')
    
    if (path) {
        return Response.redirect('https://' + urlObj.host + PREFIX + path, 301)
    }
    
    path = urlObj.href.slice(urlObj.origin.length + PREFIX.length).replace(/^https?:\/+/, 'https://')
    
    if (path === 'favicon.ico') return new Response(null, { status: 204 })

    if (path === '' || path === '/') {
        return new Response(UI_HTML, {
            headers: { 
                'Content-Type': 'text/html;charset=UTF-8',
                'Cache-Control': 'public, max-age=86400' 
            }
        })
    }

    if (exp1.test(path) || exp5.test(path) || exp6.test(path) || exp3.test(path)) {
        return httpHandler(req, path)
    } else if (exp2.test(path)) {
        if (Config.jsdelivr) {
            const newUrl = path.replace('/blob/', '@').replace(/^(?:https?:\/\/)?github\.com/, 'https://cdn.jsdelivr.net/gh')
            return Response.redirect(newUrl, 302)
        } else {
            path = path.replace('/blob/', '/raw/')
            return httpHandler(req, path)
        }
    } else if (exp4.test(path)) {
        return httpHandler(req, path)
    } else {
        return Response.redirect('https://' + urlObj.host + PREFIX, 302)
    }
}

function httpHandler(req, pathname) {
    const reqHdrRaw = req.headers
    if (req.method === 'OPTIONS' && reqHdrRaw.has('access-control-request-headers')) {
        return new Response(null, PREFLIGHT_INIT)
    }
    const reqHdrNew = new Headers(reqHdrRaw)
    let urlStr = pathname
    if (urlStr.search(/^https?:\/\//) !== 0) urlStr = 'https://' + urlStr
    const urlObj = newUrl(urlStr)
    const reqInit = { method: req.method, headers: reqHdrNew, redirect: 'manual', body: req.body }
    return proxy(urlObj, reqInit)
}

async function proxy(urlObj, reqInit) {
    const res = await fetch(urlObj.href, reqInit)
    const resHdrNew = new Headers(res.headers)
    const status = res.status

    if (resHdrNew.has('location')) {
        let _location = resHdrNew.get('location')
        if (checkUrl(_location)) resHdrNew.set('location', PREFIX + _location)
        else {
            reqInit.redirect = 'follow'
            return proxy(newUrl(_location), reqInit)
        }
    }
    resHdrNew.set('access-control-expose-headers', '*')
    resHdrNew.set('access-control-allow-origin', '*')
    resHdrNew.delete('content-security-policy')
    resHdrNew.delete('content-security-policy-report-only')
    resHdrNew.delete('clear-site-data')

    return new Response(res.body, { status, headers: resHdrNew })
}
