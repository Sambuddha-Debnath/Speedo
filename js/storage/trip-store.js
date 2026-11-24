import { put, add, get, getAll, getByIndex, deleteByIndex, transaction } from './database.js';
const id = () => (crypto.randomUUID ? crypto.randomUUID() : `s-${Date.now()}-${Math.random().toString(16).slice(2)}`);
export const newTripId = () => `trip-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
export async function createTrip(meta) { const trip = { tripId: meta.tripId || newTripId(), startTime: meta.startTime || Date.now(), endTime: null, status: 'recording', platform: /iPhone|iPad|iPod/.test(navigator.userAgent) ? 'ios' : 'android-or-other', totalDistance: 0, movingTime: 0, maximumSpeed: 0, averageSpeed: 0, totalSamples: 0, analyticsStatus: 'pending', score: null, simulated: !!meta.simulated, ...meta }; await put('trips', trip); return trip; }
export async function saveSample(tripId, sample) { const row = { sampleId: id(), tripId, timestamp: sample.timestamp, ...sample }; await add('tripSamples', row); return row; }
export async function saveSamples(tripId, samples) { const rows=samples.map(sample=>({sampleId:id(),tripId,timestamp:sample.timestamp,...sample})); await transaction(['tripSamples'],'readwrite',tx=>{const store=tx.objectStore('tripSamples');rows.forEach(row=>store.add(row));}); return rows.length; }
export async function updateTrip(trip) { await put('trips', trip); }
export async function getTrip(tripId) { return get('trips', tripId); }
export async function getTrips() { return (await getAll('trips')).sort((a,b) => b.startTime-a.startTime); }
export async function getSamples(tripId) { return (await getByIndex('tripSamples', 'tripId', tripId)).sort((a,b) => a.timestamp-b.timestamp); }
export async function saveEvents(tripId, events) { await transaction(['drivingEvents'], 'readwrite', tx => { const store = tx.objectStore('drivingEvents'); events.forEach(e => store.put({ ...e, eventId: e.eventId || id(), tripId })); }); }
export async function getEvents(tripId) { return getByIndex('drivingEvents', 'tripId', tripId); }
export async function saveReport(report) { await put('tripReports', report); }
export async function getReports() { return (await getAll('tripReports')).sort((a,b) => b.createdAt-a.createdAt); }
export async function deleteTripData(tripId) { await Promise.all(['tripSamples','drivingEvents'].map(s => deleteByIndex(s,'tripId',tripId))); await transaction(['trips','tripReports'], 'readwrite', tx => { tx.objectStore('trips').delete(tripId); tx.objectStore('tripReports').delete(tripId); }); }
