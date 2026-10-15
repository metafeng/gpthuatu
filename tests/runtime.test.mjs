import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import codecs from '../vendor/image-codecs.cjs';
import { normalizeOptions } from '../src/options.mjs';
import { loadConfig, normalizeBaseUrl, providerSettings, requireKeys, keySetup } from '../src/config.mjs';
import { inspectImage, decodeBase64, applyMask } from '../src/images.mjs';
import { generate, multipart, retryDelay } from '../src/generate.mjs';
import { requestNode, requestCurl, proxyFor } from '../src/network.mjs';
import { safeError } from '../src/errors.mjs';

const config = { keys: ['fixture-key-a', 'fixture-key-b'], model: 'gpt-image-2.5-flare', env: {} };
const options = (value = {}) => normalizeOptions({ prompt: '测试图片', ...value }, config);
function png(transparent = false) {
  const image = new codecs.PNG({ width: 4, height: 4 });
  image.data.fill(255);
  if (transparent) image.data[3] = 0;
  return codecs.PNG.sync.write(image);
}
function response(status = 200, body = { data: [{ b64_json: png().toString('base64') }] }, headers = {}) {
  return { status, body: Buffer.from(JSON.stringify(body)), headers };
}
async function temp(t) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'fangxin-test-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  return dir;
}

test('reject invalid inputs and format conflicts before any request', () => {
  for (const value of [{ prompt: ' ' }, { n: '0' }, { n: '11' }, { size: '1254x1254' },
    { size: '4096x4096' }, { size: '3840x512' }, { size: '16x16' },
    { 'output-format': 'jpeg', background: 'transparent' }, { 'output-compression': '50' },
    { 'output-format': 'webp' }, { style: 'vivid' }, { mask: 'missing.png' },
    { image: ['photo.png'], 'input-fidelity': 'high' }, { quality: 'max', model: 'gpt-image-2' },
    { retries: '2', 'max-attempts': '3' }, { model: 'dall-e-3' }]) {
    assert.throws(() => options(value), { code: 'INPUT_ERROR' });
  }
  assert.equal(options({ size: '2160x3840', quality: 'max' }).quality, 'max');
  assert.equal(options({ 'output-format': 'jpeg', 'output-compression': '70' }).compression, 70);
});

test('dotenv precedence, numeric backup order and missing explicit config', async t => {
  const root = await temp(t);
  await fs.writeFile(path.join(root, '.env'), 'FANGXIN_API_KEY="file-key"\nFANGXIN_API_KEY10=ten\nFANGXIN_API_KEY2=two\nFANGXIN_MODEL=\n');
  const loaded = await loadConfig({ FANGXIN_API_KEY: 'shell-key' }, root);
  assert.deepEqual(loaded.keys, ['shell-key', 'two', 'ten']);
  assert.equal(loaded.model, 'gpt-image-2.5-flare');
  assert.deepEqual((await loadConfig({ FANGXIN_API_KEY: '' }, root)).keys, ['two', 'ten']);
  await assert.rejects(loadConfig({ FANGXIN_ENV_FILE: path.join(root, 'missing') }, root), { code: 'CONFIG_ERROR' });
});

test('full image decode: PNG alpha/CRC/truncation, JPEG and invalid Base64', () => {
  assert.equal(inspectImage(png(true)).hasTransparency, true);
  assert.equal(inspectImage(png()).hasTransparency, false);
  const broken = png(); broken[broken.length - 1] ^= 1;
  assert.throws(() => inspectImage(broken), { code: 'INVALID_IMAGE' });
  assert.throws(() => inspectImage(png().subarray(0, -4)), { code: 'INVALID_IMAGE' });
  const jpg = codecs.jpeg.encode({ width: 4, height: 4, data: Buffer.alloc(4 * 4 * 4, 255) }, 80).data;
  assert.equal(inspectImage(jpg).format, 'jpeg');
  assert.throws(() => inspectImage(jpg.subarray(0, -2)), { code: 'INVALID_IMAGE' });
  for (const value of ['@@@=', '', 'a===', 'AB==']) assert.throws(() => decodeBase64(value), { code: 'INVALID_RESPONSE' });
});

