import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { once } from 'node:events';
import { createFullApp } from './full-app.js';
import type { RuntimeConfig } from './config.js';

function closeServer(server:ReturnType<typeof createServer>):Promise<void>{if(!server.listening)return Promise.resolve();return new Promise((resolve,reject)=>server.close(error=>error?reject(error):resolve()));}
let processCalls=0;
const processServer=createServer(async(req,res)=>{if(req.method!=='POST'||req.url!=='/process'){res.writeHead(404).end();return;}assert.equal(req.headers.authorization,'Bearer process-test-token');processCalls+=1;res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify({result:{schema_version:'astera-result-v1',runtime_version:'smoke-runtime',purpose_version:'purpose-v1',completion_state:'complete',sections:{true_purpose:{body:'目的'},missing_assumptions:{body:'前提'},fact_check:{body:'事実'},risk_detection:{body:'リスク'},counter_view:{body:'反対'},alternatives:{body:'比較'},recommendation:{body:'推奨'},next_prompt:{body:'再指示'}},sources:[]},resourceUsage:{inputUnits:10,outputUnits:20,durationMs:3}}));});
processServer.listen(0,'127.0.0.1');await once(processServer,'listening');const processPort=(processServer.address() as AddressInfo).port;
let vaultCalls=0;
const vaultServer=createServer(async(req,res)=>{assert.equal(req.headers.authorization,'Bearer vault-test-token');if(req.method==='GET'&&req.url==='/internal/v1/health'){vaultCalls+=1;res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify({status:'ok'}));return;}const chunks:Buffer[]=[];for await(const chunk of req)chunks.push(Buffer.isBuffer(chunk)?chunk:Buffer.from(chunk));const body=JSON.parse(Buffer.concat(chunks).toString('utf8')) as Record<string,unknown>;if(req.method==='POST'&&req.url==='/internal/v1/crypto/seal'){vaultCalls+=1;res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify({ciphertext:String(body.plaintext_base64||''),iv:'smoke-iv'}));return;}res.writeHead(404,{'content-type':'application/json'});res.end(JSON.stringify({error:{code:'SMOKE_VAULT_ROUTE_NOT_FOUND'}}));});
vaultServer.listen(0,'127.0.0.1');await once(vaultServer,'listening');const vaultPort=(vaultServer.address() as AddressInfo).port;
const config:RuntimeConfig={port:0,internalServiceToken:'internal-test-token',processOrigin:`http://127.0.0.1:${processPort}`,processToken:'process-test-token',processTimeoutMs:5000,shutdownTimeoutMs:5000,vaultOrigin:`http://127.0.0.1:${vaultPort}`,vaultServiceToken:'vault-test-token',vaultJobKeyRef:'smoke-job-key',vaultTimeoutMs:5000,translationModelId:'',translationGeminiKeyRef:'',translationTimeoutMs:5000,tgserverStorageOrigin:'',tgserverStorageToken:'',tgserverStorageTimeoutMs:600000,webhookGatewayOrigin:'',webhookGatewayToken:'',webhookGatewayTimeoutMs:15000};
const{app,service}=createFullApp(config);
const auth={Authorization:'Bearer internal-test-token','Content-Type':'application/json'};
async function waitJob(id:string){for(let i=0;i<100;i++){const r=await app.request(`/internal/v1/jobs/${id}`,{headers:{Authorization:'Bearer internal-test-token'}});assert.equal(r.status,200);const p=await r.json() as{job:Record<string,unknown>};if(p.job.state==='completed')return p.job;await new Promise(resolve=>setTimeout(resolve,25));}throw new Error('Runtime Job did not complete');}
try{
 assert.equal((await app.request('/internal/v1/jobs/missing')).status,401);
 assert.equal((await app.request('/ready')).status,200);
 const jobId=crypto.randomUUID(),requestId=crypto.randomUUID();const body={job_id:jobId,tenant_id:'tenant-smoke',user_id:'user-smoke',request_id:requestId,prompt:'Smoke Test',purpose:'verify',options:[],files:[],private_mode:false,project_id:null,reserved_credits:10,policy_version:'smoke-policy',correlation_id:crypto.randomUUID()};
 const created=await app.request('/internal/v1/jobs',{method:'POST',headers:auth,body:JSON.stringify(body)});assert.equal(created.status,201);const complete=await waitJob(jobId);assert.ok(complete.result);assert.equal(processCalls,1);
 const duplicate=await app.request('/internal/v1/jobs',{method:'POST',headers:auth,body:JSON.stringify(body)});assert.equal(duplicate.status,200);const dup=await duplicate.json() as{created:boolean};assert.equal(dup.created,false);assert.equal(processCalls,1);
 const privateId=crypto.randomUUID(),privateBody={...body,job_id:privateId,request_id:crypto.randomUUID(),prompt:'PRIVATE_SMOKE_CANARY_DO_NOT_PERSIST',private_mode:true,correlation_id:crypto.randomUUID()};const pc=await app.request('/internal/v1/jobs',{method:'POST',headers:auth,body:JSON.stringify(privateBody)});assert.equal(pc.status,201);const privateResult=await waitJob(privateId);assert.ok(privateResult.result);const privateRow=await service.database.get(privateId);assert.equal(privateRow?.result_json,null);assert.equal(privateRow?.request_ciphertext,null);assert.equal(privateRow?.request_iv,null);assert.equal(processCalls,2);
 const lost=await service.database.get('restart-loss-canary');assert.equal(lost?.state,'failed');assert.equal(lost?.error_code,'RUNTIME_STATE_LOST_AFTER_RESTART');
 assert.ok(vaultCalls>=2);
 console.log(JSON.stringify({event:'contabo_runtime_smoke_passed',process_calls:processCalls,private_result_persisted:false,postgres_required:false,restart_loss_fail_closed:true,webhook_gateway_optional:true}));
}finally{for(const controller of service.active.values())controller.abort('smoke_shutdown');await service.database.close();await Promise.all([closeServer(processServer),closeServer(vaultServer)]);}
