/** Node filesystem boundary (ADR-26). Root-scoped paths, no symlinks, explicit write baseline.
 * Cooperating writers serialize on per-file locks; foreign editors are checked
 * immediately before and after replacement. Review events retain both versions.
 */
import fs from 'node:fs/promises';
import {constants} from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {createHash, randomBytes, randomUUID} from 'node:crypto';
import {acquireWriter} from './node-locks.mjs';
import {relativePath, requireThat, WikiError} from '../core/errors.mjs';

export const nodeServices = {
  hash: async value => createHash('sha256').update(value).digest('hex'),
  random: size => new Uint8Array(randomBytes(size)),
  uuid: () => randomUUID(),
  now: () => new Date().toISOString()
};

export class NodeStore {
  constructor(root, {writable=true, maxBytes=128*1024*1024,shadowCacheRoot}={}) {
    requireThat(typeof root==='string' && path.isAbsolute(root), 'root', 'Select an absolute project directory.');
    this.root=path.resolve(root); this.writable=writable; this.maxBytes=maxBytes;
    this.shadowCacheRoot=shadowCacheRoot;
    this.services=nodeServices;
    this.capabilities={binary:true, exclusiveCreate:true, cooperativeLocks:true, externalWriterCAS:false};
  }
  async shadowDatabase(project,options={}) {
    const {openShadowDatabase}=await import('./shadow-node.mjs');
    return openShadowDatabase(this.root,project,{cacheRoot:this.shadowCacheRoot,...options,readOnly:this.writable===false||options.readOnly===true});
  }
  async fileURL(relative){return pathToFileURL(await this.location(relative)).href;}
  editorLocation(){const entry_path=path.join(this.root,'LLM-Wiki.html');return {project_root:this.root,entry_path,entry_uri:pathToFileURL(entry_path).href};}
  async location(relative='', {createParent=false}={}) {
    const clean=relativePath(relative,{root:true});
    const rootStat=await fs.lstat(this.root);
    requireThat(rootStat.isDirectory() && !rootStat.isSymbolicLink(), 'root', 'Root must be a directory, not a symbolic link.');
    const parts=clean?clean.split('/'):[];let current=this.root;
    for (let i=0;i<parts.length;i++) {
      current=path.join(current,parts[i]);
      let stat;
      try { stat=await fs.lstat(current); }
      catch (error) {
        if (error.code!=='ENOENT') throw error;
        if (createParent && i<parts.length-1) {
          try { await fs.mkdir(current); } catch (e) { if(e.code!=='EEXIST')throw e; }
          stat=await fs.lstat(current);
        } else continue;
      }
      requireThat(!stat.isSymbolicLink(), 'symlink', 'Symbolic links are not traversed.', {path:clean});
      if (i<parts.length-1) requireThat(stat.isDirectory(), 'path', 'Parent path is not a directory.', {path:clean});
    }
    return current;
  }
  async read(relative, {binary=false}={}) {
    const target=await this.location(relative);
    let handle;
    try { handle=await fs.open(target,constants.O_RDONLY|constants.O_NOFOLLOW); }
    catch(error) { if(error.code==='ENOENT')return null;throw error; }
    try {
      const stat=await handle.stat();
      requireThat(stat.isFile(), 'file', 'Select a file.', {path:relative});
      requireThat(stat.size<=this.maxBytes, 'size', 'File exceeds the reading limit.',{path:relative,size:stat.size});
      const bytes=await handle.readFile();
      const result={path:relative,bytes:new Uint8Array(bytes),sha256:await nodeServices.hash(bytes),size:bytes.length,mode:stat.mode&0o777,
        modified_at:stat.mtime.toISOString(),created_at:stat.birthtimeMs>0?stat.birthtime.toISOString():null,
        created_at_basis:stat.birthtimeMs>0?'filesystem_birthtime':'unknown'};
      if(!binary)result.text=new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(bytes);
      return result;
    } finally { await handle.close(); }
  }
  /** Cheap identity for validating a multi-call inventory without rehydrating bytes. */
  async fingerprint(relative) {
    let stat;try{stat=await fs.lstat(await this.location(relative));}
    catch(error){if(error.code==='ENOENT')return null;throw error;}
    requireThat(stat.isFile()&&!stat.isSymbolicLink(),'file','Select a regular file.',{path:relative});
    return [stat.dev,stat.ino,stat.size,stat.mtimeMs,stat.ctimeMs];
  }
  async mkdir(relative) {
    requireThat(this.writable,'read-only','Source folders are read-only.');
    const target=await this.location(relative+'/.directory-check',{createParent:true});
    return path.dirname(target);
  }
  async list(relative='',{recursive=true,hidden=false}={}) {
    relativePath(relative,{root:true});const out=[];
    const visit=async dir=>{
      const target=await this.location(dir);
      const entries=(await fs.readdir(target,{withFileTypes:true})).sort((a,b)=>a.name.localeCompare(b.name));
      for(const e of entries){
        if(!hidden && (e.name.startsWith('.')||e.name.startsWith('~$')))continue;
        const rel=dir?dir+'/'+e.name:e.name;
        if(e.isSymbolicLink()){out.push({path:rel,kind:'symlink'});continue;}
        out.push({path:rel,kind:e.isDirectory()?'directory':'file'});
        if(recursive&&e.isDirectory())await visit(rel);
      }
    };
    await visit(relative);return out;
  }
  async write(relative, content, options={}) {
    requireThat(this.writable,'read-only','Source folders are read-only.');
    requireThat(Object.hasOwn(options,'expected'), 'baseline', 'An expected baseline is required before writing.');
    requireThat(options.expected===null || /^[a-f0-9]{64}$/.test(options.expected), 'baseline', 'Invalid expected baseline.');
    const clean=relativePath(relative), bytes=typeof content==='string'?new TextEncoder().encode(content):content;
    requireThat(bytes instanceof Uint8Array && bytes.length<=this.maxBytes,'size','Invalid or oversized write.');
    const lockRel='.llmwiki/locks/'+await nodeServices.hash(clean)+'.lock';
    const lockPath=await this.location(lockRel,{createParent:true}),canonical=await fs.realpath(this.root),target=path.join(canonical,clean);
    const writer=acquireWriter({root:canonical,target,lockPath,clean});
    try {
      const current=await this.read(clean,{binary:true});
      requireThat((current?.sha256??null)===options.expected,'stale','The file changed since the expected baseline.',{path:clean,current:current?.sha256??null});
      await this.location(clean,{createParent:true});
      const temporary=writer.temporary;
      const file=await fs.open(temporary,'wx',current?.mode??options.mode??0o666);
      try{if(current?.mode!==undefined)await file.chmod(current.mode);await file.writeFile(bytes);await file.sync();}finally{await file.close();}
      const checked=await this.read(clean,{binary:true});
      requireThat((checked?.sha256??null)===options.expected,'stale','The file changed before replacement.',{path:clean});
      if(options.expected===null){
        try{await fs.link(temporary,target);}catch(error){if(error.code==='EEXIST')throw new WikiError('stale','The file was created by another writer.',{path:clean});throw error;}
        await fs.unlink(temporary);
      } else await fs.rename(temporary,target);
      const digest=await nodeServices.hash(bytes),readback=await this.read(clean,{binary:true});
      requireThat(readback?.sha256===digest,'mismatch','The saved file changed during verification.',{path:clean});
      return {saved:true,path:clean,sha256:digest};
    } finally {
      writer.release();
    }
  }
  async archive(from,to,expected){
    requireThat(this.writable,'read-only','Sources are read-only.');
    const seen=await this.read(from,{binary:true});requireThat(seen?.sha256===expected,'stale','The original changed before archiving.');
    const target=await this.location(to,{createParent:true}),source=await this.location(from);
    const archived=await this.read(to,{binary:true});requireThat(!archived||archived.sha256===expected,'exists','Archive destination already exists with different content.');
    if(!archived)await fs.link(source,target);
    const verified=await this.read(from,{binary:true});requireThat(verified?.sha256===expected,'stale','The original changed while archiving; both copies are retained.');
    await fs.unlink(source);
    requireThat((await this.read(to,{binary:true}))?.sha256===expected,'mismatch','Archive verification failed.');
  }
  async substore(relative,options={}) {
    const root=await this.location(relative,{createParent:false});
    const store=new NodeStore(root,{...options,writable:this.writable && options.writable!==false});
    await store.location('');return store;
  }
}
