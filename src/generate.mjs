import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import { requestNode, requestCurl } from './network.mjs';
import { makeFields, expandPath } from './options.mjs';
import { requireKeys } from './config.mjs';
import { inspectImage, decodeBase64, convertFormat, applyMask } from './images.mjs';
import { DrawError, redact } from './errors.mjs';

const API_ROOT = 'https://fangxinapi.com/v1';
const MAX_INPUT = 50 * 1024 * 1024;
const MAX_COMBINED_INPUT = 100 * 1024 * 1024;
const checkTime = deadline => {
  if (performance.now() >= deadline) throw new DrawError('TOTAL_TIMEOUT', '已达到本次任务总时间上限。');
};
const sleep = (ms, signal) => new Promise((resolve, reject) => {
  if (signal?.aborted) return reject(new DrawError('CANCELLED', '任务已取消。'));
  const done = () => { signal?.removeEventListener('abort', abort); resolve(); };
  const timer = setTimeout(done, ms);
  const abort = () => { clearTimeout(timer); signal?.removeEventListener('abort', abort); reject(new DrawError('CANCELLED', '任务已取消。')); };
  signal?.addEventListener('abort', abort, { once: true });
});

async function remoteImage(value, deadline, options, config, transport, signal, maxBytes) {
  let url;
  try { url = new URL(value); } catch { throw new DrawError('INPUT_ERROR', '图片链接无效。'); }
  if (url.protocol !== 'https:' || url.username || url.password) throw new DrawError('INPUT_ERROR', '远程图片仅接受不含用户名密码的 HTTPS 链接。');
  for (let redirect = 0; redirect <= 3; redirect++) {
    checkTime(deadline);
    const response = await transport(url.href, { timeout: Math.min(options.timeout, deadline - performance.now()),
      connectTimeout: options.connectTimeout, env: config.env, maxBytes, signal });
    if ([301, 302, 303, 307, 308].includes(response.status) && response.headers.location) {
      url = new URL(response.headers.location, url);
      if (url.protocol !== 'https:' || url.username || url.password) throw new DrawError('INPUT_ERROR', '图片重定向地址必须为 HTTPS。');
      continue;
    }
    if (response.status !== 200) throw new DrawError('DOWNLOAD_ERROR', `图片下载失败（HTTP ${response.status}）。`);
    return response.body;
  }
  throw new DrawError('DOWNLOAD_ERROR', '图片链接重定向次数过多。');
}

