/** Copy and verify a working tree before switching its project assignment.
 * Originals, old work, review receipts and old sync baselines are retained.
 */
import {load,context,folderStore,saveSettings,syncIdentity,selectWorkspace} from './project.mjs';
import {requireThat,relativePath} from './core/errors.mjs';

async function snapshot(store){
 const entries=await store.list('',{hidden:true}),files=new Map();
 requireThat(!entries.some(e=>e.kind==='symlink'),'symlink','Working copies with symbolic links cannot be relocated.');
 requireThat(!entries.some(e=>e.kind==='file'&&e.path.startsWith('.llmwiki/locks/')),'busy','Finish active saves before relocating the working copy.');
 for(const e of entries)if(e.kind==='file'&&e.path!=='.DS_Store'){
  const file=await store.read(e.path,{binary:true});requireThat(file,'stale','A file disappeared during relocation.');files.set(e.path,file);
 }
 return files;
}
export async function relocate(root,args,{bindings={},editorHTML=null}={}){
 const {project,file}=await load(root);requireThat(file.sha256===args.expected,'stale','Reload the exact project settings before relocating.');
 const c=await context(root,args.connection,{bindings,work:args.work}),target=args.target;
 requireThat(target&&/^[a-z][a-z0-9_-]*$/.test(target.id)&&!project.folders.some(f=>f.id===target.id),'work','Choose a new, unused working-folder ID.');
 requireThat(target.path===null||typeof target.path==='string','path','Choose a bound or project-relative target directory.');
 if(target.path!==null)relativePath(target.path);
 const next={...c.workFolder,id:target.id,path:target.path},destination=await folderStore(root,next,{bindings});
 // Every existing folder is protected, including unassigned working copies.
 const clean=s=>typeof s==='string'?s.replace(/\\/g,'/').replace(/\/+$/,''):null;
 const targetRoot=clean(destination.root);
 for(const f of project.folders){const store=await folderStore(root,f,{bindings,writable:false});const oldRoot=clean(store.root);
  requireThat(targetRoot!==null&&oldRoot!==null,'capability','This runtime cannot verify directory separation for relocation.');
  requireThat(targetRoot!==''&&oldRoot!==''&&targetRoot!==oldRoot&&!targetRoot.startsWith(oldRoot+'/')&&!oldRoot.startsWith(targetRoot+'/'),'binding_overlap','Choose a separate empty working directory.',{folder:f.id});
 }
 const occupied=(await destination.list('',{hidden:true})).filter(e=>e.path!=='.DS_Store');
 requireThat(!occupied.length,'occupied','The selected working directory is not empty. Its contents are preserved.');
 const original=await snapshot(c.work),receipt=[];
 for(const [name,seen]of original){const content=destination.capabilities?.textWritesOnly?(seen.text??new TextDecoder('utf-8',{fatal:true}).decode(seen.bytes)):(seen.bytes??seen.text);await destination.write(name,content,{expected:null});const copied=await destination.read(name,{binary:true});requireThat(copied?.sha256===seen.sha256,'mismatch','Working-copy verification failed.',{page:name});receipt.push({page:name,sha256:seen.sha256});}
 // Sync paths include the working-folder identity; retain the old records and
 // create equivalent baselines for the new identity before any sync can run.
 const wikiIDs=new Set(project.connections.filter(x=>x.works.includes(c.workFolder.id)).map(x=>x.wiki));
 for(const wikiID of wikiIDs){
  const wiki=project.folders.find(f=>f.id===wikiID),priorIdentity=syncIdentity(project,wiki,c.workFolder),identity=syncIdentity(project,wiki,next),oldPrefix='.llmwiki/editor-sync/'+await root.services.hash(priorIdentity)+'/',newPrefix='.llmwiki/editor-sync/'+await root.services.hash(identity)+'/';
  for(const [name,seen]of original)if(name.startsWith(oldPrefix)&&name.endsWith('.json')){
   const data=JSON.parse(seen.text??new TextDecoder().decode(seen.bytes));requireThat(data.format==='llmwiki-editor-sync/1'&&data.identity===priorIdentity,'sync','Invalid sync baseline; relocation stopped.');
   await destination.write(newPrefix+name.slice(oldPrefix.length),JSON.stringify({...data,identity}),{expected:null});
  }
 }
 const current=await snapshot(c.work);requireThat(current.size===original.size&&[...original].every(([p,v])=>current.get(p)?.sha256===v.sha256),'stale','The working copy changed during relocation. The original assignment is preserved.');
 requireThat((await root.read('llmwiki.project.json'))?.sha256===file.sha256,'stale','Project settings changed during relocation.');
 const audit='.llmwiki/relocations/'+root.services.uuid()+'.json';
 await root.write(audit,JSON.stringify({format:'llmwiki-relocation/1',at:root.services.now(),from:c.workFolder,to:next,files:receipt,deleted:0},null,2)+'\n',{expected:null});
 project.folders=project.folders.map(f=>f.id===c.workFolder.id?next:f);
 project.connections=project.connections.map(x=>({...x,works:x.works.map(id=>id===c.workFolder.id?next.id:id)}));
 const saved=await saveSettings(root,project,file.sha256,{bindings,editorHTML});
 await selectWorkspace(root,c.connection.id,next.id);
 return {...saved,from:c.workFolder.id,to:next.id,copied:receipt.length,deleted:0,published:0,receipt:audit};
}
