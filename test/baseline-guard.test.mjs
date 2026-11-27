import assert from 'node:assert/strict';
import { test } from 'node:test';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
test('baseline command refuses accidental invocation without explicit measurement flag',()=>{
 const result=spawnSync(process.execPath,['scripts/measure-stage1-b0.mjs'],{encoding:'utf8'});assert.equal(result.status,1);assert.match(result.stderr,/Use --measure only/);
});
test('baseline command requires its named credential before any engine/model setup',()=>{
 const settings=JSON.parse(readFileSync('eval/baselines/B0/settings.json','utf8'));const env={...process.env};delete env[settings.apiKeyEnv];const result=spawnSync(process.execPath,['scripts/measure-stage1-b0.mjs','--measure'],{encoding:'utf8',env});assert.equal(result.status,1);assert.match(result.stderr,process.platform==='linux'?/credential environment variable is unavailable/:/Linux\/WSL/);
});
