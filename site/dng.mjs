/* Classic TIFF/DNG metadata patcher. No pixel decoding and no network access. */
export const TARGET = Object.freeze({make:'FUJIFILM', model:'GFX100II', camera:'Fujifilm GFX 100 II'});
export const MAX_FILE_SIZE = 512 * 1024 * 1024;
const SIZES = {1:1,2:1,3:2,4:4,5:8,6:1,7:1,8:2,9:4,10:8,11:4,12:8,13:4};
const TAGS = new Map([[271,TARGET.make],[272,TARGET.model],[50708,TARGET.camera]]);
const fail = message => {throw new Error(message);};
async function read(blob, offset, length) {
  if (!Number.isSafeInteger(offset) || !Number.isSafeInteger(length) || offset < 0 || length < 0 || offset + length > blob.size) fail('文件结构不完整或偏移越界，未生成结果。');
  return new Uint8Array(await blob.slice(offset,offset+length).arrayBuffer());
}
export async function inspectDng(blob) {
  if (blob.size > MAX_FILE_SIZE) fail('这一版每张支持 512 MB 以内的 DNG，请先选较小的文件。');
  const header = await read(blob,0,8);
  const little = header[0] === 73 && header[1] === 73;
  if (!little && !(header[0] === 77 && header[1] === 77)) fail('这不是 TIFF 格式的 DNG。请选择原始 .dng 文件，HEIC / JPEG 不适用。');
  const hd = new DataView(header.buffer);
  if (hd.getUint16(2,little) === 43) fail('这一版暂不支持 BigTIFF。');
  if (hd.getUint16(2,little) !== 42) fail('不支持的 DNG 文件头。');
  const root = hd.getUint32(4,little);
  if(root < 8) fail('DNG 主目录无效。');
  const visited = new Set();
  let rootIfd;
  async function parseIfd(offset) {
    if(!offset) return;
    if(visited.has(offset)) fail('文件目录存在重复引用或循环，暂不处理。');
    if(visited.size >= 128) fail('文件目录过于复杂，暂不处理。');
    visited.add(offset);
    const countBytes = await read(blob,offset,2);
    const count = new DataView(countBytes.buffer).getUint16(0,little);
    if(count>4096) fail('文件目录过于复杂，暂不处理。');
    const bytes=await read(blob,offset+2,count*12+4);
    const view=new DataView(bytes.buffer);
    const entries=[]; const seenTags=new Set();
    for(let i=0;i<count;i++) {
      const p=i*12, tag=view.getUint16(p,little), type=view.getUint16(p+2,little), n=view.getUint32(p+4,little);
      if(seenTags.has(tag)) fail('文件包含重复元数据字段，暂不处理。');
      seenTags.add(tag);
      if(!SIZES[type]) fail('文件含有不支持的 TIFF 数据类型，暂不处理。');
      const length=SIZES[type]*n, valueOffset=length<=4?offset+2+p+8:view.getUint32(p+8,little);
      if(valueOffset+length>blob.size) fail('文件元数据越界，未生成结果。');
      entries.push({tag,type,count:n,length,valueOffset,raw:bytes.slice(p,p+12)});
    }
    const next=view.getUint32(count*12,little);
    const ifd={offset,entries,next};
    if(offset===root) rootIfd=ifd;
    for(const e of entries) {
      if([330,34665,34853,40965].includes(e.tag)) {
        if(![4,13].includes(e.type)||e.count>128) fail('不支持的子目录结构。');
        const data=await read(blob,e.valueOffset,e.length), dv=new DataView(data.buffer);
        for(let i=0;i<e.count;i++) await parseIfd(dv.getUint32(i*4,little));
      }
    }
    await parseIfd(next);
  }
  await parseIfd(root);
  const version=rootIfd.entries.find(e=>e.tag===50706);
  if(!version || version.type!==1 || version.count!==4) fail('没有找到有效 DNGVersion：文件可能只是改了扩展名的 TIFF。');
  const ver=await read(blob,version.valueOffset,4);
  if(ver[0]!==1) fail('暂不支持这一版 DNG。');
  async function ascii(tag) {
    const e=rootIfd.entries.find(x=>x.tag===tag);
    if(!e||e.type!==2) return '';
    return new TextDecoder().decode(await read(blob,e.valueOffset,Math.min(e.length,256))).replace(/\0.*$/s,'');
  }
  return {header,little,rootIfd,version:[...ver].join('.'),make:await ascii(271),model:await ascii(272),camera:await ascii(50708),directories:visited.size};
}
export async function patchDng(blob, inspected) {
  const info=inspected||await inspectDng(blob);
  const retained=info.rootIfd.entries.filter(e=>!TAGS.has(e.tag));
  const count=retained.length+TAGS.size;
  const newOffset=blob.size+(blob.size%2);
  const directorySize=2+count*12+4;
  const values=[...TAGS].map(([tag,value])=>({tag,data:new TextEncoder().encode(value+'\0')}));
  const extraSize=values.reduce((sum,v)=>sum+v.data.length+(v.data.length%2),0);
  const tail=new Uint8Array(directorySize+extraSize);
  const dv=new DataView(tail.buffer);
  dv.setUint16(0,count,info.little);
  let position=directorySize;
  const entries=retained.map(e=>({tag:e.tag,raw:e.raw}));
  for(const {tag,data} of values) {
    const raw=new Uint8Array(12),v=new DataView(raw.buffer);
    v.setUint16(0,tag,info.little);v.setUint16(2,2,info.little);v.setUint32(4,data.length,info.little);
    v.setUint32(8,newOffset+position,info.little);tail.set(data,position);position+=data.length+(data.length%2);
    entries.push({tag,raw});
  }
  entries.sort((a,b)=>a.tag-b.tag).forEach((entry,i)=>tail.set(entry.raw,2+i*12));
  dv.setUint32(2+count*12,info.rootIfd.next,info.little);
  const header=info.header.slice();new DataView(header.buffer).setUint32(4,newOffset,info.little);
  const output=new Blob([header,blob.slice(8),new Uint8Array(blob.size%2),tail],{type:'image/x-adobe-dng'});
  const check=await inspectDng(output);
  if(check.make!==TARGET.make||check.model!==TARGET.model||check.camera!==TARGET.camera) fail('输出校验未通过，未提供文件。');
  return output;
}
export function outputName(name) {return name.replace(/\.[^.]+$/,'')+'_富士.dng';}