test('multipart keeps prompt literal and repeats provider image fields', () => {
  const image = { bytes: png(), metadata: inspectImage(png()) };
  const payload = multipart({ prompt: '@do-not-read-this-file;type=bad', model: config.model }, [image, image]);
  const text = payload.body.toString('latin1');
  assert.equal((text.match(/name="image"/g) || []).length, 2);
  assert.ok(text.includes('@do-not-read-this-file;type=bad'));
  assert.ok(!text.includes('input_fidelity'));
});

test('success validates pixels, preserves actual size, unique files and manifest', async t => {
  const dir = await temp(t), request = async () => response();
  const one = await generate(options({ outdir: dir, size: '1024x1024' }), config, { request });
  const two = await generate(options({ outdir: dir }), config, { request });
  assert.equal(one.files[0].size, '4x4');
  assert.equal(one.warnings.length, 1);
  assert.notEqual(one.files[0].path, two.files[0].path);
  const saved = JSON.parse(await fs.readFile(one.manifest, 'utf8'));
  assert.equal(saved.success, true);
  assert.ok(!JSON.stringify(saved).includes('fixture-key'));
  assert.ok(!JSON.stringify(saved).includes('测试图片'));
});

test('provider PNG can satisfy JPEG output through a verified local conversion', async t => {
  const dir = await temp(t);
  const result = await generate(options({ outdir: dir, 'output-format': 'jpeg', 'output-compression': '85' }), config,
    { request: async () => response() });
  assert.equal(result.success, true);
  assert.equal(result.files[0].format, 'jpeg');
  assert.equal(result.files[0].providerFormat, 'png');
  assert.ok(result.files[0].localProcessing.includes('convert-to-jpeg'));
  assert.equal(inspectImage(await fs.readFile(result.files[0].path)).format, 'jpeg');
  assert.equal(inspectImage(await fs.readFile(result.files[0].sourcePath)).format, 'png');
});

test('mask composition preserves every unselected pixel exactly', () => {
  const original = png(), generated = new codecs.PNG({ width: 4, height: 4 }), selection = new codecs.PNG({ width: 4, height: 4 });
  generated.data.fill(0); selection.data.fill(255);
  for (let i = 3; i < generated.data.length; i += 4) generated.data[i] = 255;
  selection.data[3] = 0;
  const edited = codecs.PNG.sync.read(applyMask(original, codecs.PNG.sync.write(generated), codecs.PNG.sync.write(selection)));
  assert.equal(edited.data[0], 0);
  for (let i = 4; i < edited.data.length; i++) assert.equal(edited.data[i], 255);
});

test('strict size failure preserves paid-for valid image and an unsuccessful manifest', async t => {
  const dir = await temp(t);
  let captured;
  await assert.rejects(generate(options({ outdir: dir, size: '1024x1024', 'strict-size': true }), config,
    { request: async () => response() }), error => {
    captured = error;
    assert.equal(error.code, 'OUTPUT_VALIDATION_FAILED');
    assert.equal(error.files.length, 1);
    return true;
  });
  assert.equal(JSON.parse(await fs.readFile(captured.manifest, 'utf8')).success, false);
});

test('opaque result for transparent request fails, corrupt results never report success', async t => {
  const dir = await temp(t);
  assert.throws(() => options({ background: 'transparent' }), { code: 'CAPABILITY_UNVERIFIED' });
  await assert.rejects(generate(options({ outdir: dir, background: 'transparent', experimental: true }), config,
    { request: async () => response() }), { code: 'OUTPUT_VALIDATION_FAILED' });
  await assert.rejects(generate(options({ outdir: dir }), config,
    { request: async () => response(200, { data: [{ b64_json: Buffer.from('not-an-image').toString('base64') }] }) }), { code: 'OUTPUT_VALIDATION_FAILED' });
  await assert.rejects(generate(options({ outdir: dir }), config,
    { request: async () => response(200, { data: [] }) }), { code: 'INVALID_RESPONSE' });
});

