'use strict'

const PREFIX = '/'

const MAX_FILE_SIZE = 0

const CORS_HEADERS = {
    'access-control-allow-origin': '*',
    'access-control-allow-methods': 'GET,POST,PUT,PATCH,TRACE,DELETE,HEAD,OPTIONS',
    'access-control-max-age': '1728000',
    'access-control-expose-headers': '*'
}

const UI_HTML = `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
    <meta name="robots" content="noindex, nofollow">
    <title>root@github-proxy:~</title>
    <style>
        :root {
            --bg: #0c0c0c;
            --fg: #00ff00; 
            --dim: #006600;
            --err: #ff3333;
        }
        [data-theme="amber"] { --fg: #ffb000; --dim: #885500; }
        [data-theme="mono"] { --fg: #eeeeee; --dim: #555555; }
        body {
            background-color: var(--bg);
            color: var(--fg);
            font-family: "Courier New", Courier, monospace;
            margin: 0;
            padding: 20px;
            display: flex;
            justify-content: center;
            min-height: 100vh;
            box-sizing: border-box;
            line-height: 1.6;
            overflow-x: hidden;
        }
        .terminal { width: 100%; max-width: 800px; padding-top: 2vh; }
        .ascii-art {
            font-family: "Courier New", Courier, monospace; font-size: 14px;
            font-weight: bold; margin-bottom: 20px; line-height: 1.15; white-space: pre;
        }
        .line { margin-bottom: 10px; word-break: break-all; }
        .prompt { color: var(--fg); font-weight: bold; }
        .path { color: var(--dim); }
        .system-msg { color: var(--dim); font-size: 0.9em; }
        .error-msg { color: var(--err); }
        .input-wrapper { display: flex; align-items: flex-start; margin-bottom: 20px; }
        input {
            background: transparent; border: none; color: var(--fg);
            font-family: inherit; font-size: 1em; width: 100%;
            outline: none; padding: 0; margin-left: 8px;
            caret-color: var(--fg); border-bottom: 1px dashed transparent;
        }
        input:focus { border-bottom: 1px dashed var(--dim); }
        .output-box { border: 1px solid var(--dim); padding: 15px; margin-top: 20px; display: none; }
        .btn-group { margin-top: 15px; display: flex; gap: 15px; flex-wrap: wrap; }
        button {
            background: var(--bg); color: var(--fg); border: 1px solid var(--fg);
            padding: 6px 16px; font-family: inherit; font-size: 0.9em;
            cursor: pointer; text-transform: uppercase; transition: all 0.1s;
        }
        button:hover { background: var(--fg); color: var(--bg); }
        button:active { transform: translateY(2px); }
        .top-bar {
            display: flex; justify-content: space-between; align-items: center;
            border-bottom: 1px dashed var(--dim); padding-bottom: 10px;
            margin-bottom: 20px; font-size: 0.9em;
        }
        .theme-btn {
            background: transparent; border: none; color: var(--fg);
            cursor: pointer; text-decoration: underline; font-size: 1em; padding: 0; margin: 0; width: auto;
        }
        .theme-btn:hover { background: var(--fg); color: var(--bg); text-decoration: none; }
        ::selection { background: var(--fg); color: var(--bg); }
        @media (max-width: 600px) {
            body { padding: 15px 10px; font-size: 13px; }
            .top-bar { font-size: 11px; }
            .top-bar-title { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 65%; }
            .top-bar-color { white-space: nowrap; flex-shrink: 0; }
            .ascii-art { font-size: 5px; overflow-x: auto; }
            .input-wrapper { flex-direction: column; }
            input { margin-left: 0; margin-top: 5px; }
            .btn-group button { width: 100%; } 
        }
    </style>
</head>
<body>
    <div class="terminal">
        <div class="top-bar">
            <span class="top-bar-title">GitHub-Proxy (PID:1234)</span>
            <span class="top-bar-color">
                [COLOR: <button class="theme-btn" id="themeToggle" onclick="cycleTheme()">GREEN</button>]
            </span>
        </div>
        <pre class="ascii-art">
  ___ ___ _____ _  _ _   _ ___   ___ ___  _____  ____   __
 / __|_ _|_   _| || | | | | _ ) | _ &#92; _ &#92;/ _ &#92; &#92;/ /&#92; &#92; / /
| (_ || |  | | | __ | |_| | _ &#92; |  _/   / (_) &gt;  &lt;  &#92; V / 
 &#92;___|___| |_| |_||_|&#92;___/|___/ |_| |_|_&#92;&#92;___/_/&#92;_&#92;  |_|  
        </pre>
        <div class="line system-msg">
            * Initialization complete. System ready.<br>
            * Tip: Use [ UP / DOWN ] arrows to navigate command history.<br>
            * Tip: Press [ ESC ] to clear input buffer.
        </div>
        <div class="input-wrapper">
            <div><span class="prompt">root@proxy</span><span class="path">:~#</span></div>
            <input type="text" id="cmdInput" placeholder="Paste target URL..." autocomplete="off" spellcheck="false" autofocus>
        </div>
        <div id="errorBox" class="line error-msg" style="display:none;">
            [ERROR] Invalid syntax. Unrecognized target pattern.
        </div>
        <div id="outputBox" class="output-box">
            <div class="line system-msg">>> Target successfully parsed...</div>
            <div class="line system-msg" id="infoStr"></div>
            <div class="line" style="margin-top: 15px;">
                <span class="prompt">ENDPOINT:</span><br>
                <input type="text" id="resultOutput" readonly style="margin-left:0; margin-top:5px; color: var(--fg); font-weight:bold;">
            </div>
            <div class="btn-group">
                <button onclick="execCopy()">./copy.sh</button>
                <button onclick="execDownload()">./download.sh</button>
            </div>
            <div id="statusMsg" class="line system-msg" style="margin-top: 10px; visibility: hidden;">
                > Copied to clipboard.
            </div>
        </div>
        <div class="line" style="margin-top: 40px; text-align: center; font-size: 0.8em; color: var(--dim);">EOF</div>
    </div>
    <script>
        const themes = ['green', 'amber', 'mono']
        let currentThemeIndex = 0
        function initTheme() {
            const saved = localStorage.getItem('term_theme')
            if (saved && themes.includes(saved)) currentThemeIndex = themes.indexOf(saved)
            applyTheme()
        }
        function cycleTheme() {
            currentThemeIndex = (currentThemeIndex + 1) % themes.length
            localStorage.setItem('term_theme', themes[currentThemeIndex])
            applyTheme()
        }
        function applyTheme() {
            const theme = themes[currentThemeIndex]
            document.documentElement.setAttribute('data-theme', theme)
            document.getElementById('themeToggle').innerText = theme.toUpperCase()
        }
        initTheme()
        const input = document.getElementById('cmdInput')
        const outputBox = document.getElementById('outputBox')
        const resultOutput = document.getElementById('resultOutput')
        const errorBox = document.getElementById('errorBox')
        const infoStr = document.getElementById('infoStr')
        const statusMsg = document.getElementById('statusMsg')
        let cmdHistory = []
        try { cmdHistory = JSON.parse(localStorage.getItem('term_history') || '[]') } catch(e) {}
        let historyIndex = cmdHistory.length

        function saveHistory(val) {
            if (!val) return
            cmdHistory = cmdHistory.filter(c => c !== val)
            cmdHistory.push(val)
            if (cmdHistory.length > 50) cmdHistory.shift()
            localStorage.setItem('term_history', JSON.stringify(cmdHistory))
            historyIndex = cmdHistory.length
        }

        input.addEventListener('input', () => { processCommand(); historyIndex = cmdHistory.length })
        input.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                let cleanVal = input.value.replace(/\\s+/g, '')
                if (cleanVal) saveHistory(cleanVal)
                execDownload()
            }
            if (e.key === 'Escape') { 
                input.value = ''
                processCommand()
                historyIndex = cmdHistory.length 
            }
            if (e.key === 'ArrowUp') {
                e.preventDefault()
                if (historyIndex > 0) {
                    historyIndex--
                    input.value = cmdHistory[historyIndex]
                    processCommand()
                }
            }
            if (e.key === 'ArrowDown') {
                e.preventDefault()
                if (historyIndex < cmdHistory.length - 1) {
                    historyIndex++
                    input.value = cmdHistory[historyIndex]
                    processCommand()
                } else {
                    historyIndex = cmdHistory.length
                    input.value = ''
                    processCommand()
                }
            }
        })

        function processCommand() {
            let val = input.value.replace(/\\s+/g, '')
            statusMsg.style.visibility = 'hidden'
            if (!val) {
                outputBox.style.display = 'none'
                errorBox.style.display = 'none'
                return
            }
            const valLower = val.toLowerCase()
            const isValid = valLower.includes('github.com') || valLower.includes('githubusercontent.com') || valLower.includes('gist.') || /^[a-zA-Z0-9_-]+\\/[a-zA-Z0-9_.-]+\\//.test(val)
            if (!isValid) {
                outputBox.style.display = 'none'
                errorBox.style.display = 'block'
                return
            }
            errorBox.style.display = 'none'
            outputBox.style.display = 'block'
            const match = val.match(/(?:github\\.com\\/)?([^/]+\\/[^/]+)\\/(?:blob|raw)\\/(.+)/i)
            if (match) {
                infoStr.innerHTML = '>> REPO: ' + match[1] + '<br>>> FILE: ' + match[2].split('/').pop()
            } else {
                infoStr.innerHTML = '>> TYPE: Standard Path Routing'
            }
            let target = val.replace(/^(?:https?:\\/\\/)?(github\\.com|raw\\.githubusercontent\\.com|gist\\.github\\.com|gist\\.githubusercontent\\.com|raw\\.github\\.com)\\//i, '')
            resultOutput.value = window.location.origin + '/' + target.replace(/^\\/+/, '')
        }

        let sysTimer
        function showSysMsg(msg) {
            statusMsg.innerText = '> ' + msg
            statusMsg.style.visibility = 'visible'
            clearTimeout(sysTimer)
            sysTimer = setTimeout(() => { statusMsg.style.visibility = 'hidden' }, 2000)
        }

        function execCopy() {
            if (!resultOutput.value) return
            resultOutput.select()
            document.execCommand('copy')
            let cleanVal = input.value.replace(/\\s+/g, '')
            saveHistory(cleanVal)
            showSysMsg('Copied to clipboard. Ready for execution.')
            input.focus()
        }

        function execDownload() {
            if (!resultOutput.value) return
            let cleanVal = input.value.replace(/\\s+/g, '')
            saveHistory(cleanVal)
            showSysMsg('Initiating download protocol...')
            setTimeout(() => { window.open(resultOutput.value, '_blank') }, 300)
        }
        
        document.addEventListener('click', (e) => {
            if (e.target.tagName !== 'BUTTON') input.focus()
        })
    </script>
</body>
</html>
`

