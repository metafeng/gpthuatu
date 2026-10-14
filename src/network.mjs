import http from 'node:http';
import net from 'node:net';
import tls from 'node:tls';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { DrawError } from './errors.mjs';

function networkError(message, submitted = false, code = 'NETWORK_ERROR') {
  return new DrawError(code, message, { submitted });
}
const hostname = url => url.hostname.replace(/^\[|\]$/g, '');

export function proxyFor(url, env) {
  const host = hostname(url).toLowerCase();
  const noProxy = env.NO_PROXY ?? env.no_proxy ?? '';
  if (noProxy.split(',').some(value => {
    const item = value.trim().toLowerCase();
    if (!item) return false;
    if (item === '*') return true;
    // Hostname suffixes and optional port qualifiers; IPv6 must be bracketed.
    let matchHost = item, matchPort;
    const match = item.match(/^(\[[^\]]+\]|[^:]+):(\d+)$/);
    if (match) [, matchHost, matchPort] = match;
    if (matchPort && matchPort !== (url.port || (url.protocol === 'https:' ? '443' : '80'))) return false;
    matchHost = matchHost.replace(/^\./, '').replace(/^\[|\]$/g, '');
    return host === matchHost || host.endsWith(`.${matchHost}`);
  })) return null;
  const value = url.protocol === 'https:' ? env.HTTPS_PROXY ?? env.https_proxy ?? env.ALL_PROXY ?? env.all_proxy
    : env.HTTP_PROXY ?? env.http_proxy ?? env.ALL_PROXY ?? env.all_proxy;
  if (!value) return null;
  let proxy;
  try { proxy = new URL(value); } catch { throw new DrawError('CONFIG_ERROR', '代理地址无效。'); }
  if (!['http:', 'https:'].includes(proxy.protocol)) throw new DrawError('CONFIG_ERROR', '原生模式支持 HTTP/HTTPS 代理；SOCKS 代理请使用 --transport curl。');
  return proxy;
}

function connectSocket(options, secure, timeout, signal) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(networkError('请求已取消或达到时间上限。', false, 'TIMEOUT'));
    const socket = secure ? tls.connect({ ...options, rejectUnauthorized: true }) : net.connect(options);
    const event = secure ? 'secureConnect' : 'connect';
    const timer = setTimeout(() => failure(networkError('连接超时。', false, 'TIMEOUT')), timeout);
    const abort = () => failure(networkError('请求已取消或达到时间上限。', false, 'TIMEOUT'));
    const cleanup = () => { clearTimeout(timer); signal?.removeEventListener('abort', abort); socket.removeListener('error', failure); };
    const failure = error => { cleanup(); socket.destroy(); reject(networkError(error.message, false, error.code === 'TIMEOUT' ? 'TIMEOUT' : 'NETWORK_ERROR')); };
    socket.once('error', failure);
    socket.once(event, () => { cleanup(); resolve(socket); });
    signal?.addEventListener('abort', abort, { once: true });
  });
}

function tunnel(socket, url, proxy, timeout, signal) {
  return new Promise((resolve, reject) => {
    let buffer = Buffer.alloc(0);
    const timer = setTimeout(() => failure(networkError('代理连接超时。', false, 'TIMEOUT')), timeout);
    const abort = () => failure(networkError('请求已取消。', false, 'TIMEOUT'));
    const cleanup = () => { clearTimeout(timer); socket.removeListener('data', data); socket.removeListener('error', failure); socket.removeListener('end', ended); signal?.removeEventListener('abort', abort); };
    const failure = error => { cleanup(); socket.destroy(); reject(error); };
    const ended = () => failure(networkError('代理提前关闭连接。'));
    const data = chunk => {
      buffer = Buffer.concat([buffer, chunk]);
      const end = buffer.indexOf('\r\n\r\n');
      if (end === -1 && buffer.length > 16384) return failure(networkError('代理响应头过大。'));
      if (end === -1) return;
      const status = Number(buffer.toString('latin1', 0, end).split('\r\n')[0].split(' ')[1]);
      if (status !== 200) return failure(new DrawError('PROXY_ERROR', `代理拒绝连接（HTTP ${status || 'unknown'}）。`, { submitted: false }));
      cleanup();
      if (buffer.length > end + 4) socket.unshift(buffer.subarray(end + 4));
      resolve(socket);
    };
    socket.on('data', data); socket.once('error', failure); socket.once('end', ended);
    signal?.addEventListener('abort', abort, { once: true });
    if (signal?.aborted) return abort();
    const authority = `${url.hostname}:${url.port || 443}`;
    let auth = '';
    if (proxy.username || proxy.password) auth = `Proxy-Authorization: Basic ${Buffer.from(`${decodeURIComponent(proxy.username)}:${decodeURIComponent(proxy.password)}`).toString('base64')}\r\n`;
    socket.write(`CONNECT ${authority} HTTP/1.1\r\nHost: ${authority}\r\n${auth}\r\n`);
  });
}

