#!/usr/bin/env node
// Local Aegis release QC. Never deploys, calls a model or modifies OAG.
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import net from 'node:net';
import {hash,inventory,roots,REQUIRED_CHECKS,safePath,verifyFiles,assertChecks,assertEvidence,assertCommitted} from './release-integrity.mjs';
import {scanText} from './scan-secrets.mjs';
import {summarizeTests} from './qc-test-evidence.mjs';

const args=process.argv.slice(2),command=args.shift();
function flag(name){const i=args.indexOf(name);return i<0?null:args[i+1];}
const root=path.resolve(flag('--root')||path.join(path.dirname(fileURLToPath(import.meta.url)),'..'));
const node=process.execPath;
const runnerSha256=hash(fs.readFileSync(fileURLToPath(import.meta.url)));
const git=(...a)=>spawnSync('git',a,{cwd:root,encoding:'utf8'});
function write(p,j){fs.writeFileSync(p,JSON.stringify(j,null,2)+'\n',{flag:'wx'});}
function localSecrets(){const f=path.join(root,'.env');if(!fs.existsSync(f))return [];return fs.readFileSync(f,'utf8').split(/\r?\n/).flatMap(line=>{const m=/^[A-Z0-9_]*(?:KEY|TOKEN|SECRET|PASSWORD)[A-Z0-9_]*=(.*)$/.exec(line);const value=m?.[1].trim().replace(/^["']|["']$/g,'');return value&&value.length>=20?[value]:[]});}
function redact(text,secrets){for(const value of secrets)text=text.split(value).join('[REDACTED]');return text.replace(/AIza[\w-]{35}|(?<![\w-])sk-[\w-]{24,}|Bearer\s+[\w.-]{32,}/g,'[REDACTED]');}
const checks=[
 ['backend-types',['node_modules/typescript/bin/tsc','--noEmit','-p','tsconfig.json']],
 ['ui-types',['node_modules/typescript/bin/tsc','--noEmit','-p','ui/tsconfig.json']],
 ['release-tests',['--test','tests/release/release-integrity.test.mjs','tests/release/github-upload-policy.test.mjs','tests/release/qc-test-evidence.test.mjs']],
 ['ui-build',['node_modules/vite/bin/vite.js','build','--config','ui/vite.config.ts']],
 ['application-tests',['node_modules/vitest/vitest.mjs','run']],
 ['documentation',null],
 ['secret-scan',['tools/scan-secrets.mjs']],
 ['dependency-audit',null],
 ['browser',['node_modules/@playwright/test/cli.js','test','--max-failures=5']],
];
async function main(){
 if(command==='precheck'){
  if(hash(fs.readFileSync(path.join(root,'tools/release-engine.mjs')))!==runnerSha256)throw Error('QC driver differs from target snapshot; run the release engine from the target checkout');
  const files=inventory(root),sourceRoots=roots(files),changed=flag('--changed');
  if(changed&&!files.some(f=>f.path===changed))throw Error('Changed file is not in the release inventory');
  const rel=`data/release-qc/${new Date().toISOString().replace(/[:.]/g,'-')}-${randomUUID().slice(0,8)}`;
  const dir=safePath(root,rel);fs.mkdirSync(dir,{recursive:true});
  const secrets=localSecrets();
  for(const file of files){const bytes=fs.readFileSync(safePath(root,file.path));if(!bytes.includes(0)){
   const text=bytes.toString('utf8');if(secrets.some(s=>text.includes(s)))throw Error('Local credential detected in release input: '+file.path);
   if(!/^docs\/99-inbox\/[RX]\d{4}.*\.(html|htm|mhtml)$/i.test(file.path)&&scanText(text,file.path).length)throw Error('Credential pattern detected in release input: '+file.path);
  }}
  const outcomes=[];let testEvidence=null;
  // Provider/model features are disabled for all QC child processes. No .env is loaded.
  const env={...process.env,AEGIS_MODELS_ENABLED:'false',AEGIS_PROVIDER_MODE:'stub',AEGIS_TTS_ENABLED:'false',AEGIS_TRANSLATE_ENABLED:'false',AEGIS_LIVE_FEEDS:'false',VITE_GOOGLE_MAPS_API_KEY:'',VITE_GOOGLE_MAPS_MAP_ID:''};
  // Windows' default bash can be WSL, which cannot open E:/... script paths.
  const nativeBash=process.platform==='win32'?path.join(process.env.ProgramFiles||'C:/Program Files','Git/bin'):null;
  if(nativeBash&&fs.existsSync(path.join(nativeBash,'bash.exe')))env.PATH=nativeBash+path.delimiter+env.PATH;
  for(const [id,argv]of checks){
   const log=`${rel}/${id}.log`;let result;
   if(id==='browser'&&args.includes('--production'))env.AEGIS_BROWSER_PORT=String(await new Promise((resolve,reject)=>{const server=net.createServer();server.once('error',reject);server.listen(0,'127.0.0.1',()=>{const address=server.address();server.close(error=>error?reject(error):resolve(address.port));});}));
   if(id==='browser'&&!args.includes('--production'))result={status:null,stdout:'Browser QC not run: local diagnostic profile. Production seal refused.\n'};
   else if(id==='dependency-audit'||id==='documentation'){
    const npmArgs=id==='documentation'?['run','verify:docs:source']:['audit','--audit-level=high','--json'];
    result=process.platform==='win32'?spawnSync(process.env.ComSpec||'cmd.exe',['/d','/s','/c','npm.cmd '+npmArgs.join(' ')],{cwd:root,env,encoding:'utf8',timeout:120000,windowsHide:true,maxBuffer:32*1024*1024}):spawnSync('npm',npmArgs,{cwd:root,env,encoding:'utf8',timeout:120000,maxBuffer:32*1024*1024});
   }else {
    const childArgs=id==='application-tests'?[...argv,'--reporter=default','--reporter=json',`--outputFile.json=${path.join(dir,'application-tests.json')}`]:argv;
    result=spawnSync(node,childArgs,{cwd:root,env,encoding:'utf8',timeout:10*60*1000,windowsHide:true,maxBuffer:64*1024*1024});
   }
   let reportEvidence={};
   if(id==='application-tests'){
    try{
     const report=`${rel}/application-tests.json`,f=safePath(root,report);
     const raw=redact(fs.readFileSync(f,'utf8'),secrets);fs.writeFileSync(f,raw);
     testEvidence=summarizeTests(JSON.parse(raw),root);
     reportEvidence={report,reportSha256:hash(Buffer.from(raw))};
    }catch{result.status=1;result.stderr=String(result.stderr||'')+'\nStructured test evidence missing or invalid; application QC refused.\n';}
   }
   const text=redact(String(result.stdout||'')+String(result.stderr||'')+(result.error?'\nQC process failed or timed out.\n':''),secrets);
   fs.writeFileSync(safePath(root,log),text);
   const status=result.status===0?'PASS':result.status===null&&!result.error&&id==='browser'?'NOT_RUN':'FAIL';
   outcomes.push({id,status,exitCode:result.status??null,log,logSha256:hash(Buffer.from(text)),...reportEvidence});
   console.log(`${id}: ${status}`);
  }
  let unchanged=true;try{verifyFiles(root,files)}catch{unchanged=false}
  const receipt={schemaVersion:1,kind:'aegis-release-qc',createdAt:new Date().toISOString(),product:'aegis-ngo',packageVersion:JSON.parse(fs.readFileSync(path.join(root,'package.json'),'utf8')).version,commit:git('rev-parse','HEAD').stdout.trim()||null,runnerSha256,profile:args.includes('--production')?'production':'local-diagnostic',changedFile:changed,scope:'Complete source inventory; single-file change still uses all checks',files,...sourceRoots,checks:outcomes,testEvidence,sourceUnchanged:unchanged,status:unchanged&&outcomes.every(x=>x.status==='PASS')?'PASS':'BLOCKED'};
  write(path.join(dir,'qc.json'),receipt);console.log(JSON.stringify({status:receipt.status,receipt:`${rel}/qc.json`}));if(receipt.status!=='PASS')process.exitCode=1;
 }else if(command==='seal'){
  const relative=flag('--receipt');if(!relative)throw Error('--receipt is required');
  const receiptFile=safePath(root,relative),bytes=fs.readFileSync(receiptFile),r=JSON.parse(bytes);
  if(r.kind!=='aegis-release-qc'||r.status!=='PASS'||r.profile!=='production'||!r.sourceUnchanged)throw Error('Production QC has not passed');
  if(r.runnerSha256!==runnerSha256)throw Error('QC engine changed: run the current complete gate again');
  assertChecks(r.checks);assertEvidence(root,r.checks);const current=verifyFiles(root,r.files);
  if(current.pathBoundRoot!==r.pathBoundRoot||current.combinedDnaRoot!==r.combinedDnaRoot)throw Error('QC root mismatch');
  const commit=git('rev-parse','HEAD');if(commit.status!==0||commit.stdout.trim()!==r.commit)throw Error('Committed source identity required');
  if(git('status','--porcelain','--untracked-files=all').stdout.trim())throw Error('Commit all reviewed source changes and re-run QC before sealing');
  assertCommitted(root,r.files);
  const metadata={schemaVersion:1,kind:'aegis-source-integrity-seal',sealedAt:new Date().toISOString(),product:'aegis-ngo',packageVersion:r.packageVersion,commit:r.commit,changedFile:r.changedFile,files:r.files,...current,qcReceipt:relative,qcReceiptSha256:hash(bytes),requiredChecks:REQUIRED_CHECKS,qualityProcedure:'AEG-SOP-008/0.1',nodeVersion:process.version,platform:process.platform,engineSha256:hash(fs.readFileSync(fileURLToPath(import.meta.url))),imageDigest:null,productionApproval:'PENDING',deploymentCostGate:'NOT_RUN',limitations:'Local unsigned source integrity record. Not ISO certification, OAG registration, build provenance or production approval. Container digest/attestation, owner approval, cost gate and deployment smoke/rollback evidence remain required.'};
  const out=path.join(path.dirname(receiptFile),'release.hash.meta.json');write(out,metadata);fs.writeFileSync(out+'.sha256',hash(fs.readFileSync(out))+'  release.hash.meta.json\n',{flag:'wx'});console.log(JSON.stringify({status:'SOURCE_SEALED_NOT_DEPLOYED',metadata:path.relative(root,out).replaceAll('\\','/')}));
 }else if(command==='verify'){
  const relative=flag('--metadata');if(!relative)throw Error('--metadata is required');const f=safePath(root,relative),bytes=fs.readFileSync(f),meta=JSON.parse(bytes);
  if(meta.kind!=='aegis-source-integrity-seal'||fs.readFileSync(f+'.sha256','utf8').split(/\s+/)[0]!==hash(bytes))throw Error('Invalid seal or receipt');
  const calculated=verifyFiles(root,meta.files);if(calculated.pathBoundRoot!==meta.pathBoundRoot||calculated.combinedDnaRoot!==meta.combinedDnaRoot)throw Error('Source seal mismatch');
  const qc=fs.readFileSync(safePath(root,meta.qcReceipt));if(hash(qc)!==meta.qcReceiptSha256)throw Error('QC receipt changed');const r=JSON.parse(qc);
  if(r.status!=='PASS'||r.profile!=='production'||r.pathBoundRoot!==meta.pathBoundRoot||r.commit!==meta.commit||!r.sourceUnchanged)throw Error('Invalid QC receipt');
  if(r.runnerSha256!==runnerSha256||meta.engineSha256!==runnerSha256)throw Error('QC engine identity mismatch');
  assertChecks(r.checks);assertEvidence(root,r.checks);if(git('rev-parse','HEAD').stdout.trim()!==meta.commit||git('status','--porcelain','--untracked-files=all').stdout.trim())throw Error('Commit or working tree changed');
  assertCommitted(root,meta.files);
  console.log('PASS: source bytes, commit, QC evidence and integrity receipt match. Deployment authorization remains separate.');
 }else throw Error('Usage: release-engine.mjs precheck [--root DIR] [--changed path] [--production] | seal --receipt relative/path | verify --metadata relative/path');
}
main().catch(error=>{console.error(error.message);process.exitCode=1;});
