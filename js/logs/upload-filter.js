export function uniqueUploadableLogs(entries) {
  const seen = new Set();
  const uploadable = [];
  let inSimulation = false;

  for (const entry of entries) {
    if (seen.has(entry.id)) continue;
    seen.add(entry.id);

    const simulated = entry.d?.sim === 1 || entry.d?.sim === true;
    if (entry.k === 'session') inSimulation = false;
    if (entry.k === 'start') inSimulation = simulated;
    const isTestLog = inSimulation || simulated;
    if (entry.k === 'stop' && simulated) inSimulation = false;
    if (!isTestLog) uploadable.push(entry);
  }

  return uploadable;
}
