// Network-first navigation/assets, versioned cache, no changes to IndexedDB.
const CACHE='daily-workers-v10.0.0';
const ASSETS=['./','./index.html','./styles.css?v=10.0.0','./app.js?v=10.0.0','./pdf-export.js?v=10.0.0','./manifest.webmanifest','./icons/icon.svg','./icons/icon-180.png','./icons/icon-192.png','./icons/icon-512.png'];
self.addEventListener('install',event=>{event.waitUntil(caches.open(CACHE).then(cache=>cache.addAll(ASSETS)));self.skipWaiting();});
self.addEventListener('activate',event=>{event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k.startsWith('daily-workers-')&&k!==CACHE).map(k=>caches.delete(k)))));self.clients.claim();});
self.addEventListener('fetch',event=>{if(event.request.method!=='GET')return;if(new URL(event.request.url).origin!==self.location.origin)return;event.respondWith(fetch(event.request,{cache:'no-store'}).then(resp=>{if(resp.ok){const copy=resp.clone();event.waitUntil(caches.open(CACHE).then(cache=>cache.put(event.request,copy)).catch(()=>{}));}return resp;}).catch(()=>caches.match(event.request).then(resp=>resp||Response.error())));});
