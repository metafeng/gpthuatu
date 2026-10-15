#!/usr/bin/env node
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
export async function install(options) {
  const module = await import('../src/install.mjs');
  return module.install(options);
}
let direct = false;
try { direct = !!process.argv[1] && fs.realpathSync(process.argv[1]) === fileURLToPath(import.meta.url); } catch {}
if (direct) {
  const [major, minor] = process.versions.node.split('.').map(Number);
  if (major < 22 || (major === 22 && minor < 19)) {
    console.error('GPT画图需要 Node.js 22.19 或更新版本，建议安装 Node.js 24 LTS：https://nodejs.org/');
    process.exitCode = 2;
  } else {
    const { main } = await import('../src/install.mjs');
    await main();
  }
}
