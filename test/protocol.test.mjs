import {test} from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {createBridge} from '../src/server.mjs';
import {defaultConfig} from '../src/config.mjs';

const listen=server=>new Promise(resolve=>server.listen(0,'127.0.0.1',()=>resolve(`http://127.0.0.1:${server.address().port}`)));
test('native API preserves content arrays, generation options, tool cycles and fragmented streaming',async t=>{
 const received=[];
 const tool={id:'call_1',type:'function',function:{name:'weather',arguments:'{"city":"Amsterdam"}'}};
 const upstream=http.createServer(async(req,res)=>{
  let raw='';for await(const bytes of req)raw+=bytes;
  const body=JSON.parse(raw);received.push(body);
  if(body.messages[0].content==='truncated'){res.writeHead(200,{'Content-Type':'text/event-stream'});res.end('data: {"choices":[]}\n\n');return;}
  if(body.stream){
   res.writeHead(200,{'Content-Type':'text/event-stream'});
   const frames=[{choices:[{index:0,delta:{tool_calls:[{index:0,...tool,function:{name:'weather',arguments:'{"city":'}}]},finish_reason:null}]},{choices:[{index:0,delta:{tool_calls:[{index:0,function:{arguments:'"Amsterdam"}'}}]},finish_reason:'tool_calls'}]},{choices:[],usage:{completion_tokens:12}}];
   const data=frames.map(f=>'data: '+JSON.stringify(f)+'\r\n\r\n').join('')+'data: [DONE]\n\n';
   for(let i=0;i<data.length;i+=7)res.write(data.slice(i,i+7));res.end();
  }else{
   res.setHeader('Content-Type','application/json');
   res.end(JSON.stringify({model:'upstream',choices:[{message:body.messages.at(-1).role==='tool'?{role:'assistant',content:'Sunny'}:{role:'assistant',content:null,tool_calls:[tool]},finish_reason:body.messages.at(-1).role==='tool'?'stop':'tool_calls'}],usage:{completion_tokens:12}}));
  }
 });
 const upstreamURL=await listen(upstream);t.after(()=>upstream.close());
 const config=defaultConfig();config.providers.push({id:'fixture',name:'Fixture',type:'openai',enabled:true,cliPath:'',baseURL:upstreamURL,models:[{id:'fixture/model',name:'Fixture',upstreamModel:'upstream',enabled:true}]});
 const bridge=createBridge({key:'test',config});const base=await listen(bridge);t.after(()=>bridge.close());
 const post=body=>fetch(base+'/v1/chat/completions',{method:'POST',headers:{Authorization:'Bearer test','Content-Type':'application/json'},body:JSON.stringify(body)});
 const body={model:'fixture/model',messages:[{role:'user',content:[{type:'text',text:'Weather?'}]}],max_tokens:128,temperature:0,response_format:{type:'json_object'},tools:[{type:'function',function:{name:'weather',parameters:{type:'object',properties:{city:{type:'string'}}}}}],tool_choice:'auto'};
 const result=await(await post(body)).json();assert.deepEqual(result.choices[0].message.tool_calls,[tool]);assert.equal(result.model,'fixture/model');assert.equal(result.usage.completion_tokens,12);assert.deepEqual(received[0],{...body,model:'upstream'});
 const continuation={...body,messages:[...body.messages,result.choices[0].message,{role:'tool',tool_call_id:'call_1',content:'Sunny'}]};
 assert.equal((await(await post(continuation)).json()).choices[0].message.content,'Sunny');
 const stream=await(await post({...body,stream:true,stream_options:{include_usage:true}})).text();
 const frames=stream.split('\n').filter(l=>l.startsWith('data: ')&&!l.includes('[DONE]')).map(l=>JSON.parse(l.slice(6)));
 assert.equal(frames[0].choices[0].delta.tool_calls[0].function.name,'weather');assert.equal(frames[1].choices[0].finish_reason,'tool_calls');assert.equal(frames[2].usage.completion_tokens,12);assert.match(stream,/\[DONE\]/);
 const unsupported=await post({...body,model:'chatgpt/default'});assert.equal(unsupported.status,422);assert.match((await unsupported.json()).error.message,/CLI does not support these options/);
 const truncated=await(await post({...body,stream:true,messages:[{role:'user',content:'truncated'}]})).text();assert.match(truncated,/ended before/);assert.doesNotMatch(truncated,/data: \[DONE\]/);
 const status=await(await fetch(base+'/bridge/status',{headers:{Authorization:'Bearer test'}})).json();assert.equal(status.succeeded,3);assert.equal(status.failed,1);assert.equal(status.active,false);
});
