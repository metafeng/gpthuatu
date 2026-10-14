import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { install } from '../scripts/install.mjs';

const source = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
async function fixture(t) {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), 'fangxin-install-'));
  t.after(() => fs.rm(home, { recursive: true, force: true }));
  const old = path.join(home, '.agents', 'skills', 'fangxin-image-gen');
  await fs.mkdir(old, { recursive: true });
  await fs.writeFile(path.join(old, 'SKILL.md'), '---\nname: fangxin-image-gen\n---\nold version');
  await fs.writeFile(path.join(old, '.env'), 'FANGXIN_API_KEY=fixture-private\n');
  for (const agent of ['codex', 'claude']) {
    const dir = path.join(home, `.${agent}`, 'skills');
    await fs.mkdir(dir, { recursive: true });
    await fs.symlink(old, path.join(dir, 'fangxin-image-gen'), process.platform === 'win32' ? 'junction' : 'dir');
  }
  return { home, old };
}

test('installation preview has no side effects', async t => {
  const { home, old } = await fixture(t);
  const plan = await install({ source, home, dryRun: true });
  assert.equal(plan.configPreserved, true);
  await fs.access(old);
  await assert.rejects(fs.access(plan.canonical));
  await assert.rejects(fs.access(path.join(home, '.agents', 'skill-backups')));
});

test('migration keeps config, disables old entries, stores recoverable backups and one shared skill', async t => {
  const { home, old } = await fixture(t);
  const result = await install({ source, home });
  await assert.rejects(fs.access(old));
  assert.equal(await fs.readFile(path.join(result.canonical, '.env'), 'utf8'), 'FANGXIN_API_KEY=fixture-private\n');
  if (process.platform !== 'win32') assert.equal((await fs.stat(path.join(result.canonical, '.env'))).mode & 0o777, 0o600);
  for (const agent of ['codex', 'claude']) {
    await assert.rejects(fs.access(path.join(home, `.${agent}`, 'skills', 'fangxin-image-gen')));
    assert.equal(await fs.realpath(path.join(home, `.${agent}`, 'skills', 'fangxin-draw')), await fs.realpath(result.canonical));
  }
  const record = JSON.parse(await fs.readFile(path.join(result.backupRoot, 'restore.json'), 'utf8'));
  const saved = record.moved.find(x => x.original === old);
  assert.equal(await fs.readFile(path.join(saved.backup, '.env'), 'utf8'), 'FANGXIN_API_KEY=fixture-private\n');
  await fs.access(path.join(result.canonical, 'scripts', 'generate.mjs'));
  await fs.access(path.join(result.canonical, 'vendor', 'image-codecs.cjs'));
  assert.ok(!result.backupRoot.includes(path.join('.agents', 'skills')));
});

test('reinstallation preserves private config and updates the same canonical directory', async t => {
  const { home } = await fixture(t);
  const first = await install({ source, home });
  const second = await install({ source, home });
  assert.equal(first.canonical, second.canonical);
  assert.notEqual(first.backupRoot, second.backupRoot);
  assert.equal(await fs.readFile(path.join(second.canonical, '.env'), 'utf8'), 'FANGXIN_API_KEY=fixture-private\n');
});

test('unrelated directories are not overwritten', async t => {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), 'fangxin-unrelated-'));
  t.after(() => fs.rm(home, { recursive: true, force: true }));
  const target = path.join(home, '.agents', 'skills', 'fangxin-draw');
  await fs.mkdir(target, { recursive: true });
  await fs.writeFile(path.join(target, 'important.txt'), 'keep');
  await assert.rejects(install({ source, home }));
  assert.equal(await fs.readFile(path.join(target, 'important.txt'), 'utf8'), 'keep');
});

test('failure creating agent links rolls back old directories and config', async t => {
  const { home, old } = await fixture(t);
  const original = fs.symlink;
  fs.symlink = async () => { throw new Error('simulated link failure'); };
  try { await assert.rejects(install({ source, home }), /simulated link failure/); }
  finally { fs.symlink = original; }
  assert.equal(await fs.readFile(path.join(old, '.env'), 'utf8'), 'FANGXIN_API_KEY=fixture-private\n');
  await assert.rejects(fs.access(path.join(home, '.agents', 'skills', 'fangxin-draw')));
  assert.equal(await fs.realpath(path.join(home, '.codex', 'skills', 'fangxin-image-gen')), await fs.realpath(old));
});

test('self-install keeps a clone and refreshes aliases without removing the source', async t => {
  const { home } = await fixture(t);
  const first = await install({ source, home });
  const result = await install({ source: first.canonical, home });
  assert.equal(await fs.realpath(result.canonical), await fs.realpath(first.canonical));
  await fs.access(path.join(first.canonical, 'src', 'cli.mjs'));
  assert.equal(await fs.realpath(path.join(home, '.codex', 'skills', 'fangxin-draw')), await fs.realpath(first.canonical));
});
