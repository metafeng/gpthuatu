#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { parseArgs, parseEnv } from 'node:util';
import { randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { loadConfig, keySetup } from './config.mjs';

const SOURCE = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const NAME = 'gpthuatu';
const FILES = ['SKILL.md', 'README.md', 'agents', 'scripts', 'src', 'vendor', 'references', 'tests',
  'package.json', 'package-lock.json', '.github', '.gitignore', '.env.example'];
async function stat(file) { try { return await fs.lstat(file); } catch (error) { if (error.code === 'ENOENT') return null; throw error; } }
async function owned(folder) {
  try { return /^name:\s*["']?gpthuatu["']?\s*$/m.test(await fs.readFile(path.join(folder, 'SKILL.md'), 'utf8')); }
  catch { return false; }
}
async function pointsTo(link, target) {
  try { return await fs.realpath(link) === await fs.realpath(target); }
  catch (error) {
    if (error.code !== 'ENOENT') throw error;
    return path.resolve(path.dirname(link), await fs.readlink(link)) === target;
  }
}
async function makePrivate(file) {
  if (process.platform !== 'win32') return fs.chmod(file, 0o600);
  const account = process.env.USERDOMAIN ? `${process.env.USERDOMAIN}\\${os.userInfo().username}` : os.userInfo().username;
  try { await promisify(execFile)('icacls', [file, '/inheritance:r', '/grant:r', `${account}:F`], { timeout: 10000, windowsHide: true }); }
  catch { throw new Error('无法限制私有配置文件的访问权限，已停止安装。'); }
}

export async function install({ source = SOURCE, home = os.homedir(), agents = ['codex', 'claude'], target, dryRun = false } = {}) {
  source = await fs.realpath(path.resolve(source)); home = path.resolve(home);
  agents = [...new Set(agents)];
  if (!agents.every(name => ['codex', 'claude'].includes(name))) throw new Error('agents 只能为 codex、claude；其他工具使用 --target 指定安装目录。');
  const canonical = path.resolve(target || path.join(home, '.agents', 'skills', NAME));
  const existing = await stat(canonical);
  if (existing && (!existing.isDirectory() || !await owned(canonical))) throw new Error(`安装位置已有其他内容，请选择空目录：${canonical}`);
  const links = agents.map(name => path.join(home, `.${name}`, 'skills', NAME)).filter(link => link !== canonical);
  const pendingLinks = [];
  for (const link of links) {
    const info = await stat(link);
    if (!info) pendingLinks.push(link);
    else if (!info.isSymbolicLink() || !await pointsTo(link, canonical)) throw new Error(`工具入口已被其他内容占用：${link}`);
  }
  // Private configuration belongs to the destination; never import source credentials.
  let envBytes;
  try { envBytes = await fs.readFile(path.join(canonical, '.env')); parseEnv(envBytes.toString('utf8')); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  const plan = { success: true, dryRun, canonical, agents, existingInstallation: !!existing,
    configPreserved: envBytes !== undefined };
  if (dryRun) return plan;

  const parent = path.dirname(canonical);
  const stage = path.join(parent, `.gpthuatu-stage-${randomUUID()}`);
  const previous = path.join(parent, `.gpthuatu-replace-${randomUUID()}`);
  const linksCreated = [];
  let installed = false, moved = false, committed = false;
  await fs.mkdir(parent, { recursive: true });
  try {
    if (source !== canonical) {
      await fs.mkdir(stage, { mode: 0o700 });
      for (const file of FILES) await fs.cp(path.join(source, file), path.join(stage, file), { recursive: true, dereference: true });
      // Keep the destination's generated images and personal files when refreshing managed code.
      if (existing) for (const name of await fs.readdir(canonical)) {
        if (!FILES.includes(name) && name !== '.env' && name !== '.git') {
          await fs.cp(path.join(canonical, name), path.join(stage, name), { recursive: true });
        }
      }
      const git = await stat(path.join(source, '.git'));
      if (git?.isDirectory()) {
        const config = await fs.readFile(path.join(source, '.git', 'config'), 'utf8');
        if (!/^\s*worktree\s*=/m.test(config)) await fs.cp(path.join(source, '.git'), path.join(stage, '.git'), { recursive: true });
      } else if (existing && (await stat(path.join(canonical, '.git')))?.isDirectory()) {
        await fs.cp(path.join(canonical, '.git'), path.join(stage, '.git'), { recursive: true });
      }
      if (envBytes !== undefined) {
        await fs.writeFile(path.join(stage, '.env'), envBytes, { mode: 0o600 });
        await makePrivate(path.join(stage, '.env'));
      }
      if (existing) { await fs.rename(canonical, previous); moved = true; }
      await fs.rename(stage, canonical); installed = true;
    } else if (envBytes !== undefined) await makePrivate(path.join(canonical, '.env'));
    for (const link of pendingLinks) {
      await fs.mkdir(path.dirname(link), { recursive: true });
      await fs.symlink(canonical, link, process.platform === 'win32' ? 'junction' : 'dir');
      linksCreated.push(link);
    }
    const config = await loadConfig(process.env, canonical);
    committed = true;
    return { ...plan, installed: true, restartAgent: true,
      ...(!config.keys.length ? { keySetup: keySetup(config) } : {}) };
  } catch (error) {
    for (const link of linksCreated.reverse()) await fs.rm(link, { force: true });
    if (installed) await fs.rm(canonical, { recursive: true, force: true });
    if (moved) await fs.rename(previous, canonical);
    throw error;
  } finally {
    await fs.rm(stage, { recursive: true, force: true });
    if (committed && moved) await fs.rm(previous, { recursive: true, force: true });
  }
}

export async function main() {
  try {
    const { values } = parseArgs({ options: { agents: { type: 'string' }, target: { type: 'string' }, home: { type: 'string' },
      'dry-run': { type: 'boolean' }, help: { type: 'boolean' } } });
    if (values.help) { console.log('node scripts/install.mjs [--agents codex,claude] [--target /path/to/skills/gpthuatu] [--dry-run]\n安装 GPT画图并建立工具入口；已有 gpthuatu 的私有配置会保留。'); return; }
    console.log(JSON.stringify(await install({ home: values.home, target: values.target,
      agents: values.agents !== undefined ? values.agents.split(',').filter(Boolean) : ['codex', 'claude'], dryRun: values['dry-run'] }), null, 2));
  } catch (error) { console.error(`安装失败：${error.message}`); process.exitCode = 1; }
}