test('mask mismatch and invalid references stop before contacting provider', async t => {
  const dir = await temp(t), first = path.join(dir, 'first.png'), mask = path.join(dir, 'mask.png');
  await fs.writeFile(first, png()); await fs.writeFile(mask, png());
  let calls = 0;
  await assert.rejects(generate(options({ image: [first], mask, outdir: dir }), config,
    { request: async () => { calls++; return response(); } }), { code: 'INPUT_ERROR' });
  assert.equal(calls, 0);
  await assert.rejects(generate(options({ image: [path.join(dir, 'missing.png')], outdir: dir }), config), { code: 'INPUT_ERROR' });
});

test('bounded retries: auth failover shares attempts and 403 never rotates credentials', async t => {
  const dir = await temp(t), auth = [];
  const result = await generate(options({ outdir: dir }), config, { request: async (url, request) => {
    auth.push(request.headers.Authorization);
    return auth.length === 1 ? response(401, { error: { code: 'invalid_api_key' } }) : response();
  } });
  assert.equal(result.attempts.length, 2);
  assert.deepEqual(auth, ['Bearer fixture-key-a', 'Bearer fixture-key-b']);
  let count = 0;
  await assert.rejects(generate(options({ outdir: dir }), config, { request: async () => {
    count++; return response(403, { error: { message: 'forbidden' } });
  } }), { code: 'PROVIDER_ERROR' });
  assert.equal(count, 1);
});

test('429 respects Retry-After and total attempt/time caps', async t => {
  const dir = await temp(t); let calls = 0;
  await assert.rejects(generate(options({ outdir: dir, 'max-attempts': '2' }), config, { request: async () => {
    calls++; return response(429, {}, { 'retry-after': '0' });
  } }), { code: 'PROVIDER_ERROR' });
  assert.equal(calls, 2);
  calls = 0;
  await assert.rejects(generate(options({ outdir: dir, 'total-timeout': '1' }), config, { request: async () => {
    calls++; return response(429, {}, { 'retry-after': '60' });
  } }), { code: 'TOTAL_TIMEOUT' });
  assert.equal(calls, 1);
  assert.equal(retryDelay({ 'retry-after': new Date(60000).toUTCString() }, 1, 0), 60000);
});

test('ambiguous submission and 5xx do not resubmit by default; HTML/null rejected', async t => {
  const dir = await temp(t); let calls = 0;
  await assert.rejects(generate(options({ outdir: dir }), config, { request: async () => {
    calls++; throw Object.assign(new Error('socket reset'), { submitted: true });
  } }), { code: 'AMBIGUOUS_REQUEST', uncertain: true });
  assert.equal(calls, 1);
  calls = 0;
  await assert.rejects(generate(options({ outdir: dir }), config, { request: async () => {
    calls++; return response(502, {});
  } }), { code: 'AMBIGUOUS_REQUEST' });
  assert.equal(calls, 1);
  await assert.rejects(generate(options({ outdir: dir }), config, { request: async () => ({ status: 200, body: Buffer.from('<html>gateway</html>'), headers: {} }) }), { code: 'INVALID_RESPONSE' });
  await assert.rejects(generate(options({ outdir: dir }), config, { request: async () => response(200, null) }), { code: 'INVALID_RESPONSE' });
});

test('redaction removes keys, bearer headers and signed URLs from errors', () => {
  const result = safeError(new Error('fixture-key-a Bearer secret https://example.com/image?token=private sk-abcdefghijk'), config.keys);
  assert.ok(!result.message.includes('fixture-key-a'));
  assert.ok(!result.message.includes('private'));
  assert.ok(!result.message.includes('abcdefghijk'));
});

