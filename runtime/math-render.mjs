/** Offline formula display (FEAT-08-07). KaTeX emits only MathML, copied through
 * an allowlist into DOM nodes. No fonts, HTML extensions, links or network I/O.
 * Source text remains in the editor buffer and never comes from rendered DOM.
 */
import katex from 'katex';
const tags=new Set('math semantics annotation mrow mi mo mn mtext mspace ms mfrac msqrt mroot mstyle merror mpadded mphantom mfenced menclose msub msup msubsup munder mover munderover mmultiscripts mprescripts none mtable mtr mtd mlabeledtr'.split(' '));
const attributes=new Set('display mathvariant mathsize mathcolor mathbackground scriptlevel displaystyle stretchy symmetric largeop movablelimits fence separator lspace rspace width height depth voffset linethickness bevelled notation accent accentunder rowalign columnalign rowspacing columnspacing columnspan rowspan rowlines columnlines frame framespacing equalrows equalcolumns encoding'.split(' '));
export function renderFormula(root,source,displayMode=false){
 root.replaceChildren();root.classList.remove('ws-formula-error');root.removeAttribute('role');root.removeAttribute('title');root.classList.add('ws-formula');
 try{
  if(typeof source!=='string'||source.length>10000)throw Error('Formula exceeds the display limit.');
  const markup=katex.renderToString(source,{output:'mathml',displayMode,trust:false,strict:'error',throwOnError:true,maxExpand:1000,maxSize:10,macros:{}});
  const parsed=new DOMParser().parseFromString(markup,'text/html'),math=parsed.querySelector('math');if(!math)throw Error('Formula has no MathML output.');
  const copy=node=>{if(node.nodeType===3)return root.ownerDocument.createTextNode(node.textContent);if(node.nodeType!==1||!tags.has(node.localName))throw Error('Unsupported formula element.');const result=root.ownerDocument.createElementNS('http://www.w3.org/1998/Math/MathML',node.localName);for(const attr of node.attributes)if(attributes.has(attr.name))result.setAttribute(attr.name,attr.value);for(const child of node.childNodes)result.append(copy(child));return result;};
  root.append(copy(math));return true;
 }catch(error){root.classList.add('ws-formula-error');root.textContent=source;root.title=error.message;root.setAttribute('role','note');return false;}
}
