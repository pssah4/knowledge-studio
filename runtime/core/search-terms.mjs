/** Deterministic, bounded German lexical matching for file and shadow retrieval.
 * Original strings/offsets never change. This is conservative stemming, not a
 * dictionary or semantic inference. Compound matches require a long suffix.
 */
export const searchTokens=text=>String(text).toLowerCase().normalize('NFKC').match(/[\p{L}\p{N}]+/gu)??[];
function stem(value){
 if(value.length<=3)return value;
 value=value.replace(/ß/g,'ss').normalize('NFKD').replace(/\p{M}/gu,'').replace(/ae/g,'a').replace(/oe/g,'o').replace(/ue/g,'u');
 let boundary=value.length;for(let i=1;i<value.length;i++)if(/[aeiouy]/.test(value[i-1])&&!/[aeiouy]/.test(value[i])){boundary=Math.max(3,i+1);break;}
 for(const suffix of ['ern','em','er','en','es','e','s'])if(value.endsWith(suffix)&&value.length-suffix.length>=boundary){if(suffix==='s'&&!/[bdfghklmnrt]/.test(value.at(-2)))continue;return value.slice(0,-suffix.length);}
 return value;
}
export function matchWeight(term,word){
 if(term===word)return 1;if(term.length<=3||word.length<=3)return 0;
 const query=stem(term),candidate=stem(word);if(query===candidate)return .8;
 const prefix=candidate.length-query.length;return query.length>=5&&prefix>=2&&prefix<=20&&candidate.endsWith(query)?.55:0;
}
export function termFrequency(term,frequencies){let total=0;for(const [word,count]of frequencies)total+=matchWeight(term,word)*count;return total;}
export function termPresence(term,words){let best=0;for(const word of words)best=Math.max(best,matchWeight(term,word));return best;}
export function expansionEvidence(terms,words,limit=64){const expansions=[],seen=new Set();let truncated=false;
 for(const term of terms)for(const word of words){const weight=matchWeight(term,word),key=term+'\0'+word;if(!weight||weight===1||seen.has(key))continue;seen.add(key);if(expansions.length>=limit){truncated=true;continue;}expansions.push({query:term,word,kind:weight===.8?'word-form':'compound-suffix',weight});}
 return {method:'german-conservative/1',weights:{exact:1,word_form:.8,compound_suffix:.55},expansions,truncated};
}
