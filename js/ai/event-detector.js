import { featureVector } from './data-processor.js';
const uid = () => crypto.randomUUID ? crypto.randomUUID() : `evt-${Date.now()}-${Math.random()}`;
function event(type, sample, severity, confidence, value, unit) {
  const location = sample.quality.gpsValid && sample.gps.accuracy <= 25
    ? { latitude: sample.gps.latitude, longitude: sample.gps.longitude }
    : null;
  return {
    eventId: uid(),
    eventType: type,
    timestamp: sample.timestamp,
    ...(location ? { location } : {}),
    severity,
    confidence,
    value,
    unit,
    acknowledged: false,
    source: 'gps-estimate',
    note: 'Estimated from phone GPS; review before treating as a confirmed driving event.'
  };
}
export function detectEvents(samples) {
  const features = featureVector(samples);
  const out = [];
  const last = { braking: -Infinity, acceleration: -Infinity, cornering: -Infinity, overspeed: -Infinity, gps: -Infinity, unreliable: -Infinity };
  let overspeedStart = null;
  let prolongedOverspeedReported = false;
  for(let i=1;i<features.length;i++) {
    const f=features[i], s=samples[i];
    if (f.dt == null || f.dt <= 0) continue;
    if (f.gpsAccuracyM == null || f.gpsAccuracyM > 40 || f.dt > 10) {
      if (s.timestamp - last.gps > 30000) {
        const value = f.dt > 10 ? f.dt : f.gpsAccuracyM;
        const unit = f.dt > 10 ? 'seconds between GPS fixes' : 'm GPS accuracy';
        out.push(event('gps_anomaly', s, 'low', 0.4, Number.isFinite(value) ? Number(value.toFixed(1)) : 'unavailable', unit));
        last.gps = s.timestamp;
      }
      overspeedStart = null;
      prolongedOverspeedReported = false;
      continue;
    }
    if (!f.valid) {
      if (s.timestamp - last.unreliable > 30000) {
        out.push(event('unreliable_sensor_data', s, 'low', 0.35, 'missing or invalid', 'GPS/speed sample'));
        last.unreliable = s.timestamp;
      }
      overspeedStart = null;
      prolongedOverspeedReported = false;
      continue;
    }
    if (f.dt > 3 || f.gpsAccuracyM > 25) {
      overspeedStart = null;
      prolongedOverspeedReported = false;
      continue;
    }
    const a=f.accelerationMps2;
    if(a!==null && a < -3 && (samples[i-1].vehicle.speed||0)>20 && s.timestamp-last.braking>12000) { out.push(event('possible_harsh_braking',s,Math.abs(a)>4.5?'high':'medium',0.55,Number(a.toFixed(2)),'m/s²')); last.braking=s.timestamp; }
    if(a!==null && a > 2.5 && f.speedKmh>15 && s.timestamp-last.acceleration>12000) { out.push(event('possible_harsh_acceleration',s,a>3.5?'high':'medium',0.5,Number(a.toFixed(2)),'m/s²')); last.acceleration=s.timestamp; }
    if(f.headingDeltaDeg!==null && f.headingDeltaDeg>20 && f.dt<=2 && f.speedKmh>25 && s.timestamp-last.cornering>12000) { out.push(event('possible_sharp_corner',s,'medium',0.35,Number(f.headingDeltaDeg.toFixed(1)),'degrees')); last.cornering=s.timestamp; }
    const limit=s.road.speedLimit;
    if(Number.isFinite(limit) && limit>0 && f.speedKmh>limit+5) {
      if (overspeedStart === null) overspeedStart = s.timestamp;
      if (s.timestamp-last.overspeed>30000) {
        out.push(event('overspeed',s,f.speedKmh>limit+20?'high':'medium',0.85,Number((f.speedKmh-limit).toFixed(1)),'km/h above mapped limit'));
        last.overspeed=s.timestamp;
      }
      if (!prolongedOverspeedReported && s.timestamp - overspeedStart >= 60000) {
        out.push(event('prolonged_overspeed', s, 'high', 0.8, 60, 'seconds above mapped speed limit'));
        prolongedOverspeedReported = true;
      }
    } else {
      overspeedStart = null;
      prolongedOverspeedReported = false;
    }
  }
  return out;
}
