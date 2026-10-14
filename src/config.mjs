import fs from 'node:fs/promises';
import path from 'node:path';
import { parseEnv } from 'node:util';
import { fileURLToPath } from 'node:url';
import { DrawError } from './errors.mjs';

export const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
export const DEFAULT_MODEL = 'gpt-image-2.5-flare';

export async function loadConfig(env = process.env, root = ROOT) {
  const selected = env.FANGXIN_ENV_FILE?.trim();
  const envFile = path.resolve(selected || path.join(root, '.env'));
  let fileValues = {};
  try {
    fileValues = parseEnv(await fs.readFile(envFile, 'utf8'));
  } catch (error) {
    if (error.code !== 'ENOENT' || selected) {
      throw new DrawError('CONFIG_ERROR', `无法读取配置文件 ${envFile}，请检查路径、权限和内容。`);
    }
  }
  // An explicitly exported empty value is intentional and overrides the file.
  const values = { ...fileValues, ...env };
  const candidates = [values.FANGXIN_API_KEY];
  for (const name of Object.keys(values).filter(x => /^FANGXIN_API_KEY\d+$/.test(x))
    .sort((a, b) => Number(a.slice(15)) - Number(b.slice(15)))) candidates.push(values[name]);
  candidates.push(values.FANGXIN_API_KEY_BACKUP,
    ...(values.FANGXIN_API_KEYS ?? '').split(/[,\n]/));
  const keys = [...new Set(candidates.map(x => String(x ?? '').trim()).filter(Boolean))];
  for (const key of keys) {
    if (!/^[\x21-\x7E]+$/.test(key)) throw new DrawError('CONFIG_ERROR', '密钥含有空格、非法字符或控制字符。');
  }
  return { keys, model: values.FANGXIN_MODEL?.trim() || DEFAULT_MODEL, envFile, env: values };
}

export function requireKeys(config) {
  if (!config.keys.length) throw new DrawError('CONFIG_ERROR',
    `尚未配置密钥。请在 ${config.envFile} 写入 FANGXIN_API_KEY，或设置对应环境变量。`);
}
