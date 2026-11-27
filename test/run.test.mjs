import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtempSync,mkdirSync,writeFileSync,readFileSync,rmSync,existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join,resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import Ajv from 'ajv';
import { initialize } from '../dist/engine/init.js';
import { trustRepository } from '../dist/engine/trust.js';
import { runCommand,showRun } from '../dist/cli/commands/run.js';
import { replayRun,comparable } from '../dist/cli/commands/replay.js';
const valid=new Ajv().compile(JSON.parse(readFileSync('schemas/envelope.schema.json','utf8')));
const usage={input:4,cached:0,output:2,reasoning:0,cost:0};
function fixture(t){
 const root=mkdtempSync(join(tmpdir(),'tuig-run-'));t.after(()=>rmSync(root,{recursive:true,force:true}));const old=process.env.XDG_CONFIG_HOME;process.env.XDG_CONFIG_HOME=join(root,'state');t.after(()=>{if(old===undefined)delete process.env.XDG_CONFIG_HOME;else process.env.XDG_CONFIG_HOME=old});
 const repo=join(root,'repo');mkdirSync(repo);
 const git=args=>{const r=spawnSync('git',['-c','core.hooksPath=/dev/null',...args],{cwd:repo,encoding:'utf8'});assert.equal(r.status,0,r.stderr);return r.stdout.trim()};git(['init']);
 writeFileSync(join(repo,'a.txt'),'broken');writeFileSync(join(repo,'.gitignore'),'checks.log\n');
 initialize(repo);
 const configPath=join(repo,'.tuig/config.json');const config=JSON.parse(readFileSync(configPath,'utf8'));config.models={...config.models,adapter:'replay',replayFile:'responses.jsonl'};
 const responses=[{message:null,toolCalls:[{id:'edit-1',name:'edit',arguments:{path:'a.txt',search:'broken',replace:'fixed'}}],usage,stopReason:'tool_calls'},{message:'finished',toolCalls:[],usage,stopReason:'stop'}];
 writeFileSync(join(repo,'responses.jsonl'),responses.map((response,step)=>JSON.stringify({schema_version:1,seq:step,timestamp:new Date().toISOString(),type:'model_response',data:{step,response}})).join('\n')+'\n');
 writeFileSync(configPath,JSON.stringify(config));
 const argv=[process.execPath,'-e','const f=require("fs");f.appendFileSync("checks.log","ran\\n");if(f.readFileSync("a.txt","utf8")!=="fixed")process.exit(1)'];
 writeFileSync(join(repo,'.tuig/checks.json'),JSON.stringify({schema_version:1,checks:[{name:'visible acceptance',argv,timeoutSec:5}]}));
 const task=join(repo,'.tuig/tasks/protocol-fixture');mkdirSync(task,{recursive:true});writeFileSync(join(task,'task.json'),JSON.stringify({id:'protocol-fixture',oracleReviewed:true}));writeFileSync(join(task,'instruction.md'),'Fix the known broken value.');
 git(['add','.']);git(['-c','user.name=Test','-c','user.email=test@example.invalid','-c','commit.gpgsign=false','commit','-m','fixture']);
 trustRepository(repo);
 return {root,repo,git,config,configPath};
}
test('fixture run produces branch/diff/events/summary; replay reconstructs event sequence without executing checks',async t=>{
 const f=fixture(t);const r=await runCommand({cwd:f.repo,platform:'linux',taskId:'protocol-fixture'});assert.ok(valid(r),JSON.stringify(valid.errors));assert.equal(r.status,'ok',JSON.stringify(r));assert.equal(r.data.state,'SUCCEEDED');assert.match(f.git(['branch','--show-current']),/^tuig\/run-/);
 const directory=join(f.repo,'.tuig/runs',r.data.id);for(const file of ['events.jsonl','summary.json','diff.patch'])assert.ok(existsSync(join(directory,file)));
 const shown=showRun(r.data.id,f.repo);assert.equal(shown.status,'ok');assert.match(shown.data.diff,/-broken/);assert.match(shown.data.diff,/\+fixed/);assert.equal(shown.data.summary.id,r.data.id);
 const before=readFileSync(join(f.repo,'checks.log'),'utf8');const replay=await replayRun(r.data.id,f.repo);assert.equal(replay.status,'ok',JSON.stringify(replay));assert.equal(replay.data.verified,true);assert.deepEqual(comparable(replay.data.events),comparable(shown.data.events));assert.equal(readFileSync(join(f.repo,'checks.log'),'utf8'),before);assert.equal(readFileSync(join(f.repo,'a.txt'),'utf8'),'fixed');
 const entry=resolve('dist/main.js');for(const args of [['runs','show',r.data.id],['runs','replay',r.data.id,'--adapter','replay']]){const c=spawnSync(process.execPath,[entry,...args],{cwd:f.repo,env:{...process.env,TUIG_OUTPUT:'json'},encoding:'utf8'});assert.equal(c.status,0,c.stdout+c.stderr);assert.ok(valid(JSON.parse(c.stdout)))}
});
test('instruction mode runs; untrusted, dirty, unsupported platform and unreviewed tasks refuse safely',async t=>{
 let f=fixture(t);const r=await runCommand({cwd:f.repo,platform:'linux',instruction:'fix it'});assert.equal(r.status,'ok');
 f=fixture(t);const head=f.git(['branch','--show-current']);writeFileSync(join(f.repo,'dirty.txt'),'uncommitted');assert.equal((await runCommand({cwd:f.repo,platform:'linux',instruction:'fix it'})).error.code,'TUIG_E_DIRTY');assert.equal(f.git(['branch','--show-current']),head);
 rmSync(join(f.repo,'dirty.txt'));assert.equal((await runCommand({cwd:f.repo,platform:'win32',instruction:'fix it'})).error.code,'TUIG_E_PREREQUISITE');
 writeFileSync(join(f.repo,'.tuig/tasks/protocol-fixture/task.json'),JSON.stringify({id:'protocol-fixture',oracleReviewed:false}));assert.equal((await runCommand({cwd:f.repo,platform:'linux',taskId:'protocol-fixture'})).error.code,'TUIG_E_ORACLE_REVIEW');
 rmSync(join(process.env.XDG_CONFIG_HOME,'tuig/trusted.json'));writeFileSync(join(f.repo,'.tuig/checks.json'),'do not parse');assert.equal((await runCommand({cwd:f.repo,platform:'linux',instruction:'fix it'})).error.code,'TUIG_E_UNTRUSTED');
});
test('missing and traversal run IDs fail without creating storage; corrupted journals cannot replay',async t=>{
 const f=fixture(t);assert.equal(showRun('../escape',f.repo).status,'error');assert.equal(showRun('missing',f.repo).status,'error');assert.equal(existsSync(join(f.repo,'.tuig/runs/missing')),false);
 const r=await runCommand({cwd:f.repo,platform:'linux',instruction:'fix it'});const path=join(f.repo,'.tuig/runs',r.data.id,'events.jsonl');writeFileSync(path,readFileSync(path,'utf8')+'{"partial"');assert.equal((await replayRun(r.data.id,f.repo)).error.code,'TUIG_E_REPLAY');
});
test('actual run command on supported CI platforms uses initialized trusted fixture',async t=>{
 const f=fixture(t);const r=spawnSync(process.execPath,[resolve('dist/main.js'),'run','protocol-fixture'],{cwd:f.repo,env:{...process.env,TUIG_OUTPUT:'json'},encoding:'utf8'});const value=JSON.parse(r.stdout);assert.ok(valid(value));if(process.platform==='win32'){assert.equal(value.error.code,'TUIG_E_PREREQUISITE')}else{assert.equal(r.status,0,r.stdout+r.stderr);assert.equal(value.data.state,'SUCCEEDED')}
});

