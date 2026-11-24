import { getReports, getTrips } from '../storage/trip-store.js';
import { put } from '../storage/database.js';
export async function refreshDriverProfile() {
  const [reports,trips]=await Promise.all([getReports(),getTrips()]);
  const usable=reports.filter(r=>!r.simulated&&r.scoreDetails&&r.scoreDetails.score!==null).slice(0,30);
  const scores=usable.map(r=>r.score); const avg=scores.length?scores.reduce((a,b)=>a+b,0)/scores.length:null;
  const profile={profileId:'default',updatedAt:Date.now(),tripCount:trips.length,analysedTripCount:usable.length,averageScore:avg===null?null:Number(avg.toFixed(1)),recentScores:scores.slice(0,10),baselineStatus:usable.length>=5?'established':'building',notes:usable.length>=5?'Based on recent trips with sufficient data.':'Collect at least five reliable analysed trips to establish a useful personal baseline.'};
  await put('driverProfile',profile); return profile;
}