export default {
    async fetch(request) {
        try {
            if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS_HEADERS })
            const url = new URL(request.url)
            let path = url.pathname.slice(PREFIX.length)
            
            if (path === '' || path === '/') {
                return new Response(UI_HTML, { headers: { 'Content-Type': 'text/html;charset=UTF-8' } })
            }
            if (path === 'favicon.ico') return new Response(null, { status: 204 })

            let targetUrl = resolveGitHubUrl(path)
            if (!targetUrl) return new Response('[FATAL] Invalid Request Format\n', { status: 400, headers: {'Content-Type':'text/plain'} })
            
            if (url.search) targetUrl += url.search
            return await proxyRequest(request, targetUrl, url.origin)
        } catch (err) {
            return new Response('[FATAL] 502 Bad Gateway - Proxy Service Error\n', { status: 502, headers: {'Content-Type':'text/plain'} })
        }
    }
}

function resolveGitHubUrl(path) {
    path = path.replace(/^https?:\/+/, '')
    const segments = path.split('/')
    const knownDomains = ['github.com', 'raw.githubusercontent.com', 'gist.github.com', 'gist.githubusercontent.com', 'raw.github.com']
    
    if (!knownDomains.some(domain => path.toLowerCase().startsWith(domain + '/'))) {
        if (segments.length >= 2 && /^[0-9a-fA-F]{32}$/.test(segments[1])) {
            path = (segments.length >= 3 && segments[2] === 'raw') ? 'gist.githubusercontent.com/' + path : 'gist.github.com/' + path
        } else if (segments.length >= 3 && /^(releases|archive|blob|raw|info|git-|tags)$/i.test(segments[2])) {
            path = 'github.com/' + path
        } else if (segments.length >= 4) {
            path = 'raw.githubusercontent.com/' + path
        } else {
            path = 'github.com/' + path
        }
    }
    return 'https://' + path.replace(/\/blob\//, '/raw/')
}

async function proxyRequest(originalRequest, targetUrl, workerOrigin) {
    const init = {
        method: originalRequest.method,
        headers: new Headers(originalRequest.headers),
        redirect: 'manual',
        body: originalRequest.body,
        keepalive: true
    }
    const response = await fetch(targetUrl, init)
    const responseHeaders = new Headers(response.headers)
    
    if (MAX_FILE_SIZE > 0 && responseHeaders.has('content-length')) {
        const contentLength = parseInt(responseHeaders.get('content-length'), 10)
        if (contentLength > MAX_FILE_SIZE) {
            const errorMsg = `[FORBIDDEN] Target file size (${contentLength} bytes) exceeds the configured proxy limit of ${MAX_FILE_SIZE} bytes.\n`
            return new Response(errorMsg, { status: 403, headers: { 'Content-Type': 'text/plain; charset=utf-8' } })
        }
    }

    if (response.status === 404 || response.status >= 500) {
        const errorMsg = `[FATAL ERROR] ${response.status}\n=========================================\nTarget : ${targetUrl}\nStatus : Upstream resource offline or not found\n\nEOF\n`
        return new Response(errorMsg, { status: response.status, headers: { 'Content-Type': 'text/plain; charset=utf-8' } })
    }

    if (responseHeaders.has('location')) {
        let redirectUrl = responseHeaders.get('location')
        if (/^(?:https?:\/\/)?(?:github\.com|raw\.githubusercontent\.com|gist\.github\.com|gist\.githubusercontent\.com|raw\.github\.com)/i.test(redirectUrl)) {
            responseHeaders.set('location', workerOrigin + PREFIX + redirectUrl)
        } else {
            init.redirect = 'follow'
            return fetch(redirectUrl, init)
        }
    }

    for (const [key, value] of Object.entries(CORS_HEADERS)) responseHeaders.set(key, value)
    responseHeaders.delete('content-security-policy')
    responseHeaders.delete('content-security-policy-report-only')
    responseHeaders.delete('clear-site-data')
    responseHeaders.set('x-frame-options', 'DENY')
    responseHeaders.set('x-content-type-options', 'nosniff')

    return new Response(response.body, { status: response.status, headers: responseHeaders })
}