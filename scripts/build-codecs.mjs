import { build } from 'esbuild';
import fs from 'node:fs/promises';
await fs.mkdir('vendor', { recursive: true });
await build({ stdin: { contents: "exports.PNG = require('pngjs').PNG; exports.jpeg = require('jpeg-js');", resolveDir: process.cwd() },
  bundle: true, platform: 'node', format: 'cjs', target: 'node22', minify: true, outfile: 'vendor/image-codecs.cjs', legalComments: 'eof' });
let licenses = '# Bundled image codec licenses\n\n';
for (const name of ['pngjs', 'jpeg-js']) {
  const pkg = JSON.parse(await fs.readFile(`node_modules/${name}/package.json`, 'utf8'));
  const names = await fs.readdir(`node_modules/${name}`);
  const file = names.find(x => /^license(?:\.|$)/i.test(x));
  const text = (await fs.readFile(`node_modules/${name}/${file}`, 'utf8')).split(/\r?\n/).map(line => line.trimEnd()).join('\n').trim();
  licenses += `## ${name} ${pkg.version}\n\n${text}\n\n`;
}
await fs.writeFile('vendor/LICENSES.md', licenses.trimEnd() + '\n');
