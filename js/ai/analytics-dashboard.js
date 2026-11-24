export function periodBounds(period, value) {
  const parts = String(value || '').split('-').map(Number);
  let start;
  let end;
  if (period === 'day' && parts.length === 3 && parts.every(Number.isFinite)) {
    start = new Date(parts[0], parts[1] - 1, parts[2]);
    end = new Date(parts[0], parts[1] - 1, parts[2] + 1);
    if (start.getFullYear() !== parts[0] || start.getMonth() !== parts[1] - 1 || start.getDate() !== parts[2]) {
      throw new RangeError('Choose a valid day, month, or year.');
    }
  } else if (period === 'month' && parts.length === 2 && parts.every(Number.isFinite)) {
    if (parts[1] < 1 || parts[1] > 12) throw new RangeError('Choose a valid day, month, or year.');
    start = new Date(parts[0], parts[1] - 1, 1);
    end = new Date(parts[0], parts[1], 1);
  } else if (period === 'year' && /^\d{4}$/.test(String(value))) {
    const year = Number(value);
    start = new Date(year, 0, 1);
    end = new Date(year + 1, 0, 1);
  } else {
    throw new RangeError('Choose a valid day, month, or year.');
  }
  if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime())) {
    throw new RangeError('Choose a valid day, month, or year.');
  }
  return { start: start.getTime(), end: end.getTime() };
}

export function buildDistanceWindows(records, windowKm) {
  if (!Number.isInteger(windowKm) || windowKm < 10 || windowKm > 10000 || windowKm % 10 !== 0) {
    throw new RangeError('Distance windows must be 10–10,000 km in 10 km steps.');
  }

  const buckets = new Map();
  let distanceKm = 0;
  const ordered = [...records].sort((a, b) => a.startTime - b.startTime);
  for (const record of ordered) {
    let remaining = Number(record.distanceKm);
    if (!Number.isFinite(remaining) || remaining <= 0) continue;

    while (remaining > 0.000001) {
      const index = Math.floor(distanceKm / windowKm);
      const offsetKm = distanceKm - index * windowKm;
      const sliceKm = Math.min(remaining, windowKm - offsetKm);
      let bucket = buckets.get(index);
      if (!bucket) {
        bucket = {
          index,
          fromKm: index * windowKm,
          toKm: (index + 1) * windowKm,
          distanceKm: 0,
          safetyScore: null,
          controlScore: null,
          trips: new Set(),
          safetyWeighted: 0,
          safetyDistance: 0,
          controlWeighted: 0,
          controlDistance: 0
        };
        buckets.set(index, bucket);
      }

      bucket.distanceKm += sliceKm;
      bucket.trips.add(record.tripId);
      if (Number.isFinite(record.safetyScore)) {
        bucket.safetyWeighted += record.safetyScore * sliceKm;
        bucket.safetyDistance += sliceKm;
      }
      if (Number.isFinite(record.controlScore)) {
        bucket.controlWeighted += record.controlScore * sliceKm;
        bucket.controlDistance += sliceKm;
      }
      distanceKm += sliceKm;
      remaining -= sliceKm;
    }
  }

  return [...buckets.values()].map(bucket => ({
    index: bucket.index,
    fromKm: bucket.fromKm,
    toKm: bucket.toKm,
    distanceKm: Number(bucket.distanceKm.toFixed(2)),
    tripCount: bucket.trips.size,
    safetyScore: bucket.safetyDistance
      ? Number((bucket.safetyWeighted / bucket.safetyDistance).toFixed(1)) : null,
    controlScore: bucket.controlDistance
      ? Number((bucket.controlWeighted / bucket.controlDistance).toFixed(1)) : null,
    safetyDistanceKm: Number(bucket.safetyDistance.toFixed(2)),
    controlDistanceKm: Number(bucket.controlDistance.toFixed(2))
  }));
}

export function distanceWeightedScore(windows, field) {
  const distanceField = field === 'safetyScore' ? 'safetyDistanceKm' : 'controlDistanceKm';
  const eligible = windows.filter(window => Number.isFinite(window[field]) && window[distanceField] > 0);
  const distance = eligible.reduce((total, window) => total + window[distanceField], 0);
  if (!distance) return null;
  return Number((eligible.reduce((total, window) => total + window[field] * window[distanceField], 0) / distance).toFixed(1));
}
