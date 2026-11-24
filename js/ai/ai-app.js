import './ai-manager.js';
import { getTrips, getReports, getEvents, deleteTripData } from '../storage/trip-store.js';
import { refreshDriverProfile } from './driver-profile.js';
import { getModelStatus } from './model-manager.js';
const $=id=>document.getElementById(id);
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const fmtDate=t=>new Date(t).toLocaleString([],{day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'});
function panel(title,value,sub=''){return `<div class="ai-stat"><div class="ai-muted">${title}</div><strong>${value}</strong><small>${sub}</small></div>`;}
async function render(){
  const [trips,reports,profile,model]=await Promise.all([getTrips(),getReports(),refreshDriverProfile(),getModelStatus()]);
  const valid=reports.filter(r=>r.score!==null);const avg=valid.length?Math.round(valid.reduce((a,r)=>a+r.score,0)/valid.length):'—';
  $('aiStats').innerHTML=panel('Average score',avg,`${valid.length} analysed trips`)+panel('Recorded trips',trips.length,'Stored on this device')+panel('Possible events',reports.reduce((n,r)=>n+r.events.length,0),'Across analysed trips')+panel('Personal baseline',profile.baselineStatus==='established'?'Ready':'Building',profile.notes);
  $('aiModelStatus').textContent=model.status==='ready'?'Optional ML model loaded':model.status==='unavailable'?'ML model unavailable – rules active':'No ML model installed – rules active';
  $('aiTripList').innerHTML=trips.slice(0,40).map(t=>{const r=reports.find(x=>x.tripId===t.tripId);return `<div class="ai-trip"><div><b>${fmtDate(t.startTime)}${t.simulated?' · simulation':''}</b><small>${Number((t.totalDistance||0)/1000).toFixed(2)} km · ${t.totalSamples||0} samples</small></div><div class="ai-trip-right"><b>${r?.score??'—'}</b><button data-report="${esc(t.tripId)}">Report</button></div></div>`;}).join('')||'<p class="ai-muted">No trips found. Complete a trip or run a simulation to generate analytics.</p>';
  $('aiTrend').innerHTML=valid.slice(0,10).reverse().map(r=>`<span title="${r.score}/100" style="height:${Math.max(4,r.score)}%"></span>`).join('')||'<span class="ai-muted">Complete trips to build your score history.</span>';
}
async function openReport(tripId){const [reports,events]=await Promise.all([getReports(),getEvents(tripId)]);const r=reports.find(x=>x.tripId===tripId);if(!r){$('aiReport').innerHTML='<p>No report available yet. This trip may not have enough reliable samples.</p>';return;}
 const rows=events.map(e=>`<div class="ai-event"><b>${esc(e.eventType.replaceAll('_',' '))}</b><span>${fmtDate(e.timestamp)} · ${esc(e.value)} ${esc(e.unit)} · confidence ${Math.round(e.confidence*100)}%</span></div>`).join('');
 $('aiReport').innerHTML=`<div class="ai-report-score"><strong>${r.score??'—'}</strong><span>${esc(r.scoreLabel||'Insufficient data')}</span></div><p>${esc(r.scoreDetails?.reason||`${r.scoreDetails?.coverage??0}% reliable data coverage. ${r.events.length} estimated events detected.`)}</p><div class="ai-event-list">${rows||'<p class="ai-muted">No driving events detected.</p>'}</div>`;
}
function setup(){
  $('aiOpen').addEventListener('click',()=>{$('scrAI').classList.add('open');render().catch(e=>console.error(e));});
  $('aiClose').addEventListener('click',()=>$('scrAI').classList.remove('open'));
  $('aiTripList').addEventListener('click',e=>{const b=e.target.closest('[data-report]');if(b)openReport(b.dataset.report).catch(console.error);});
  $('aiRefresh').addEventListener('click',()=>render().catch(console.error));
  $('aiClear').addEventListener('click',async()=>{if(!confirm('Delete all SPEEDO AI trip analytics from this device? Original legacy trip exports will remain untouched.'))return;const trips=await getTrips();for(const t of trips)await deleteTripData(t.tripId);await render();});
  window.addEventListener('speedo-ai-trip-state',e=>{if(!e.detail.recording&&$('scrAI').classList.contains('open'))render().catch(console.error);});
  window.addEventListener('speedo-ai-ready',e=>{if($('aiModelStatus'))$('aiModelStatus').textContent=e.detail.model?.message||'Local analytics ready';if($('scrAI').classList.contains('open'))render().catch(console.error);});
}
setup();