async function inputImage(value, deadline, options, config, transport, signal, limit = MAX_INPUT) {
  checkTime(deadline);
  let bytes;
  if (/^https?:\/\//i.test(value)) bytes = await remoteImage(value, deadline, options, config, transport, signal, limit);
  else {
    const file = expandPath(value);
    let stat;
    try { stat = await fs.stat(file); } catch { throw new DrawError('INPUT_ERROR', `无法读取参考图：${file}`); }
    if (!stat.isFile() || !stat.size || stat.size >= limit) throw new DrawError('INPUT_ERROR', '参考图必须为非空文件，且不能超过图片大小上限。');
    bytes = await fs.readFile(file);
  }
  if (!bytes.length || bytes.length >= limit) throw new DrawError('INPUT_ERROR', '图片文件为空或超过大小上限。');
  const metadata = inspectImage(bytes);
  checkTime(deadline);
  return { bytes, metadata };
}

export function multipart(fields, images, mask) {
  const boundary = `fangxin-${randomUUID()}`;
  const parts = [];
  const append = (name, value, filename, type) => {
    parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${name}"${filename ? `; filename="${filename}"` : ''}\r\n${type ? `Content-Type: ${type}\r\n` : ''}\r\n`));
    parts.push(Buffer.isBuffer(value) ? value : Buffer.from(String(value)));
    parts.push(Buffer.from('\r\n'));
  };
  for (const [name, value] of Object.entries(fields)) append(name, value);
  // Fangxin uses repeated `image`, unlike OpenAI's multipart `image[]` examples.
  for (const [index, image] of images.entries()) append('image', image.bytes,
    `image-${index + 1}.${image.metadata.format}`, `image/${image.metadata.format}`);
  if (mask) append('mask', mask.bytes, 'mask.png', 'image/png');
  parts.push(Buffer.from(`--${boundary}--\r\n`));
  return { body: Buffer.concat(parts), contentType: `multipart/form-data; boundary=${boundary}` };
}

export function retryDelay(headers, attempt, now = Date.now()) {
  const hint = headers['retry-after'];
  if (hint !== undefined) {
    const seconds = Number(hint);
    const delay = Number.isFinite(seconds) ? seconds * 1000 : Date.parse(hint) - now;
    if (Number.isFinite(delay) && delay >= 0) return delay;
  }
  return Math.min(30000, 1000 * 2 ** (attempt - 1)) + Math.floor(Math.random() * 500);
}

export async function callProvider(options, config, payload, deadline, transport, progress, signal) {
  let keyIndex = 0;
  const attempts = [];
  const endpoint = options.images.length ? 'images/edits' : 'images/generations';
  for (let attempt = 1; attempt <= options.maxAttempts; attempt++) {
    checkTime(deadline);
    if (signal?.aborted) throw new DrawError('CANCELLED', '任务已取消。');
    const started = performance.now();
    progress({ stage: 'request', attempt, maxAttempts: options.maxAttempts, keySlot: keyIndex + 1 });
    let response, delay, failure;
    try {
      response = await transport(`${API_ROOT}/${endpoint}`, { method: 'POST',
        headers: { Authorization: `Bearer ${config.keys[keyIndex]}`, 'Content-Type': payload.contentType,
          'User-Agent': 'fangxin-draw-node', Accept: 'application/json' },
        body: payload.body, timeout: Math.min(options.timeout, deadline - performance.now()),
        connectTimeout: options.connectTimeout, env: config.env, signal });
    } catch (error) {
      attempts.push({ attempt, keySlot: keyIndex + 1, durationMs: Math.round(performance.now() - started), code: error.code || 'NETWORK_ERROR' });
      if (signal?.aborted) throw new DrawError('CANCELLED', '任务已取消；已提交的请求可能仍在服务端处理。', { attempts: attempt, uncertain: !!error.submitted });
      const uncertain = !!error.submitted;
      if (uncertain && !options.retryUncertain) throw new DrawError('AMBIGUOUS_REQUEST',
        '请求已提交但未收到完整结果，无法确认是否已出图或扣费；本次停止自动重发。请先检查服务商记录。', { attempts: attempt, uncertain: true });
      if (error.code === 'CONFIG_ERROR' || error.code === 'INPUT_ERROR' || error.code === 'PROXY_ERROR' || error.code === 'RESPONSE_TOO_LARGE') throw error;
      failure = new DrawError(error.code || 'NETWORK_ERROR', redact(error.message, config.keys), { attempts: attempt, uncertain });
      delay = retryDelay({}, attempt);
    }
    if (response) {
      const requestId = response.headers['x-request-id'] || response.headers['request-id'];
      attempts.push({ attempt, keySlot: keyIndex + 1, durationMs: Math.round(performance.now() - started), status: response.status,
        ...(requestId ? { requestId: redact(requestId, config.keys) } : {}) });
      let body;
      try { body = JSON.parse(response.body.toString('utf8')); } catch {
        // An HTML gateway page is not an image result and is never printed into logs.
        if (response.status >= 200 && response.status < 300) throw new DrawError('INVALID_RESPONSE',
          '接口返回了无法解析的成功响应；停止自动重发，请检查服务商记录。', { uncertain: true, requestId, attempts: attempt });
        body = {};
      }
      if (response.status >= 200 && response.status < 300 && (!body || typeof body !== 'object' || Array.isArray(body))) {
        throw new DrawError('INVALID_RESPONSE', '接口响应结构无效；停止自动重发。', { uncertain: true, requestId, attempts: attempt });
      }
      if (response.status >= 200 && response.status < 300 && !body.error) return { body, attempts, requestId, endpoint };
      const code = body?.error?.code || 'HTTP_ERROR';
      const message = redact(body?.error?.message || `接口返回 HTTP ${response.status}。`, config.keys);
      failure = new DrawError('PROVIDER_ERROR', message, { status: response.status, requestId, attempts: attempt });
      if (response.status === 401 && keyIndex + 1 < config.keys.length) {
        keyIndex++; delay = 0;
      } else if (response.status === 429) delay = retryDelay(response.headers, attempt);
      else if (response.status >= 500 && options.retryUncertain) { failure.uncertain = true; delay = retryDelay(response.headers, attempt); }
      else {
        if (response.status >= 500) { failure.code = 'AMBIGUOUS_REQUEST'; failure.uncertain = true;
          failure.message += ' 服务端执行状态不确定，默认不自动重发。'; }
        // 403 may be a policy or permission error; rotating credentials is not a remedy.
        throw failure;
      }
      progress({ stage: 'retry', reason: redact(code, config.keys), status: response.status, nextAttempt: attempt + 1 });
    }
    if (attempt >= options.maxAttempts) throw failure;
    if (delay >= deadline - performance.now()) throw new DrawError('TOTAL_TIMEOUT', '剩余总时间不足以等待下一次请求。', { attempts: attempt });
    await sleep(delay, signal);
  }
}

async function atomicWrite(file, bytes) {
  const temp = `${file}.${randomUUID()}.tmp`;
  try { await fs.writeFile(temp, bytes, { flag: 'wx', mode: 0o600 }); await fs.rename(temp, file); }
  finally { await fs.rm(temp, { force: true }); }
}

export async function generate(options, config, { request, progress = () => {}, signal } = {}) {
  const start = performance.now(), deadline = start + options.totalTimeout;
  const transport = request || (options.transport === 'curl' ? requestCurl : requestNode);
  const inputs = [];
  let inputBytes = 0;
  for (const image of options.images) {
    progress({ stage: 'validate_input', index: inputs.length + 1 });
    const input = await inputImage(image, deadline, options, config, transport, signal);
    inputBytes += input.bytes.length;
    if (inputBytes > MAX_COMBINED_INPUT) throw new DrawError('INPUT_ERROR', '参考图合计超过 100 MiB，请缩小图片后再试。');
    inputs.push(input);
  }
  let mask;
  if (options.mask) {
    mask = await inputImage(options.mask, deadline, options, config, transport, signal, 4 * 1024 * 1024);
    if (mask.metadata.format !== 'png' || !mask.metadata.hasTransparency || mask.metadata.size !== inputs[0].metadata.size) {
      throw new DrawError('INPUT_ERROR', '遮罩必须是小于 4 MiB 的 PNG，含透明编辑区域，且与第一张参考图尺寸相同。');
    }
  }
  if (options.dryRun) return { success: true, dryRun: true, provider: 'fangxin', mode: inputs.length ? 'edit' : 'generate',
    model: options.model, requestedSize: options.size, quality: options.quality, format: options.format, background: options.background,
    imageCount: options.n, inputCount: inputs.length, promptCharacters: [...options.prompt].length,
    keysConfigured: config.keys.length, maxAttempts: options.maxAttempts, totalTimeoutSeconds: options.totalTimeout / 1000,
    transport: options.transport, outdir: options.outdir };
  requireKeys(config);
  // Detect invalid or unwritable output locations before submitting a paid request.
  try {
    await fs.mkdir(options.outdir, { recursive: true, mode: 0o700 });
    const probe = path.join(options.outdir, `.write-check-${randomUUID()}`);
    try { await fs.writeFile(probe, Buffer.alloc(0), { flag: 'wx', mode: 0o600 }); }
    finally { await fs.rm(probe, { force: true }); }
  } catch {
    throw new DrawError('OUTPUT_PATH_ERROR', '输出目录无法写入，请检查 outdir 路径及权限；尚未提交出图请求。');
  }
  const fields = makeFields(options);
  const payload = inputs.length ? multipart(fields, inputs, mask)
    : { body: Buffer.from(JSON.stringify(fields)), contentType: 'application/json' };
  const response = await callProvider(options, config, payload, deadline, transport, progress, signal);
  progress({ stage: 'validate_output' });
  const entries = response.body?.data;
  if (!Array.isArray(entries) || !entries.length || entries.length > 10) throw new DrawError('INVALID_RESPONSE',
    '接口未返回有效的图片列表；停止自动重发，请检查服务商记录。', { uncertain: true, requestId: response.requestId });
  const files = [], warnings = [], violations = [];
  if (entries.length !== options.n) violations.push(`请求 ${options.n} 张，实际返回 ${entries.length} 张。`);
  const taskId = randomUUID();
  for (const [index, entry] of entries.entries()) {
    let bytes, info;
    try {
      if (entry?.b64_json) bytes = decodeBase64(entry.b64_json);
      else if (typeof entry?.url === 'string') bytes = await remoteImage(entry.url, deadline, options, config, transport, signal, MAX_INPUT);
      else throw new DrawError('INVALID_RESPONSE', '缺少 Base64 图片内容或图片链接。');
      info = inspectImage(bytes);
    } catch (error) { violations.push(`第 ${index + 1} 张：${redact(error.message, config.keys)}`); continue; }
    const providerInfo = { ...info };
    let sourcePath;
    const localProcessing = [];
    if (mask || info.format !== options.format) {
      sourcePath = path.join(options.outdir, `source-${taskId}-${index + 1}.${info.format}`);
      await atomicWrite(sourcePath, bytes);
    }
    if (mask) {
      try { bytes = applyMask(inputs[0].bytes, bytes, mask.bytes); info = inspectImage(bytes); localProcessing.push('mask-composite'); }
      catch (error) { violations.push(`第 ${index + 1} 张：${error.message}`); }
    }
    if (info.format !== options.format) {
      try {
        bytes = convertFormat(bytes, options.format, options.compression);
        info = inspectImage(bytes);
        localProcessing.push(`convert-to-${options.format}`);
        warnings.push(`第 ${index + 1} 张接口返回 ${providerInfo.format}，已在本地转换为请求的 ${options.format}；原始图片已保留。`);
      } catch { violations.push(`第 ${index + 1} 张无法转换为请求格式。`); }
    }
    const name = path.join(options.outdir, `image-${taskId}-${index + 1}.${info.format}`);
    await atomicWrite(name, bytes);
    files.push({ path: name, ...info, sha256: createHash('sha256').update(bytes).digest('hex'),
      ...(sourcePath ? { sourcePath, providerFormat: providerInfo.format, localProcessing } : {}) });
    if (info.format !== options.format) violations.push(`第 ${index + 1} 张格式为 ${info.format}，与请求 ${options.format} 不同。`);
    if (options.size !== 'auto' && info.size !== options.size) {
      const mismatch = `第 ${index + 1} 张请求尺寸 ${options.size}，实际尺寸 ${info.size}。`;
      (options.strictSize ? violations : warnings).push(mismatch);
    }
    if (options.background === 'transparent' && !info.hasTransparency) violations.push(`第 ${index + 1} 张没有实际透明区域。`);
  }
  const result = { success: !violations.length, taskId, provider: 'fangxin', endpoint: response.endpoint,
    mode: inputs.length ? 'edit' : 'generate', model: options.model,
    requestedSize: options.size, requestedQuality: options.quality, requestedFormat: options.format,
    requestedBackground: options.background, inputCount: inputs.length,
    ...(response.requestId ? { requestId: redact(response.requestId, config.keys) } : {}),
    transport: options.transport, elapsedSeconds: Math.round((performance.now() - start) / 100) / 10,
    attempts: response.attempts, files, warnings, ...(violations.length ? { violations } : {}),
    // Do not store prompt text, keys, source URLs, signed URLs or raw upstream responses.
    promptSha256: createHash('sha256').update(options.prompt).digest('hex'), createdAt: new Date().toISOString() };
  const manifest = path.join(options.outdir, `result-${taskId}.json`);
  result.manifest = manifest;
  await atomicWrite(manifest, JSON.stringify(result, null, 2) + '\n');
  if (violations.length) throw new DrawError('OUTPUT_VALIDATION_FAILED',
    `图片验收未通过：${violations.join(' ')} 已保留可正常解码的图片和结果记录。`, { files, manifest });
  progress({ stage: 'complete', count: files.length });
  return result;
}
