import fs from 'node:fs/promises';
import path from 'node:path';
import { parseEnv } from 'node:util';
import { fileURLToPath } from 'node:url';
import { DrawError } from './errors.mjs';

export const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
export const DEFAULT_MODEL = 'gpt-image-2.5-flare';
export const DEFAULT_BASE_URL = 'https://fangxinapi.com/v1';
export const KEY_SETUP_URL = 'https://fangxinapi.com/keys';
export const SETUP_URLS = [KEY_SETUP_URL, 'https://dashboard.ttapi.io', 'https://platform.openai.com/api-keys'];
const fail = message => { throw new DrawError('CONFIG_ERROR', message); };
const PROFILES = {
  fangxin: { namespace: 'FANGXIN', url: DEFAULT_BASE_URL },
  ttapi: { namespace: 'TT', url: 'https://api.ttapi.io/v1' },
  openai: { namespace: 'OPENAI', url: 'https://api.openai.com/v1' },
};
const keyNames = namespace => new RegExp(`^${namespace}_API_KEY(?:\\d+|S|_BACKUP)?$`);
function readKeys(values, namespace) {
  const prefix = `${namespace}_API_KEY`;
  const candidates = [values[prefix]];
  for (const name of Object.keys(values).filter(x => new RegExp(`^${prefix}\\d+$`).test(x))
    .sort((a, b) => Number(a.slice(prefix.length)) - Number(b.slice(prefix.length)))) candidates.push(values[name]);
  candidates.push(values[`${prefix}_BACKUP`], ...(values[`${prefix}S`] ?? '').split(/[,\n]/));
  const keys = [...new Set(candidates.map(x => String(x ?? '').trim()).filter(Boolean))];
  for (const key of keys) if (!/^[\x21-\x7E]+$/.test(key)) fail('密钥含有空格、非法字符或控制字符。');
  return keys;
}

export function normalizeBaseUrl(value = DEFAULT_BASE_URL) {
  let url;
  try { url = new URL(value); } catch { fail('接口地址无效，请填写服务商提供的 HTTPS 地址。'); }
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) {
    fail('接口地址必须为 HTTPS，不得包含密钥、用户名密码、查询参数或锚点。');
  }
  let pathname = url.pathname.replace(/\/+$/, '').replace(/\/images\/(generations|edits)$/, '');
  url.pathname = pathname || '/v1';
  return url.href.replace(/\/+$/, '');
}

export function providerSettings(values = {}) {
  const apiBaseUrl = normalizeBaseUrl(values.IMAGE_API_BASE_URL?.trim() || DEFAULT_BASE_URL);
  const host = new URL(apiBaseUrl).hostname;
  const provider = host === 'fangxinapi.com' ? 'fangxin' : host === 'api.ttapi.io' ? 'ttapi'
    : host === 'api.openai.com' ? 'openai' : 'openai-compatible';
  const requestedAuth = values.IMAGE_API_AUTH_TYPE?.trim() || 'auto';
  if (!['auto', 'bearer', 'api-key'].includes(requestedAuth)) fail('IMAGE_API_AUTH_TYPE 必须为 auto、bearer 或 api-key。');
  const authType = requestedAuth === 'auto' ? (provider === 'ttapi' ? 'api-key' : 'bearer') : requestedAuth;
  const apiKeyHeader = values.IMAGE_API_KEY_HEADER?.trim() || (provider === 'ttapi' ? 'TT-API-KEY' : 'X-API-Key');
  if (!/^[a-zA-Z0-9-]+$/.test(apiKeyHeader) || /^(host|content-type|content-length|cookie|connection|authorization|accept|user-agent)$/i.test(apiKeyHeader)) {
    fail('IMAGE_API_KEY_HEADER 应为 API 密钥专用请求头，例如 TT-API-KEY 或 X-API-Key。Bearer 认证请使用 IMAGE_API_AUTH_TYPE=bearer。');
  }
  const editFormat = values.IMAGE_API_EDIT_FORMAT?.trim() || (provider === 'ttapi' ? 'json' : 'multipart');
  if (!['json', 'multipart'].includes(editFormat)) fail('IMAGE_API_EDIT_FORMAT 必须为 json 或 multipart。');
  const imageField = values.IMAGE_API_IMAGE_FIELD?.trim() || (provider === 'fangxin' ? 'image' : 'image[]');
  if (!['image', 'image[]'].includes(imageField)) fail('IMAGE_API_IMAGE_FIELD 必须为 image 或 image[]。');
  return { apiBaseUrl, provider, authType, apiKeyHeader, editFormat, imageField };
}

