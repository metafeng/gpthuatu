import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import codecs from '../vendor/image-codecs.cjs';
import { loadConfig } from '../src/config.mjs';
import { normalizeOptions } from '../src/options.mjs';
import { generate } from '../src/generate.mjs';
import { safeError } from '../src/errors.mjs';

const env = { IMAGE_API_PROVIDER:'fangxin', FANGXIN_API_KEY:'fixture-fangxin', TT_API_KEY:'fixture-tt' };
function png() {
  const image = new codecs.PNG({width:4,height:4}); image.data.fill(255);
  return codecs.PNG.sync.write(image);
}
const reply = (status=200, body={data:[{b64_json:png().toString('base64')}]}, headers={}) =>
  ({status, body:Buffer.from(JSON.stringify(body)), headers});
async function setup(t, values={}, flags={}) {
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'gpthuatu-fallback-'));
  t.after(()=>fs.rm(root,{recursive:true,force:true}));
  const config=await loadConfig({...env,...values},root);
  return {root,config,options:normalizeOptions({prompt:'fixture scene',outdir:root,...flags},config)};
}

test('both directions fall back after persistent throttling with one global three-request budget', async t => {
  for (const primary of ['fangxin','ttapi']) {
    const {root,config,options}=await setup(t,{IMAGE_API_PROVIDER:primary});
    const backup=primary==='fangxin'?'ttapi':'fangxin';
    let calls=0;
    const result=await generate(options,config,{request:async(url,request)=>{
      const provider=url.includes('fangxinapi.com')?'fangxin':'ttapi';
      assert.equal(provider,calls<2?primary:backup);
      assert.equal(JSON.parse(request.body).model,options.model);
      assert.equal(request.headers[provider==='fangxin'?'Authorization':'TT-API-KEY'],
        provider==='fangxin'?'Bearer fixture-fangxin':'fixture-tt');
      assert.equal(request.headers[provider==='fangxin'?'TT-API-KEY':'Authorization'],undefined);
      return ++calls<=2?reply(429,{error:{code:'rate_limit'}},{'retry-after':'0'}):reply();
    }});
    assert.equal(calls,3);
    assert.equal(result.initialProvider,primary);assert.equal(result.provider,backup);
    assert.deepEqual(result.attempts.map(x=>[x.attempt,x.provider]),[[1,primary],[2,primary],[3,backup]]);
    assert.equal(result.failover.from,primary); assert.equal(result.failover.to,backup);
    assert.equal(result.model,options.model);
    const saved=await fs.readFile(result.manifest,'utf8');
    assert.ok(!saved.includes('fixture-fangxin')&&!saved.includes('fixture-tt'));
    assert.equal(JSON.parse(saved).provider,backup);
    assert.equal((await loadConfig({...env,IMAGE_API_PROVIDER:primary},root)).provider,primary);
  }
});

test('healthy primary never sends a request to backup', async t => {
  const {config,options}=await setup(t);let calls=0;
  const result=await generate(options,config,{request:async url=>{calls++;assert.ok(url.includes('fangxinapi.com'));return reply();}});
  assert.equal(calls,1);assert.equal(result.provider,'fangxin');assert.equal(result.failover,undefined);
});

test('both providers failing stops after one switch and exposes the actual final provider', async t => {
  const {config,options}=await setup(t);const hosts=[];
  await assert.rejects(generate(options,config,{request:async url=>{
    hosts.push(new URL(url).hostname);return reply(429,{}, {'retry-after':'0'});
  }}),error=>{
    const result=safeError(error,[...config.keys,...config.fallback.keys]);
    assert.equal(result.attempts,3);assert.equal(result.provider,'ttapi');assert.equal(result.initialProvider,'fangxin');
    assert.equal(result.failover.to,'ttapi');assert.equal(result.attemptLog.length,3);return true;
  });
  assert.deepEqual(hosts,['fangxinapi.com','fangxinapi.com','api.ttapi.io']);
});

test('account rejection or explicit failed-task response can switch immediately', async t => {
  for(const [status,body] of [[401,{}],[402,{}],[404,{}],[477,{error:{code:'upstream_task_failed',message:'Task failed'}}]]) {
    const {config,options}=await setup(t);let calls=0;
    const result=await generate(options,config,{request:async()=>++calls===1?reply(status,body):reply()});
    assert.equal(calls,2);assert.equal(result.provider,'ttapi');
  }
});

test('policy, invalid inputs, uncertain submissions and invalid paid output never trigger fallback', async t => {
  const failures=[
    ()=>reply(403,{}),()=>reply(400,{}),
    ()=>reply(477,{error:{message:'上游图片任务失败或需要审核'}}),
    ()=>reply(429,{error:{code:'content_policy_violation'}}),
    ()=>reply(502,{}),
    ()=>{throw Object.assign(new Error('after submission'),{submitted:true});},
    ()=>reply(200,{data:[]}),
    ()=>reply(200,{data:[{b64_json:'bad image'}]}),
  ];
  for(const failure of failures) {
    const {config,options}=await setup(t);let calls=0;
    await assert.rejects(generate(options,config,{request:async url=>{
      calls++;assert.ok(url.includes('fangxinapi.com'));return failure();
    }}));
    assert.equal(calls,1);
  }
});

