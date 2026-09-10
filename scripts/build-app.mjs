import fs from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {build} from 'esbuild';
import {applyEditorDesign} from './editor-design.mjs';
const root=new URL('../app/',import.meta.url);
export async function buildApp({profile=null}={}){
 let html=await fs.readFile(new URL('index.html',root),'utf8'),used=[];
 const {version}=JSON.parse(await fs.readFile(new URL('../package.json',root),'utf8'));
 html=html.replace('<head>','<head>\n<meta name="llmwiki-editor-version" content="'+version+'">');
 const matches=[...html.matchAll(/<link\b[^>]*>|<script\b[^>]*>\s*<\/script\s*>/gi)];
 for(const m of matches){const script=/^<script/i.test(m[0]),source=(script?/\bsrc="([^"]+)"/:/\bhref="([^"]+)"/).exec(m[0]);if(!source)continue;
   const name=source[1];if(!/^[a-zA-Z0-9][\w.-]*\.(?:js|css)$/.test(name))throw Error('Non-local editor asset: '+name);
   const content=await fs.readFile(new URL(name,root),'utf8');if(/<\/\s*(?:script|style)/i.test(content))throw Error('Unsafe editor payload: '+name);
   html=html.replace(m[0],()=>script?'<script>\n'+content+'\n</script>':'<style>\n'+content+'\n</style>');used.push(name);
 }
 for(const file of await fs.readdir(root))if(/\.(js|css)$/.test(file)&&!used.includes(file))throw Error('Editor part is not embedded: '+file);
 const order=['core.js','folder.js','marks.js','writing.js','ui.js'];if(order.some((name,i)=>!used.includes(name)||i&&used.indexOf(name)<used.indexOf(order[i-1])))throw Error('Editor script order changed.');
 if(/<script\b[^>]+\bsrc=|<link\b[^>]+\bhref=/i.test(html))throw Error('Editor retains an external script or stylesheet.');
 const shared=await build({entryPoints:[fileURLToPath(new URL('../runtime/editor-core.mjs',root))],bundle:true,write:false,format:'iife',globalName:'WikiCore',platform:'browser',target:'es2022',legalComments:'inline'});
 const code=shared.outputFiles[0].text.replace(/<\/script/gi,'<\\/script');html=html.replace('</head>',()=>'<script>\n'+code+'\n</script>\n</head>');
 return applyEditorDesign(html.replace(/<!doctype html>/i,'<!DOCTYPE html>\n<!-- Diese Seite wird erzeugt, aus app/ gebaut und nie von Hand geändert. -->'),profile);
}
if(process.argv[1]===fileURLToPath(import.meta.url)){const html=await buildApp();await fs.writeFile(new URL('../runtime/assets/app.html',import.meta.url),html);process.stdout.write('Standalone editor built.\n');}
