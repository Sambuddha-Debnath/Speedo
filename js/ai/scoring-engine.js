import { featureVector } from './data-processor.js';

const clamp=(n,min=0,max=100)=>Math.max(min,Math.min(max,n));
export function calculateScore(samples, events) {
  const valid=samples.filter(s=>s.quality.gpsValid&&s.quality.speedValid);
  const coverage=samples.length?valid.length/samples.length:0;
  if(valid.length<30 || coverage<0.6) return { score:null, label:'Insufficient data', coverage:Math.round(coverage*100), components:null, reason:'At least 30 reliable samples and 60% valid data coverage are required.' };
  const moving=valid.filter(s=>(s.vehicle.speed||0)>8); const distance=estimateDistance(valid); let movingSeconds=0; for(let i=1;i<valid.length;i++){const dt=(valid[i].timestamp-valid[i-1].timestamp)/1000;if(dt>0&&dt<=5&&(valid[i].vehicle.speed||0)>8)movingSeconds+=dt;} const hours=Math.max(1/3600,movingSeconds/3600);
  const rate=(type)=>events.filter(e=>e.eventType===type).length/Math.max(0.1,distance/1000);
  const over=events.filter(e=>e.eventType==='overspeed').length;
  const prolongedOver=events.filter(e=>e.eventType==='prolonged_overspeed').length;
  const components={speedDiscipline:clamp(35-over*2.5-prolongedOver*5),braking:clamp(25-rate('possible_harsh_braking')*7),acceleration:clamp(20-rate('possible_harsh_acceleration')*5),cornering:clamp(10-rate('possible_sharp_corner')*3),consistency:clamp(10-(Math.max(0,standardDeviation(moving.map(s=>s.vehicle.speed||0))-12)*0.35))};
  const score=Math.round(components.speedDiscipline+components.braking+components.acceleration+components.cornering+components.consistency);
  return {score,label:score>=90?'Very consistent':score>=80?'Consistent':score>=65?'Developing':'Needs review',coverage:Math.round(coverage*100),components,distanceKm:Number((distance/1000).toFixed(2)),movingSamples:moving.length,eventRatePer100Km:Number((events.length/Math.max(0.1,distance/1000)).toFixed(1)),confidence:coverage>=0.85?'good':'limited',durationHours:Number(hours.toFixed(2))};
}
function standardDeviation(a){if(a.length<2)return 0;const m=a.reduce((x,y)=>x+y,0)/a.length;return Math.sqrt(a.reduce((x,y)=>x+(y-m)**2,0)/a.length)}
function distanceBetween(a,b){const R=6371000,p=Math.PI/180,dLat=(b.gps.latitude-a.gps.latitude)*p,dLon=(b.gps.longitude-a.gps.longitude)*p;const h=Math.sin(dLat/2)**2+Math.cos(a.gps.latitude*p)*Math.cos(b.gps.latitude*p)*Math.sin(dLon/2)**2;return 2*R*Math.asin(Math.sqrt(h))}
function estimateDistance(samples){let d=0;for(let i=1;i<samples.length;i++){const a=samples[i-1],b=samples[i];if(a.gps.latitude==null||b.gps.latitude==null||a.gps.longitude==null||b.gps.longitude==null)continue;const dt=(b.timestamp-a.timestamp)/1000;if(dt>0&&dt<=5&&b.gps.accuracy<=40){const m=distanceBetween(a,b);if(m/dt<70)d+=m;}}return d}
export function calculateControlScore(samples) {
  const valid = samples.filter(sample => sample.quality.gpsValid && sample.quality.speedValid);
  const coverage = samples.length ? valid.length / samples.length : 0;
  if (valid.length < 30 || coverage < 0.6) {
    return {
      score: null,
      label: 'Insufficient data',
      coverage: Math.round(coverage * 100),
      components: null,
      reason: 'At least 30 reliable samples and 60% valid data coverage are required.'
    };
  }

  const accelerations = [];
  const longitudinalJerk = [];
  const yawRateChange = [];
  let previousAcceleration = null;
  let previousYawRate = null;
  const features = featureVector(samples);
  for (const feature of features) {
    if (!feature.valid || feature.gpsAccuracyM == null || feature.gpsAccuracyM > 25
      || feature.dt == null || feature.dt <= 0 || feature.dt > 3) {
      previousAcceleration = null;
      previousYawRate = null;
      continue;
    }

    if (feature.accelerationMps2 != null) {
      accelerations.push(feature.accelerationMps2);
      if (previousAcceleration) {
        longitudinalJerk.push(Math.abs(feature.accelerationMps2 - previousAcceleration.value) / feature.dt);
      }
      previousAcceleration = { value: feature.accelerationMps2 };
    } else {
      previousAcceleration = null;
    }

    if (feature.headingDeltaDeg != null && feature.speedKmh > 15) {
      const yawRate = feature.headingDeltaDeg / feature.dt;
      if (previousYawRate != null) yawRateChange.push(Math.abs(yawRate - previousYawRate) / feature.dt);
      previousYawRate = yawRate;
    } else {
      previousYawRate = null;
    }
  }

  const components = {};
  const weights = {};
  if (longitudinalJerk.length >= 5) {
    components.longitudinalSmoothness = clamp(40 - median(longitudinalJerk) * 5, 0, 40);
    weights.longitudinalSmoothness = 0.4;
  }
  if (yawRateChange.length >= 5) {
    components.corneringSmoothness = clamp(35 - median(yawRateChange) * 0.5, 0, 35);
    weights.corneringSmoothness = 0.35;
  }
  if (accelerations.length >= 10) {
    components.accelerationConsistency = clamp(25 - standardDeviation(accelerations) * 4, 0, 25);
    weights.accelerationConsistency = 0.25;
  }

  const availableWeight = Object.values(weights).reduce((total, weight) => total + weight, 0);
  if (!availableWeight) {
    return {
      score: null,
      label: 'Insufficient dynamics',
      coverage: Math.round(coverage * 100),
      components: null,
      reason: 'Reliable acceleration or heading-change samples were not available.'
    };
  }
  const score = Math.round(Object.entries(components).reduce((total, [key, value]) => {
    const maximum = key === 'longitudinalSmoothness' ? 40
      : key === 'corneringSmoothness' ? 35 : 25;
    return total + value / maximum * weights[key];
  }, 0) / availableWeight * 100);
  return {
    score,
    label: score >= 90 ? 'Very consistent' : score >= 80 ? 'Consistent' : score >= 65 ? 'Developing' : 'Needs review',
    coverage: Math.round(coverage * 100),
    components: Object.fromEntries(Object.entries(components).map(([key, value]) => [key, Math.round(value)])),
    confidence: coverage >= 0.85 && valid.length >= 60 ? 'good' : 'limited',
    reason: 'Estimated from GPS-derived acceleration and heading changes; this is a control-consistency score, not a race-performance result.'
  };
}

function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}
