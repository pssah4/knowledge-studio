/** One physical working folder contributes one knowledge scope. Full home
 * connections name it before selective connections to other bundles do. */
export function knowledgeScopes(contexts){
 const selected=[];
 for(const context of [...contexts].sort((a,b)=>Number((a.connection.scope??'full')!=='full')-Number((b.connection.scope??'full')!=='full'))){
  if(selected.some(({context:prior})=>prior.work===context.work||prior.work.root&&prior.work.root===context.work.root||prior.workFolder.id===context.workFolder.id))continue;
  const own=context.connection.scope==='contributions';
  selected.push({context,wiki:{id:own?context.syncOptions.contributionMeta.owner.bundle_id:context.wiki.id,label:own?context.workFolder.label:context.wiki.label,path:own?context.workFolder.path:context.wiki.path,connection:context.connection.id,work:context.workFolder.id,store:context.work}});
 }
 return selected;
}
