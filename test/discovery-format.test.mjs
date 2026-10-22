import {test} from 'node:test';import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,rmSync} from 'node:fs';import {tmpdir} from 'node:os';import {join} from 'node:path';
import {claudeCatalogue,claudeModelRows,discoverClaude} from '../src/model-discovery.mjs';
import {runClaude,validate,createBridge} from '../src/server.mjs';
function fixture(t){
 const dir=mkdtempSync(join(tmpdir(),'openbridge-fixture-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));
 const binary=join(dir,'claude');writeFileSync(binary,`#!/usr/bin/env node
const args=process.argv;const emit=x=>console.log(JSON.stringify(x));
if(args.includes('--input-format')){
 process.stdin.on('data',data=>{const request=JSON.parse(data);emit({type:'control_response',response:{request_id:request.request_id,response:{models:[{value:'haiku',resolvedModel:'claude-haiku-4-5',displayName:'Haiku 4.5'}]}}});});
}else{
 process.stdin.resume();process.stdin.on('end',()=>{
 const model=args[args.indexOf('--model')+1];emit({type:'system',subtype:'init',model:'actual-model'});
 emit({type:'stream_event',event:{delta:{type:'text_delta',text:'unstructured preamble'}}});
 if(model==='schema'&&!args.includes('--json-schema'))process.exit(2);
 emit({type:'result',is_error:false,result:model==='invalid'?'not JSON':'{"ok":true}',...(model==='schema'?{structured_output:{ok:true}}:{})});
 });}
`,{mode:0o700});return binary;
}
test('Claude discovery uses initialization only, exposes aliases and public version IDs',async t=>{
 const binary=fixture(t);const native=await claudeCatalogue(binary,AbortSignal.timeout(5000));
 assert.equal(claudeModelRows(native).find(m=>m.id==='haiku').resolvedModel,'claude-haiku-4-5');
 const models=await discoverClaude({cliPath:binary},AbortSignal.timeout(5000),async()=>new Response(JSON.stringify({anthropic:{models:{'claude-haiku-5-5':{name:'Claude Haiku 5.5'}}}})));
 assert.equal(models.find(m=>m.id==='claude-haiku-5-5').source,'models.dev · public catalogue');
 assert.equal(models.find(m=>m.id==='claude-haiku-4-5').source,'Claude CLI');
});
test('Claude JSON schema/object output suppresses unstructured deltas and reports actual model',async t=>{
 const binary=fixture(t);
 for(const type of ['json_schema','json_object']){
  const chunks=[];let served;
  const result=await runClaude([{role:'user',content:'JSON please'}],AbortSignal.timeout(5000),x=>chunks.push(x),type==='json_schema'?'schema':'object',binary,{response_format:{type,json_schema:{schema:{type:'object'}}}},x=>served=x);
  assert.deepEqual(JSON.parse(result),{ok:true});assert.deepEqual(chunks,[result]);assert.equal(served,'actual-model');
 }
 await assert.rejects(runClaude([{role:'user',content:'JSON please'}],AbortSignal.timeout(5000),()=>{},'invalid',binary,{response_format:{type:'json_object'}}),/valid structured output/);
 assert.throws(()=>validate({model:'x',messages:[{role:'user',content:'x'}],response_format:{type:'json_schema'}}),/JSON Schema/);
});
test('Claude HTTP route accepts response_format and forwards structured output options',async t=>{
 let options;const server=createBridge({key:'test',runner:async(messages,signal,emit,id,settings)=>{options=settings.options;settings.onModel('actual-haiku');emit('{"ok":true}');return '{"ok":true}';}});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>server.close());const base=`http://127.0.0.1:${server.address().port}`;const headers={Authorization:'Bearer test','Content-Type':'application/json'};
 const response=await fetch(base+'/v1/chat/completions',{method:'POST',headers,body:JSON.stringify({model:'claude/haiku',messages:[{role:'user',content:[{type:'text',text:'JSON please'}]}],response_format:{type:'json_object'}})});
 assert.equal(response.status,200);assert.deepEqual(JSON.parse((await response.json()).choices[0].message.content),{ok:true});assert.equal(options.response_format.type,'json_object');
 const status=await(await fetch(base+'/bridge/status',{headers})).json();assert.equal(status.checks['claude/haiku'].resolvedModel,'actual-haiku');
});
