const CACHE='fuji-pocket-v3';
const ASSETS=['./','./index.html','./style.css','./app.mjs','./dng.mjs','./rawler.js','./rawler_bg.wasm.gz.part0','./rawler_bg.wasm.gz.part1','./rawler_bg.wasm.gz.part2','./rawler_bg.wasm.gz.part3','./rawler_bg.wasm.gz.part4','./manifest.webmanifest','./icon.svg','./icon-192.png','./icon-512.png'];
self.addEventListener('install',event=>event.waitUntil((async()=>{
 const cache=await caches.open(CACHE);
 for(const path of ASSETS){const response=await fetch(new Request(path,{cache:'reload'}));if(!response.ok||response.redirected)throw new Error('Offline asset unavailable');await cache.put(path,response);}
 await self.skipWaiting();
})()));
self.addEventListener('activate',event=>event.waitUntil((async()=>{for(const key of await caches.keys())if(key.startsWith('fuji-pocket-')&&key!==CACHE)await caches.delete(key);await self.clients.claim();})()));
self.addEventListener('fetch',event=>{
 if(event.request.method!=='GET'||new URL(event.request.url).origin!==self.location.origin)return;
 const url=new URL(event.request.url);
 const allowed=ASSETS.some(p=>new URL(p,self.registration.scope).pathname===url.pathname);
 if(!allowed)return;
 event.respondWith((async()=>{const cached=await caches.match(event.request,{ignoreSearch:true});return cached||fetch(event.request);})());
});
