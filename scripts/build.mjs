/** Reproducible per-host packages. Build into a fresh staging directory; never
 * collect stale files from a previous output. No runtime package downloads. */
import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {build} from 'esbuild';
import {parseDocument} from '../runtime/core/document.mjs';
import {createZip} from '../vendor/skill-build/zip.mjs';
import {trimRuntimeForHost} from '../vendor/skill-build/runtime.mjs';
import {syncContracts} from './sync-contracts.mjs';
import {buildApp} from './build-app.mjs';
import {applyEditorDesign} from './editor-design.mjs';
import registerText from '../runtime/assets/default-register.mjs';
import {loadWorkshop, validateReleaseMatrix, distributionReadme} from './workshop.mjs';
const root=fileURLToPath(new URL('../',import.meta.url)),version=JSON.parse(await fs.readFile(path.join(root,'package.json'),'utf8')).version;
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
export async function files(dir,prefix=''){const out=[];for(const entry of (await fs.readdir(path.join(dir,prefix),{withFileTypes:true})).sort((a,b)=>a.name.localeCompare(b.name))){const rel=prefix?prefix+'/'+entry.name:entry.name;if(entry.isSymbolicLink())throw Error('Build input contains a symlink: '+rel);if(entry.isDirectory())out.push(...await files(dir,rel));else if(entry.isFile())out.push(rel);}return out;}
async function put(dir,name,content){await fs.mkdir(path.dirname(path.join(dir,name)),{recursive:true});await fs.writeFile(path.join(dir,name),content);}
async function licenses(){const records=[];for(const name of ['katex','commander','yaml','fflate','fast-xml-parser','fast-xml-builder','strnum','path-expression-matcher','pdfjs-dist','@nodable/entities','anynum','is-unsafe','xml-naming']){const dir=path.join(root,'node_modules',name);let pkg;try{pkg=JSON.parse(await fs.readFile(path.join(dir,'package.json'),'utf8'));}catch{continue;}for(const file of await fs.readdir(dir))if(/^(LICENSE|LICENCE|COPYING)/i.test(file))records.push({name:'assets/licenses/'+name.replace(/[^\w.-]/g,'_')+'-'+file.replace(/[^\w.-]/g,'_'),text:await fs.readFile(path.join(dir,file))});}records.push({name:'assets/licenses/skill-build-LICENSE',text:await fs.readFile(path.join(root,'vendor/skill-build/LICENSE'))});return records;}
/** Remove only recognized outputs from the former flat distribution layout.
 * Canonical scopes and current test data are retained; never follow directory links. */
