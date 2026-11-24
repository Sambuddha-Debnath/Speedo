const finite = v => Number.isFinite(Number(v)) ? Number(v) : null;
export function normaliseSample(raw) {
  const gps = raw.gps || {};
  const vehicle = raw.vehicle || {};
  const motion = raw.motion || {};
  const road = raw.road || {};
  const quality = raw.quality || {};
  return {
    timestamp: finite(raw.timestamp) || Date.now(),
    gps: { latitude: finite(gps.latitude), longitude: finite(gps.longitude), accuracy: finite(gps.accuracy) },
    vehicle: { speed: finite(vehicle.speed), heading: finite(vehicle.heading), altitude: finite(vehicle.altitude), gradient: finite(vehicle.gradient) },
    motion: { pitch: finite(motion.pitch), roll: finite(motion.roll), accelerationX: finite(motion.accelerationX), accelerationY: finite(motion.accelerationY), accelerationZ: finite(motion.accelerationZ) },
    road: { speedLimit: finite(road.speedLimit), speedLimitSource: road.speedLimitSource || null },
    quality: { gpsValid: quality.gpsValid !== false && finite(gps.accuracy) !== null && finite(gps.accuracy) <= 40, speedValid: quality.speedValid !== false && finite(vehicle.speed) !== null && finite(vehicle.speed) >= 0 && finite(vehicle.speed) <= 250, motionValid: quality.motionValid === true }
  };
}
export function featureVector(samples) {
  return samples.map((s, i) => {
    const p = samples[i-1]; const dt = p ? (s.timestamp-p.timestamp)/1000 : null;
    const accel = p && dt > 0 && dt <= 3 && p.quality.speedValid && s.quality.speedValid ? ((s.vehicle.speed-p.vehicle.speed)/3.6)/dt : null;
    const headingDelta = p && dt > 0 && dt <= 5 && p.vehicle.heading != null && s.vehicle.heading != null ? Math.abs(((s.vehicle.heading-p.vehicle.heading+540)%360)-180) : null;
    return { timestamp:s.timestamp, speedKmh:s.vehicle.speed, accelerationMps2:accel, headingDeltaDeg:headingDelta, gpsAccuracyM:s.gps.accuracy, speedLimitKmh:s.road.speedLimit, valid:s.quality.gpsValid && s.quality.speedValid, dt };
  });
}
