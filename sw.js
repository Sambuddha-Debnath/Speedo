const C='SPEEDO-v11.1';
const A=[
  './','index.html','manifest.json','icon-192.png','icon-512.png',
  './css/dashboard.css','./css/main.css','./css/analytics.css','./css/map.css','./css/places.css','./css/responsive.css',
  './js/main.js','./js/ai/ai-app.js','./js/ai/ai-manager.js','./js/ai/data-processor.js',
  './js/ai/event-detector.js','./js/ai/scoring-engine.js','./js/ai/trip-analysis.js',
  './js/ai/driver-profile.js','./js/storage/database.js','./js/storage/trip-store.js',
  './js/maps/map-screen.js','./js/places/places.js','./js/reports/github-upload.js',
  './workers/analytics-worker.js','./tests/analytics-tests.html'
];
self.addEventListener('install',e=>{e.waitUntil(caches.open(C).then(c=>c.addAll(A)).then(()=>self.skipWaiting()))});
self.addEventListener('activate',e=>{e.waitUntil(caches.keys().then(k=>Promise.all(k.filter(x=>/^(speedo-|SPEEDO-)/.test(x)&&x!==C).map(x=>caches.delete(x)))).then(()=>self.clients.claim()))});
self.addEventListener('fetch',e=>{
  if(e.request.method!=='GET')return;
  const url=new URL(e.request.url);
  if(url.origin!==self.location.origin)return;
  e.respondWith(caches.match(e.request).then(cached=>cached||fetch(e.request).then(r=>{if(r.ok){const cp=r.clone();caches.open(C).then(c=>c.put(e.request,cp));}return r;}).catch(()=>caches.match('./index.html'))));
});
