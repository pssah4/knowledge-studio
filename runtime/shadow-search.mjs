/** Section BM25 and neighboring source ranges. Generated context is never quoted. */
export const shadowTokens=text=>String(text).toLocaleLowerCase().normalize('NFKC').match(/[\p{L}\p{N}]+/gu)??[];
const stop=new Set('der die das den dem des ein eine einer eines und oder ist sind war waren warum wie was why the a an and or is are was were'.split(' '));
export const shadowTerms=text=>{const words=[...new Set(shadowTokens(text))],content=words.filter(w=>!stop.has(w));return content.length?content:words;};
export function sectionRanking(documents,question){
 const terms=shadowTerms(question),sections=[];
 for(const document of documents)for(let index=0;index<document.data.blocks.length;index++){
  const block=document.data.blocks[index];if(block.kind==='heading')continue;
  const words=shadowTokens(block.quote),frequencies=new Map();for(const word of words)frequencies.set(word,(frequencies.get(word)??0)+1);
  sections.push({document,block,index,length:words.length,frequencies,headings:new Set(shadowTokens(block.headings.join(' ')))});
 }
 const average=sections.reduce((n,s)=>n+s.length,0)/Math.max(1,sections.length),counts=new Map(terms.map(t=>[t,sections.filter(s=>s.frequencies.has(t)).length]));
 for(const section of sections){section.score=0;for(const term of terms){const tf=section.frequencies.get(term)??0,idf=Math.log(1+(sections.length-counts.get(term)+.5)/(counts.get(term)+.5));section.score+=idf*(tf*2.2/(tf+1.2*(.25+.75*section.length/Math.max(1,average)))+(section.headings.has(term)?.2:0));}}
 return sections.filter(s=>s.score>0).sort((a,b)=>b.score-a.score||a.block.start-b.block.start);
}

export function sectionWindow(document,index,budget,bodyOffset=0,question=''){
 const blocks=document.data.blocks,block=blocks[index];let start=block.start,end=block.end;
 if(end-start>budget){
  const terms=new Set(shadowTerms(question)),matches=[...block.quote.matchAll(/[\p{L}\p{N}]+/gu)].filter(m=>terms.has(m[0].toLocaleLowerCase().normalize('NFKC')));let best=-1;
  for(const match of matches){const candidate=Math.max(block.start,Math.min(block.end-budget,block.start+match.index-Math.floor(budget/4))),score=new Set(shadowTokens(document.data.source.slice(candidate,candidate+budget)).filter(t=>terms.has(t))).size;if(score>best){start=candidate;best=score;}}
  end=Math.min(block.end,start+budget);
  if(start>block.start&&/[\uDC00-\uDFFF]/.test(document.data.source[start]))start++;
  if(end<block.end&&/[\uDC00-\uDFFF]/.test(document.data.source[end]))end--;
  return {start:start-bodyOffset,end:end-bodyOffset,headings:block.headings};
 }
 // Prefer a following qualification, then a preceding explanation. The window
 // remains contiguous original text; the heading path is supplied separately.
 if(blocks[index+1]&&blocks[index+1].kind!=='heading'&&blocks[index+1].end-start<=budget)end=blocks[index+1].end;
 if(blocks[index-1]&&end-blocks[index-1].start<=budget)start=blocks[index-1].start;
 return {start:Math.max(0,start-bodyOffset),end:Math.max(0,Math.min(end,start+budget)-bodyOffset),headings:block.headings};
}
