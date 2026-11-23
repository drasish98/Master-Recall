/* Cache local static assets so the entire core app remains available offline. */
const CACHE='master-recall-v2.1';
const ASSETS=['./','./index.html','./styles.css','./app.js','./schedule.js','./cloud.js','./firebase-config.js','./manifest.json','./icon.svg','./icon-192.png','./icon-512.png'];
self.addEventListener('install',event=>{
  event.waitUntil(caches.open(CACHE).then(cache=>cache.addAll(ASSETS)).then(()=>self.skipWaiting()));
});
self.addEventListener('activate',event=>{
 event.waitUntil(Promise.all([caches.keys().then(keys=>Promise.all(keys.filter(k=>k.startsWith('master-recall-')&&k!==CACHE).map(k=>caches.delete(k)))),self.clients.claim()]));
});
self.addEventListener('fetch',event=>{
 const req=event.request;
 if(req.method!=='GET'||new URL(req.url).origin!==self.location.origin)return;
 event.respondWith((async()=>{
   try{
    const response=await fetch(req);
    if(response.ok){const cache=await caches.open(CACHE);cache.put(req,response.clone());}
    return response;
   }catch{
    return (await caches.match(req)) || (req.mode==='navigate' ? await caches.match('./index.html') : Response.error());
   }
 })());
});
