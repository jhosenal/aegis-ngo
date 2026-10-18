import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {safePath,hash,roots,inventory,verifyFiles,assertChecks,assertEvidence,assertCommitted,REQUIRED_CHECKS} from '../../tools/release-integrity.mjs';

test('paths reject traversal, absolute paths and alternate separators',()=>{
 for(const p of ['../secret','/tmp/secret','a/../b','a\\b','a//b','C:/secret','file:stream','a\tb','a\nb'])assert.throws(()=>safePath(os.tmpdir(),p));
});
test('path-bound root detects renames even when combined byte hashes match',()=>{
 const a=[{path:'a.ts',bytes:1,sha256:hash('x')}],b=[{...a[0],path:'b.ts'}];
 assert.equal(roots(a).combinedDnaRoot,roots(b).combinedDnaRoot);assert.notEqual(roots(a).pathBoundRoot,roots(b).pathBoundRoot);
});
test('failed, missing, skipped and duplicated checks cannot seal',()=>{
 const passed=REQUIRED_CHECKS.map(id=>({id,status:'PASS',exitCode:0}));assert.doesNotThrow(()=>assertChecks(passed));
 assert.throws(()=>assertChecks(passed.slice(1)));assert.throws(()=>assertChecks([...passed,passed[0]]));
 for(const status of ['FAIL','NOT_RUN'])assert.throws(()=>assertChecks(passed.map((r,i)=>i? r:{...r,status})));
});
test('complete inventory detects changed bytes and added source',()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'aegis-release-test-'));
 spawnSync('git',['init','--quiet'],{cwd:dir});fs.writeFileSync(path.join(dir,'.gitignore'),'data/\n');fs.writeFileSync(path.join(dir,'a.ts'),'original');
 const initial=inventory(dir);assert.doesNotThrow(()=>verifyFiles(dir,initial));fs.writeFileSync(path.join(dir,'a.ts'),'modified');assert.throws(()=>verifyFiles(dir,initial));
 fs.writeFileSync(path.join(dir,'a.ts'),'original');fs.writeFileSync(path.join(dir,'b.ts'),'new');assert.throws(()=>verifyFiles(dir,initial));
});
test('altered or missing QC evidence is refused',()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'aegis-qc-evidence-'));fs.writeFileSync(path.join(root,'qc.log'),'PASS');
 const checks=[{id:'test',log:'qc.log',logSha256:hash('PASS')}];assert.doesNotThrow(()=>assertEvidence(root,checks));fs.writeFileSync(path.join(root,'qc.log'),'changed');assert.throws(()=>assertEvidence(root,checks));
});

test('structured skipped-test evidence cannot change after QC',()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'aegis-qc-report-'));
 fs.writeFileSync(path.join(root,'qc.log'),'PASS');fs.writeFileSync(path.join(root,'tests.json'),'{"unverified":20}');
 const checks=[{id:'application-tests',log:'qc.log',logSha256:hash('PASS'),report:'tests.json',reportSha256:hash('{"unverified":20}')}];
 assert.doesNotThrow(()=>assertEvidence(root,checks));
 fs.writeFileSync(path.join(root,'tests.json'),'{"unverified":0}');assert.throws(()=>assertEvidence(root,checks));
});
test('ignored source still belongs to the release inventory',()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'aegis-ignored-source-'));spawnSync('git',['init','--quiet'],{cwd:root});
 fs.writeFileSync(path.join(root,'.gitignore'),'data/\n');fs.mkdirSync(path.join(root,'src/data'),{recursive:true});fs.writeFileSync(path.join(root,'src/data/new.ts'),'export const value=1;');
 assert.ok(inventory(root).some(f=>f.path==='src/data/new.ts'));
});
test('tracked credentials and symlink escapes are refused',()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'aegis-unsafe-source-'));spawnSync('git',['init','--quiet'],{cwd:root});fs.writeFileSync(path.join(root,'.env'),'LOCAL_SETTING=example');
 assert.throws(()=>inventory(root));fs.unlinkSync(path.join(root,'.env'));
 const outside=fs.mkdtempSync(path.join(os.tmpdir(),'aegis-outside-'));fs.symlinkSync(outside,path.join(root,'escape'),process.platform==='win32'?'junction':'dir');
 assert.throws(()=>safePath(root,'escape/file.json'));
});
test('CLI refuses to seal failed production QC',()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'aegis-failed-qc-'));fs.writeFileSync(path.join(root,'qc.json'),JSON.stringify({kind:'aegis-release-qc',status:'BLOCKED',profile:'production',sourceUnchanged:true}));
 const result=spawnSync(process.execPath,[new URL('../../tools/release-engine.mjs',import.meta.url).pathname.replace(/^\/([A-Za-z]:)/,'$1'),'seal','--root',root,'--receipt','qc.json'],{encoding:'utf8'});
 assert.equal(result.status,1);assert.match(result.stderr,/Production QC has not passed/);assert.equal(fs.existsSync(path.join(root,'release.hash.meta.json')),false);
});
test('ignored code absent from HEAD cannot be bound to a commit seal',()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'aegis-commit-source-'));spawnSync('git',['init','--quiet'],{cwd:root});
 fs.writeFileSync(path.join(root,'.gitignore'),'data/\n');spawnSync('git',['add','.gitignore'],{cwd:root});
 const result=spawnSync('git',['-c','user.name=Fixture','-c','user.email=fixture@example.invalid','-c','commit.gpgsign=false','commit','-m','Test fixture'],{cwd:root,encoding:'utf8'});assert.equal(result.status,0);
 assert.doesNotThrow(()=>assertCommitted(root,inventory(root)));
 fs.mkdirSync(path.join(root,'src/data'),{recursive:true});fs.writeFileSync(path.join(root,'src/data/uncommitted.ts'),'export const hidden=1;');
 assert.throws(()=>assertCommitted(root,inventory(root)));
});
