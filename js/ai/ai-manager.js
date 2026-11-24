import { createTrip, saveSample, saveSamples, getTrip, getSamples, getReports, updateTrip } from '../storage/trip-store.js';
import { normaliseSample } from './data-processor.js';
import { analyseTrip } from './trip-analysis.js';
import { refreshDriverProfile } from './driver-profile.js';
let activeTrip=null,worker=null,sampleCount=0,writeQueue=Promise.resolve();
const emit=(name,detail)=>window.dispatchEvent(new CustomEvent(name,{detail}));
function reportError(error, operation) {
  const message = `${operation}: ${error?.message || String(error)}`;
  console.error(message, error);
  emit('speedo-ai-error', { message });
}
async function init(){
  if('Worker' in window){try{worker=new Worker(new URL('../../workers/analytics-worker.js',import.meta.url),{type:'module'});worker.onmessage=e=>{if(e.data.type==='EVENTS')emit('speedo-ai-live-events',e.data.events);};}catch(e){console.warn('Analytics worker unavailable; using trip analysis after stop.',e);}}
  await migrateLegacyTrips(); emit('speedo-ai-ready',{model:{message:'Transparent, rule-based analytics running locally. No trained ML model is bundled.'}});
}
async function migrateLegacyTrips(){
  try{if(localStorage.getItem('speedo.ai.migration.v1')==='done')return;}catch{}
  let legacy=[];try{legacy=JSON.parse(localStorage.getItem('speedo.trips')||'[]');}catch{}
  for(const t of legacy){
    const tripId=`legacy-${t.id}`;
    let trip=await getTrip(tripId);
    const points=t.p||[];
    if(!trip){
      trip=await createTrip({tripId,startTime:t.s,endTime:t.e,status:'completed',simulated:!!t.sim,totalDistance:t.d||0,maximumSpeed:t.mx||0,movingTime:t.mv||0,averageSpeed:t.mv?(t.d/t.mv*3.6):0,totalSamples:points.length,analyticsStatus:'pending',legacy:true});
      for(let offset=0;offset<points.length;offset+=500){
        const batch=points.slice(offset,offset+500).map(p=>normaliseSample({timestamp:Number(p[0])*1000,gps:{latitude:p[1],longitude:p[2],accuracy:p[5]},vehicle:{speed:p[3],altitude:p[4]===''?null:p[4]},quality:{gpsValid:Number(p[5])<=40,speedValid:Number.isFinite(Number(p[3]))}}));
        await saveSamples(tripId,batch);
      }
    }
    if(points.length>=30){const reports=await getReports();if(!reports.some(r=>r.tripId===tripId)){const migratedSamples=await getSamples(tripId);await analyseTrip(trip,migratedSamples);}}
  }
  try{localStorage.setItem('speedo.ai.migration.v1','done');}catch{}
}
async function startTrip(meta={}){if(activeTrip)return activeTrip;activeTrip=await createTrip({startTime:meta.timestamp||Date.now(),simulated:!!meta.simulated});sampleCount=0;worker?.postMessage({type:'RESET'});emit('speedo-ai-trip-state',{recording:true,tripId:activeTrip.tripId});return activeTrip;}
async function onSample(raw){if(!activeTrip||sampleCount>=20000)return;const sample=normaliseSample(raw);const tripId=activeTrip.tripId;sampleCount++;worker?.postMessage({type:'SAMPLE',payload:sample});writeQueue=writeQueue.then(()=>saveSample(tripId,sample)).catch(e=>{reportError(e,'Trip sample could not be saved');});}
async function stopTrip(meta={}){if(!activeTrip)return null;const trip=activeTrip;activeTrip=null;await writeQueue;const samples=await getSamples(trip.tripId);const updated={...trip,endTime:meta.timestamp||Date.now(),status:'completed',totalSamples:samples.length};await updateTrip(updated);let report=null;if(samples.length>=5)report=await analyseTrip(updated,samples);await refreshDriverProfile();emit('speedo-ai-trip-state',{recording:false,tripId:trip.tripId,report});return report;}
window.addEventListener('speedo:trip-start',e=>startTrip(e.detail||{}).catch(error=>reportError(error,'Trip could not start')));
window.addEventListener('speedo:sample',e=>onSample(e.detail||{}));
window.addEventListener('speedo:trip-stop',e=>stopTrip(e.detail||{}).catch(error=>reportError(error,'Trip could not be completed')));
init().then(()=>emit('speedo-ai-initialised')).catch(error=>reportError(error,'SPEEDO initialization failed'));
export { startTrip, onSample, stopTrip };
