import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { install } from '../scripts/install.mjs';

const source = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
async function fixture(t) {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), 'gpthuatu-install-'));
  t.after(() => fs.rm(home, { recursive: true, force: true }));
  return { home, target: path.join(home, '.agents', 'skills', 'gpthuatu') };
}
const privateConfig = 'IMAGE_MODEL=gpt-image-2.5-flare\nTT_API_KEY=fixture-private\nFANGXIN_API_KEY=fixture-fangxin\n';

test('installation preview does not create files or directories', async t => {
  const {home,target}=await fixture(t);
  const plan=await install({source,home,dryRun:true});
  assert.equal(plan.canonical,target);assert.equal(plan.configPreserved,false);
  assert.deepEqual(await fs.readdir(home),[]);
});

test('fresh installation shares one skill across tools and excludes source private configuration', async t => {
  const {home,target}=await fixture(t);
  const download=path.join(home,'download');
  await fs.cp(source,download,{recursive:true,filter:file=>!['.git','.env','node_modules','outputs'].includes(path.basename(file))});
  await fs.writeFile(path.join(download,'.env'),'TT_API_KEY=fixture-source-only\n');
  const result=await install({source:download,home});
  assert.equal(result.canonical,target);assert.equal(result.configPreserved,false);
  assert.match(await fs.readFile(path.join(target,'SKILL.md'),'utf8'),/^name: gpthuatu$/m);
  await assert.rejects(fs.access(path.join(target,'.env')));
  await fs.access(path.join(target,'scripts','generate.mjs'));
  await fs.access(path.join(target,'vendor','image-codecs.cjs'));
  for(const agent of ['codex','claude']) assert.equal(await fs.realpath(path.join(home,`.${agent}`,'skills','gpthuatu')),await fs.realpath(target));
  assert.deepEqual(await fs.readdir(path.dirname(target)),['gpthuatu']);
});

test('reinstallation preserves destination private config, permissions and removes temporary staging', async t => {
  const {home,target}=await fixture(t);
  await install({source,home});
  await fs.writeFile(path.join(target,'.env'),privateConfig);
  await fs.mkdir(path.join(target,'outputs'));
  await fs.writeFile(path.join(target,'outputs','personal-image.png'),'user-owned-output');
  const result=await install({source,home});
  assert.equal(result.configPreserved,true);
  assert.equal(await fs.readFile(path.join(target,'.env'),'utf8'),privateConfig);
  assert.equal(await fs.readFile(path.join(target,'outputs','personal-image.png'),'utf8'),'user-owned-output');
  if(process.platform!=='win32') assert.equal((await fs.stat(path.join(target,'.env'))).mode&0o777,0o600);
  assert.deepEqual(await fs.readdir(path.dirname(target)),['gpthuatu']);
});

test('unrelated destination is not overwritten', async t => {
  const {home,target}=await fixture(t);
  await fs.mkdir(target,{recursive:true});await fs.writeFile(path.join(target,'important.txt'),'keep');
  await assert.rejects(install({source,home}));
  assert.equal(await fs.readFile(path.join(target,'important.txt'),'utf8'),'keep');
});

test('unrelated tool entry is not replaced and installation has not started', async t => {
  const {home,target}=await fixture(t);
  const entry=path.join(home,'.codex','skills','gpthuatu');
  await fs.mkdir(entry,{recursive:true});await fs.writeFile(path.join(entry,'important.txt'),'keep');
  await assert.rejects(install({source,home}));
  await assert.rejects(fs.access(target));
  assert.equal(await fs.readFile(path.join(entry,'important.txt'),'utf8'),'keep');
});

test('entry creation failure restores the existing destination and its private config', async t => {
  const {home,target}=await fixture(t);
  await install({source,home});await fs.writeFile(path.join(target,'.env'),privateConfig);
  await fs.writeFile(path.join(target,'local-only.txt'),'keep');
  await fs.rm(path.join(home,'.claude','skills','gpthuatu'));
  const original=fs.symlink;
  fs.symlink=async()=>{throw new Error('simulated link failure');};
  try {await assert.rejects(install({source,home}),/simulated link failure/);}
  finally {fs.symlink=original;}
  assert.equal(await fs.readFile(path.join(target,'.env'),'utf8'),privateConfig);
  assert.equal(await fs.readFile(path.join(target,'local-only.txt'),'utf8'),'keep');
  assert.deepEqual(await fs.readdir(path.dirname(target)),['gpthuatu']);
});

test('self-install keeps files and git metadata while refreshing a missing tool entry', async t => {
  const {home,target}=await fixture(t);
  await install({source,home});await fs.writeFile(path.join(target,'.env'),privateConfig);
  await fs.rm(path.join(home,'.codex','skills','gpthuatu'));
  const result=await install({source:target,home});
  assert.equal(result.canonical,target);
  assert.equal(await fs.readFile(path.join(target,'.env'),'utf8'),privateConfig);
  await fs.access(path.join(target,'src','cli.mjs'));
  assert.equal(await fs.realpath(path.join(home,'.codex','skills','gpthuatu')),await fs.realpath(target));
});
