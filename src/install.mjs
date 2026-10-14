#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { parseArgs, parseEnv } from 'node:util';
import { randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const SOURCE = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const NAME = 'fangxin-draw';
const OLD = 'fangxin-image-gen';
const FILES = ['SKILL.md', 'README.md', 'agents', 'scripts', 'src', 'vendor', 'references', 'tests',
  'package.json', 'package-lock.json', '.github', '.gitignore', '.env.example'];
async function stat(file) { try { return await fs.lstat(file); } catch (e) { if (e.code === 'ENOENT') return null; throw e; } }
async function owned(file) {
  const info = await stat(file);
  if (!info) return true;
  try {
    const text = await fs.readFile(path.join(file, 'SKILL.md'), 'utf8');
    return /^name:\s*["']?(fangxin-image-gen|fangxin-draw|放心画图)["']?\s*$/m.test(text);
  } catch { return false; }
}
async function exists(file) { return !!(await stat(file)); }
async function makePrivate(file, directory = false) {
  if (process.platform !== 'win32') return fs.chmod(file, directory ? 0o700 : 0o600);
  const account = process.env.USERDOMAIN ? `${process.env.USERDOMAIN}\\${os.userInfo().username}` : os.userInfo().username;
  try {
    await promisify(execFile)('icacls', [file, '/inheritance:r', '/grant:r', `${account}:${directory ? '(OI)(CI)F' : 'F'}`], { timeout: 10000, windowsHide: true });
  } catch { throw new Error('无法设置私有配置/备份的访问权限，已停止安装。'); }
}

export async function install({ source = SOURCE, home = os.homedir(), agents = ['codex', 'claude'], target,
  dryRun = false, replaceHomeSource = false } = {}) {
  source = path.resolve(source); home = path.resolve(home);
  agents = [...new Set(agents)];
  const canonical = path.resolve(target || path.join(home, '.agents', 'skills', NAME));
  if (!agents.every(x => ['codex', 'claude'].includes(x))) throw new Error('agents 只能为 codex、claude；其他 Agent 使用 --target 指定安装目录。');
  const oldCanonical = path.join(home, '.agents', 'skills', OLD);
  const nested = path.join(home, '.agents', 'skills', 'baoyu-danger-gemini-web', OLD);
  const aliases = agents.flatMap(agent => [path.join(home, `.${agent}`, 'skills', OLD), path.join(home, `.${agent}`, 'skills', NAME)]);
  const candidates = [...new Set([canonical, oldCanonical, nested, ...aliases])];
  const removals = [];
  const seenEntries = new Set();
  for (const file of candidates) {
    const info = await stat(file);
    if (!info) continue;
    const entry = path.join(await fs.realpath(path.dirname(file)), path.basename(file));
    if (seenEntries.has(entry)) continue;
    seenEntries.add(entry);
    // A dangling known alias is safe to back up, but arbitrary directories are never removed.
    if (!await owned(file)) {
      if (!(info.isSymbolicLink() && [OLD, NAME].includes(path.basename(file)))) throw new Error(`安装目录中已有其他内容，停止替换：${file}`);
      const link = await fs.readlink(file);
      if (!/fangxin-(?:image-gen|draw)/.test(link)) throw new Error(`无法确认旧链接归属，停止替换：${file}`);
    }
    if (file === source && file === canonical && !replaceHomeSource) continue;
    removals.push({ path: file, symlink: info.isSymbolicLink() });
  }
  // Prefer the configuration from the existing canonical installation, then from its source.
  const envCandidates = [...new Set([path.join(canonical, '.env'), path.join(oldCanonical, '.env'), path.join(source, '.env'),
    ...aliases.map(x => path.join(x, '.env')), path.join(nested, '.env')])];
  let envBytes, envOrigin;
  for (const file of envCandidates) {
    try { envBytes = await fs.readFile(file); envOrigin = file; break; } catch (e) { if (e.code !== 'ENOENT') throw e; }
  }
  // Legacy embedded keys are migrated into a private config file, never into the new source code.
  if (!envBytes) for (const root of [oldCanonical, nested, source]) {
    try {
      const legacy = await fs.readFile(path.join(root, 'scripts', 'generate.py'), 'utf8');
      const match = legacy.match(/DEFAULT_API_KEY\s*=\s*["']([^"'\r\n]+)["']/);
      if (match?.[1] && /^sk-/.test(match[1])) { envBytes = Buffer.from(`FANGXIN_API_KEY=${match[1]}\n`); envOrigin = 'legacy-script'; break; }
    } catch (e) { if (e.code !== 'ENOENT') throw e; }
  }
  if (envBytes) {
    // Validate before moving anything, then preserve the user's configuration verbatim.
    parseEnv(envBytes.toString('utf8'));
  }
  const backupRoot = path.join(home, '.agents', 'skill-backups', `fangxin-${new Date().toISOString().replace(/[:.]/g, '-')}-${randomUUID().slice(0, 8)}`);
  const plan = { success: true, dryRun, canonical, agents, backups: removals.map(x => x.path),
    configPreserved: !!envBytes, configOrigin: envOrigin === 'legacy-script' ? 'legacy-script' : envOrigin ? 'existing-config' : 'none',
    backupRoot: removals.length ? backupRoot : null };
  if (dryRun) return plan;

  const parent = path.dirname(canonical);
  await fs.mkdir(parent, { recursive: true });
  const staged = path.join(parent, `.fangxin-stage-${randomUUID()}`);
  await fs.mkdir(staged, { mode: 0o700 });
  const moved = [], linksCreated = [];
  let installed = false;
  try {
    // Stage completely before moving any directory, including when running from the old directory.
    for (const item of FILES) await fs.cp(path.join(source, item), path.join(staged, item), { recursive: true, dereference: true });
    const git = await stat(path.join(source, '.git'));
    // Normal clones retain Git updates; worktree pointer files are deliberately not copied.
    if (git?.isDirectory()) {
      const gitConfig = await fs.readFile(path.join(source, '.git', 'config'), 'utf8');
      if (!/^\s*worktree\s*=/m.test(gitConfig)) await fs.cp(path.join(source, '.git'), path.join(staged, '.git'), { recursive: true });
    }
    if (envBytes) await fs.writeFile(path.join(staged, '.env'), envBytes, { mode: 0o600 });
    if (envBytes) await makePrivate(path.join(staged, '.env'));
    if (removals.length) {
      await fs.mkdir(backupRoot, { recursive: true, mode: 0o700 });
      await makePrivate(backupRoot, true);
      // Symlinks are moved first so their targets remain available during backup planning.
      removals.sort((a, b) => Number(b.symlink) - Number(a.symlink));
      for (const [index, item] of removals.entries()) {
        const backup = path.join(backupRoot, `${index + 1}-${path.basename(item.path)}`);
        await fs.rename(item.path, backup);
        moved.push({ original: item.path, backup, symlink: item.symlink });
      }
    }
    if (source === canonical && !replaceHomeSource) {
      // The checked-out skill can update itself without losing its Git metadata.
      await fs.rm(staged, { recursive: true, force: true });
      if (envBytes) await fs.writeFile(path.join(canonical, '.env'), envBytes, { mode: 0o600 });
      if (await exists(path.join(canonical, '.env'))) await makePrivate(path.join(canonical, '.env'));
    } else {
      await fs.rename(staged, canonical);
      installed = true;
    }
    for (const agent of agents) {
      const link = path.join(home, `.${agent}`, 'skills', NAME);
      if (link === canonical) continue;
      await fs.mkdir(path.dirname(link), { recursive: true });
      if (await exists(link) && await fs.realpath(link) === await fs.realpath(canonical)) continue;
      await fs.symlink(canonical, link, process.platform === 'win32' ? 'junction' : 'dir');
      linksCreated.push(link);
    }
    if (moved.length) await fs.writeFile(path.join(backupRoot, 'restore.json'), JSON.stringify({ canonical, moved, linksCreated }, null, 2), { mode: 0o600 });
    return { ...plan, installed: true, restartAgent: true };
  } catch (error) {
    for (const link of linksCreated.reverse()) await fs.rm(link, { force: true });
    if (installed) await fs.rm(canonical, { recursive: true, force: true });
    for (const item of moved.reverse()) { await fs.mkdir(path.dirname(item.original), { recursive: true }); await fs.rename(item.backup, item.original); }
    throw error;
  } finally { await fs.rm(staged, { recursive: true, force: true }); }
}

export async function main() {
  try {
    const { values } = parseArgs({ options: { agents: { type: 'string' }, target: { type: 'string' }, home: { type: 'string' },
      'dry-run': { type: 'boolean' }, help: { type: 'boolean' } } });
    if (values.help) { console.log('node scripts/install.mjs [--agents codex,claude] [--target /path/to/skills/fangxin-draw] [--dry-run]\n自动备份旧版、保留配置，并安装放心画图。备份位于 ~/.agents/skill-backups/，不进入技能扫描目录。'); return; }
    console.log(JSON.stringify(await install({ home: values.home, target: values.target, agents: values.agents !== undefined ? values.agents.split(',').filter(Boolean) : ['codex', 'claude'], dryRun: values['dry-run'] }), null, 2));
  } catch (error) { console.error(`安装失败：${error.message}`); process.exitCode = 1; }
}
