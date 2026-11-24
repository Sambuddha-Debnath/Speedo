import { getReports, getTrips } from '../storage/trip-store.js';
import { put } from '../storage/database.js';
export async function refreshDriverProfile() {
  const [reports,trips]=await Promise.all([getReports(),getTrips()]);
  const usable=reports.filter(r=>!r.simulated&&r.scoreDetails&&r.scoreDetails.score!==null).slice(0,30);
  const scores=usable.map(r=>r.score); const avg=scores.length?scores.reduce((a,b)=>a+b,0)/scores.length:null;
  const speeds=usable.map(r=>r.metrics?.averageSpeedKmh).filter(Number.isFinite);
  const distanceKm=usable.reduce((total,r)=>total+(r.metrics?.distanceM||0)/1000,0);
  const eventCount=type=>usable.reduce((total,r)=>total+(r.events||[]).filter(event=>event.eventType===type).length,0);
  const profile={profileId:'default',updatedAt:Date.now(),tripCount:trips.length,analysedTripCount:usable.length,averageScore:avg===null?null:Number(avg.toFixed(1)),averageDrivingSpeedKmh:speeds.length?Number((speeds.reduce((a,b)=>a+b,0)/speeds.length).toFixed(1)):null,possibleBrakingPer100Km:Number((eventCount('possible_harsh_braking')/Math.max(.1,distanceKm)*100).toFixed(1)),possibleAccelerationPer100Km:Number((eventCount('possible_harsh_acceleration')/Math.max(.1,distanceKm)*100).toFixed(1)),overspeedEventsPer100Km:Number((eventCount('overspeed')/Math.max(.1,distanceKm)*100).toFixed(1)),recentScores:scores.slice(0,10),baselineStatus:usable.length>=5?'established':'building',notes:usable.length>=5?'Based on recent non-simulated trips with sufficient data.':'Collect at least five reliable non-simulated trips to establish a useful personal baseline.'};
  await put('driverProfile',profile); return profile;
}
