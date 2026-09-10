/** Office XML boundary for the Chromium host. Parsing is inert and network-free.
 * The common reader rejects DTD/entity declarations before reaching this parser. */
function parse(text){const xml=new DOMParser().parseFromString(text,'application/xml');if(xml.getElementsByTagName('parsererror').length)throw Error('Malformed source XML.');return xml;}
export const XMLValidator={validate(text){try{parse(text);return true;}catch(error){return {err:{msg:error.message}};}}};
export class XMLParser{
 parse(text){const xml=parse(text);
   function nodes(parent){const out=[];for(const node of parent.childNodes){
     if(node.nodeType===3||node.nodeType===4)out.push({'#text':node.nodeValue});
     else if(node.nodeType===1){const name=node.nodeName,item={[name]:nodes(node)},attrs=Object.create(null);for(const attr of node.attributes)attrs['@_'+attr.name]=attr.value;if(Object.keys(attrs).length)item[':@']=attrs;out.push(item);}
   }return out;}
   return nodes(xml);
 }
}
