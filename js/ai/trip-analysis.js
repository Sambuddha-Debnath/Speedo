import { detectEvents } from './event-detector.js';
import { calculateControlScore, calculateScore } from './scoring-engine.js';
import { saveEvents, saveReport, updateTrip } from '../storage/trip-store.js';

function distanceBetween(a, b) {
  const radians = Math.PI / 180;
  const dLat = (b.gps.latitude - a.gps.latitude) * radians;
  const dLon = (b.gps.longitude - a.gps.longitude) * radians;
  const h = Math.sin(dLat / 2) ** 2
    + Math.cos(a.gps.latitude * radians) * Math.cos(b.gps.latitude * radians) * Math.sin(dLon / 2) ** 2;
  return 6371000 * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

export function tripMetrics(samples) {
  const valid = samples.filter(sample => sample.quality.gpsValid && sample.quality.speedValid);
  const speeds = valid.map(sample => sample.vehicle.speed);
  const altitudes = samples
    .filter(sample => sample.quality.gpsValid && Number.isFinite(sample.vehicle.altitude))
    .map(sample => sample.vehicle.altitude);
  const gradients = valid
    .filter(sample => Number.isFinite(sample.vehicle.gradient))
    .map(sample => sample.vehicle.gradient);
  const speedBands = [
    { label: '0–30 km/h', min: 0, max: 30 },
    { label: '30–60 km/h', min: 30, max: 60 },
    { label: '60–90 km/h', min: 60, max: 90 },
    { label: '90+ km/h', min: 90, max: Infinity }
  ].map(band => ({
    label: band.label,
    samples: speeds.filter(speed => speed >= band.min && speed < band.max).length
  }));
  let distance = 0;
  let movingTime = 0;
  let stationaryTime = 0;
  let elevationGain = 0;
  let elevationLoss = 0;
  let overspeedDuration = 0;
  let gaps = 0;
  const accuracy = [];

  for (let index = 0; index < samples.length; index += 1) {
    const sample = samples[index];
    if (sample.quality.gpsValid && Number.isFinite(sample.gps.accuracy)) accuracy.push(sample.gps.accuracy);
    if (index === 0) continue;

    const previous = samples[index - 1];
    const seconds = (sample.timestamp - previous.timestamp) / 1000;
    if (seconds <= 0) continue;
    if (seconds > 10) {
      gaps += 1;
      continue;
    }

    if (sample.quality.gpsValid && sample.quality.speedValid) {
      if (sample.vehicle.speed > 3) movingTime += seconds;
      else stationaryTime += seconds;
      const limit = sample.road.speedLimit;
      if (Number.isFinite(limit) && limit > 0 && sample.vehicle.speed > limit + 5) overspeedDuration += seconds;
    }

    const coordinatesValid = previous.quality.gpsValid && sample.quality.gpsValid
      && Number.isFinite(previous.gps.latitude) && Number.isFinite(previous.gps.longitude)
      && Number.isFinite(sample.gps.latitude) && Number.isFinite(sample.gps.longitude);
    if (coordinatesValid) {
      const segment = distanceBetween(previous, sample);
      if (segment / seconds <= 70) distance += segment;
    }

    const altitudeDelta = sample.vehicle.altitude - previous.vehicle.altitude;
    if (sample.quality.gpsValid && previous.quality.gpsValid
      && Number.isFinite(sample.vehicle.altitude) && Number.isFinite(previous.vehicle.altitude)
      && Math.abs(altitudeDelta) >= 3) {
      if (altitudeDelta > 0) elevationGain += altitudeDelta;
      else elevationLoss -= altitudeDelta;
    }
  }

  return {
    distanceM: Math.round(distance),
    movingTimeSeconds: Math.round(movingTime),
    stationaryTimeSeconds: Math.round(stationaryTime),
    averageSpeedKmh: movingTime > 0 ? Number((distance / movingTime * 3.6).toFixed(1)) : null,
    maximumSpeedKmh: speeds.length ? Number(Math.max(...speeds).toFixed(1)) : null,
    speedDistribution: speedBands.map(band => ({ ...band, percent: speeds.length ? Math.round(band.samples / speeds.length * 100) : 0 })),
    elevation: {
      startM: altitudes.length ? Number(altitudes[0].toFixed(1)) : null,
      minimumM: altitudes.length ? Number(Math.min(...altitudes).toFixed(1)) : null,
      maximumM: altitudes.length ? Number(Math.max(...altitudes).toFixed(1)) : null,
      gainM: Number(elevationGain.toFixed(1)),
      lossM: Number(elevationLoss.toFixed(1))
    },
    gradient: {
      minimumPercent: gradients.length ? Number(Math.min(...gradients).toFixed(1)) : null,
      maximumPercent: gradients.length ? Number(Math.max(...gradients).toFixed(1)) : null
    },
    overspeedDurationSeconds: Math.round(overspeedDuration),
    gpsQuality: {
      validSamples: valid.length,
      totalSamples: samples.length,
      coveragePercent: samples.length ? Math.round(valid.length / samples.length * 100) : 0,
      meanAccuracyM: accuracy.length ? Number((accuracy.reduce((sum, value) => sum + value, 0) / accuracy.length).toFixed(1)) : null,
      gapsOver10Seconds: gaps
    }
  };
}

export async function analyseTrip(trip,samples) {
  const events=detectEvents(samples); const score=calculateScore(samples,events); const control=calculateControlScore(samples);
  const speeds=samples.filter(s=>s.quality.speedValid).map(s=>s.vehicle.speed);
  const metrics=tripMetrics(samples);
  const report={tripId:trip.tripId,createdAt:Date.now(),simulated:!!trip.simulated,tripOverview:{startTime:trip.startTime,endTime:trip.endTime||Date.now(),durationSeconds:Math.max(0,Math.round(((trip.endTime||Date.now())-trip.startTime)/1000))},score:score.score,scoreLabel:score.label,scoreDetails:score,controlScore:control.score,controlScoreDetails:control,metrics,events,summary:{samples:samples.length,maximumSpeed:speeds.length?Math.max(...speeds):null,averageSpeed:speeds.length?speeds.reduce((a,b)=>a+b,0)/speeds.length:null,overspeedEvents:events.filter(e=>e.eventType==='overspeed').length,possibleBraking:events.filter(e=>e.eventType==='possible_harsh_braking').length,possibleAcceleration:events.filter(e=>e.eventType==='possible_harsh_acceleration').length,possibleCornering:events.filter(e=>e.eventType==='possible_sharp_corner').length}};
  await saveEvents(trip.tripId,events); await saveReport(report);
  await updateTrip({...trip,endTime:trip.endTime||Date.now(),status:'completed',analyticsStatus:'complete',score:score.score,controlScore:control.score,totalSamples:samples.length,maximumSpeed:report.summary.maximumSpeed,totalDistance:metrics.distanceM,movingTime:metrics.movingTimeSeconds,averageSpeed:metrics.averageSpeedKmh});
  return report;
}
