/** Verify the public matrix and collect uniquely named GitHub release assets. */
import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {unzipSync} from 'fflate';
import {loadWorkshop,validateReleaseMatrix} from './workshop.mjs';
const root=new URL('../',import.meta.url),workshop=await loadWorkshop();
const dist=new URL('dist/public/',root),output=new URL('dist/release-assets/',root);
const manifest=JSON.parse(await fs.readFile(new URL('release-'+workshop.version+'.json',dist),'utf8'));
validateReleaseMatrix(workshop,manifest);
const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
const collected=[];
for(const entry of [...manifest.packages,manifest.plugin].filter(Boolean)){
 if(path.isAbsolute(entry.file)||entry.file.split('/').includes('..'))throw Error('Unsafe asset path');
 const bytes=await fs.readFile(new URL(entry.file,dist));
 if(digest(bytes)!==entry.sha256)throw Error('Asset checksum mismatch: '+entry.file);
 if(entry.skill){
  const archive=unzipSync(bytes),prefix=entry.skill+'/',record=JSON.parse(Buffer.from(archive[prefix+'assets/build-manifest.json']).toString());
  if(record.version!==workshop.version||record.profile.id!==entry.profile||Object.keys(archive).length!==record.files.length+1)throw Error('Archive metadata mismatch: '+entry.file);
  for(const file of record.files)if(digest(archive[prefix+file.path])!==file.sha256)throw Error('Archive checksum mismatch: '+file.path);
 }
 const name=entry.profile?entry.profile+'-'+entry.skill+'.skill':entry.file;
 collected.push([name,bytes],[name+'.sha256',Buffer.from(entry.sha256+'  '+name+'\n')]);
}
await fs.rm(output,{recursive:true,force:true});await fs.mkdir(output,{recursive:true});
for(const [name,bytes] of collected)await fs.writeFile(new URL(name,output),bytes);
await fs.copyFile(new URL('release-'+workshop.version+'.json',dist),new URL('release-'+workshop.version+'.json',output));
console.log('Verified '+manifest.packages.length+' packages; collected '+(collected.length+1)+' release assets.');
