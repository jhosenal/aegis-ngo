// Prepare a source-only repository without changing the working repository's index/history.
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {scanText} from './scan-secrets.mjs';
import {allowedRecord} from './github-upload-policy.mjs';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const nameIndex=process.argv.indexOf('--snapshot');
const snapshot=nameIndex<0?'github-first-push':process.argv[nameIndex+1];
if(!snapshot||!/^github-[a-z0-9-]+$/.test(snapshot))throw Error('Invalid snapshot name');
const target=path.join(root,'data',snapshot);
const review=path.join(root,'data',snapshot+'-review');
if(fs.existsSync(target)){
 if(!process.argv.includes('--refresh'))throw Error('Preparation directory already exists; use --refresh only for a previously generated snapshot.');
 const prior=JSON.parse(fs.readFileSync(path.join(review,'included.json'),'utf8'));
 for(const item of prior){const f=path.join(target,item.path);if(!fs.existsSync(f)||createHash('sha256').update(fs.readFileSync(f)).digest('hex')!==item.sha256)throw Error('Prepared source changed independently; refusing refresh: '+item.path);}
}
function git(args,cwd=root,input){const r=spawnSync('git',args,{cwd,input,encoding:'utf8',maxBuffer:64*1024*1024});if(r.status!==0)throw Error(`Git operation failed: ${args[0]} (output withheld)`);return r.stdout;}
// Enumerate approved source directories too: broad ignore rules can hide NEW source files.
function sourceFiles(dir){if(!fs.existsSync(path.join(root,dir)))return [];return fs.readdirSync(path.join(root,dir),{withFileTypes:true}).flatMap(entry=>{
 const p=dir+'/'+entry.name;if(entry.isSymbolicLink()||['node_modules','dist','out','__pycache__'].includes(entry.name))return [];
 return entry.isDirectory()?sourceFiles(p):[p];
});}
const candidates=[...new Set([...git(['ls-files','--cached','--others','--exclude-standard','-z']).split('\0').filter(Boolean),...['src','ui','content','migrations','fixtures','tests','tools','deploy','.github','records/costs','records/releases','records/reviews','records/sources','research/engineer','.agents/skills'].flatMap(sourceFiles)])].sort();
// Only named documentation fixtures; records references cannot bypass the owner allowlist.
const support=new Set(['.agents/skills/aegis-oag-governance/SKILL.md','.agents/skills/aegis-qzeex-workers/SKILL.md','.agents/skills/aegis-storyboard-learning/SKILL.md','docs/99-inbox/C0001_refined-aegis-scope-of-work.md','docs/99-inbox/C0002_frontend-snet-backend-handoff.md']);
function references(value){
 if(typeof value==='string'){
  for(const p of [value,'docs/99-inbox/'+value])if(/^(docs\/99-inbox|records)\//.test(p)&&fs.existsSync(path.join(root,p))&&fs.statSync(path.join(root,p)).isFile())support.add(p);
 }else if(Array.isArray(value))value.forEach(references);else if(value&&typeof value==='object')Object.values(value).forEach(references);
}
for(const p of candidates.filter(p=>/^(content|records\/costs)\/.*\.json$/.test(p))){try{references(JSON.parse(fs.readFileSync(path.join(root,p),'utf8')))}catch{throw Error('Invalid source JSON: '+p);}}
const roots=new Set(['.dockerignore','.env.example','.gitattributes','.gcloudignore','.gitignore','LICENSE','AGENTS.md','CLAUDE.md','GEMINI.md','LUNA.md','HANDOVER.md','README.md','Dockerfile','package.json','package-lock.json','tsconfig.json','vitest.config.ts','vitest.live.config.ts','playwright.config.ts']);
function include(p){
 if(p.startsWith('records/'))return allowedRecord(p);
 if(/(^|\/)(node_modules|dist|out|__pycache__)(\/|$)/.test(p))return false;
 if(/(^|\/)(?:\.env(?:\..*)?|client_secret[^/]*\.json)$/.test(p)&&p!=='.env.example')return false;
 if(/\.(pem|key|db|sqlite|db-wal|db-shm|log|mhtml)$/i.test(p))return false;
 if(p==='tests/browser/judge-trial-signin.spec.ts')return false; // needs the Judge Trial form and backend, neither ships in v8
 if(p.startsWith('ui/public/media/'))return p==='ui/public/media/aegis-presenter-welcome.webm';
 return roots.has(p)||support.has(p)||/^(src|ui|content|migrations|fixtures|tests|tools|deploy|\.github)\//.test(p)
  ||p.startsWith('research/engineer/')||/^render\/presenter\/(Dockerfile|README\.md|\.dockerignore|scripts\/|musetalk\/|tts\/)/.test(p)
  ||/^docs\/(?!99-inbox\/)/.test(p);
}
const envPath=path.join(root,'.env');
const secrets=fs.existsSync(envPath)?fs.readFileSync(envPath,'utf8').split(/\r?\n/).flatMap(line=>{
 const m=/^([A-Z0-9_]*(?:KEY|TOKEN|SECRET|PASSWORD)[A-Z0-9_]*)=(.*)$/.exec(line);if(!m)return [];
 const value=m[2].trim().replace(/^["']|["']$/g,'');return value.length>=20?[{name:m[1],value}]:[];
}):[];
const selected=[],excluded=[],findings=[];
for(const p of candidates){
 const full=path.join(root,p);if(!fs.existsSync(full))continue;
 const stat=fs.lstatSync(full);if(!stat.isFile()){excluded.push({path:p,reason:'Not a regular source file'});continue;}
 if(!include(p)){excluded.push({path:p,bytes:stat.size,reason:'Outside explicit source upload allowlist'});continue;}
 if(stat.size>50*1024*1024){findings.push({path:p,rule:'oversized-file'});continue;}
 const bytes=fs.readFileSync(full);
 if(!bytes.includes(0)){
  const text=bytes.toString('utf8');
  for(const s of secrets)if(text.includes(s.value))findings.push({path:p,rule:'exact-local-secret',variable:s.name});
  // Public publisher-page fixtures can contain the publisher's own public site-search keys.
  // They still undergo exact matching for this project's local credentials above.
  if(!/^docs\/99-inbox\/[RX]\d{4}.*\.(html|htm|mhtml)$/i.test(p))for(const hit of scanText(text,p))findings.push({path:p,line:hit.line,rule:hit.rule});
 }
 selected.push({path:p,bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')});
}
fs.mkdirSync(review,{recursive:true});
fs.writeFileSync(path.join(review,'included.json'),JSON.stringify(selected,null,2)+'\n');
fs.writeFileSync(path.join(review,'excluded.json'),JSON.stringify(excluded,null,2)+'\n');
fs.writeFileSync(path.join(review,'findings.json'),JSON.stringify(findings,null,2)+'\n');
if(findings.length){console.log(JSON.stringify({status:'BLOCKED',findings}));process.exit(1);}
// Narrowing the policy must never retain previously staged private paths.
if(fs.existsSync(path.join(target,'.git'))){
 const allowed=new Set(selected.map(x=>x.path));
 const stale=git(['ls-files','-z'],target).split('\0').filter(p=>p&&!allowed.has(p));
 if(stale.length)throw Error('Existing snapshot contains paths outside current policy; use a new --snapshot name.');
}
fs.mkdirSync(target,{recursive:true});
for(const item of selected){
 const bytes=fs.readFileSync(path.join(root,item.path));
 if(createHash('sha256').update(bytes).digest('hex')!==item.sha256)throw Error('Source changed during preparation; do not publish this directory.');
 const dest=path.join(target,item.path);fs.mkdirSync(path.dirname(dest),{recursive:true});fs.writeFileSync(dest,bytes);
}
if(!fs.existsSync(path.join(target,'.git'))){git(['init','--initial-branch=main'],target);git(['remote','add','origin','https://github.com/jhosenal/aegis-ngo.git'],target);}
git(['config','core.autocrlf','false'],target);
if(process.argv.includes('--base-remote')){git(['fetch','origin','main'],target);git(['reset','--mixed','FETCH_HEAD'],target);}
// Exact, NUL-delimited paths; never stage the original working directory or copy its history.
// Original data/ ignore also matches required src/data; force ONLY the audited path list.
git(['add','--force','--pathspec-from-file=-','--pathspec-file-nul'],target,selected.map(x=>x.path).join('\0')+'\0');
const report={status:'PREPARED_NOT_COMMITTED_OR_PUSHED',repository:'jhosenal/aegis-ngo',directory:target,branch:'main',includedFiles:selected.length,includedBytes:selected.reduce((s,x)=>s+x.bytes,0),excludedFiles:excluded.length,secretFindings:0,oldHistoryIncluded:false,originalIndexChanged:false,reviewDirectory:review};
fs.writeFileSync(path.join(review,'summary.json'),JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify(report,null,2));
