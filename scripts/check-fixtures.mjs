import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { Ajv } from 'ajv';
const schema=JSON.parse(readFileSync(new URL('../schemas/task.schema.json',import.meta.url),'utf8'));
const validate=new Ajv({strict:true}).compile(schema);
export function inspectFixtureProposals(root=resolve('fixtures')) {
 const tasks=join(root,'tasks');const results=[];
 for(const id of readdirSync(tasks).sort()){
  const dir=join(tasks,id);const task=JSON.parse(readFileSync(join(dir,'task.json'),'utf8'));
  if(!validate(task)||task.id!==id)throw Error('Invalid task metadata: '+id);
  for(const key of ['visible','hidden','reference']){
   const relative=task.oracle[key];
   if(relative.includes('..')||!relative.startsWith(key==='visible'?'tests-visible/':key==='hidden'?'tests-hidden/':'solution/'))throw Error('Unsafe oracle path: '+id);
   const digest=createHash('sha256').update(readFileSync(join(dir,relative))).digest('hex');
   if(digest!==task.oracle.sha256[key])throw Error('Oracle/reference hash mismatch: '+id+' '+key);
  }
  if(!existsSync(join(dir,'instruction.md'))||!existsSync(join(dir,'setup.sh')))throw Error('Missing task files: '+id);
  results.push({id,reviewed:task.oracleReviewed,fixtureVersion:task.fixtureVersion});
 }
 return results;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
 const results=inspectFixtureProposals();console.log(JSON.stringify({status:'structurally-valid-proposals',oraclesExecuted:false,tasks:results},null,2));
}