export async function removeObsoleteOutputs({projectRoot=root,currentVersion=version,profileIds=[],skillNames=[]}={}){
 const dist=path.join(projectRoot,'dist');
 let info;try{info=await fs.lstat(dist);}catch(error){if(error.code==='ENOENT')return [];throw error;}
 if(info.isSymbolicLink()||!info.isDirectory())throw Error('Distribution root must be a real directory');
 const legacyProfiles=new Set(profileIds),legacySkills=new Set(skillNames.flatMap(name=>[name+'.skill',name+'.skill.sha256']));
 // Include the other matrix without loading its private configuration.
 for(const scope of ['public','internal']){
  const dir=path.join(dist,scope);let stat;try{stat=await fs.lstat(dir);}catch(error){if(error.code==='ENOENT')continue;throw error;}
  if(stat.isDirectory()&&!stat.isSymbolicLink())for(const entry of await fs.readdir(dir,{withFileTypes:true}))if(entry.isDirectory())legacyProfiles.add(entry.name);
 }
 const removed=[];
 for(const entry of await fs.readdir(dist,{withFileTypes:true})){
  const name=entry.name;
  if(['public','internal','README.md'].includes(name))continue;
  const oldPackage=/^(?:llm-wiki(?:-public)?-\d+\.\d+\.\d+(?:-[\w.-]+)?\.zip(?:\.sha256)?|release-\d+\.\d+\.\d+(?:-[\w.-]+)?\.json)$/.test(name);
  const testArchive=/^llmwiki-(fachtest|testpaket)-(\d+\.\d+\.\d+(?:-[\w.-]+)?)\.zip(?:\.sha256)?$/.exec(name);
  const oldTest=testArchive&&(testArchive[1]==='testpaket'||testArchive[2]!==currentVersion);
  if(legacyProfiles.has(name)||legacySkills.has(name)||oldPackage||oldTest||['app.html','SHA256SUMS.txt','llmwiki-testdaten.zip'].includes(name)){
   await fs.rm(path.join(dist,name),{recursive:true,force:true,maxRetries:5,retryDelay:100});removed.push('dist/'+name);
  }
 }
 return removed.sort();
}
export async function buildRelease({privateProfiles=false}={}){
 const workshop=await loadWorkshop({privateProfiles});
 const outputRoot=path.join(root,privateProfiles?'dist/internal':'dist/public'),buildRoot=path.join(root,privateProfiles?'build-internal':'build');
 await syncContracts({check:true});const html=await buildApp(),profiles=workshop.profiles,vaultContract=JSON.parse(await fs.readFile(path.join(root,'platforms/vault-contract.json'),'utf8'));
 const stage=await fs.mkdtemp(path.join(root,'.release-stage-')),docs=await fs.readFile(path.join(root,'platforms/runtime.md'),'utf8'),attributions=await licenses(),manifest={format:'llmwiki-release/1',version,workshop:workshop.provenance,packages:[]};
 try{
  for(const profile of profiles)for(const definition of workshop.skills){
   const name=definition.name;
   const dir=path.join(stage,'build',profile.id,name),source=path.join(root,'skills',name),skill=await fs.readFile(path.join(source,'SKILL.md'),'utf8'),head=parseDocument(skill).head;
   if(head.name!==name||head.description.length>300||skill.length>24000)throw Error('Skill routing contract exceeded: '+name);
   const queryOnly=definition.access==='read-only',queryCall=profile.engine==='vault'?'Call run_skill_script with this structured JSON, replacing the known project root: {"skill_name":"query-llm-wiki","script_name":"wiki","args":{"action":"inspect","root":"<known vault-relative project>"}}.':'Run node "<loaded-skill>/scripts/wiki.mjs" --root "<known-project>" --input \'{"action":"inspect"}\'. Use properly quoted paths and structured request data.';
   const reference=queryOnly?(await fs.readFile(path.join(root,'platforms/query-runtime.md'),'utf8')).replace('{{CALL}}',queryCall):profile.runtimeReference?await fs.readFile(path.join(root,profile.runtimeReference),'utf8'):trimRuntimeForHost(docs,profile.section);
   const hostReference=queryOnly&&profile.queryHostReference?'\n'+await fs.readFile(path.join(root,profile.queryHostReference),'utf8'):'';
   const hostInstructions=queryOnly?'\n## Installed host: '+profile.section+'\n\nThis package uses '+(profile.engine==='vault'?'the Vault runtime; use the Vault call below, never Node.':'Node; use the Node calls below, never the Vault entry.')+' The start contract is already in this loaded skill; no reference-file read is required before inspect/query.\n'+hostReference+'\n':profile.skillAppend?'\n'+await fs.readFile(path.join(root,profile.skillAppend),'utf8')+'\n':'';
   const skillText=skill.replace(/^(# .+\n)/m,heading=>heading+hostInstructions);
   if(skillText.length>24000)throw Error('Embedded skill contract exceeded: '+name);
   await put(dir,'SKILL.md',skillText);
   const answerReference=queryOnly&&profile.engine==='node'?'\n## Browser answer output\nIf chat cannot open local editor citations, use the bundled presentation helper described in [answer.md](answer.md). It creates only a new answer HTML; wiki.mjs remains strictly read-only. Follow any host-specific opening instructions above.\n':'';
   await put(dir,'references/runtime.md',reference+hostReference+answerReference);await put(dir,'references/operations.md',await fs.readFile(path.join(root,queryOnly?'platforms/query-operations.md':'platforms/operations.md')));
   if(answerReference)await put(dir,'references/answer.md',await fs.readFile(path.join(root,'platforms/query-answer.md'),'utf8'));
   for(const ref of definition.references??[])await put(dir,'references/'+ref,await fs.readFile(profile.references?.[ref]?path.join(root,profile.references[ref]):path.join(source,'references',ref)));
   await put(dir,'LICENSE',await fs.readFile(path.join(root,'LICENSE')));await put(dir,'assets/NOTICE.md',await fs.readFile(path.join(root,'NOTICE.md')));
   for(const file of attributions)await put(dir,file.name,file.text);
   await put(dir,'assets/office-NOTICES.txt',await fs.readFile(path.join(root,'runtime/assets/office-NOTICES.txt')));
   await put(dir,'assets/app.html',await applyEditorDesign(html,profile));
   for(const [name,file] of Object.entries(profile.assets??{}))await put(dir,name,await fs.readFile(path.join(root,file)));
   await put(dir,'assets/TYPES.md',registerText);
   const readOnly=definition.access==='read-only',options={absWorkingDir:root,bundle:true,write:true,minify:false,legalComments:'inline',target:'es2022',define:{__LLMWIKI_ALLOW_LOCAL_BINDING__:String(profile.allowLocalBinding!==false),__LLMWIKI_HOST_OPEN_TOOL__:JSON.stringify(profile.hostOpenTool??null),__LLMWIKI_PROFILE__:JSON.stringify(profile.id),__LLMWIKI_BRAND__:JSON.stringify(profile.brand??'Knowledge Studio'),__LLMWIKI_VERSION__:JSON.stringify(version),__LLMWIKI_READ_ONLY__:String(readOnly),__PDFJS_ASSETS__:'"./pdf/"',__EDITOR_HTML__:'"../assets/app.html"'}};
   if(profile.engine==='node'){
    if(queryOnly)await build({...options,entryPoints:['runtime/answer-cli.mjs'],outfile:path.join(dir,'scripts/answer.mjs'),platform:'node',format:'esm',banner:{js:'import {createRequire as createHostRequire} from "node:module"; const require = createHostRequire(import.meta.url);'}});
    await build({...options,entryPoints:['runtime/node-cli.mjs'],outfile:path.join(dir,'scripts/wiki.mjs'),platform:'node',format:'esm',banner:{js:'import {createRequire as createHostRequire} from "node:module"; const require = createHostRequire(import.meta.url);'},plugins:[{name:'packaged-pdf',setup(b){b.onResolve({filter:/^pdfjs-dist\/legacy\/build\/pdf\.mjs$/},()=>({path:'./pdf/pdf.mjs',external:true}));}}]});
    for(const f of ['pdf.mjs','pdf.worker.mjs'])await put(dir,'scripts/pdf/'+f,await fs.readFile(path.join(root,'node_modules/pdfjs-dist/legacy/build',f)));
    for(const folder of ['cmaps','standard_fonts','wasm'])for(const f of await files(path.join(root,'node_modules/pdfjs-dist',folder)))await put(dir,'scripts/pdf/'+folder+'/'+f,await fs.readFile(path.join(root,'node_modules/pdfjs-dist',folder,f)));
   }else{
    const result=await build({...options,write:false,minify:true,entryPoints:['runtime/vault-entry.mjs'],platform:'browser',format:'iife',globalName:'WikiRuntime',mainFields:['browser','module','main'],plugins:[{name:'chromium-boundaries',setup(b){
      b.onResolve({filter:/^fast-xml-parser$/},()=>({path:path.join(root,'runtime/readers/dom-xml.mjs')}));
      b.onLoad({filter:/default-register\.mjs$/},()=>({contents:'export default null;',loader:'js'}));
    }}]});
    const script=result.outputFiles[0].text+'\nexport async function execute(args, ctx) { return WikiRuntime.execute(args, ctx); }\n';if(/\bimport\s*(?:\(|[\w{*])|\brequire\s*\(|\bprocess\./.test(script))throw Error('The vault payload contains a host dependency.');
    for(const pattern of vaultContract.blockedPatterns)if(new RegExp(pattern.source,pattern.flags).test(script))throw Error('Vault sandbox contract: '+pattern.reason);await put(dir,'scripts/wiki.js',script);
   }
   if(profile.layout==='openai')await put(dir,'agents/openai.yaml','interface:\n'+Object.entries(definition.interface).map(([key,value])=>'  '+key+': '+JSON.stringify(value)+'\n').join('')+'policy:\n  allow_implicit_invocation: true\n');
   const entries=[];let uncompressed=0;for(const rel of await files(dir)){if(/\.py[co]?$|node_modules|__pycache__/.test(rel))throw Error('Nonportable package file: '+rel);if(profile.engine==='vault'&&!vaultContract.pkg.whitelist.some(p=>new RegExp(p.source,p.flags).test(rel)))throw Error('Vault package layout: '+rel);const bytes=await fs.readFile(path.join(dir,rel));uncompressed+=bytes.length;entries.push({path:rel,sha256:hash(bytes)});}
   if(profile.engine==='vault'&&uncompressed>vaultContract.pkg.maxUncompressedBytes-100000)throw Error('Vault package size exceeded.');
   const origin={format:'llmwiki-build/1',version,skill:name,access:definition.access,profile,workshop:workshop.provenance,source:'https://github.com/pssah4/knowledge-studio',build_mechanisms:JSON.parse(await fs.readFile(path.join(root,'vendor/skill-build/ORIGIN.json'),'utf8')),files:entries};
   await put(dir,'assets/build-manifest.json',JSON.stringify(origin,null,2)+'\n');
   const archive=createZip(await Promise.all((await files(dir)).map(async rel=>({name:name+'/'+rel,data:await fs.readFile(path.join(dir,rel))}))));
   const output=profile.id+'/'+name+'.skill';await put(stage,'dist/'+output,archive);await put(stage,'dist/'+output+'.sha256',hash(archive)+'  '+name+'.skill\n');manifest.packages.push({profile:profile.id,skill:name,file:output,sha256:hash(archive),bytes:archive.length,files:entries.length+1});
  }
  if(profiles.some(p=>p.id==='claude-code')){
  const plugin={...JSON.parse(await fs.readFile(path.join(root,'.claude-plugin/plugin.json'),'utf8')),version};
  const pluginEntries=[{name:'.claude-plugin/plugin.json',data:Buffer.from(JSON.stringify(plugin,null,2)+'\n')},{name:'LICENSE',data:await fs.readFile(path.join(root,'LICENSE'))}];
  for(const {name} of workshop.skills)for(const rel of await files(path.join(stage,'build/claude-code',name)))pluginEntries.push({name:'skills/'+name+'/'+rel,data:await fs.readFile(path.join(stage,'build/claude-code',name,rel))});
  const pluginArchive=createZip(pluginEntries.sort((a,b)=>a.name.localeCompare(b.name)));await put(stage,'dist/llm-wiki-'+version+'.zip',pluginArchive);await put(stage,'dist/llm-wiki-'+version+'.zip.sha256',hash(pluginArchive)+'  llm-wiki-'+version+'.zip\n');manifest.plugin={file:'llm-wiki-'+version+'.zip',sha256:hash(pluginArchive),bytes:pluginArchive.length};
  }
  validateReleaseMatrix(workshop,manifest);
  await put(stage,'dist/release-'+version+'.json',JSON.stringify(manifest,null,2)+'\n');
  await put(stage,'dist/README.md',distributionReadme(workshop,manifest));
  // Replace only product-owned outputs after every package passed its build checks.
  // Finder can recreate .DS_Store while the old output is being removed.
  await fs.mkdir(path.dirname(buildRoot),{recursive:true});await fs.rm(buildRoot,{recursive:true,force:true,maxRetries:5,retryDelay:100});await fs.rename(path.join(stage,'build'),buildRoot);
  await fs.mkdir(path.dirname(outputRoot),{recursive:true});await fs.rm(outputRoot,{recursive:true,force:true});await fs.rename(path.join(stage,'dist'),outputRoot);
  await fs.writeFile(path.join(root,'runtime/assets/app.html'),html);
  await removeObsoleteOutputs({profileIds:profiles.map(p=>p.id),skillNames:workshop.skills.map(s=>s.name)});
  return manifest;
 }finally{await fs.rm(stage,{recursive:true,force:true});}
}
if(process.argv[1]===fileURLToPath(import.meta.url)){const result=await buildRelease({privateProfiles:process.argv.includes('--private')});process.stdout.write(JSON.stringify({version,packages:result.packages.map(p=>({profile:p.profile,skill:p.skill,bytes:p.bytes}))})+'\n');}
