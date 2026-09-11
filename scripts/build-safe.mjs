import {existsSync,lstatSync,rmSync,mkdirSync} from 'node:fs';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {spawnSync} from 'node:child_process';
import './recycle-build-hook.mjs';
for(const name of ['dist','.next','.vinext']){const path=resolve(name);if(existsSync(path)){if(lstatSync(path).isSymbolicLink())throw new Error('Refusing linked build output');rmSync(path,{recursive:true});}}
const hook=pathToFileURL(resolve('scripts/recycle-build-hook.mjs')).href;
mkdirSync('work/build-tmp',{recursive:true});
const env={...process.env,TEMP:resolve('work/build-tmp'),TMP:resolve('work/build-tmp'),NODE_OPTIONS:[process.env.NODE_OPTIONS,'--import='+hook].filter(Boolean).join(' '),WRANGLER_SEND_METRICS:'false',WRANGLER_WRITE_LOGS:'false'};
for(const args of [['node_modules/vinext/dist/cli.js','build'],['--experimental-transform-types','scripts/build-shell.mts']]){const result=spawnSync(process.execPath,args,{stdio:'inherit',env,windowsHide:true});if(result.status!==0)process.exit(result.status||1);}