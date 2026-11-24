(function(){
  var $=function(id){return document.getElementById(id)};
  var MAXV=240;
  var S={max:0,dist:0,moving:0,t0:0,last:null,watch:null,run:false,wake:null,demo:null,tick:null,v:0,pts:[],ended:false,al:false,lim:60,lastBeep:0,lastPt:0,fixes:0,lastFix:0,raw:null,sim:false,view:'digital',over:false};
  var VER='SPEEDO v11';
  // ---- Logging: IndexedDB ring buffer ----
  var LG={db:null,q:[],MAX:6000,fail:false};
  function L(k,d){
    LG.q.push({t:Date.now(),k:k,d:d===undefined?null:d});
    if(LG.fail&&LG.q.length>1000)LG.q.shift();
    if(LG.db&&LG.q.length>=20)flush();
  }
  function flush(){
    if(!LG.db||!LG.q.length)return;
    var b=LG.q.splice(0);
    try{
      var tx=LG.db.transaction('logs','readwrite'),st=tx.objectStore('logs');
      b.forEach(function(e){st.add(e)});
      st.count().onsuccess=function(){
        var ex=this.result-LG.MAX;
        if(ex>0)st.openCursor().onsuccess=function(){var c=this.result;if(c&&ex>0){c.delete();ex--;c.continue()}};
      };
    }catch(e){LG.q=b.concat(LG.q)}
  }
  function readLogs(cb){
    flush();
    if(!LG.db){cb(LG.q.slice());return}
    try{var r=LG.db.transaction('logs').objectStore('logs').getAll();r.onsuccess=function(){cb(r.result)};r.onerror=function(){cb([])}}catch(e){cb([])}
  }
  try{
    var rq=indexedDB.open('speedo-log',1);
    rq.onupgradeneeded=function(){rq.result.createObjectStore('logs',{autoIncrement:true})};
    rq.onsuccess=function(){LG.db=rq.result;flush()};
    rq.onerror=function(){LG.fail=true};
  }catch(e){LG.fail=true}
  setInterval(flush,2000);
  window.addEventListener('error',function(e){L('error',{type:'onerror',msg:String(e.message),src:String(e.filename||'').split('/').pop(),line:e.lineno,col:e.colno})});
  window.addEventListener('unhandledrejection',function(e){L('error',{type:'rejection',msg:String(e.reason&&e.reason.message||e.reason)})});
  document.addEventListener('visibilitychange',function(){L('vis',{hidden:document.hidden});if(document.hidden)flush()});
  window.addEventListener('pagehide',flush);
  window.addEventListener('online',function(){L('net',{online:true})});
  window.addEventListener('offline',function(){L('net',{online:false})});
  var rz=null;
  function viewInfo(){return{vp:[innerWidth,innerHeight],orient:(screen.orientation&&screen.orientation.type)||(innerWidth>innerHeight?'landscape':'portrait')}}
  window.addEventListener('resize',function(){requestAnimationFrame(function(){render();window.dispatchEvent(new CustomEvent('speedo:orientation-change', {detail:viewInfo()}))});clearTimeout(rz);rz=setTimeout(function(){L('view',viewInfo())},250)});
  if(screen.orientation&&screen.orientation.addEventListener)screen.orientation.addEventListener('change',function(){requestAnimationFrame(function(){render();window.dispatchEvent(new CustomEvent('speedo:orientation-change',{detail:viewInfo()}))})});
  L('session',{ver:VER,ua:navigator.userAgent,vp:[innerWidth,innerHeight],scr:[screen.width,screen.height],dpr:window.devicePixelRatio,orient:viewInfo().orient,
    standalone:!!(navigator.standalone||(window.matchMedia&&matchMedia('(display-mode: standalone)').matches)),online:navigator.onLine,lang:navigator.language,tz:(Intl.DateTimeFormat().resolvedOptions().timeZone||''),
    secure:window.isSecureContext,url:location.pathname});
  try{navigator.permissions.query({name:'geolocation'}).then(function(p){L('perm',{state:p.state});p.onchange=function(){L('perm',{state:p.state})}}).catch(function(){})}catch(e){}
  var lastSt='';
  try{var sv=localStorage.getItem('view');if(sv==='analog'||sv==='digital')S.view=sv}catch(e){}

  function pt(r,a){var t=a*Math.PI/180;return [120+r*Math.sin(t),110-r*Math.cos(t)]}
  (function(){
    var g='';
    for(var v=0;v<=MAXV;v+=10){
      var a=-135+270*v/MAXV,maj=v%20===0,p1=pt(92,a),p2=pt(maj?79:85,a),col=v>=180?'var(--warn)':'var(--text)';
      g+='<line x1="'+p1[0].toFixed(1)+'" y1="'+p1[1].toFixed(1)+'" x2="'+p2[0].toFixed(1)+'" y2="'+p2[1].toFixed(1)+'" stroke="'+col+'" stroke-width="'+(maj?2:1)+'"/>';
      if(maj){var l=pt(66,a);g+='<text x="'+l[0].toFixed(1)+'" y="'+l[1].toFixed(1)+'" style="fill:'+col+'" font-size="9" text-anchor="middle" dominant-baseline="middle">'+v+'</text>'}
    }
    $('ticks').innerHTML=g;
    // red zone 180-240 on both gauges
    var C1=2*Math.PI*90,F1=C1*.75;$('rz').setAttribute('stroke-dasharray','0 '+(F1*180/MAXV)+' '+(F1*60/MAXV)+' '+C1);
    var C2=2*Math.PI*98,F2=C2*.75;$('rz2').setAttribute('stroke-dasharray','0 '+(F2*180/MAXV)+' '+(F2*60/MAXV)+' '+C2);
  })();

  function setView(v){
    S.view=v;$('gauge').className='gauge speed-card '+v;
    [].forEach.call($('views').children,function(b){b.classList.toggle('on',b.dataset.v===v)});
    try{localStorage.setItem('view',v)}catch(e){}
  }

  function hav(a,b,c,d){var R=6371000,r=Math.PI/180,x=(c-a)*r,y=(d-b)*r;
    var h=Math.sin(x/2)*Math.sin(x/2)+Math.cos(a*r)*Math.cos(c*r)*Math.sin(y/2)*Math.sin(y/2);
    return 2*R*Math.asin(Math.sqrt(h))}
  function dir(h){return ['N','NE','E','SE','S','SW','W','NW'][Math.round(h/45)%8]}
  function pad(n){return n<10?'0'+n:''+n}
  function status(t,c){
    var st=c==='ok'?'ok':!c?'':/weak|Acquiring/i.test(t)?'warn blink':'bad';
    $('lgps').className='li '+st;$('gst').textContent=t;$('gst').className=st==='bad'?'bad':'';
    if(t!==lastSt){lastSt=t;L('gps',{s:t})}
  }

  function setHeading(h){
    h=((h%360)+360)%360;
    $('head').textContent=Math.round(h)+'° '+dir(h);
  }
  function render(){
    var kmh=S.v*3.6,p=Math.min(kmh/MAXV,1),red=kmh>=180;
    $('spd').textContent=$('spd2').textContent=Math.round(kmh);
    var arc=$('arc');arc.style.strokeDashoffset=424.1*(1-p);
    arc.style.stroke=arc.style.color=(red||S.over)?'var(--warn)':'var(--text)';$('gauge').classList.toggle('hot',red||S.over);
    $('needle').style.transform='rotate('+(-135+270*p)+'deg)';
    $('dist').innerHTML=(S.dist/1000).toFixed(2)+' <small>km</small>';
    $('lrec').className='li '+(S.run?'ok blink':'');
    alertCheck(kmh);
  }
  function clock(){
    if(!S.run)return;
    var s=Math.floor((Date.now()-S.t0)/1000);
    $('time').textContent=pad(Math.floor(s/3600))+':'+pad(Math.floor(s/60)%60)+':'+pad(s%60);
  }

  function onPos(p){
    var c=p.coords,now=p.timestamp||Date.now();
    if(S.last&&now<=S.last.t)return;                 // stale or duplicate fix
    S.fixes++;S.lastFix=Date.now();S.raw=c.speed;
    var acc=c.accuracy;
    $('dbg').textContent='Fixes '+S.fixes+' · device speed '+(c.speed!=null&&!isNaN(c.speed)?(c.speed*3.6).toFixed(1)+' km/h':'not provided');
    if(acc>100){L('fix',{rej:'weak',acc:Math.round(acc),sim:S.sim?1:0});status('GPS weak','bad');return}      // ignore very poor fixes
    var v=c.speed,dt=S.last?(now-S.last.t)/1000:0;
    if(v==null||isNaN(v)||v<0){                       // fall back to distance / time
      v=0;
      if(S.last&&acc<=50&&dt>0&&dt<10)v=hav(S.last.la,S.last.lo,c.latitude,c.longitude)/dt;
    }
    if(v>70){L('fix',{rej:'spike',v:+(v*3.6).toFixed(0),acc:Math.round(acc)});return}                                   // reject spikes above 250 km/h
    if(v<0.8)v=0;                                     // standing-still jitter
    if(v>0&&S.v>0)v=0.65*v+0.35*S.v;                  // light smoothing
    S.v=v;
    if(dt>3)L('gap',{dt:+dt.toFixed(1)});
    L('fix',{la:+c.latitude.toFixed(5),lo:+c.longitude.toFixed(5),alt:c.altitude!=null?Math.round(c.altitude):null,acc:+acc.toFixed(1),raw:c.speed!=null&&!isNaN(c.speed)?+(c.speed*3.6).toFixed(1):null,v:+(v*3.6).toFixed(1),dt:+dt.toFixed(1),hd:c.heading!=null&&!isNaN(c.heading)?Math.round(c.heading):null,lm:LIM.v,as:E.sm!=null?+E.sm.toFixed(1):null,gr:E.gr!=null?+E.gr.toFixed(1):null,tp:T.state==='ok'?+T.p.toFixed(1):null,tr:T.state==='ok'?+T.r.toFixed(1):null,sim:S.sim?1:0});
    if(v>S.max)S.max=v;
    if(S.run&&now-S.lastPt>=1000&&S.pts.length<20000){S.lastPt=now;S.pts.push([Math.round(now/1000),+c.latitude.toFixed(6),+c.longitude.toFixed(6),+(v*3.6).toFixed(1),c.altitude!=null?Math.round(c.altitude):'',Math.round(acc)])}
    if(S.last&&v>0&&acc<=40&&dt>0&&dt<10){
      var m=hav(S.last.la,S.last.lo,c.latitude,c.longitude);
      if(m/dt<80){S.dist+=m;S.moving+=dt}
    }
    if(S.last&&acc<=40&&hav(S.last.la,S.last.lo,c.latitude,c.longitude)>=8){S.course=brg(S.last.la,S.last.lo,c.latitude,c.longitude);S.courseT=now}   // course from successive fixes, used when the device gives none
    S.last={la:c.latitude,lo:c.longitude,t:now};
    $('coord').textContent=c.latitude.toFixed(5)+'°, '+c.longitude.toFixed(5)+'°';
    $('meta').textContent='Altitude '+(c.altitude!=null?Math.round(c.altitude)+' m':'–')+' · Accuracy ±'+Math.round(acc)+' m';
    elevAdd(c.altitude,c.altitudeAccuracy,now);elevUpdate();
    $('maps').href='https://maps.apple.com/?ll='+c.latitude+','+c.longitude+'&q=My%20location';
    if(c.heading!=null&&!isNaN(c.heading)&&c.heading>=0&&v>=1.4)setHeading(c.heading);else if(S.course!=null&&v>=1.4&&now-S.courseT<8000)setHeading(S.course);
    mapTick(c,v,now);   // GPS course is only valid while moving; hold last value when stopped
    window.dispatchEvent(new CustomEvent('speedo:gps-fix',{detail:{timestamp:now,latitude:c.latitude,longitude:c.longitude,accuracy:acc,heading:(c.heading!=null&&!isNaN(c.heading)&&c.heading>=0)?c.heading:(S.course!=null?S.course:null),speedLimit:LIM.v,camera:$('cam').hidden?null:$('cam').textContent,recording:S.run,simulated:S.sim}}));
    if(S.run){window.dispatchEvent(new CustomEvent('speedo:sample',{detail:{timestamp:now,gps:{latitude:c.latitude,longitude:c.longitude,accuracy:acc},vehicle:{speed:v*3.6,heading:(c.heading!=null&&!isNaN(c.heading)&&c.heading>=0)?c.heading:(S.course!=null?S.course:null),altitude:c.altitude,gradient:E.gr},motion:{pitch:T.state==='ok'?T.p:null,roll:T.state==='ok'?T.r:null},road:{speedLimit:LIM.v,speedLimitSource:LIM.v!=null?'osm':null},quality:{gpsValid:acc<=40,speedValid:Number.isFinite(v)&&v>=0&&v<=70,motionValid:T.state==='ok'}}}));}
    status(acc<=15?'GPS strong':acc<=40?'GPS fair':'GPS weak',acc<=40?'ok':'bad');
    render();
  }

  function startWatch(why){
    L('watch',{start:why||'?'});
    if(S.watch!=null)navigator.geolocation.clearWatch(S.watch);
    S.watch=navigator.geolocation.watchPosition(onPos,onErr,{enableHighAccuracy:true,maximumAge:0,timeout:20000});
  }
  function onErr(e){
    L('error',{type:'geo',code:e.code,msg:e.message});
    if(e.code===1){
      $('msg').textContent='Location is blocked. iPhone: Settings › Privacy › Location Services › Chrome › While Using, then reload.';
      status('Blocked','bad');stop(true);return;
    }
    status(e.code===3?'Acquiring GPS…':'No signal','bad');
    $('msg').textContent='Searching for GPS. Move near a window or outdoors with open sky.';
    if(S.run&&!S.sim)setTimeout(function(){if(S.run&&!S.sim)startWatch('retry')},1500);
  }

  async function lock(){try{if('wakeLock' in navigator){S.wake=await navigator.wakeLock.request('screen');L('wake',{ok:1})}else L('wake',{ok:0,why:'unsupported'})}catch(e){L('wake',{ok:0,why:String(e.name)})}}
  function start(){
    if(S.run)return;
    if(!navigator.geolocation){$('msg').textContent='This browser has no location support.';return}
    if(S.ended){reset();S.ended=false}
    S.run=true;S.sim=false;S.t0=S.t0||Date.now();window.dispatchEvent(new CustomEvent('speedo:trip-start',{detail:{timestamp:S.t0,simulated:false}}));S.last=null;S.fixes=0;S.lastFix=0;
    $('go').textContent='Stop';$('go').className='btn stop';
    status('Acquiring GPS…','bad');
    $('msg').textContent='Tracking. Keep this screen on while driving.';
    L('start',{sim:0});enableTilt();startWatch('start');S.tick=setInterval(clock,500);lock();render();
  }
  function stop(keepMsg){
    L('stop',{dist:Math.round(S.dist),max:+(S.max*3.6).toFixed(0),fixes:S.fixes,sim:S.sim?1:0});
    saveTrip();window.dispatchEvent(new CustomEvent('speedo:trip-stop',{detail:{timestamp:Date.now(),simulated:S.sim}}));S.ended=true;
    S.run=false;S.sim=false;
    if(S.watch!=null&&navigator.geolocation)navigator.geolocation.clearWatch(S.watch);S.watch=null;
    if(S.demo){clearInterval(S.demo);S.demo=null}
    $('demo').textContent='Run simulation';
    clearInterval(S.tick);tiltOff();
    try{if(S.wake)S.wake.release()}catch(e){}
    S.v=0;
    $('go').textContent='Start';$('go').className='btn main';
    if(keepMsg!==true){status('GPS off','');$('msg').textContent='Stopped.'}
    render();
  }
  function reset(){
    var wasRunning=S.run;if(wasRunning)window.dispatchEvent(new CustomEvent('speedo:trip-stop',{detail:{timestamp:Date.now(),simulated:S.sim,reason:'reset'}}));
    saveTrip();S.pts=[];
    E.s=[];E.gr=null;drawElev();
    var was=S.run;S.max=0;S.dist=0;S.moving=0;S.last=null;S.t0=was?Date.now():0;
    $('time').textContent='00:00:00';if(wasRunning)window.dispatchEvent(new CustomEvent('speedo:trip-start',{detail:{timestamp:S.t0||Date.now(),simulated:S.sim}}));render();
  }

  // Watchdog: zero the speed and re-arm GPS if fixes stop arriving
  setInterval(function(){
    if(!S.run||S.sim)return;
    var age=S.lastFix?(Date.now()-S.lastFix)/1000:0;
    if(S.lastFix&&age>6){S.v=0;status('Signal lost','bad');render();if(age>20){L('watch',{watchdog:Math.round(age)});startWatch('watchdog')}}
  },2000);

  // ---- Trips, export, speed alert ----
  var TK='speedo.trips',TH='speedo.alert',AC=null;
  function loadTrips(){try{return JSON.parse(localStorage.getItem(TK)||'[]')}catch(e){return[]}}
  function putTrips(a){try{localStorage.setItem(TK,JSON.stringify(a));return true}catch(e){L('storage',{op:'save-trip',msg:String(e&&e.name||e)});$('msg').textContent='Trip stays in analytics storage, but the legacy export list could not be updated. Export important trips.';return false}}
  function dur(s){s=Math.round(s);return pad(Math.floor(s/3600))+':'+pad(Math.floor(s/60)%60)+':'+pad(s%60)}
  function saveTrip(){
    if(S.pts.length<5||S.dist<50)return;
    var a=loadTrips();
    a.unshift({id:Date.now(),s:S.t0,e:Date.now(),d:Math.round(S.dist),mx:+(S.max*3.6).toFixed(1),mv:Math.round(S.moving),sim:S.sim,p:S.pts});
    if(putTrips(a))S.pts=[];renderTrips();
  }
  function renderTrips(){
    var h='';
    loadTrips().forEach(function(t){
      var avg=t.mv>0?t.d/t.mv*3.6:0;
      h+='<div class="trip"><div><b>'+new Date(t.s).toLocaleString([],{day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'})+(t.sim?' (sim)':'')+'</b><br><span>'+(t.d/1000).toFixed(2)+' km · '+dur((t.e-t.s)/1000)+' · max '+Math.round(t.mx)+' · avg '+Math.round(avg)+' km/h</span></div><div class="ta"><button data-a="details" data-id="'+t.id+'">Details</button><button data-a="csv" data-id="'+t.id+'">CSV</button><button data-a="gpx" data-id="'+t.id+'">GPX</button><button data-a="del" data-id="'+t.id+'">✕</button></div></div>';
    });
    $('tl').innerHTML=h||'<span style="color:var(--mute);font-size:13px">No trips yet. A trip is saved when you tap Stop.</span>';
  }
  function out(name,text,type){
    var f=new File([text],name,{type:type});
    if(navigator.canShare&&navigator.canShare({files:[f]})){navigator.share({files:[f],title:name}).catch(function(){});return}
    var a=document.createElement('a');a.href=URL.createObjectURL(f);a.download=name;document.body.appendChild(a);a.click();a.remove();
  }
  function exportTrip(t,kind){
    var nm='trip-'+new Date(t.s).toISOString().slice(0,16).replace(/[:T]/g,'-'),txt;
    if(kind==='csv'){
      txt='time_iso,lat,lon,speed_kmh,altitude_m,accuracy_m\n'+t.p.map(function(r){return new Date(r[0]*1000).toISOString()+','+r[1]+','+r[2]+','+r[3]+','+r[4]+','+r[5]}).join('\n');
      out(nm+'.csv',txt,'text/csv');
    }else{
      txt='<?xml version="1.0" encoding="UTF-8"?>\n<gpx version="1.1" creator="Speedometer" xmlns="http://www.topografix.com/GPX/1/1"><trk><n>'+nm+'</n><trkseg>'+t.p.map(function(r){return '<trkpt lat="'+r[1]+'" lon="'+r[2]+'">'+(r[4]!==''?'<ele>'+r[4]+'</ele>':'')+'<time>'+new Date(r[0]*1000).toISOString()+'</time></trkpt>'}).join('')+'</trkseg></trk></gpx>';
      out(nm+'.gpx',txt,'application/gpx+xml');
    }
  }
  $('tl').onclick=function(e){
    var b=e.target.closest('button');if(!b)return;
    var id=+b.dataset.id,a=loadTrips(),t=a.filter(function(x){return x.id===id})[0];if(!t)return;
    if(b.dataset.a==='del'){if(confirm('Delete this trip?')){putTrips(a.filter(function(x){return x.id!==id}));renderTrips()}}
    else if(b.dataset.a==='details')window.dispatchEvent(new CustomEvent('speedo:trip-detail-request',{detail:{tripId:'legacy-'+id}}));
    else exportTrip(t,b.dataset.a);
  };

  try{var sa=JSON.parse(localStorage.getItem(TH)||'{}');if(sa.lim)S.lim=sa.lim;S.al=!!sa.on}catch(e){}
  function saveAl(){try{localStorage.setItem(TH,JSON.stringify({lim:S.lim,on:S.al}))}catch(e){}}
  function syncAl(){$('lim').value=S.lim;$('alert').textContent=S.al?'On':'Off';$('alert').classList.toggle('on',S.al);drawSign()}
  function beep(f){
    try{AC=AC||new (window.AudioContext||window.webkitAudioContext)();if(AC.resume)AC.resume();
      var o=AC.createOscillator(),g=AC.createGain();o.frequency.value=f||880;g.gain.value=.15;o.connect(g);g.connect(AC.destination);o.start();o.stop(AC.currentTime+.25)}catch(e){}
  }
  function alertCheck(kmh){
    var lm=curLimit(),over=S.al&&lm!=null&&kmh>lm;document.body.classList.toggle('over',over);
    if(over&&!S.over)L('alert',{kmh:Math.round(kmh),lim:lm,src:LIM.v!=null?'osm':'manual'});
    S.over=over;
    if(over&&Date.now()-S.lastBeep>3000){S.lastBeep=Date.now();beep();try{navigator.vibrate&&navigator.vibrate(200)}catch(e){}}
  }
  $('alert').onclick=function(){S.al=!S.al;if(S.al)beep();syncAl();saveAl();render()};
  $('lim').oninput=function(){var n=parseInt(this.value,10);if(n>=10&&n<=240){S.lim=n;saveAl();drawSign()}};

  // ---- Speed limits + cameras from OpenStreetMap (Overpass), cached per ~1 km tile ----
  var MP={osm:true,cam:true},LIM={v:null,cand:undefined,n:0,t:0,run:0},TS=0.01,TILES={},MDB=null,CAMS={},
      OPS=['https://overpass-api.de/api/interpreter','https://overpass.private.coffee/api/interpreter'];
  try{var m0=JSON.parse(localStorage.getItem('speedo.map')||'{}');for(var mk in m0)MP[mk]=m0[mk]}catch(e){}
  try{var mq=indexedDB.open('speedo-map',1);mq.onupgradeneeded=function(){mq.result.createObjectStore('tiles',{keyPath:'k'})};mq.onsuccess=function(){MDB=mq.result}}catch(e){}
  function curLimit(){return LIM.v!=null?LIM.v:(S.al?S.lim:null)}
  function drawSign(){
    var lm=curLimit(),t=$('signtxt');t.textContent=lm!=null?lm:'--';t.setAttribute('font-size',lm!=null&&lm>=100?30:38);
    $('sign').classList.toggle('dim',lm==null);$('sign').classList.toggle('man',LIM.v==null&&lm!=null);
  }
  function brg(a,b,c,d){var r=Math.PI/180,y=Math.sin((d-b)*r)*Math.cos(c*r),x=Math.cos(a*r)*Math.sin(c*r)-Math.sin(a*r)*Math.cos(c*r)*Math.cos((d-b)*r);return (Math.atan2(y,x)/r+360)%360}
  function adiff(a,b){return Math.abs(((a-b+540)%360)-180)}
  function mdist(a,b,c,d){var k=Math.cos((a+c)*Math.PI/360);return Math.sqrt(Math.pow((d-b)*k*111320,2)+Math.pow((c-a)*110540,2))}
  function segd(la,lo,p,q){
    var k=Math.cos(la*Math.PI/180),ax=(p[1]-lo)*k*111320,ay=(p[0]-la)*110540,dx=(q[1]-lo)*k*111320-ax,dy=(q[0]-la)*110540-ay;
    var t=Math.max(0,Math.min(1,-(ax*dx+ay*dy)/(dx*dx+dy*dy||1)));
    return Math.sqrt(Math.pow(ax+t*dx,2)+Math.pow(ay+t*dy,2));
  }
  function pv(x){var m=/^\s*(\d+(?:\.\d+)?)\s*(mph)?/.exec(x||'');return m?Math.round(+m[1]*(m[2]?1.609:1)):null}   // "50", "30 mph"; ignores none/signals
  function tk(la,lo){return Math.floor(la/TS)+'_'+Math.floor(lo/TS)}
  function tbox(k){var a=k.split('_').map(Number);return [a[0]*TS,a[1]*TS,(a[0]+1)*TS,(a[1]+1)*TS]}
  function parseTile(j){
    var w=[],c=[];
    (j.elements||[]).forEach(function(e){
      var t=e.tags||{};
      if(e.type==='way'&&e.geometry){
        var f=pv(t['maxspeed:forward']||t.maxspeed),b=pv(t['maxspeed:backward']||t.maxspeed);if(f==null&&b==null)return;
        w.push({f:f,b:b,o:/^(yes|true|1)$/.test(t.oneway||'')?1:0,g:e.geometry.map(function(p){return [+p.lat.toFixed(5),+p.lon.toFixed(5)]})});
      }else if(e.type==='node')c.push({id:e.id,la:e.lat,lo:e.lon,v:pv(t.maxspeed)});
    });
    return {w:w,c:c};
  }
  function saveTile(k,p){
    if(!MDB)return;
    try{var st=MDB.transaction('tiles','readwrite').objectStore('tiles');st.put({k:k,t:Date.now(),w:p.w,c:p.c});
      st.getAll().onsuccess=function(){var a=this.result;if(a.length>60){a.sort(function(x,y){return x.t-y.t});for(var i=0;i<a.length-60;i++)st.delete(a[i].k)}}}catch(e){}
  }
  function fetchTile(k,i){
    var T=TILES[k],b=tbox(k),bb=b.map(function(x){return x.toFixed(4)}).join(','),t0=Date.now();
    var q='[out:json][timeout:25];way["highway"]["maxspeed"]('+bb+');out tags geom;(node["highway"="speed_camera"]('+bb+');node["enforcement"="maxspeed"]('+bb+'););out;';
    T.busy=true;
    fetch(OPS[i],{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:'data='+encodeURIComponent(q)}).then(function(r){if(!r.ok)throw new Error('HTTP '+r.status);return r.json()}).then(function(j){
      var p=parseTile(j);T.w=p.w;T.c=p.c;T.ready=true;T.busy=false;T.fail=0;
      L('limit',{tile:k,ok:1,ways:p.w.length,cams:p.c.length,ms:Date.now()-t0,srv:i});saveTile(k,p);
    }).catch(function(e){
      if(i+1<OPS.length){fetchTile(k,i+1);return}
      T.busy=false;T.fail=(T.fail||0)+1;T.retry=Date.now()+Math.min(600000,30000*Math.pow(2,T.fail-1));
      L('limit',{tile:k,ok:0,msg:String(e&&e.message||e),fail:T.fail});
    });
  }
  function loadTile(k){
    var T=TILES[k];
    if(MDB){try{var r=MDB.transaction('tiles').objectStore('tiles').get(k);
      r.onsuccess=function(){var x=r.result;if(x&&Date.now()-x.t<6048e5){T.w=x.w;T.c=x.c;T.ready=true;T.busy=false;L('limit',{tile:k,ok:1,cache:1,ways:x.w.length,cams:x.c.length})}else fetchTile(k,0)};
      r.onerror=function(){fetchTile(k,0)};return}catch(e){}}
    fetchTile(k,0);
  }
  function getTile(k){
    var T=TILES[k];
    if(!T){TILES[k]={ready:false,busy:true,w:[],c:[],fail:0};loadTile(k);return}
    if(!T.ready&&!T.busy&&!(T.retry>Date.now()))fetchTile(k,0);
  }
  function limMatch(la,lo,hd,acc,tiles,now){
    var R=Math.max(30,Math.min(60,acc||0)),best=null;
    tiles.forEach(function(T){T.w.forEach(function(w){
      for(var i=0;i<w.g.length-1;i++){
        var p=w.g[i],q=w.g[i+1],d=segd(la,lo,p,q);if(d>R)continue;
        var fw=null,pen=0;
        if(hd!=null){var df=adiff(brg(p[0],p[1],q[0],q[1]),hd);fw=df<90;if(w.o&&!fw)pen=60}      // one-way roads only count when you drive with them
        var sc=d+pen;if(sc>R)continue;
        if(!best||sc<best.s)best={s:sc,v:fw===false?(w.b!=null?w.b:w.f):(w.f!=null?w.f:w.b)};
      }
    })});
    var cand=best?best.v:null;
    if(best)LIM.t=now;
    if(cand===LIM.cand)LIM.n++;else{LIM.cand=cand;LIM.n=1}
    if(LIM.n>=2&&cand!==LIM.v&&(cand!==null||now-LIM.t>10000)){      // needs 2 agreeing readings; clears only after 10 s with no match
      LIM.v=cand;L('limit',{v:cand,la:+la.toFixed(5),lo:+lo.toFixed(5),hd:hd!=null?Math.round(hd):null});drawSign();
    }
  }
  function camCheck(la,lo,hd,v,tiles,now){
    var best=null,k;
    for(k in CAMS)if(now-CAMS[k].t>600000)delete CAMS[k];
    if(hd!=null&&v>=2)tiles.forEach(function(T){T.c.forEach(function(c){
      var d=mdist(la,lo,c.la,c.lo);if(d>800||d<15)return;
      var df=adiff(brg(la,lo,c.la,c.lo),hd);if(df>40||d*Math.sin(df*Math.PI/180)>35)return;     // only cameras ahead, on your line of travel
      if(!best||d<best.d)best={c:c,d:d};
    })});
    var el=$('cam');
    if(!best){el.hidden=true;return}
    el.hidden=false;el.textContent='📷 '+(Math.round(best.d/10)*10)+' m'+(best.c.v?' · '+best.c.v:'');
    var st=CAMS[best.c.id]||(CAMS[best.c.id]={t:now,s:0});
    if(st.s<1){st.s=1;beep(1200);L('camera',{id:best.c.id,d:Math.round(best.d),v:best.c.v||null})}
    else if(st.s<2&&best.d<300){st.s=2;beep(1200);setTimeout(function(){beep(1200)},300)}
  }
  function mapTick(c,v,now){
    if(!MP.osm&&!MP.cam)return;
    if(now-LIM.run<2000)return;LIM.run=now;
    var la=c.latitude,lo=c.longitude,fast=v>=1.4;
    var hd=(c.heading!=null&&!isNaN(c.heading)&&c.heading>=0&&fast)?c.heading:(S.course!=null&&now-S.courseT<8000&&fast?S.course:null);
    var k=tk(la,lo),b=tbox(k),mg=0.002;
    getTile(k);
    if(la-b[0]<mg)getTile(tk(la-TS,lo));if(b[2]-la<mg)getTile(tk(la+TS,lo));if(lo-b[1]<mg)getTile(tk(la,lo-TS));if(b[3]-lo<mg)getTile(tk(la,lo+TS));   // prefetch the next tile near an edge
    var rd=[];for(var i=-1;i<=1;i++)for(var j=-1;j<=1;j++){var T=TILES[tk(la+i*TS,lo+j*TS)];if(T&&T.ready)rd.push(T)}
    if(MP.osm)limMatch(la,lo,hd,c.accuracy,rd,now);
    if(MP.cam)camCheck(la,lo,hd,v,rd,now);else $('cam').hidden=true;
  }
  function syncMP(){
    $('bosm').textContent='OSM limits: '+(MP.osm?'On':'Off');$('bosm').classList.toggle('on',MP.osm);
    $('bcam').textContent='Camera alerts: '+(MP.cam?'On':'Off');$('bcam').classList.toggle('on',MP.cam);
  }
  function saveMP(){try{localStorage.setItem('speedo.map',JSON.stringify(MP))}catch(e){}syncMP()}
  $('bosm').onclick=function(){MP.osm=!MP.osm;if(!MP.osm){LIM.v=null;LIM.cand=undefined;drawSign()}saveMP()};
  $('bcam').onclick=function(){MP.cam=!MP.cam;if(!MP.cam)$('cam').hidden=true;saveMP()};
  syncMP();

  // ---- Elevation profile (smoothed GPS altitude, scrolling by distance) ----
  var E={s:[],raw:[],sm:null,t:0,gr:null,W:1500};
  function elevAdd(alt,acc,now){
    if(alt==null||isNaN(alt)||(acc!=null&&acc>50))return;
    E.raw.push(alt);if(E.raw.length>5)E.raw.shift();
    var m=E.raw.slice().sort(function(a,b){return a-b})[E.raw.length>>1];      // median of last 5 removes spikes
    if(E.sm==null)E.sm=m;else E.sm+=(m-E.sm)*(1-Math.exp(-Math.max(.2,Math.min(5,(now-E.t)/1000))/6));  // then ~6 s low-pass
    E.t=now;
  }
  function elevUpdate(){
    if(E.sm==null)return;
    var D=S.dist,last=E.s[E.s.length-1],ref=null,i;
    if(!last||D-last.d>=10){E.s.push({d:D,a:E.sm});if(E.s.length>400)E.s.shift()}   // one sample per 10 m
    for(i=E.s.length-1;i>=0;i--)if(D-E.s[i].d>=100){ref=E.s[i];break}
    if(!ref&&E.s.length&&D-E.s[0].d>=50)ref=E.s[0];
    if(ref){var g=Math.max(-40,Math.min(40,(E.sm-ref.a)/(D-ref.d)*100));E.gr=E.gr==null?g:E.gr+.3*(g-E.gr)}
    drawElev();
  }
  function bez(q){
    var d='M'+q[0][0].toFixed(1)+' '+q[0][1].toFixed(1);
    for(var i=0;i<q.length-1;i++){var a=q[i-1]||q[i],b=q[i],c=q[i+1],e=q[i+2]||c;
      d+='C'+(b[0]+(c[0]-a[0])/6).toFixed(1)+' '+(b[1]+(c[1]-a[1])/6).toFixed(1)+' '+(c[0]-(e[0]-b[0])/6).toFixed(1)+' '+(c[1]-(e[1]-b[1])/6).toFixed(1)+' '+c[0].toFixed(1)+' '+c[1].toFixed(1)}
    return d;
  }
  function drawElev(){
    if(E.sm==null){return}
    $('altv').textContent=Math.round(E.sm);
    $('grade').textContent=E.gr==null?'–':(E.gr>=.05?'▲ ':E.gr<=-.05?'▼ ':'')+Math.abs(E.gr).toFixed(1)+'%';
    var D=S.dist,pts=E.s.filter(function(p){return p.d>=D-E.W-30}).concat([{d:D,a:E.sm}]);
    if(E.s.length<2||pts.length<2){$('pf').setAttribute('d','');$('pl2').setAttribute('d','');$('pd').setAttribute('d','');return}
    var lo=1e9,hi=-1e9;pts.forEach(function(p){lo=Math.min(lo,p.a);hi=Math.max(hi,p.a)});
    var rg=Math.max(hi-lo,15);lo=(hi+lo)/2-rg/2;                              // flat roads stay flat (min 15 m range)
    var q=pts.map(function(p){return [264-(D-p.d)/E.W*264,92-(p.a-lo)/rg*74]});
    var d=bez(q),l=q[q.length-1],f=q[0];
    $('pl2').setAttribute('d',d);$('amax').textContent=Math.round(lo+rg)+' m';$('amin').textContent=Math.round(lo)+' m';
    $('pf').setAttribute('d',d+'L'+l[0].toFixed(1)+' 100L'+f[0].toFixed(1)+' 100Z');
    $('pd').setAttribute('d','M'+l[0].toFixed(1)+' '+l[1].toFixed(1)+'L'+l[0].toFixed(1)+' '+l[1].toFixed(1));
  }

  // ---- Tilt (pitch / roll), calibrated to level ----
  var T={state:'off',listening:false,u:null,su:null,cal:null,samples:[],t0:0,p:0,r:0,sp:0,sr:0,ip:false,ir:false,mount:'auto'};
  try{var ti=JSON.parse(localStorage.getItem('speedo.tilt')||'{}');T.ip=!!ti.ip;T.ir=!!ti.ir;if(ti.m==='upright'||ti.m==='flat')T.mount=ti.m}catch(e){}
  function saveTilt(){try{localStorage.setItem('speedo.tilt',JSON.stringify({ip:T.ip,ir:T.ir,m:T.mount}))}catch(e){}}
  var vd=function(a,b){return a[0]*b[0]+a[1]*b[1]+a[2]*b[2]};
  var vn=function(a){var l=Math.sqrt(vd(a,a))||1;return [a[0]/l,a[1]/l,a[2]/l]};
  var vx=function(a,b){return [a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]]};
  function onOri(e){
    if(e.beta==null||e.gamma==null)return;
    var b=e.beta*Math.PI/180,g=e.gamma*Math.PI/180;
    T.u=[-Math.cos(b)*Math.sin(g),Math.sin(b),Math.cos(b)*Math.cos(g)];   // world "up" in device axes
  }
  function tiltLight(){$('ltilt').className='li '+(S.sim||T.state==='ok'?'ok':T.state==='denied'?'warn':T.state==='cal'||T.state==='wait'?'warn blink':'')}
  function listen(){
    if(!T.listening){window.addEventListener('deviceorientation',onOri);T.listening=true}
    if(T.state==='off'||T.state==='denied'||T.state==='none')T.state='wait';
  }
  function askTilt(){
    var DO=window.DeviceOrientationEvent;
    if(!DO){T.state='none';L('tilt',{state:'unsupported'});return Promise.resolve()}
    if(typeof DO.requestPermission==='function'){
      return DO.requestPermission().then(function(r){L('tilt',{perm:r});if(r==='granted')listen();else{T.state='denied';$('msg').textContent='Motion access denied. Reload the page and allow Motion & Orientation.'}}).catch(function(e){L('tilt',{permErr:String(e)});T.state='denied'});
    }
    listen();return Promise.resolve();
  }
  function calibrate(){
    if(S.sim||T.state==='denied'||T.state==='none')return;
    T.samples=[];T.t0=Date.now();T.cal=null;T.state='cal';
    $('msg').textContent='Calibrating level… keep the car still.';
  }
  function finishCal(){
    var a=[0,0,0];T.samples.forEach(function(u){a[0]+=u[0];a[1]+=u[1];a[2]+=u[2]});
    var u0=vn(a),flat=T.mount==='flat'?true:T.mount==='upright'?false:Math.abs(u0[2])>0.8,f;
    if(flat){var ang=(screen.orientation&&screen.orientation.angle!=null)?screen.orientation.angle:(window.orientation||0);ang=((ang%360)+360)%360;f=[[0,1,0],[1,0,0],[0,-1,0],[-1,0,0]][Math.round(ang/90)%4]}   // flat: top of screen points forward
    else f=[0,0,-1];                                                                                                                                  // upright: screen faces driver, so forward is into the screen
    var d=vd(f,u0);f=vn([f[0]-d*u0[0],f[1]-d*u0[1],f[2]-d*u0[2]]);
    T.cal={u:u0,f:f,r:vx(f,u0)};T.state='ok';
    L('tilt',{cal:u0.map(function(x){return +x.toFixed(3)}),f:f.map(function(x){return +x.toFixed(3)}),mount:flat?'flat':'upright',mset:T.mount,ip:T.ip?1:0,ir:T.ir?1:0});
    $('msg').textContent='Level set. Tilt is live.';
  }
  var TK2=2.9,TRL=[];
  function setAtt(p,r){
    // dot shows where the car is leaning: lean right -> right, nose up -> up
    var x=r*TK2,y=-p*TK2,l=Math.sqrt(x*x+y*y);
    if(l>95){x*=95/l;y*=95/l}
    $('bub').style.transform='translate('+x.toFixed(1)+'px,'+y.toFixed(1)+'px)';
    TRL.push([x,y]);if(TRL.length>40)TRL.shift();
    for(var k=0;k<8;k++){var q=TRL[TRL.length-1-(8-k)*4];var el=$('tt'+k);if(q){el.setAttribute('cx',(100+q[0]).toFixed(1));el.setAttribute('cy',(100+q[1]).toFixed(1))}else{el.setAttribute('cx',100);el.setAttribute('cy',100)}}
  }
  function setCarPose(p,r){
    p=Math.max(-25,Math.min(25,p));r=Math.max(-25,Math.min(25,r));
    $('carBody').setAttribute('transform','rotate('+(r*.45).toFixed(1)+' 90 43)');
    $('carHood').setAttribute('transform','rotate('+(-p*.7).toFixed(1)+' 70 38)');
  }
  function tiltUI(){
    var st=T.state,ok=S.sim||st==='ok',p=T.p,r=T.r,el=$('att');
    if(S.sim){p=Number.isFinite(T.sp)?T.sp:0;r=Number.isFinite(T.sr)?T.sr:0}
    tiltLight();
    if(!ok){
      $('pv').textContent='--';$('rv').textContent='--';
      $('pl').textContent=st==='cal'?'Calibrating…':st==='denied'?'Access denied':st==='none'?'No sensor':st==='wait'?'Starting…':'Tap to enable';
      $('rl').textContent='';el.className='tile tilt att';setAtt(0,0);setCarPose(0,0);return;
    }
    if(T.ip)p=-p;if(T.ir)r=-r;
    var mp=Math.abs(p),mr=Math.abs(r),m=Math.max(mp,mr);
    $('pv').textContent=(mp<0.5?'':p>0?'+':'\u2212')+Math.round(mp)+'\u00b0';
    $('rv').textContent=(mr<0.5?'':r>0?'+':'\u2212')+Math.round(mr)+'\u00b0';
    $('pl').textContent=mp<1.5?'Level':p>0?'\u25B2 Nose up':'\u25BC Nose down';
    $('rl').textContent=mr<1.5?'Level':r>0?'Lean right \u25B6':'\u25C0 Lean left';
    el.className='tile tilt att'+(m>=30?' bad':m>=20?' warn':'');
    setAtt(p,r);setCarPose(p,r);
  }
  setInterval(function(){
    if(T.u){T.su=T.su?[T.su[0]+.35*(T.u[0]-T.su[0]),T.su[1]+.35*(T.u[1]-T.su[1]),T.su[2]+.35*(T.u[2]-T.su[2])]:T.u.slice()}
    if(T.state==='wait'&&!T.u&&Date.now()-T.t0>4000&&T.t0){T.state='none';L('tilt',{state:'no events'})}
    if(T.state==='cal'){
      if(T.su)T.samples.push(T.su.slice());
      var el=Date.now()-T.t0;
      if(el>=1200&&T.samples.length>=5)finishCal();
      else if(el>5000){T.state='none';L('tilt',{state:'calibration timeout'});$('msg').textContent='No tilt sensor data.'}
    }
    if(T.state==='ok'&&T.cal&&T.su){
      var c=T.cal,cl=function(x){return Math.max(-1,Math.min(1,x))};
      T.p=Math.asin(cl(vd(T.su,c.f)))*180/Math.PI;     // nose up = positive
      T.r=-Math.asin(cl(vd(T.su,c.r)))*180/Math.PI;    // right side down = positive
    }
    tiltUI();
  },100);
  function tiltOff(){
    if(T.listening){window.removeEventListener('deviceorientation',onOri);T.listening=false}
    T.state='off';T.u=T.su=T.cal=null;
  }
  function enableTilt(){askTilt().then(calibrate)}
  $('att').onclick=function(){if(!S.sim&&(T.state==='off'||T.state==='denied'||T.state==='none'))enableTilt()};
  $('lvl').onclick=function(){if(S.sim){$('msg').textContent='Level is not used in simulation.';return}enableTilt()};
  $('bcal').onclick=function(){closeScr('scrSet');enableTilt()};
  function tiltSet(){$('invp').classList.toggle('on',T.ip);$('invr').classList.toggle('on',T.ir);
    [].forEach.call($('mnt').children,function(b){b.classList.toggle('on',b.dataset.m===T.mount)})}
  $('invp').onclick=function(){T.ip=!T.ip;saveTilt();tiltSet();L('tilt',{invp:T.ip?1:0})};
  $('invr').onclick=function(){T.ir=!T.ir;saveTilt();tiltSet();L('tilt',{invr:T.ir?1:0})};
  [].forEach.call($('mnt').children,function(b){b.onclick=function(){T.mount=b.dataset.m;saveTilt();tiltSet();L('tilt',{mount:T.mount});if(T.state==='ok')enableTilt()}});
  tiltSet();

  // ---- Debug screen ----
  var BK='speedo.blur';
  try{if(localStorage.getItem(BK)==='0')$('blur').checked=false}catch(e){}
  function bl(d,on){
    if(!on||!d||typeof d!=='object')return d;
    var o={};for(var k in d)o[k]=d[k];
    ['la','lo','lat','lon'].forEach(function(f){if(typeof o[f]==='number')o[f]=+o[f].toFixed(2)});
    return o;
  }
  function tm(t){var d=new Date(t);return pad(d.getHours())+':'+pad(d.getMinutes())+':'+pad(d.getSeconds())+'.'+Math.floor(d.getMilliseconds()/100)}
  function showLogs(){
    updUp();
    var on=$('blur').checked;
    readLogs(function(a){
      var sz=a.length?Math.round(JSON.stringify(a).length/1024):0;
      $('dstat').textContent=a.length+' entries (~'+sz+' KB, keeps the newest '+LG.MAX+')'+(LG.fail?' · IndexedDB unavailable, memory only':'');
      $('dlog').textContent=a.slice(-120).reverse().map(function(e){var s=JSON.stringify(bl(e.d,on));return tm(e.t)+' '+e.k+' '+(s.length>170?s.slice(0,170)+'…':s)}).join('\n')||'No entries yet.';
    });
  }
  $('bd').onclick=function(){openScr('scrDbg');showLogs()};
  $('cd').onclick=function(){closeScr('scrDbg')};
  $('dref').onclick=showLogs;
  $('blur').onchange=function(){try{localStorage.setItem(BK,this.checked?'1':'0')}catch(e){}showLogs()};
  $('dclr').onclick=function(){
    if(!confirm('Clear all debug logs?'))return;
    LG.q=[];
    try{if(LG.db)LG.db.transaction('logs','readwrite').objectStore('logs').clear().onsuccess=showLogs;else showLogs()}catch(e){showLogs()}
  };
  $('dexp').onclick=function(){
    var on=$('blur').checked;
    readLogs(function(a){
      var meta={app:'speedo',version:VER,exported:new Date().toISOString(),coordinatesBlurred:on,count:a.length};
      var txt='{"meta":'+JSON.stringify(meta)+',"entries":[\n'+a.map(function(e){return JSON.stringify({t:new Date(e.t).toISOString(),k:e.k,d:bl(e.d,on)})}).join(',\n')+'\n]}';
      out('speedo-log-'+new Date().toISOString().slice(0,16).replace(/[:T]/g,'-')+'.json',txt,'application/json');
      L('export',{n:a.length,blurred:on});
    });
  };

  // ---- Send logs to GitHub (Contents API, one new file per upload) ----
  var GK='speedo.gh',UK='speedo.logup',DK='speedo.dev';
  var GH={repo:'Sambuddha-Debnath/Speedo',branch:'logs',token:'',auto:false},upBusy=false,pub=null,devId='anon',sessId=new Date().toISOString().slice(11,19).replace(/:/g,'');
  try{var g0=JSON.parse(localStorage.getItem(GK)||'{}');GH.repo=g0.repo||GH.repo;GH.branch=g0.branch||GH.branch;localStorage.removeItem(GK+'-token');localStorage.setItem(GK,JSON.stringify({repo:GH.repo,branch:GH.branch}))}catch(e){}
  try{devId=localStorage.getItem(DK);if(!devId){devId=Math.random().toString(16).slice(2,10);localStorage.setItem(DK,devId)}}catch(e){devId='anon'}
  $('ghrepo').value=GH.repo;$('ghbr').value=GH.branch||'';
  function saveGH(){try{localStorage.setItem(GK,JSON.stringify({repo:GH.repo,branch:GH.branch}))}catch(e){}}
  function upStatus(t){$('upst').textContent=t}
  function ghHead(){return{'Authorization':'Bearer '+GH.token,'Accept':'application/vnd.github+json','X-GitHub-Api-Version':'2022-11-28'}}
  function b64(t){var b=new TextEncoder().encode(t),r='';for(var i=0;i<b.length;i+=8192)r+=String.fromCharCode.apply(null,b.subarray(i,i+8192));return btoa(r)}
  function ghOk(){return !!GH.token&&/^[\w.-]+\/[\w.-]+$/.test(GH.repo)}
  function readSince(after,cb){
    flush();
    if(!LG.db){cb([]);return}
    var out=[];
    try{var r=LG.db.transaction('logs').objectStore('logs').openCursor(after?IDBKeyRange.lowerBound(after,true):null);
      r.onsuccess=function(){var c=r.result;if(c){out.push({id:c.key,t:c.value.t,k:c.value.k,d:c.value.d});c.continue()}else cb(out)};
      r.onerror=function(){cb([])}}catch(e){cb([])}
  }
  function updUp(){
    if(!GH.token){upStatus('Not set up. Add a repo and token, then tap Save & test.');return}
    readSince(+localStorage.getItem(UK)||0,function(a){upStatus('Pending upload: '+a.length+' entries'+(pub===true?' · repo is PUBLIC, coordinates are always blurred':''))});
  }
  function checkRepo(cb){
    var H=ghHead(),base='https://api.github.com/repos/'+GH.repo;
    fetch(base,{headers:H}).then(function(r){return r.json().then(function(j){return{s:r.status,j:j}})}).then(function(x){
      if(x.s!==200){cb(x.s===401?'Token rejected (401). Check it has not expired.':x.s===404?'Repo not found, or the token has no access to it (404).':'GitHub error '+x.s);return}
      pub=!x.j.private;
      if(x.j.permissions&&x.j.permissions.push===false){cb('Token cannot write. It needs Contents: Read and write.');return}
      if(!GH.branch){cb(null);return}
      return fetch(base+'/branches/'+encodeURIComponent(GH.branch),{headers:H}).then(function(r){
        if(r.status===200){cb(null);return}
        cb(r.status===404?'Branch not found. Choose an existing branch; Save & test will not create one.':'GitHub error '+r.status);
      });
    }).catch(function(){cb('Offline or blocked.')});
  }
  function upload(why,manual){
    if(upBusy)return;
    if(!manual)return;
    if(!ghOk()){if(manual)upStatus('Add a repo and token first.');return}
    if(!navigator.onLine){if(manual)upStatus('Offline. Connect and tap Send now to retry.');return}
    upBusy=true;
    var fail=function(msg,st){upBusy=false;L('upload',{ok:0,why:why,status:st||null,msg:msg});if(manual||$('scrDbg').classList.contains('open'))upStatus('Upload failed: '+msg)};
    var run=function(){
      readSince(+localStorage.getItem(UK)||0,function(a){
        if(!a.length){upBusy=false;upStatus('Nothing new to send.');return}
        var blur=$('blur').checked||pub===true,sent=0;
        (function next(i){
          if(i>=a.length||i>=2000){upBusy=false;upStatus('Sent '+sent+' entries at '+new Date().toLocaleTimeString()+(blur?' (coordinates blurred)':''));return}
          var ch=a.slice(i,i+400),now=new Date(),iso=now.toISOString();
          var txt='{"meta":'+JSON.stringify({app:'speedo',version:VER,device:devId,session:sessId,sent:iso,why:why,coordinatesBlurred:blur,count:ch.length})+',"entries":[\n'+ch.map(function(e){return JSON.stringify({t:new Date(e.t).toISOString(),k:e.k,d:bl(e.d,blur)})}).join(',\n')+'\n]}';
          var path='logs/'+devId+'/'+iso.slice(0,10)+'/'+iso.slice(11,19).replace(/:/g,'')+'-'+sessId+'-'+Math.random().toString(16).slice(2,5)+'.json';
          fetch('https://api.github.com/repos/'+GH.repo+'/contents/'+path,{method:'PUT',headers:Object.assign({'Content-Type':'application/json'},ghHead()),keepalive:why==='hidden'&&txt.length<40000,
            body:JSON.stringify({message:'log '+devId+' '+iso.slice(0,19)+' ('+why+')',content:b64(txt),branch:GH.branch||undefined})}).then(function(r){
            if(r.status===201||r.status===200){try{localStorage.setItem(UK,String(ch[ch.length-1].id))}catch(e){}sent+=ch.length;next(i+400)}
            else fail(r.status===401?'token rejected (401)':r.status===403?'forbidden or rate limited (403)':r.status===404?'repo or branch not found, or no access (404)':'GitHub error '+r.status,r.status);
          }).catch(function(){fail('network error')});
        })(0);
      });
    };
    if(pub===null)checkRepo(function(err){if(err&&pub===null)fail(err);else run()});else run();
  }
  $('ghsave').onclick=function(){
    GH.repo=$('ghrepo').value.trim();GH.branch=$('ghbr').value.trim();GH.token=$('ghtok').value.trim();saveGH();$('ghtok').value='';pub=null;
    if(!ghOk()){upStatus('Enter the repo as owner/name and paste a token.');return}
    $('ghtok').placeholder='Enter again when uploading';upStatus('Testing…');
    checkRepo(function(err){upStatus(err?err:(pub?'Connected, but this repo is PUBLIC. Coordinates will always be blurred.':'Connected to a private repo. Ready.'))});
  };
  $('ghsend').onclick=function(){upStatus('Sending…');upload('manual',true)};
  $('ghdel').onclick=function(){GH.token='';pub=null;$('ghtok').value='';$('ghtok').placeholder='Fine-grained token';upStatus('Token cleared from memory.')};

  function openScr(id){$(id).classList.add('open')}
  function closeScr(id){$(id).classList.remove('open')}
  $('bt').onclick=function(){renderTrips();$('savedTripsList').hidden=false;$('tripDetailPanel').hidden=true;openScr('scrTrips')};
  $('ba').onclick=function(){openScr('scrAnalytics')};
  $('bs').onclick=function(){openScr('scrSet')};
  $('ct').onclick=function(){closeScr('scrTrips')};
  $('ca').onclick=function(){closeScr('scrAnalytics')};
  $('cr').onclick=function(){closeScr('scrReport')};
  $('cs').onclick=function(){closeScr('scrSet')};

  $('go').onclick=function(){S.run?stop():start()};
  $('reset').onclick=reset;
  $('views').onclick=function(e){var b=e.target.closest('button');if(b)setView(b.dataset.v)};
  $('hud').onclick=function(){var enabled=document.body.classList.toggle('hud');this.textContent='HUD mirror: '+(enabled?'On':'Off');this.setAttribute('aria-pressed',String(enabled))};
  window.addEventListener('speedo:notice',function(e){$('msg').textContent=String(e.detail||'')});
  $('full').onclick=function(e){e.preventDefault();window.open(location.href,'_blank')};
  document.addEventListener('visibilitychange',function(){if(!document.hidden&&S.run){lock();if(!S.sim)startWatch('visible')}});

  $('demo').onclick=function(){
    if(S.demo){stop();return}
    if(S.run)stop();
    reset();S.ended=false;
    S.run=true;S.sim=true;S.t0=Date.now();window.dispatchEvent(new CustomEvent('speedo:trip-start',{detail:{timestamp:S.t0,simulated:true}}));S.last=null;S.fixes=0;L('start',{sim:1,scn:$('scn').value});
    $('go').textContent='Stop';$('go').className='btn stop';
    $('demo').textContent='Stop simulation';
    $('msg').textContent='Simulated drive: no GPS is used.';
    closeScr('scrSet');
    var P={city:{vmax:14,acc:1.8,dec:3,turn:14,stops:1},hwy:{vmax:31,acc:1.2,dec:2,turn:2,stops:0},jam:{vmax:9,acc:1.5,dec:3,turn:7,stops:1}}[$('scn').value];
    var la=37.7749,lo=-122.4194,hd=45,sp=0,tgt=P.vmax*0.7,n=0,r=Math.PI/180;
    S.tick=setInterval(clock,500);
    S.demo=setInterval(function(){
      n++;
      if(n%(P.stops?7:12)===0){tgt=(P.stops&&Math.random()<0.3)?0:P.vmax*(0.45+Math.random()*0.55)}
      sp=sp<tgt?Math.min(tgt,sp+P.acc):Math.max(tgt,sp-P.dec);
      hd=(hd+(Math.random()*2-1)*P.turn+360)%360;T.sp=14*Math.sin(n/9);T.sr=10*Math.sin(n/6+1);
      la+=sp*Math.cos(hd*r)/111320;lo+=sp*Math.sin(hd*r)/(111320*Math.cos(la*r));
      onPos({timestamp:Date.now(),coords:{latitude:la,longitude:lo,speed:sp,heading:hd,altitude:900+30*Math.sin(n/25)+12*Math.sin(n/8),accuracy:5+Math.random()*4}});
    },1000);
  };

  var framed=false;try{framed=window.self!==window.top}catch(e){framed=true}
  if(framed)$('frame').hidden=false;
  if('serviceWorker' in navigator&&location.protocol==='https:'&&!framed)navigator.serviceWorker.register('sw.js').then(function(){L('sw',{ok:1})}).catch(function(e){L('sw',{ok:0,msg:String(e)})});
  syncAl();renderTrips();setView(S.view);render();
})();
