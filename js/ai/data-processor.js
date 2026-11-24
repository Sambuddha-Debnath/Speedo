const finite = value => {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
};
export function normaliseSample(raw) {
  const gps = raw.gps || {};
  const vehicle = raw.vehicle || {};
  const motion = raw.motion || {};
  const road = raw.road || {};
  const quality = raw.quality || {};
  const latitude = finite(gps.latitude);
  const longitude = finite(gps.longitude);
  const accuracy = finite(gps.accuracy);
  const speed = finite(vehicle.speed);
  return {
    timestamp: finite(raw.timestamp) ?? Date.now(),
    gps: { latitude, longitude, accuracy },
    vehicle: { speed, heading: finite(vehicle.heading), altitude: finite(vehicle.altitude), gradient: finite(vehicle.gradient) },
    motion: { pitch: finite(motion.pitch), roll: finite(motion.roll), accelerationX: finite(motion.accelerationX), accelerationY: finite(motion.accelerationY), accelerationZ: finite(motion.accelerationZ) },
    road: { speedLimit: finite(road.speedLimit), speedLimitSource: road.speedLimitSource || null },
    quality: {
      gpsValid: quality.gpsValid !== false
        && latitude !== null && latitude >= -90 && latitude <= 90
        && longitude !== null && longitude >= -180 && longitude <= 180
        && accuracy !== null && accuracy >= 0 && accuracy <= 40,
      speedValid: quality.speedValid !== false && speed !== null && speed >= 0 && speed <= 250,
      motionValid: quality.motionValid === true
    }
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