async function openSocket(url, proxy, timeout, signal) {
  const endpoint = proxy || url;
  const port = Number(endpoint.port || (endpoint.protocol === 'https:' ? 443 : 80));
  const options = { host: hostname(endpoint), port,
    ...(net.isIP(hostname(endpoint)) ? {} : { servername: hostname(endpoint) }), ALPNProtocols: ['http/1.1'] };
  let socket = await connectSocket(options, endpoint.protocol === 'https:', timeout, signal);
  if (proxy && url.protocol === 'https:') {
    socket = await tunnel(socket, url, proxy, timeout, signal);
    socket = await connectSocket({ socket, ...(net.isIP(hostname(url)) ? {} : { servername: hostname(url) }), ALPNProtocols: ['http/1.1'] }, true, timeout, signal);
  }
  return socket;
}

export async function requestNode(urlValue, { method = 'GET', headers = {}, body, timeout = 420000,
  connectTimeout = 15000, maxBytes = 128 * 1024 * 1024, env = process.env, signal } = {}) {
  const url = new URL(urlValue);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new DrawError('INPUT_ERROR', '请求地址必须为不含用户名密码的 HTTP(S) URL。');
  const controller = new AbortController();
  const abort = () => controller.abort();
  signal?.addEventListener('abort', abort, { once: true });
  if (signal?.aborted) controller.abort();
  const timer = setTimeout(abort, timeout);
  let socket, agent;
  try {
    const proxy = proxyFor(url, env);
    socket = await openSocket(url, proxy, Math.min(connectTimeout, timeout), controller.signal);
    agent = new http.Agent({ keepAlive: false });
    agent.createConnection = () => socket;
    const requestHeaders = { Host: url.host, Connection: 'close', ...headers };
    if (body) requestHeaders['Content-Length'] = String(body.length);
    if (proxy && url.protocol === 'http:' && (proxy.username || proxy.password)) requestHeaders['Proxy-Authorization'] =
      `Basic ${Buffer.from(`${decodeURIComponent(proxy.username)}:${decodeURIComponent(proxy.password)}`).toString('base64')}`;
    return await new Promise((resolve, reject) => {
      let submitted = false, settled = false;
      const done = (error, value) => {
        if (settled) return; settled = true;
        controller.signal.removeEventListener('abort', onAbort);
        error ? reject(error) : resolve(value);
      };
      const onAbort = () => req.destroy(networkError('请求已取消或达到时间上限。', submitted || socket.bytesWritten > 0, 'TIMEOUT'));
      const req = http.request({ hostname: hostname(url), port: Number(url.port || (url.protocol === 'https:' ? 443 : 80)),
        method, path: proxy && url.protocol === 'http:' ? url.href : url.pathname + url.search, headers: requestHeaders, agent }, res => {
        let total = 0;
        const chunks = [];
        res.on('data', chunk => {
          total += chunk.length;
          if (total > maxBytes) {
            const error = networkError('响应数据超过大小限制。', submitted, 'RESPONSE_TOO_LARGE');
            done(error); req.destroy(error); return;
          }
          chunks.push(chunk);
        });
        res.once('aborted', () => done(networkError('接口在返回完整结果前关闭连接。', submitted)));
        res.once('error', error => done(networkError(error.message, submitted)));
        res.once('end', () => {
          if (!res.complete) return done(networkError('响应内容不完整。', submitted));
          done(null, { status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks), submitted });
        });
      });
      req.once('finish', () => { submitted = true; });
      req.once('error', error => done(networkError(error.message, submitted || socket.bytesWritten > 0, error.code === 'TIMEOUT' ? 'TIMEOUT' : error.code === 'RESPONSE_TOO_LARGE' ? error.code : 'NETWORK_ERROR')));
      controller.signal.addEventListener('abort', onAbort, { once: true });
      if (controller.signal.aborted) return onAbort();
      req.end(body);
    });
  } finally {
    clearTimeout(timer); signal?.removeEventListener('abort', abort); agent?.destroy(); socket?.destroy();
  }
}

