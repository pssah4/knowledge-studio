/** Optional, explicit local branding adapter. Public builds have no private dependency. */
import {pathToFileURL} from 'node:url';
import path from 'node:path';
export async function applyEditorDesign(html,profile){
 if(!profile||typeof profile==='string'||!profile.editorAdapter)return html;
 const adapter=await import(pathToFileURL(path.resolve(profile.editorAdapter)).href);
 return adapter.applyEditorDesign(html,profile.id);
}