test('native transport sends literal bytes, handles chunking and enforces size/deadline', async t => {
  const seen = [];
  let afterSubmission;
  const server = http.createServer((req, res) => {
    const chunks = []; req.on('data', x => chunks.push(x));
    req.on('end', () => {
      seen.push(Buffer.concat(chunks).toString());
      if (req.url === '/cancel-after-send') { afterSubmission(); return; }
      if (req.url === '/wait') return setTimeout(() => res.end('late'), 60);
      res.setHeader('x-request-id', 'test-request-id'); res.write('abc'); res.end('def');
    });
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;
  const ok = await requestNode(base, { method: 'POST', body: Buffer.from('@literal'), env: {} });
  assert.equal(ok.body.toString(), 'abcdef'); assert.equal(seen[0], '@literal');
  assert.equal(ok.headers['x-request-id'], 'test-request-id');
  await assert.rejects(requestNode(base, { maxBytes: 3, env: {} }), { code: 'RESPONSE_TOO_LARGE' });
  // A very short deadline can expire during connection setup on a busy runner.
  await assert.rejects(requestNode(base + '/wait', { method: 'POST', body: Buffer.from('sent'), timeout: 15, env: {} }), { code: 'TIMEOUT' });
  // Test post-submission classification deterministically, after the server receives the body.
  const controller = new AbortController();
  afterSubmission = () => controller.abort();
  await assert.rejects(requestNode(base + '/cancel-after-send', { method: 'POST', body: Buffer.from('sent'),
    timeout: 5000, signal: controller.signal, env: {} }), error => error.code === 'TIMEOUT' && error.submitted);
});

test('curl transport separates headers/body and protects credentials from arguments', async t => {
  const server = http.createServer((req, res) => {
    req.resume(); req.on('end', () => { res.setHeader('x-request-id', 'curl-id'); res.end('a\n\nb'); });
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const result = await requestCurl(`http://127.0.0.1:${server.address().port}`, {
    method: 'POST', headers: { Authorization: 'Bearer fixture-key-a' }, body: Buffer.from('literal'), env: { ...process.env, NO_PROXY: '127.0.0.1' }, timeout: 3000 });
  assert.equal(result.status, 200); assert.equal(result.body.toString(), 'a\n\nb');
  assert.equal(result.headers['x-request-id'], 'curl-id');
});

test('proxy bypass works for exact, suffix, port and IPv6 host rules', () => {
  assert.equal(proxyFor(new URL('https://api.example.com'), { HTTPS_PROXY: 'http://proxy:8080', NO_PROXY: '.example.com' }), null);
  assert.equal(proxyFor(new URL('https://localhost:443'), { HTTPS_PROXY: 'http://proxy:8080', NO_PROXY: 'localhost:443' }), null);
  assert.equal(proxyFor(new URL('http://[::1]:8080'), { HTTP_PROXY: 'http://proxy:8080', NO_PROXY: '[::1]:8080' }), null);
  assert.throws(() => proxyFor(new URL('https://example.com'), { HTTPS_PROXY: 'socks5://proxy:1080' }), { code: 'CONFIG_ERROR' });
});

test('generic provider configuration normalizes URLs and isolates legacy credentials', async t => {
  const root = await temp(t);
  await fs.writeFile(path.join(root, '.env'), 'FANGXIN_API_KEY=old-service-key\nFANGXIN_MODEL=gpt-image-1\n');
  const changed = await loadConfig({ IMAGE_API_BASE_URL:'https://api.ttapi.io/v1/images/generations' },root);
  assert.equal(changed.apiBaseUrl,'https://api.ttapi.io/v1');
  assert.equal(changed.authType,'api-key');
  assert.equal(changed.apiKeyHeader,'TT-API-KEY');
  assert.equal(changed.model,'gpt-image-2.5-flare');
  assert.deepEqual(changed.keys,[]);
  const generic = await loadConfig({ IMAGE_API_BASE_URL:'https://example.com/custom/v1/',
    IMAGE_API_KEY:'new-service-key', IMAGE_API_KEY10:'ten', IMAGE_API_KEY2:'two' },root);
  assert.deepEqual(generic.keys,['new-service-key','two','ten']);
  assert.equal(generic.authType,'bearer');
  assert.equal(generic.imageField,'image[]');
  assert.equal(generic.editFormat,'multipart');
  assert.equal(normalizeBaseUrl('https://api.ttapi.io'),'https://api.ttapi.io/v1');
  assert.equal(normalizeBaseUrl('https://example.com/custom/images/edits/'),'https://example.com/custom');
  for (const url of ['http://example.com/v1','https://user:pass@example.com/v1','https://example.com/v1?key=private','https://example.com/v1#key','not a URL']) {
    assert.throws(()=>normalizeBaseUrl(url),{code:'CONFIG_ERROR'});
  }
  assert.throws(()=>providerSettings({IMAGE_API_AUTH_TYPE:'guess'}),{code:'CONFIG_ERROR'});
  assert.throws(()=>providerSettings({IMAGE_API_KEY_HEADER:'Host'}),{code:'CONFIG_ERROR'});
  assert.throws(()=>providerSettings({IMAGE_API_KEY_HEADER:'X-Key\r\nBad: 1'}),{code:'CONFIG_ERROR'});
});

test('TTAPI routes through configured URL and header without leaking keys to returned image URLs',async t => {
  const dir=await temp(t);
  const loaded=await loadConfig({IMAGE_API_BASE_URL:'https://api.ttapi.io/v1/images/generations',IMAGE_API_KEY:'test-ttapi-only'},dir);
  let calls=0;
  const result=await generate(options({outdir:dir}),loaded,{request:async(url,request)=>{
    calls++;
    if (calls===1) {
      assert.equal(url,'https://api.ttapi.io/v1/images/generations');
      assert.equal(request.headers['TT-API-KEY'],'test-ttapi-only');
      assert.equal(request.headers.Authorization,undefined);
      assert.equal(JSON.parse(request.body).model,'gpt-image-2.5-flare');
      return response(200,{data:[{url:'https://cdn.example.com/image.png?token=private'}]});
    }
    assert.equal(url,'https://cdn.example.com/image.png?token=private');
    assert.equal(request.headers,undefined);
    return {status:200,headers:{},body:png()};
  }});
  assert.equal(calls,2);
  assert.equal(result.provider,'ttapi');
  const text=await fs.readFile(result.manifest,'utf8');
  assert.ok(!text.includes('test-ttapi-only'));
  assert.ok(!text.includes('token=private'));
});

test('editing follows JSON references for TTAPI and multipart image[] for other compatible services',async t => {
  const dir=await temp(t),file=path.join(dir,'input.png'),mask=path.join(dir,'mask.png');
  await fs.writeFile(file,png()); await fs.writeFile(mask,png(true));
  const tt=await loadConfig({IMAGE_API_BASE_URL:'https://api.ttapi.io/v1',IMAGE_API_KEY:'fixture-tt'},dir);
  await generate(options({outdir:dir,image:[file],mask}),tt,{request:async(url,request)=>{
    assert.equal(url,'https://api.ttapi.io/v1/images/edits');
    assert.equal(request.headers['Content-Type'],'application/json');
    const body=JSON.parse(request.body);
    assert.ok(body.images[0].image_url.startsWith('data:image/png;base64,'));
    assert.equal(inspectImage(Buffer.from(body.mask.image_url.split(',')[1],'base64')).hasTransparency,true);
    return response();
  }});
  const generic=await loadConfig({IMAGE_API_BASE_URL:'https://example.com/v1',IMAGE_API_KEY:'fixture-custom'},dir);
  await generate(options({outdir:dir,image:[file]}),generic,{request:async(url,request)=>{
    assert.equal(url,'https://example.com/v1/images/edits');
    assert.equal(request.headers.Authorization,'Bearer fixture-custom');
    assert.ok(request.headers['Content-Type'].startsWith('multipart/form-data; boundary='));
    assert.ok(request.body.toString().includes('name="image[]"'));
    return response();
  }});
});

test('named providers pair only their own keys, endpoint, auth and model across switches', async t => {
  const dir = await temp(t);
  await fs.writeFile(path.join(dir, '.env'), [
    'IMAGE_API_PROVIDER=fangxin', 'FANGXIN_API_KEY=fixture-fangxin', 'TT_API_KEY=fixture-tt',
    'TT_API_KEY10=tt-ten', 'TT_API_KEY2=tt-two', 'TT_API_MODEL=gpt-image-2',
    // Stale custom settings must not affect a named profile.
    'IMAGE_API_BASE_URL=https://wrong.example/v1', 'IMAGE_API_KEY=fixture-other',
    'IMAGE_API_AUTH_TYPE=api-key', 'IMAGE_API_KEY_HEADER=X-Wrong', 'IMAGE_API_EDIT_FORMAT=multipart',
  ].join('\n'));
  const fangxin = await loadConfig({}, dir), tt = await loadConfig({}, dir, 'ttapi');
  assert.deepEqual(fangxin.keys, ['fixture-fangxin']);
  assert.equal(fangxin.authType, 'bearer');
  assert.equal(keySetup(fangxin).variable, 'FANGXIN_API_KEY');
  assert.deepEqual(tt.keys, ['fixture-tt', 'tt-two', 'tt-ten']);
  assert.equal(tt.editFormat, 'json');
  assert.equal(tt.model, 'gpt-image-2');
  assert.equal(keySetup(tt).variable, 'TT_API_KEY');
  for (const [selected, url, header, value] of [
    [fangxin, 'https://fangxinapi.com/v1/images/generations', 'Authorization', 'Bearer fixture-fangxin'],
    [tt, 'https://api.ttapi.io/v1/images/generations', 'TT-API-KEY', 'fixture-tt'],
  ]) {
    await generate(normalizeOptions({prompt:'fixture', outdir:dir}, selected), selected, {request:async (actualUrl, request) => {
      assert.equal(actualUrl, url);
      assert.equal(request.headers[header], value);
      assert.equal(request.headers['X-Wrong'], undefined);
      assert.equal(request.headers[header === 'Authorization' ? 'TT-API-KEY' : 'Authorization'], undefined);
      return response();
    }});
  }
  assert.equal((await loadConfig({}, dir)).provider, 'fangxin'); // One-call override is not persistent.
});

test('missing named key stops without falling back to another or generic provider key', async t => {
  const dir = await temp(t);
  const selected = await loadConfig({IMAGE_API_PROVIDER:'ttapi', FANGXIN_API_KEY:'fixture-fangxin', IMAGE_API_KEY:'fixture-other'}, dir);
  assert.deepEqual(selected.keys, []);
  assert.throws(() => requireKeys(selected), error => error.code === 'CONFIG_ERROR' && error.message.includes('TT_API_KEY'));
  let requests = 0;
  await assert.rejects(generate(options({outdir:dir}), selected, {request:async () => { requests++; return response(); }}), {code:'CONFIG_ERROR'});
  assert.equal(requests, 0);
  await assert.rejects(loadConfig({IMAGE_API_PROVIDER:'ttapi', TT_API_BASE_URL:'https://fangxinapi.com/v1', TT_API_KEY:'fixture-tt'}, dir), {code:'CONFIG_ERROR'});
  await assert.rejects(loadConfig({IMAGE_API_PROVIDER:'custom', TT_API_KEY:'fixture-tt'}, dir), {code:'CONFIG_ERROR'});
});

test('provider selection detects one named key, rejects ambiguity, and preserves generic compatibility', async t => {
  const dir = await temp(t);
  const tt = await loadConfig({TT_API_KEY:'fixture-tt'}, dir);
  assert.equal(tt.provider, 'ttapi');
  assert.deepEqual(tt.keys, ['fixture-tt']);
  await assert.rejects(loadConfig({TT_API_KEY:'fixture-tt', FANGXIN_API_KEY:'fixture-fangxin'}, dir), {code:'CONFIG_ERROR'});
  const official = await loadConfig({IMAGE_API_PROVIDER:'openai', OPENAI_API_KEY:'fixture-official'}, dir);
  assert.equal(official.apiBaseUrl, 'https://api.openai.com/v1');
  assert.deepEqual(official.keys, ['fixture-official']);
  const urlSelected = await loadConfig({IMAGE_API_BASE_URL:'https://api.ttapi.io/v1', TT_API_KEY:'fixture-tt', FANGXIN_API_KEY:'fixture-fangxin'}, dir);
  assert.deepEqual(urlSelected.keys, ['fixture-tt']);
  const custom = await loadConfig({IMAGE_API_PROVIDER:'custom', IMAGE_API_BASE_URL:'https://example.com/v1', IMAGE_API_KEY:'fixture-custom', TT_API_KEY:'fixture-tt'}, dir);
  assert.deepEqual(custom.keys, ['fixture-custom']);
  assert.equal(custom.provider, 'openai-compatible');
});
