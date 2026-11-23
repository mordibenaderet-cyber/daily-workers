// v6 cache: no stale v4 script/style aliases. Network-first on all same-origin assets.
const CACHE='daily-workers-v6.0.0';
const ASSETS=['./','./index.html','./styles.css?v=6.0.0','./app.js?v=6.0.0','./manifest.webmanifest','./icons/icon.svg','./icons/icon-192.png','./icons/icon-512.png','./icons/icon-180.png'];
self.addEventListener('install',event=>{
  event.waitUntil(caches.open(CACHE).then(cache=>cache.addAll(ASSETS)));
  self.skipWaiting();
});
self.addEventListener('activate',event=>{
  event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k.startsWith('daily-workers-')&&k!==CACHE).map(k=>caches.delete(k)))));
  self.clients.claim();
});
self.addEventListener('fetch',event=>{
  if(event.request.method!=='GET')return;
  const url=new URL(event.request.url);
  if(url.origin!==self.location.origin)return;
  event.respondWith(fetch(event.request,{cache:'no-store'}).then(response=>{
    if(response.ok){const copy=response.clone();event.waitUntil(caches.open(CACHE).then(cache=>cache.put(event.request,copy)).catch(()=>{}));}
    return response;
  }).catch(()=>caches.match(event.request).then(response=>response||Response.error())));
});
