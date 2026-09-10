/** Read-only ZIP boundary. Size, duplicate-name and CRC checks precede document parsing. */
import {unzipSync} from 'fflate';
import {requireThat,relativePath} from '../core/errors.mjs';

const crcTable=Uint32Array.from({length:256},(_,i)=>{let n=i;for(let j=0;j<8;j++)n=n&1?0xedb88320^(n>>>1):n>>>1;return n>>>0;});
export function crc32(bytes){let n=0xffffffff;for(const byte of bytes)n=crcTable[(n^byte)&255]^(n>>>8);return (n^0xffffffff)>>>0;}
export function openArchive(bytes,{maxBytes=128*1024*1024,maxFiles=20000}={}){
  requireThat(bytes instanceof Uint8Array&&bytes.length<=maxBytes,'archive','Archive exceeds the input limit.');
  const view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength),files=new Map();let end=-1;
  for(let at=bytes.length-22;at>=Math.max(0,bytes.length-65557);at--)if(view.getUint32(at,true)===0x06054b50){end=at;break;}
  requireThat(end>=0,'archive','Invalid ZIP directory.');
  const count=view.getUint16(end+10,true),start=view.getUint32(end+16,true),directorySize=view.getUint32(end+12,true);
  requireThat(count>0&&count<=maxFiles&&count!==65535&&start+directorySize<=end&&view.getUint16(end+4,true)===0&&view.getUint16(end+6,true)===0,'archive','Unsupported ZIP64, split or oversized archive.');
  let at=start,total=0;
  for(let i=0;i<count;i++){
    requireThat(at+46<=end&&view.getUint32(at,true)===0x02014b50,'archive','Corrupt ZIP entry.');
    const flags=view.getUint16(at+8,true),size=view.getUint32(at+24,true),nameLength=view.getUint16(at+28,true),extra=view.getUint16(at+30,true),comment=view.getUint16(at+32,true),crc=view.getUint32(at+16,true);
    requireThat(!(flags&1)&&at+46+nameLength+extra+comment<=end,'archive','Encrypted or corrupt ZIP entry.');
    const name=new TextDecoder('utf-8',{fatal:true}).decode(bytes.subarray(at+46,at+46+nameLength));
    const canonical=name.endsWith('/')?name.slice(0,-1):name;
    relativePath(canonical);
    requireThat(!files.has(name),'archive','Duplicate ZIP filename.',{name});
    total+=size;requireThat(total<=maxBytes,'archive','Archive expands beyond the reading limit.');
    files.set(name,{size,crc});at+=46+nameLength+extra+comment;
  }
  const extracted=unzipSync(bytes,{filter:file=>!file.name.endsWith('/')});
  for(const [name,payload] of Object.entries(extracted)){
    const entry=files.get(name);requireThat(entry&&entry.size===payload.length&&entry.crc===crc32(payload),'archive','ZIP size or checksum mismatch.',{name});
  }
  requireThat(Object.keys(extracted).length===[...files.keys()].filter(n=>!n.endsWith('/')).length,'archive','Archive is incomplete.');
  return extracted;
}
