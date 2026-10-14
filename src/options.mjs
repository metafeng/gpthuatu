import path from 'node:path';
import os from 'node:os';
import { DrawError } from './errors.mjs';

const MODELS = new Set(['gpt-image-2.5-flare', 'gpt-image-2.5-flare-2026-09-08',
  'gpt-image-2.5-sunburst', 'gpt-image-2.5-sunburst-2026-09-08',
  'gpt-image-2', 'gpt-image-2-2026-04-21', 'gpt-image-1.5', 'gpt-image-1', 'gpt-image-1-mini']);
const fail = message => { throw new DrawError('INPUT_ERROR', message); };
const choice = (value, list, name) => { if (!list.includes(value)) fail(`${name} 必须为 ${list.join(' / ')}。`); };
function integer(value, min, max, name) {
  if (!/^\d+$/.test(String(value))) fail(`${name} 必须为整数。`);
  const n = Number(value);
  if (!Number.isSafeInteger(n) || n < min || n > max) fail(`${name} 必须在 ${min}～${max} 之间。`);
  return n;
}
export function expandPath(value) {
  return path.resolve(value === '~' ? os.homedir() : value.startsWith('~/') ? path.join(os.homedir(), value.slice(2)) : value);
}

export function normalizeOptions(v, config) {
  const prompt = v.prompt ?? '';
  if (!prompt.trim() || [...prompt].length > 32000) fail('提示词不能为空，且不能超过 32000 个字符。');
  const model = v.model || config.model;
  if (!MODELS.has(model)) fail('不支持该模型；请使用 GPT Image 模型，不使用已退役的 DALL·E 参数。');
  const quality = v.quality ?? 'auto';
  choice(quality, model.startsWith('gpt-image-2.5-') ? ['auto', 'low', 'medium', 'high', 'xhigh', 'max'] : ['auto', 'low', 'medium', 'high'], 'quality');
  const size = v.size ?? 'auto';
  if (size !== 'auto') {
    if (!/^\d{1,5}x\d{1,5}$/.test(size)) fail('size 应为 auto 或 WIDTHxHEIGHT，例如 1024x1024。');
    if (model.startsWith('gpt-image-2')) {
      const [w, h] = size.split('x').map(Number);
      if (!w || !h || w % 16 || h % 16 || Math.max(w, h) > 3840 || Math.max(w, h) / Math.min(w, h) > 3 || w * h < 655360 || w * h > 8294400) {
        fail('尺寸需为 16 的倍数，最长边≤3840，长短边比≤3，总像素在 655360～8294400。');
      }
    } else choice(size, ['1024x1024', '1536x1024', '1024x1536'], '此模型的 size');
  }
  const format = v['output-format'] ?? 'png';
  // Fangxin's WebP output compatibility is not established. Do not silently change formats.
  choice(format, ['png', 'jpeg'], '放心接口 output-format（WebP 暂未开放）');
  const background = v.background ?? 'auto';
  choice(background, ['auto', 'opaque', 'transparent'], 'background');
  if (background === 'transparent' && format === 'jpeg') fail('透明背景不能使用 JPEG，请选择 PNG。');
  if (background === 'transparent' && model.startsWith('gpt-image-2.5-flare') && !v.experimental) {
    throw new DrawError('CAPABILITY_UNVERIFIED', '放心 Flare 透明背景尚未通过实测，默认不提交收费请求。确认需要试验时显式使用 --experimental。');
  }
  if (format === 'png' && v['output-compression'] !== undefined) fail('output-compression 仅用于 JPEG；PNG 请省略此参数。');
  const compression = format === 'jpeg' ? integer(v['output-compression'] ?? 100, 0, 100, 'output-compression') : undefined;
  const moderation = v.moderation ?? 'auto';
  choice(moderation, ['auto', 'low'], 'moderation');
  const images = v.image ?? [];
  if (images.length > 16) fail('最多传入 16 张参考图。');
  if (v.mask && !images.length) fail('mask 必须与至少一张 image 一起使用。');
  if (v['input-fidelity']) {
    if (!images.length) fail('input-fidelity 仅用于图片编辑。');
    choice(v['input-fidelity'], ['high', 'low'], 'input-fidelity');
    if (!['gpt-image-1', 'gpt-image-1.5', 'gpt-image-1-mini'].includes(model)) fail('该模型不使用可调 input-fidelity，请省略。');
    if (model === 'gpt-image-1-mini' && v['input-fidelity'] !== 'low') fail('gpt-image-1-mini 只支持 input-fidelity=low。');
  }
  if (v.style !== undefined) fail('GPT Image 模型不使用 style 参数，请将风格写在提示词中。');
  if (v.retries !== undefined && v['max-attempts'] !== undefined) fail('retries 与 max-attempts 不能同时使用。');
  const maxAttempts = v.retries !== undefined ? integer(v.retries, 0, 9, 'retries') + 1 : integer(v['max-attempts'] ?? 3, 1, 10, 'max-attempts');
  const timeout = integer(v.timeout ?? 420, 1, 900, 'timeout') * 1000;
  const connectTimeout = integer(v['connect-timeout'] ?? 15, 1, 120, 'connect-timeout') * 1000;
  const totalTimeout = integer(v['total-timeout'] ?? 600, 1, 1800, 'total-timeout') * 1000;
  const transport = v.transport ?? 'node';
  choice(transport, ['node', 'curl'], 'transport');
  return { prompt, model, size, quality, background, format, compression, moderation,
    n: integer(v.n ?? 1, 1, 10, 'n'), images, mask: v.mask, inputFidelity: v['input-fidelity'],
    user: v.user, maxAttempts, timeout, connectTimeout, totalTimeout, transport,
    retryUncertain: v['retry-uncertain'] ?? false, strictSize: v['strict-size'] ?? false,
    outdir: expandPath(v.outdir ?? './outputs/fangxin-draw'), json: v.json ?? false, dryRun: v['dry-run'] ?? false };
}

export function makeFields(o) {
  return { model: o.model, prompt: o.prompt, size: o.size, quality: o.quality,
    background: o.background, output_format: o.format, moderation: o.moderation,
    ...(o.n !== 1 ? { n: o.n } : {}),
    ...(o.compression !== undefined ? { output_compression: o.compression } : {}),
    ...(o.inputFidelity ? { input_fidelity: o.inputFidelity } : {}),
    ...(o.user ? { user: o.user } : {}) };
}
