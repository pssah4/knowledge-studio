/* Read-only local source display with fully bundled Office renderers (IMP-08-05-02).
   No document markup is inserted into the editor. Blob URLs live for one view. */
(function(global){
"use strict";
const OFFICE=new Set("doc docx docm dot dotx dotm xls xlsx xlsm xlt xltx xltm ppt pptx pptm pot potx potm pps ppsx ppsm".split(" "));
const ALIASES={dot:"doc",dotx:"docx",dotm:"docm",xlt:"xls",xltx:"xlsx",xltm:"xlsm",pot:"ppt",pps:"ppt",potx:"pptx",potm:"pptm",ppsm:"pptm"};
const IMAGES={png:"image/png",jpg:"image/jpeg",jpeg:"image/jpeg",gif:"image/gif",webp:"image/webp",bmp:"image/bmp",avif:"image/avif",svg:"image/svg+xml"};
const TEXT=new Set("txt md markdown csv tsv json yaml yml xml log".split(" "));
const MAX_BYTES=100*1024*1024;
const msg=(key,values)=>global.I18n.message(key,values);
function kind(name){const ext=name.split(".").pop().toLowerCase();return ext==="pdf"?"pdf":OFFICE.has(ext)?"office":IMAGES[ext]?"image":TEXT.has(ext)?"text":"unsupported";}
function node(tag,cls,message){const n=global.document.createElement(tag);if(cls)n.className=cls;if(message!==undefined)global.I18n.appendText(n,message);return n;}
function mount(parent,options){
  let closed=false,officeListener=null,officeTimer=null;const urls=[];
  parent.replaceChildren();
  const hint=node("p","ws-viewer-message",msg("Loading source…"));parent.append(hint);
  const url=blob=>{const value=global.URL.createObjectURL(blob);urls.push(value);return value;};
  const ready=(async()=>{
    try{
      const file=await global.FolderAccess.readBlob(options.dir,options.name);
      if(closed)return;
      if(file.size>MAX_BYTES)throw global.I18n.error(msg("This source exceeds 100 MB. Open it in your desktop application."));
      const type=kind(options.name),ext=options.name.split(".").pop().toLowerCase();
      parent.replaceChildren();
      const bar=node("div","ws-viewer-bar"),label=node("span","ws-muted",type==="office"?msg("{format} · Local preview",{format:ext.toUpperCase()}):ext.toUpperCase());bar.append(label);
      const download=node("a","ws-viewer-download",msg("Download original"));download.href=url(file);download.download=options.name.split("/").pop();bar.append(download);parent.append(bar);
      const body=node("div","ws-viewer-body");parent.append(body);
      if(type==="text"){
        if(file.size>2000000)throw global.I18n.error(msg("This text exceeds 2 MB. Open it in your desktop application."));
        const text=await file.text();if(closed)return;body.append(node("pre","ws-source-text",text));return;
      }
      if(type==="image"){
        const image=node("img","ws-source-image");image.alt=options.name;image.src=url(new Blob([file],{type:IMAGES[ext]}));image.addEventListener("error",()=>{if(!closed)body.replaceChildren(node("p","ws-viewer-message",msg("This image cannot be displayed.")));});body.append(image);return;
      }
      if(type==="unsupported"){body.append(node("p","ws-viewer-message",msg("No preview is available for this format. Export it as PDF in its original application.")));return;}
      if(type==="office"){
        const bytes=await file.arrayBuffer();if(closed)return;
        const html=await global.OfficeBundle.html();if(closed)return;
        const frame=node("iframe","ws-source-office");frame.title=global.I18n.render(msg("Source preview: {name}",{name:options.name}));frame.setAttribute("sandbox","allow-scripts");
        const token=global.crypto.randomUUID();
        const fail=()=>{if(!closed){body.replaceChildren(node("p","ws-viewer-message",msg("This Office file cannot be displayed by the bundled viewer. It may be protected, damaged or contain unsupported features.")));clearTimeout(officeTimer);}};
        officeListener=event=>{
          if(closed||event.source!==frame.contentWindow)return;
          if(event.data?.type==="office-ready"){
            frame.contentWindow.postMessage({type:"open-office",token,bytes,name:options.name.replace(/[^.]+$/,ALIASES[ext]||ext),locale:global.I18n.language(),icons:global.WorkspaceIcons},"*",[bytes]);
          }else if(event.data?.token===token&&event.data.type==="office-loaded"){clearTimeout(officeTimer);frame.dataset.loaded="true";}
          else if(event.data?.token===token&&event.data.type==="office-error")fail();
        };
        global.addEventListener("message",officeListener);officeTimer=setTimeout(fail,60000);frame.srcdoc=html;body.append(frame);return;
      }
      const pdf=file;
      if(pdf.size>MAX_BYTES)throw global.I18n.error(msg("This source exceeds 100 MB. Open it in your desktop application."));
      if(await pdf.slice(0,5).text()!=="%PDF-")throw global.I18n.error(msg("This PDF cannot be displayed."));
      if(closed)return;
      const address=url(new Blob([pdf],{type:"application/pdf"}));
      const open=node("a","ws-viewer-download",msg("Open PDF in a new tab"));open.href=address;open.target="_blank";open.rel="noopener noreferrer";bar.append(open);
      const frame=node("iframe","ws-source-pdf");frame.title=String(global.I18n.render(msg("Source preview: {name}",{name:options.name})));frame.src=address;body.append(frame);
    }catch(error){if(!closed){parent.replaceChildren(node("p","ws-viewer-message",global.I18n.fromError(error)));}}
  })();
  return {ready,destroy(){closed=true;clearTimeout(officeTimer);if(officeListener)global.removeEventListener("message",officeListener);for(const value of urls)global.URL.revokeObjectURL(value);parent.replaceChildren();}};
}
global.SourceViewer={kind,mount};
})(typeof globalThis==="object"?globalThis:this);
