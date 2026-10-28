import {inspectDng,patchDng,outputName} from './dng.mjs';
import initRawler,{convert_raw_to_dng} from './rawler.js';
const $=id=>document.getElementById(id);
let items=[], urls=[], busy=false;
const RAW_EXTS='ari,cr3,cr2,crw,erf,raf,3fr,kdc,dcs,dcr,iiq,mos,mef,mrw,nef,nrw,orf,rw2,pef,srw,arw,arq,srf,sr2';
function element(tag,text,className){const e=document.createElement(tag);if(text)e.textContent=text;if(className)e.className=className;return e;}
function explainError(error){
  const message=String(error?.message||error||'未知错误');
  if(error instanceof WebAssembly.RuntimeError||/\bunreachable\b|memory access out of bounds/i.test(message))return 'RAW 解码器在处理此文件时异常中断（WebAssembly unreachable）。常见原因是该相机型号或 RAW 压缩方式尚未兼容；原片未改动。请保留文件并把相机型号和这条提示发给我。';
  return message;
}
function release(){for(const url of urls)URL.revokeObjectURL(url);urls=[];}
function reset(){release();items=[];$('files').value='';$('queue').replaceChildren();$('results').replaceChildren();$('status').textContent='';$('convert').hidden=true;$('clear').hidden=true;}
$('clear').onclick=()=>{if(!busy)reset();};
$('files').addEventListener('change',async()=>{
  if(busy)return;
  release();items=[];$('queue').replaceChildren();$('results').replaceChildren();$('convert').hidden=true;
  const selected=Array.from($('files').files||[]);
  if(!selected.length){reset();return;}
  busy=true;$('files').disabled=true;$('clear').hidden=true;$('status').textContent='正在本地检查文件…';
  try {
    for(const file of selected){
      const row=element('div',null,'queue-row');const name=element('span',file.name,'name');const meta=element('small',(file.size/1048576).toFixed(1)+' MB');row.append(name,meta);$('queue').append(row);
      try{
        const isDng=/\.dng$/i.test(file.name);
        const ext=file.name.split('.').pop()?.toLowerCase();
        if(!isDng&&!RAW_EXTS.split(',').includes(ext))throw new Error('不支持的文件扩展名');
        const info=isDng?await inspectDng(file):null;
        items.push({file,info,isDng});meta.textContent=(file.size/1048576).toFixed(1)+' MB · '+(info?.model||(isDng?'DNG':ext.toUpperCase()+' RAW'));
      } catch(error){row.classList.add('invalid');meta.textContent=error.message;}
    }
    $('status').textContent=items.length?`已检查 ${items.length} 张。支持 DNG 元数据修改和多种 RAW 本地转 DNG。`:'没有可转换的文件。请选择 DNG 或受支持相机的 RAW 原片。';
    $('convert').textContent=`转换 ${items.length} 张照片`;$('convert').hidden=!items.length;
  }finally{busy=false;$('files').disabled=false;$('clear').hidden=false;}
});
$('convert').onclick=async()=>{
  if(busy)return;busy=true;$('convert').disabled=true;$('files').disabled=true;$('clear').disabled=true;
  release();$('results').replaceChildren();let success=0;
  try{
    for(const [i,item] of items.entries()){
      $('status').textContent=`正在本地转换 ${i+1} / ${items.length}… 首次加载转换引擎约 8 MB，请保持页面打开。`;
      await new Promise(r=>setTimeout(r,30));
      const card=element('div',null,'result');card.append(element('strong',item.file.name));
      try{
        let source=item.file;
        if(!item.isDng){
          if (!('DecompressionStream' in window)) throw new Error('当前浏览器不支持解压转换引擎，请更新 iOS 或使用新版 Safari。');
          const parts = await Promise.all(Array.from({length: 5}, (_, n) => fetch(`./rawler_bg.wasm.gz.part${n}`).then(response => {if (!response.ok) throw new Error('转换引擎下载失败，请刷新页面后重试。'); return response.arrayBuffer();})));
          const compressed = new Uint8Array(parts.reduce((size, part) => size + part.byteLength, 0));
          let offset = 0; for (const part of parts) { compressed.set(new Uint8Array(part), offset); offset += part.byteLength; }
          const wasm = new Blob([compressed]).stream().pipeThrough(new DecompressionStream('gzip'));
          await initRawler({module_or_path: new Response(wasm, {headers: {'Content-Type': 'application/wasm'}})});
          const input=new Uint8Array(await item.file.arrayBuffer());
          const converted=convert_raw_to_dng(input,item.file.name);
          source=new Blob([converted],{type:'image/x-adobe-dng'});
        }
        const info=item.isDng?item.info:await inspectDng(source);
        const blob=await patchDng(source,info),name=outputName(item.file.name),url=URL.createObjectURL(blob);urls.push(url);
        card.append(element('p',(item.isDng?'相机信息校验通过':'RAW 已在本机转成 DNG')+' · 原照片未改动。保存后请在 Lightroom 中检查显示与配置文件。'));
        const actions=element('div',null,'actions');
        const download=element('a','下载 DNG','download');download.href=url;download.download=name;
        const sharedFile=new File([blob],name,{type:'image/x-adobe-dng'});
        if(navigator.canShare?.({files:[sharedFile]})){
          const share=element('button','分享 / 存储');share.onclick=async()=>{try{await navigator.share({files:[sharedFile]});}catch(e){if(e.name!=='AbortError')$('status').textContent='分享未完成，请使用“下载 DNG”，在下载项中存储文件。';}};
          actions.append(share);
        }
        actions.append(download);card.append(actions);success++;
      }catch(error){card.classList.add('error');card.append(element('p',explainError(error)));}
      $('results').append(card);
    }
    $('status').textContent=`完成 ${success} / ${items.length} 张。请逐张保存；清空或关闭页面后，未保存的结果将释放。`;
  }finally{busy=false;$('convert').disabled=false;$('files').disabled=false;$('clear').disabled=false;}
};
if('serviceWorker' in navigator){
  navigator.serviceWorker.register('./sw.js').then(async registration=>{
    await navigator.serviceWorker.ready;
    const ready=()=>{$('offline').textContent='离线资源已就绪。可添加到主屏幕，再用飞行模式测试。';};
    if(registration.active)ready();else navigator.serviceWorker.addEventListener('controllerchange',ready,{once:true});
  }).catch(()=>{$('offline').textContent='离线缓存未启用，目前请联网打开页面。文件转换仍在本地进行。';});
}else $('offline').textContent='此浏览器未提供离线缓存，请使用 Safari。';
window.addEventListener('beforeunload',event=>{if(busy){event.preventDefault();event.returnValue='';}});