test('pre-submission network failure can switch, unknown submission state cannot', async t => {
  for(const submitted of [false,undefined]) {
    const {config,options}=await setup(t,{}, {'max-attempts':'2'});let calls=0;
    const task=generate(options,config,{request:async()=>{
      if(++calls===1) throw Object.assign(new Error('connect failed'),{code:'NETWORK_ERROR',submitted});
      return reply();
    }});
    if(submitted===false) {assert.equal((await task).provider,'ttapi');assert.equal(calls,2);}
    else {await assert.rejects(task);assert.equal(calls,1);}
  }
});

test('long Retry-After does not delay a different provider or repeat the throttled one', async t => {
  const {config,options}=await setup(t);let calls=0;
  const result=await generate(options,config,{request:async()=>++calls===1?reply(429,{}, {'retry-after':'3600'}):reply()});
  assert.equal(result.provider,'ttapi');assert.equal(calls,2);
});

test('disabled, missing backup and one-attempt requests remain on the primary', async t => {
  for(const [values,flags,expected] of [
    [{IMAGE_API_FALLBACK:'off'},{},3],[{TT_API_KEY:''},{},3],
    [{},{'no-fallback':true},3],[{},{'max-attempts':'1'},1],
  ]) {
    const {config,options}=await setup(t,values,flags);let calls=0;
    await assert.rejects(generate(options,config,{request:async url=>{
      calls++;assert.ok(url.includes('fangxinapi.com'));return reply(429,{}, {'retry-after':'0'});
    }}));assert.equal(calls,expected);
  }
});

test('editing rebuilds the provider-specific upload while keeping identical requested fields', async t => {
  for(const primary of ['fangxin','ttapi']) {
    const {root,config}=await setup(t,{IMAGE_API_PROVIDER:primary,TT_API_MODEL:'gpt-image-2'});
    const file=path.join(root,'reference.png');await fs.writeFile(file,png());
    const options=normalizeOptions({prompt:'keep scene',image:[file],outdir:root},config);let calls=0;
    const result=await generate(options,config,{request:async(url,request)=>{
      assert.ok(url.endsWith('/images/edits'));
      if(url.includes('fangxinapi.com')) {
        assert.ok(request.headers['Content-Type'].startsWith('multipart/form-data'));
        assert.ok(request.body.toString().includes('name="image"'));
        assert.ok(request.body.toString().includes(options.model));
      } else {
        assert.equal(request.headers['Content-Type'],'application/json');
        const body=JSON.parse(request.body);assert.equal(body.model,options.model);
        assert.ok(body.images[0].image_url.startsWith('data:image/png;base64,'));
      }
      return ++calls===1?reply(401,{}):reply();
    }});
    assert.equal(calls,2);assert.equal(result.model,options.model);
  }
});

test('cancellation and elapsed total deadline do not start backup requests', async t => {
  for(const cancelled of [true,false]) {
    const {config,options}=await setup(t);const controller=new AbortController();let calls=0;
    if(!cancelled) options.totalTimeout=1000;
    await assert.rejects(generate(options,config,{signal:controller.signal,request:async()=>{
      calls++;
      if(cancelled) controller.abort();else await new Promise(resolve=>setTimeout(resolve,1100));
      return reply(401,{});
    }}));
    assert.equal(calls,1);
  }
});

test('fallback configuration is mutual, opt-out, and limited to the two named providers', async t => {
  const {root,config}=await setup(t);
  assert.equal(config.fallback.provider,'ttapi');
  assert.equal((await loadConfig(env,root,'ttapi')).fallback.provider,'fangxin');
  assert.equal((await loadConfig({...env,IMAGE_API_FALLBACK:'off'},root)).fallback,undefined);
  assert.equal((await loadConfig({...env,IMAGE_API_PROVIDER:'openai',OPENAI_API_KEY:'fixture-official'},root)).fallback,undefined);
  assert.equal((await loadConfig({...env,IMAGE_API_PROVIDER:'custom',IMAGE_API_BASE_URL:'https://fangxinapi.com/v1',IMAGE_API_KEY:'fixture-custom'},root)).fallback,undefined);
});

test('an earlier ambiguous attempt prevents cross-provider replay even when a later retry is rejected', async t => {
  const {config,options}=await setup(t,{}, {'retry-uncertain':true});let calls=0;
  await assert.rejects(generate(options,config,{request:async url=>{
    calls++;assert.ok(url.includes('fangxinapi.com'));
    return calls===1?reply(502,{}, {'retry-after':'0'}):reply(429,{}, {'retry-after':'0'});
  }}),error=>error.uncertain===true && error.provider==='fangxin');
  assert.equal(calls,2);
});

test('invalid backup configuration does not block a healthy primary and produces a clear warning', async t => {
  const {config,options}=await setup(t,{TT_API_BASE_URL:'https://wrong.example/v1'});
  assert.equal(config.fallback,undefined);assert.ok(config.fallbackWarning.includes('TT_API_'));
  let calls=0;
  const result=await generate(options,config,{request:async url=>{
    calls++;assert.ok(url.includes('fangxinapi.com'));return reply();
  }});
  assert.equal(calls,1);assert.equal(result.warnings.length,1);
});
