import fs from 'node:fs/promises';
import { parseArgs } from 'node:util';
import { loadConfig, keySetup } from './config.mjs';
import { normalizeOptions, expandPath } from './options.mjs';
import { generate } from './generate.mjs';
import { inspectImage } from './images.mjs';
import { safeError } from './errors.mjs';

const HELP = `GPT画图 — Node.js 22.19+（建议 24 LTS）

node scripts/generate.mjs --prompt "一只晒太阳的橙色小猫"
node scripts/generate.mjs --prompt "背景换成海边" --image /path/photo.png

--prompt TEXT                  提示词（必填，最多 32000 字符）
--model NAME                   默认 gpt-image-2.5-flare
--image PATH_OR_HTTPS_URL       参考图；可重复，最多 16 张 PNG/JPEG
--mask PATH_OR_HTTPS_URL        PNG 遮罩，与第一张参考图同尺寸，透明处编辑
--size SIZE                    auto 或 WIDTHxHEIGHT；默认 auto
--quality QUALITY              auto/low/medium/high；2.5 另支持 xhigh/max
--background VALUE             auto/opaque/transparent
--output-format FORMAT         png/jpeg；默认 png
--output-compression NUMBER    JPEG 质量 0～100；PNG 不使用
--n NUMBER                     1～10；默认 1
--moderation VALUE             auto/low；默认 auto
--input-fidelity VALUE         仅旧模型支持；Flare 请省略
--outdir PATH                  默认 ./outputs/gpthuatu
--timeout SECONDS              单次请求上限，默认 420
--connect-timeout SECONDS      连接上限，默认 15
--total-timeout SECONDS        全任务网络预算，默认 600
--max-attempts NUMBER          全任务请求次数上限，默认 3（所有密钥合计）
--transport node|curl          默认 node；curl 是显式选择的备用通道
--retry-uncertain              允许重发执行状态不确定的请求，可能重复扣费
--strict-size                  尺寸不匹配时验收失败，并保留已出图片
--experimental                 显式试验当前尚未验收的 Flare 透明背景
--json                         stdout 输出一个 JSON 结果
--dry-run                      只检查参数/参考图，不提交接口，不产生费用
--doctor                       只检查环境/配置，不调用接口
--verify PATH                  只验证一张本地 PNG/JPEG，不调用接口
--help                         显示帮助
`;

export async function main(argv = process.argv.slice(2)) {
  let config;
  const controller = new AbortController();
  const interrupt = () => controller.abort();
  process.once('SIGINT', interrupt); process.once('SIGTERM', interrupt);
  let values = {};
  try {
    const stringNames = ['prompt', 'model', 'size', 'quality', 'background', 'output-format', 'output-compression',
      'n', 'moderation', 'input-fidelity', 'style', 'outdir', 'timeout', 'connect-timeout', 'total-timeout',
      'max-attempts', 'retries', 'transport', 'user', 'mask', 'verify'];
    const options = Object.fromEntries(stringNames.map(name => [name, { type: 'string' }]));
    for (const name of ['help', 'json', 'dry-run', 'doctor', 'retry-uncertain', 'strict-size', 'experimental']) options[name] = { type: 'boolean' };
    options.image = { type: 'string', multiple: true };
    ({ values } = parseArgs({ args: argv, options, strict: true, allowPositionals: false }));
    if (values.help) { console.log(HELP); return; }
    config = await loadConfig();
    if (values.doctor) {
      console.log(JSON.stringify({ success: true, node: process.versions.node, minimumNode: '22.19.0',
        model: values.model || config.model, provider: config.provider, apiBaseUrl: config.apiBaseUrl,
        authType: config.authType, apiKeyHeader: config.authType === 'api-key' ? config.apiKeyHeader : 'Authorization',
        editFormat: config.editFormat, keysConfigured: config.keys.length, envFile: config.envFile,
        nativeTransport: true, codecsBundled: true,
        ...(!config.keys.length ? { keySetup: keySetup(config) } : {}) }, null, 2));
      return;
    }
    if (values.verify) {
      const file = expandPath(values.verify);
      const stat = await fs.stat(file);
      if (!stat.isFile() || stat.size > 50 * 1024 * 1024) throw new Error('图片文件无效或超过 50 MiB。');
      console.log(JSON.stringify({ success: true, path: file, ...inspectImage(await fs.readFile(file)) }, null, 2));
      return;
    }
    const normalized = normalizeOptions(values, config);
    const progress = event => {
      if (values.json) console.error(JSON.stringify(event));
      else if (event.stage === 'request') console.error(`正在出图：第 ${event.attempt}/${event.maxAttempts} 次请求…`);
      else if (event.stage === 'validate_output') console.error('接口已返回，正在完整解码并检查图片…');
      else if (event.stage === 'waiting') console.error('仍在等待接口返回…');
      else if (event.stage === 'retry') console.error(`接口返回 ${event.status}，按重试预算处理…`);
    };
    const heartbeat = setInterval(() => progress({ stage: 'waiting' }), 20000);
    heartbeat.unref();
    let result;
    try { result = await generate(normalized, config, { progress, signal: controller.signal }); }
    finally { clearInterval(heartbeat); }
    if (values.json || normalized.dryRun) console.log(JSON.stringify(result, null, 2));
    else {
      console.log(`模型：${result.model} | 请求尺寸：${result.requestedSize} | 耗时：${result.elapsedSeconds} 秒`);
      for (const [index, file] of result.files.entries()) console.log(`[${index + 1}/${result.files.length}] ${file.path}\n  实际尺寸：${file.size} | 格式：${file.format} | 透明区域：${file.hasTransparency ? '有' : '无'}`);
      for (const warning of result.warnings) console.log(`提醒：${warning}`);
      console.log(`结果记录：${result.manifest}`);
    }
  } catch (error) {
    const result = safeError(error, config?.keys);
    if (values.json || argv.includes('--json')) console.log(JSON.stringify(result, null, 2));
    else console.error(`${result.code}：${result.message}${result.setupUrl ? `\n获取画图分组 Key：${result.setupUrl}` : ''}${result.manifest ? `\n结果记录：${result.manifest}` : ''}`);
    process.exitCode = error.code === 'INPUT_ERROR' || error.code?.startsWith('ERR_PARSE_ARGS') ? 4 : error.code === 'CONFIG_ERROR' ? 2 : 1;
  } finally {
    process.removeListener('SIGINT', interrupt); process.removeListener('SIGTERM', interrupt);
  }
}
