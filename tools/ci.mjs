#!/usr/bin/env node
// One entry point for CI and local release checks. No cloud deployment occurs here.
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('..',import.meta.url));
const result=spawnSync(process.execPath,[fileURLToPath(new URL('./release-engine.mjs',import.meta.url)),'precheck','--production'],{cwd:root,stdio:'inherit',windowsHide:true});
process.exitCode=result.status??1;