export function parseHeaders(text) {
  const blocks = text.replace(/\r\n/g, '\n').split('\n\n').filter(x => x.startsWith('HTTP/'));
  const lines = (blocks.at(-1) || '').split('\n').slice(1);
  return Object.fromEntries(lines.map(line => {
    const index = line.indexOf(':'); return [line.slice(0, index).toLowerCase(), line.slice(index + 1).trim()];
  }).filter(([key]) => key));
}

const curlQuote = value => `"${String(value).replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;

export async function requestCurl(url, { method = 'GET', headers = {}, body, timeout = 420000, connectTimeout = 15000,
  maxBytes = 128 * 1024 * 1024, env = process.env, signal } = {}) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'fangxin-request-'));
  await fs.chmod(dir, 0o700);
  const responseFile = path.join(dir, 'response'), headerFile = path.join(dir, 'headers'), bodyFile = path.join(dir, 'body');
  let child;
  try {
    if (body) await fs.writeFile(bodyFile, body, { mode: 0o600 });
    let config = `url = ${curlQuote(url)}\nrequest = ${curlQuote(method)}\n`;
    for (const [key, value] of Object.entries(headers)) {
      if (/[\r\n]/.test(key + value)) throw new DrawError('INPUT_ERROR', '请求头包含非法字符。');
      config += `header = ${curlQuote(`${key}: ${value}`)}\n`;
    }
    const args = ['--disable', '--config', '-', '--no-insecure', '--http1.1', '--silent', '--show-error', '--proto', '=http,https',
      '--connect-timeout', String(connectTimeout / 1000), '--max-time', String(timeout / 1000),
      '--max-filesize', String(maxBytes), '--output', responseFile, '--dump-header', headerFile,
      '--write-out', '%{http_code}\n%{size_upload}'];
    if (body) args.push('--data-binary', `@${bodyFile}`);
    const result = await new Promise((resolve, reject) => {
      if (signal?.aborted) return reject(networkError('请求已取消。', false, 'TIMEOUT'));
      child = spawn('curl', args, { env, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
      let output = '', errorOutput = '', exceeded = false, killed = false;
      const kill = () => { killed = true; child.kill(); };
      const timer = setTimeout(kill, timeout + 1000);
      // Also bound chunked bodies on curl versions that do not enforce --max-filesize mid-download.
      const sizeTimer = setInterval(async () => {
        try { if ((await fs.stat(responseFile)).size > maxBytes) { exceeded = true; kill(); } } catch { /* not created yet */ }
      }, 200);
      signal?.addEventListener('abort', kill, { once: true });
      const cleanup = () => { clearTimeout(timer); clearInterval(sizeTimer); signal?.removeEventListener('abort', kill); };
      child.stdout.on('data', chunk => { output = (output + chunk).slice(0, 1000); });
      child.stderr.on('data', chunk => { errorOutput = (errorOutput + chunk).slice(0, 2000); });
      child.stdin.on('error', () => {});
      child.once('error', error => { cleanup(); reject(networkError(error.code === 'ENOENT' ? '未找到 curl，请使用默认原生模式或安装 curl。' : 'curl 无法启动。')); });
      child.once('close', code => { cleanup(); resolve({ code, output, errorOutput, exceeded, killed }); });
      child.stdin.end(config);
    });
    const [status, uploaded] = result.output.trim().split('\n').map(Number);
    if (result.code !== 0) {
      // Exit codes for failures before HTTP submission are safe to retry; others are conservative.
      const definitelyNotSent = [5, 6, 7, 35, 60].includes(result.code);
      throw networkError(result.exceeded ? '响应数据超过大小限制。' : result.killed ? '请求已取消或达到时间上限。' : result.errorOutput || 'curl 请求失败。',
        uploaded > 0 || !definitelyNotSent, result.exceeded ? 'RESPONSE_TOO_LARGE' : result.killed || result.code === 28 ? 'TIMEOUT' : 'NETWORK_ERROR');
    }
    const bytes = await fs.readFile(responseFile);
    if (bytes.length > maxBytes) throw networkError('响应数据超过大小限制。', true, 'RESPONSE_TOO_LARGE');
    return { status, headers: parseHeaders(await fs.readFile(headerFile, 'utf8')), body: bytes, submitted: uploaded > 0 };
  } finally {
    child?.kill();
    await fs.rm(dir, { recursive: true, force: true });
  }
}
