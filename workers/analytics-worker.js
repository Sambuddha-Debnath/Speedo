import { normaliseSample } from '../js/ai/data-processor.js';
import { detectEvents } from '../js/ai/event-detector.js';
let history=[];
const emitted=new Set();
self.onmessage=(event)=>{
  const {type,payload}=event.data||{};
  if(type==='RESET'){history=[];emitted.clear();self.postMessage({type:'READY'});return;}
  if(type==='SAMPLE'){
    const sample=normaliseSample(payload); history.push(sample); if(history.length>12)history.shift();
    const events=detectEvents(history).filter(e=>{const key=e.eventType+':'+e.timestamp;if(emitted.has(key))return false;emitted.add(key);return true;});
    if(events.length) self.postMessage({type:'EVENTS',events});
  }
};