test('replay rechecks all terminal decisions, including recorded adapter errors and cancellation',async t=>{
 const {control}=await import('../dist/runner/controller.js');const {createRecord}=await import('../dist/engine/record.js');const {replayAdapter}=await import('../dist/runner/adapter/replay.js');
 const f=fixture(t);const response=(calls=[],use={input:0,cached:0,output:0,reasoning:0,cost:0})=>({message:'done',toolCalls:calls,usage:use,stopReason:calls.length?'tool_calls':'stop'});
 const ev=responses=>responses.map((response,step)=>({schema_version:1,seq:step,timestamp:new Date().toISOString(),type:'model_response',data:{step,response}}));
 const cases=[['success',[response()],{}],['failed',[response(),response(),response(),response()],{validate:async()=>({checks:[{name:'visible',passed:false}]})}],['abort',[response([{id:'one',name:'abort_with_reason',arguments:{reason:'cannot finish'}}])],{}],['error',[],{}],['cancel',[],{signal:AbortSignal.abort()}],['requests',[],{limits:{requests:0}}],['wall',[],{limits:{wallSeconds:0}}],['tokens',[response([],{input:10,cached:0,output:0,reasoning:0,cost:0})],{limits:{tokens:1}}],['cost',[response([],{input:0,cached:0,output:0,reasoning:0,cost:20})],{}],['stuck',Array.from({length:4},()=>response([{id:'one',name:'read_file',arguments:{path:'a.txt'}}])),{}]];
 for(const [id,responses,extra]of cases){const source=await control({root:f.repo,store:createRecord(f.repo,id),adapter:replayAdapter(ev(responses)),messages:[],validate:async()=>({checks:[{name:'visible',passed:true}]}),handleSIGINT:false,...extra});const replay=await replayRun(id,f.repo);assert.equal(replay.status,'ok',id+': '+JSON.stringify(replay));assert.equal(replay.data.state,source.state)}
});
