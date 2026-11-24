import { detectEvents } from './event-detector.js';
import { calculateScore } from './scoring-engine.js';
import { saveEvents, saveReport, updateTrip } from '../storage/trip-store.js';
export async function analyseTrip(trip,samples) {
  const events=detectEvents(samples); const score=calculateScore(samples,events);
  const speeds=samples.filter(s=>s.quality.speedValid).map(s=>s.vehicle.speed);
  const report={tripId:trip.tripId,createdAt:Date.now(),simulated:!!trip.simulated,score:score.score,scoreLabel:score.label,scoreDetails:score,events,summary:{samples:samples.length,maximumSpeed:speeds.length?Math.max(...speeds):null,averageSpeed:speeds.length?speeds.reduce((a,b)=>a+b,0)/speeds.length:null,overspeedEvents:events.filter(e=>e.eventType==='overspeed').length,possibleBraking:events.filter(e=>e.eventType==='possible_harsh_braking').length,possibleAcceleration:events.filter(e=>e.eventType==='possible_harsh_acceleration').length,possibleCornering:events.filter(e=>e.eventType==='possible_sharp_corner').length}};
  await saveEvents(trip.tripId,events); await saveReport(report);
  await updateTrip({...trip,endTime:trip.endTime||Date.now(),status:'completed',analyticsStatus:'complete',score:score.score,totalSamples:samples.length,maximumSpeed:report.summary.maximumSpeed});
  return report;
}
