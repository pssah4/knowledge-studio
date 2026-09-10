/** Local writer ownership for ADR-09/26. SQLite serializes lease recovery, never
 * document content. The private registry is not transferred with shared locks.
 * Only an ESRCH process and a matching token prove an abandoned local writer.
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {randomUUID,createHash} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import {requireThat,WikiError} from '../core/errors.mjs';
const databases=new Map();
const beneath=(root,p)=>p===root||p.startsWith(root+path.sep);
function openRegistry(root,target){
 const shard=createHash('sha256').update(target).digest('hex')[0];let entry=databases.get(shard);
 const dir=path.join(os.homedir(),process.platform==='darwin'?'Library/Caches':'.cache','llmwiki','writers');
 requireThat(!beneath(root,dir),'lock_location','Writer ownership must be stored outside the project.');
 if(!entry){
  fs.mkdirSync(dir,{recursive:true,mode:0o700});const real=fs.realpathSync(dir);requireThat(!fs.lstatSync(dir).isSymbolicLink()&&!beneath(root,real),'lock_location','Writer registry must be a private directory outside the project.');fs.chmodSync(dir,0o700);
  const registry=path.join(real,'leases-'+shard+'.sqlite');let stat;try{stat=fs.lstatSync(registry);}catch(e){if(e.code!=='ENOENT')throw e;}
  requireThat(!stat||stat.isFile()&&!stat.isSymbolicLink(),'lock_location','Writer registry must be a regular private file.');
  if(!stat)try{fs.closeSync(fs.openSync(registry,'wx',0o600));}catch(e){if(e.code!=='EEXIST')throw e;}
  fs.chmodSync(registry,0o600);const db=new DatabaseSync(registry,{allowExtension:false});
  try{db.exec('PRAGMA busy_timeout=1500; PRAGMA trusted_schema=OFF; PRAGMA journal_mode=DELETE; CREATE TABLE IF NOT EXISTS leases (file TEXT PRIMARY KEY, token TEXT NOT NULL, pid INTEGER NOT NULL, lock TEXT NOT NULL, temporary TEXT NOT NULL);');entry={db,registry};databases.set(shard,entry);}catch(e){db.close();throw e;}
 }
 requireThat(!beneath(root,entry.registry),'lock_location','Writer ownership must remain outside the project.');return entry.db;
}
function guarded(db,run){db.exec('BEGIN IMMEDIATE');try{const result=run();db.exec('COMMIT');return result;}catch(e){db.exec('ROLLBACK');throw e;}}
function busy(clean,reason){return new WikiError('busy',reason==='active'?'A local writer is saving this file. Wait for it to finish, then retry.':'The retained lock has unknown or conflicting ownership. Close other writers and inspect the lock before any manual recovery.',{path:clean,reason});}
function readLock(file){
 let fd;try{fd=fs.openSync(file,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW);const stat=fs.fstatSync(fd);requireThat(stat.isFile()&&stat.size<=1024,'busy','The retained lock is not a valid writer record.');const raw=fs.readFileSync(fd,'utf8');try{return {raw,record:JSON.parse(raw)};}catch{return {raw,record:null};}}
 catch(e){if(e.code==='ENOENT')return null;throw e;}finally{if(fd!==undefined)fs.closeSync(fd);}
}
function dead(pid){if(!Number.isSafeInteger(pid)||pid<=0)return false;try{process.kill(pid,0);return false;}catch(e){return e.code==='ESRCH';}}
function owned(record,token){return record?.format==='llmwiki-lock/2'&&record.token===token;}
function removeTemporary(file){try{const stat=fs.lstatSync(file);requireThat(stat.isFile()&&!stat.isSymbolicLink(),'busy','A retained temporary path changed type; inspect it before recovery.');fs.unlinkSync(file);}catch(e){if(e.code!=='ENOENT')throw e;}}
export function acquireWriter({root,target,lockPath,clean}){
 const db=openRegistry(root,target),token=randomUUID(),temporary=target+'.llmwiki-'+token+'.tmp';
 guarded(db,()=>{
  const prior=db.prepare('SELECT * FROM leases WHERE file=?').get(target);
  if(prior){
   if(!dead(prior.pid))throw busy(clean,'active');
   const lock=readLock(prior.lock);if(lock&&!owned(lock.record,prior.token))throw busy(clean,'unknown');
   if(lock)fs.unlinkSync(prior.lock);removeTemporary(prior.temporary);db.prepare('DELETE FROM leases WHERE file=? AND token=?').run(target,prior.token);
  }
  if(readLock(lockPath))throw busy(clean,'unknown');
  db.prepare('INSERT INTO leases VALUES(?,?,?,?,?)').run(target,token,process.pid,lockPath,temporary);
 });
 // Persist the lease before creating the shared lock: SIGKILL after creation
 // leaves enough local evidence to distinguish this writer from another host.
 try{
  const fd=fs.openSync(lockPath,'wx',0o600);try{fs.writeFileSync(fd,JSON.stringify({format:'llmwiki-lock/2',token}));fs.fsyncSync(fd);}finally{fs.closeSync(fd);}
 }catch(e){guarded(db,()=>db.prepare('DELETE FROM leases WHERE file=? AND token=?').run(target,token));if(e.code==='EEXIST')throw busy(clean,'unknown');throw e;}
 return {temporary,release(){guarded(db,()=>{
  const row=db.prepare('SELECT token FROM leases WHERE file=?').get(target),lock=readLock(lockPath);
  if(row?.token!==token||lock&&!owned(lock.record,token))throw busy(clean,'unknown');
  removeTemporary(temporary);if(lock)fs.unlinkSync(lockPath);db.prepare('DELETE FROM leases WHERE file=? AND token=?').run(target,token);
 });}};
}