function namedSettings(provider, values) {
  const profile = PROFILES[provider], prefix = `${profile.namespace}_API_`;
  const own = { IMAGE_API_BASE_URL: values[`${prefix}BASE_URL`]?.trim() || profile.url };
  for (const field of ['AUTH_TYPE', 'KEY_HEADER', 'EDIT_FORMAT', 'IMAGE_FIELD']) own[`IMAGE_API_${field}`] = values[`${prefix}${field}`];
  const settings = providerSettings(own);
  if (settings.provider !== provider) fail(`${prefix}BASE_URL 必须对应 ${provider}；其他服务请使用 custom 配置。`);
  return settings;
}

export function keySetup(config) {
  const links = { fangxin: KEY_SETUP_URL, ttapi: SETUP_URLS[1], openai: SETUP_URLS[2] };
  const message = config.provider === 'fangxin'
    ? `如使用放心 API，请登录后选择支持画图模型的分组（需支持 ${config.model || DEFAULT_MODEL}），再创建 Key；也可按 README 配置 TTAPI 或其他兼容接口。`
    : `请从当前服务商获取支持 ${config.model || DEFAULT_MODEL} 的 Key，并确认接口地址和认证方式。`;
  return { ...(links[config.provider] ? { url: links[config.provider] } : {}), message,
    envFile: config.envFile, variable: `${config.keyNamespace || 'IMAGE'}_API_KEY` };
}

export async function loadConfig(env = process.env, root = ROOT, providerOverride) {
  const selected = env.IMAGE_API_ENV_FILE?.trim() || env.FANGXIN_ENV_FILE?.trim();
  const envFile = path.resolve(selected || path.join(root, '.env'));
  let fileValues = {};
  try { fileValues = parseEnv(await fs.readFile(envFile, 'utf8')); }
  catch (error) {
    if (error.code !== 'ENOENT' || selected) fail(`无法读取配置文件 ${envFile}，请检查路径、权限和内容。`);
  }
  // Explicitly exported empty values override the same variables in the file.
  const values = { ...fileValues, ...env };
  const requested = (providerOverride ?? values.IMAGE_API_PROVIDER)?.trim().toLowerCase();
  if (requested && ![...Object.keys(PROFILES), 'custom'].includes(requested)) {
    fail('服务商必须为 fangxin、ttapi、openai 或 custom。');
  }
  let settings, keyNamespace;
  if (requested && requested !== 'custom') {
    // Named profiles ignore stale generic settings, including another provider's key/header.
    settings = namedSettings(requested, values);
    keyNamespace = PROFILES[requested].namespace;
  } else if (requested === 'custom' || values.IMAGE_API_BASE_URL?.trim()) {
    if (requested === 'custom' && !values.IMAGE_API_BASE_URL?.trim()) fail('custom 服务商需要填写 IMAGE_API_BASE_URL。');
    settings = providerSettings(values);
    const named = PROFILES[settings.provider]?.namespace;
    // URL-based legacy profiles remain supported; prefer the matching named key when present.
    keyNamespace = requested !== 'custom' && named && Object.keys(values).some(name => keyNames(named).test(name)) ? named : 'IMAGE';
  } else if (Object.keys(values).some(name => keyNames('IMAGE').test(name))) {
    settings = providerSettings(values); keyNamespace = 'IMAGE';
  } else {
    const configured = Object.entries(PROFILES).filter(([, profile]) => readKeys(values, profile.namespace).length);
    if (configured.length > 1) fail('已配置多家服务商，请设置 IMAGE_API_PROVIDER，或使用 --provider fangxin / --provider ttapi / --provider openai 选择。');
    const provider = configured[0]?.[0] || 'fangxin';
    settings = namedSettings(provider, values);
    keyNamespace = PROFILES[provider].namespace;
  }
  const keys = readKeys(values, keyNamespace);
  const model = (keyNamespace !== 'IMAGE' && values[`${keyNamespace}_API_MODEL`]?.trim())
    || (keyNamespace === 'FANGXIN' && values.FANGXIN_MODEL?.trim()) || values.IMAGE_API_MODEL?.trim() || DEFAULT_MODEL;
  return { keys, model, keyNamespace, envFile, env: values, ...settings };
}

export function requireKeys(config) {
  if (!config.keys.length) {
    const setup = keySetup(config);
    throw new DrawError('CONFIG_ERROR', `尚未配置密钥。${setup.message}请在 ${config.envFile} 写入 ${setup.variable}。`,
      { ...(setup.url ? { setupUrl: setup.url } : {}) });
  }
}
