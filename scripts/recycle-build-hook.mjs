import fs from 'node:fs';
import {fileURLToPath} from 'node:url';
import {resolve,sep} from 'node:path';
import {execFileSync} from 'node:child_process';
import {syncBuiltinESMExports} from 'node:module';
// Build tools must recycle owned existing output, including automatic cleanup.
const boundary=resolve(fileURLToPath(new URL('..',import.meta.url)));
const originals={rm:fs.rm,rmSync:fs.rmSync,unlink:fs.unlink,unlinkSync:fs.unlinkSync,rmdir:fs.rmdir,rmdirSync:fs.rmdirSync,prm:fs.promises.rm,punlink:fs.promises.unlink,prmdir:fs.promises.rmdir};
function recycle(value,method,options){
 const path=resolve(value instanceof URL?fileURLToPath(value):Buffer.isBuffer(value)?value.toString():String(value));
 if(!fs.existsSync(path))return false;
 if(!path.startsWith(boundary+sep)||path===boundary)throw new Error('Build cleanup blocked outside owned project: '+path);
 const stat=fs.lstatSync(path);if(stat.isSymbolicLink())throw new Error('Build cannot remove shared link: '+path);
 if(method==='unlink'&&stat.isDirectory())throw Object.assign(new Error('EISDIR'),{code:'EISDIR'});
 if(method==='rmdir'&&stat.isDirectory()&&fs.readdirSync(path).length&&!options?.recursive)throw Object.assign(new Error('ENOTEMPTY'),{code:'ENOTEMPTY'});
 if(process.platform!=='win32'){const archive=resolve(boundary,'work/recycled',String(Date.now())+'-'+crypto.randomUUID());fs.mkdirSync(archive,{recursive:true});fs.renameSync(path,resolve(archive,'output'));return true;}
 const encoded=Buffer.from(path,'utf8').toString('base64');
 const ps="$ErrorActionPreference='Stop';Add-Type -AssemblyName Microsoft.VisualBasic;$taskTarget=[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('"+encoded+"'));if([IO.Directory]::Exists($taskTarget)){[Microsoft.VisualBasic.FileIO.FileSystem]::DeleteDirectory($taskTarget,[Microsoft.VisualBasic.FileIO.UIOption]::OnlyErrorDialogs,[Microsoft.VisualBasic.FileIO.RecycleOption]::SendToRecycleBin)}else{[Microsoft.VisualBasic.FileIO.FileSystem]::DeleteFile($taskTarget,[Microsoft.VisualBasic.FileIO.UIOption]::OnlyErrorDialogs,[Microsoft.VisualBasic.FileIO.RecycleOption]::SendToRecycleBin)}";
 execFileSync('powershell.exe',['-NoProfile','-NonInteractive','-EncodedCommand',Buffer.from(ps,'utf16le').toString('base64')],{windowsHide:true,stdio:'pipe'});
 if(fs.existsSync(path))throw new Error('Recycle did not complete: '+path);
 return true;
}
for(const method of ['rm','unlink','rmdir']){
 fs[method+'Sync']=(path,options)=>recycle(path,method,options)?undefined:originals[method+'Sync'](path,options);
 fs[method]=(...args)=>{const callback=args.pop();const [path,options]=args;try{if(recycle(path,method,options))queueMicrotask(()=>callback(null));else originals[method](...args,callback);}catch(error){queueMicrotask(()=>callback(error));}};
 fs.promises[method]=async(path,options)=>recycle(path,method,options)?undefined:originals['p'+method](path,options);
}
syncBuiltinESMExports();