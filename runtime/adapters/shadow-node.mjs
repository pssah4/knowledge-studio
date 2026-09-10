/** Private SQLite cache for FEAT-03-06. Never stored in a wiki or sync folder.
 * Only fixed SQL is executed. Extension loading is disabled. Shared provenance
 * belongs to the portable evidence protocol, not this disposable database.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {createHash} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import {requireThat} from '../core/errors.mjs';
const digest=s=>createHash('sha256').update(s).digest('hex');
const beneath=(root,file)=>file===root||file.startsWith(root+path.sep);

export async function openShadowDatabase(root,project,{readOnly=false,cacheRoot,maxBytes=128*1024*1024,rebuild=false}={}){
 requireThat(!readOnly||!rebuild,'read-only','A read-only query cannot rebuild the database.');
 requireThat(Number.isSafeInteger(maxBytes)&&maxBytes>=1024&&maxBytes<=1024*1024*1024,'shadow_budget','Choose a cache budget between 1 KiB and 1 GiB.');
 const canonical=await fs.realpath(root);
 const base=path.resolve(cacheRoot??path.join(os.homedir(),process.platform==='darwin'?'Library/Caches':'.cache','llmwiki','shadow'));
 requireThat(!beneath(canonical,base),'shadow_location','The local database must remain outside the project.');
 const name=digest(JSON.stringify([canonical,project]));let dir=path.join(base,name),file=path.join(dir,'shadow.sqlite');
 // Do not create even a parent directory in the read-only role.
 if(readOnly){try{await fs.lstat(file);}catch(e){if(e.code==='ENOENT')return null;throw e;}}
 else await fs.mkdir(dir,{recursive:true,mode:0o700});
 const realBase=await fs.realpath(base),real=await fs.realpath(dir);requireThat(real===path.join(realBase,name)&&!beneath(canonical,real),'shadow_location','The database cache must be outside the project without symbolic links.');
 dir=real;file=path.join(dir,'shadow.sqlite');
 let stat;try{stat=await fs.lstat(file);}catch(e){if(e.code!=='ENOENT')throw e;}
 requireThat(!stat||stat.isFile()&&!stat.isSymbolicLink(),'shadow_location','The database must be a regular private file.');
 if(!readOnly&&!stat){const handle=await fs.open(file,'wx',0o600);await handle.close();}
 const db=new DatabaseSync(file,{readOnly,allowExtension:false});
 try{
  db.exec('PRAGMA busy_timeout=1500; PRAGMA trusted_schema=OFF;');
  if(!readOnly){await fs.chmod(file,0o600);db.exec(`
   PRAGMA journal_mode=DELETE;
   PRAGMA secure_delete=ON;
   CREATE TABLE IF NOT EXISTS state (singleton INTEGER PRIMARY KEY CHECK(singleton=1), version INTEGER NOT NULL, generation INTEGER NOT NULL);
   INSERT OR IGNORE INTO state VALUES(1,1,0);
   CREATE TABLE IF NOT EXISTS documents (wiki TEXT NOT NULL, path TEXT NOT NULL, id TEXT NOT NULL, revision TEXT NOT NULL, data TEXT NOT NULL, PRIMARY KEY(wiki,path));
   CREATE INDEX IF NOT EXISTS document_ids ON documents(wiki,id);
  `);}
  requireThat(db.prepare('SELECT version FROM state WHERE singleton=1').get()?.version===1,'shadow_version','Unsupported shadow database version.');
  requireThat(Object.values(db.prepare('PRAGMA quick_check').get())[0]==='ok','shadow_corrupt','The shadow database is corrupt; rebuild the derived cache.');
  if(!readOnly){const pageSize=db.prepare('PRAGMA page_size').get().page_size;db.exec('PRAGMA max_page_count='+Math.ceil((maxBytes*1.15+65536)/pageSize));}
  // A healthy rebuild is staged by refreshShadow; opening must not erase other scopes.
 }catch(error){db.close();
  if(rebuild&&(error.code==='shadow_corrupt'||[11,26].includes(error.errcode))){
   for(const suffix of ['-journal','-wal','-shm']){let present=false;try{await fs.lstat(file+suffix);present=true;}catch(e){if(e.code!=='ENOENT')throw e;}requireThat(!present,'shadow_busy','Close active database users before recovering this cache.');}
   await fs.rename(file,file+'.corrupt');return openShadowDatabase(root,project,{readOnly:false,cacheRoot,maxBytes});
  }
  throw error;
 }
 return {
  path:file,readOnly,maxBytes,
  generation:()=>db.prepare('SELECT generation FROM state WHERE singleton=1').get().generation,
  documents:wiki=>db.prepare('SELECT * FROM documents WHERE wiki=? ORDER BY path').all(wiki).map(row=>({...row,data:JSON.parse(row.data)})),
  commit(updates,{expected,remove=[],keepWikis=null}={}){
   requireThat(!readOnly,'read-only','The shadow database is read-only.');
   db.exec('BEGIN IMMEDIATE');
   try{
    requireThat(db.prepare('SELECT generation FROM state WHERE singleton=1').get().generation===expected,'shadow_stale','The shadow database changed during this update. Retry the maintenance action.');
    for(const wiki of keepWikis===null?[]:db.prepare('SELECT DISTINCT wiki FROM documents').all().map(r=>r.wiki).filter(w=>!keepWikis.includes(w)))db.prepare('DELETE FROM documents WHERE wiki=?').run(wiki);
    for(const r of remove)db.prepare('DELETE FROM documents WHERE wiki=? AND path=?').run(r.wiki,r.path);
    const put=db.prepare('INSERT INTO documents(wiki,path,id,revision,data) VALUES(?,?,?,?,?) ON CONFLICT(wiki,path) DO UPDATE SET id=excluded.id,revision=excluded.revision,data=excluded.data');
    for(const row of updates)put.run(row.wiki,row.path,row.id,row.revision,JSON.stringify(row.data));
    // Bound actual serialized content, including Unicode bytes. SQLite pages are
    // reused across updates; no full revision history accumulates in this cache.
    const size=db.prepare('SELECT COALESCE(SUM(length(CAST(data AS BLOB))),0) AS bytes FROM documents').get().bytes;
    requireThat(size<=maxBytes,'shadow_budget','The structural cache exceeds its configured byte budget.',{bytes:size,maxBytes});
    db.prepare('UPDATE state SET generation=generation+1 WHERE singleton=1').run();db.exec('COMMIT');return {bytes:size,generation:expected+1};
   }catch(error){db.exec('ROLLBACK');throw error;}
  },
  close:()=>db.close()
 };
}
