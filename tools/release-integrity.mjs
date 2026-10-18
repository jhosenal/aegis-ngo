import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';

export const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
export const REQUIRED_CHECKS=['backend-types','ui-types','release-tests','application-tests','ui-build','documentation','secret-scan','dependency-audit','browser'];
export function safePath(root,relative){
 if(typeof relative!=='string'||!relative||/[\\:\u0000-\u001f]/.test(relative)||path.isAbsolute(relative)||relative.split('/').some(x=>!x||x==='.'||x==='..'))throw Error('Unsafe artifact path');
 const target=path.resolve(root,relative);
 if(!target.startsWith(path.resolve(root)+path.sep))throw Error('Artifact outside repository');
 let cursor=path.resolve(root);for(const part of relative.split('/')){cursor=path.join(cursor,part);if(fs.existsSync(cursor)&&fs.lstatSync(cursor).isSymbolicLink())throw Error('Symlink in artifact path');}
 return target;
}
export function inventory(root){
 const r=spawnSync('git',['ls-files','--cached','--others','--exclude-standard','-z'],{cwd:root,encoding:'utf8',maxBuffer:64*1024*1024});
 if(r.status!==0)throw Error('Repository inventory failed');
 function walk(dir){const base=path.join(root,dir);if(!fs.existsSync(base))return [];return fs.readdirSync(base,{withFileTypes:true}).flatMap(e=>{if(['node_modules','dist','out','__pycache__'].includes(e.name))return [];const p=dir+'/'+e.name;return e.isDirectory()?walk(p):[p];});}
 // Do not let a broad ignore rule silently remove newly added application code from QC.
 const paths=[...new Set([...r.stdout.split('\0').filter(Boolean),...['src','ui','content','migrations','fixtures','tests','tools','deploy','.github'].flatMap(walk)])].sort();
 return paths.filter(p=>fs.existsSync(safePath(root,p))).map(p=>{
  if(/(^|\/)(?:node_modules|dist|out)(\/|$)|(^|\/)\.env(?:$|\.)|\.(?:db|sqlite|pem|key|log)$/i.test(p)&&p!=='.env.example')throw Error('Forbidden file in release inventory: '+p);
  const f=safePath(root,p);if(!fs.statSync(f).isFile())throw Error('Non-file artifact');
  const bytes=fs.readFileSync(f);if(bytes.length>50*1024*1024)throw Error('Oversized release artifact: '+p);
  return {path:p,bytes:bytes.length,sha256:hash(bytes)};
 });
}
export function roots(files){
 return {combinedDnaRoot:'0x'+hash(files.map(f=>f.sha256).join('')),pathBoundRoot:'0x'+hash(files.map(f=>`${f.path}\t${f.bytes}\t${f.sha256}\n`).join(''))};
}
export function assertChecks(checks){
 if(!Array.isArray(checks)||checks.length!==REQUIRED_CHECKS.length)throw Error('Incomplete QC checks');
 for(const id of REQUIRED_CHECKS){const rows=checks.filter(x=>x.id===id);if(rows.length!==1||rows[0].status!=='PASS'||rows[0].exitCode!==0)throw Error('QC not passed: '+id);}
}
export function verifyFiles(root,files){
 const current=inventory(root);if(JSON.stringify(current)!==JSON.stringify(files))throw Error('Artifact changed: re-run QC for the complete release');
 return roots(current);
}
export function assertEvidence(root,checks){
 for(const check of checks){const f=safePath(root,check.log);if(!fs.existsSync(f)||hash(fs.readFileSync(f))!==check.logSha256)throw Error('QC evidence changed or missing: '+check.id);
  if(check.report){const report=safePath(root,check.report);if(!fs.existsSync(report)||hash(fs.readFileSync(report))!==check.reportSha256)throw Error('QC structured report changed or missing: '+check.id);}
 }
}
export function assertCommitted(root,files){
 const tree=spawnSync('git',['ls-tree','-r','-z','HEAD'],{cwd:root,encoding:'utf8',maxBuffer:64*1024*1024});
 if(tree.status!==0)throw Error('Committed source identity required');
 const format=spawnSync('git',['rev-parse','--show-object-format'],{cwd:root,encoding:'utf8'}).stdout.trim();
 if(!['sha1','sha256'].includes(format))throw Error('Unsupported Git object format');
 const entries=new Map(tree.stdout.split('\0').filter(Boolean).map(line=>{const split=line.indexOf('\t');const meta=line.slice(0,split).split(' ');if(meta[1]!=='blob'||meta[0]==='120000')throw Error('Unsupported committed object');return [line.slice(split+1),meta[2]];}));
 if(entries.size!==files.length)throw Error('Release inventory differs from committed files');
 for(const item of files){const bytes=fs.readFileSync(safePath(root,item.path));const oid=createHash(format).update(Buffer.from(`blob ${bytes.length}\0`)).update(bytes).digest('hex');if(entries.get(item.path)!==oid)throw Error('Source bytes are not committed: '+item.path);}
}
