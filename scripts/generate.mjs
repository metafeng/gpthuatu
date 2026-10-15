#!/usr/bin/env node
const [major, minor] = process.versions.node.split('.').map(Number);
if (major < 22 || (major === 22 && minor < 19)) {
  console.error('GPT画图需要 Node.js 22.19 或更新版本，建议安装 Node.js 24 LTS：https://nodejs.org/');
  process.exitCode = 2;
} else {
  const { main } = await import('../src/cli.mjs');
  await main();
}
