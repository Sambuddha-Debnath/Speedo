const API = 'https://api.github.com';

export async function uploadTripReport({ repository, token, report, includeRoute, samples }) {
  const repo = String(repository || '').trim();
  const credential = String(token || '').trim();
  if (!/^[\w.-]+\/[\w.-]+$/.test(repo)) throw new Error('Enter the repository as owner/name.');
  if (!credential) throw new Error('Enter a GitHub token with Contents: read and write permission.');
  if (report.simulated) throw new Error('Simulated test trips stay on this device and cannot be uploaded.');

  const route = includeRoute ? samples
    .filter(sample => sample.quality.gpsValid && Number.isFinite(sample.gps.latitude) && Number.isFinite(sample.gps.longitude))
    .map(sample => ({
      timestamp: new Date(sample.timestamp).toISOString(),
      latitude: sample.gps.latitude,
      longitude: sample.gps.longitude
    })) : undefined;
  const payload = {
    application: 'SPEEDO v11',
    exportedAt: new Date().toISOString(),
    locationCoordinatesIncluded: Boolean(includeRoute),
    trip: {
      tripId: report.tripId,
      simulated: report.simulated,
      score: report.score,
      scoreLabel: report.scoreLabel,
      scoreDetails: report.scoreDetails,
      metrics: report.metrics,
      events: report.events.map(event => includeRoute ? event : withoutLocation(event))
    },
    ...(route ? { route } : {})
  };
  const path = `reports/${encodeURIComponent(report.tripId)}.json`;
  const headers = {
    Accept: 'application/vnd.github+json',
    Authorization: `Bearer ${credential}`,
    'X-GitHub-Api-Version': '2022-11-28'
  };
  const existing = await fetch(`${API}/repos/${repo}/contents/${path}`, { headers });
  if (existing.ok) throw new Error('A report for this trip already exists in the repository; it was not overwritten.');
  if (existing.status !== 404) throw await githubError(existing);

  const response = await fetch(`${API}/repos/${repo}/contents/${path}`, {
    method: 'PUT',
    headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      message: `Add SPEEDO v11 report ${report.tripId}`,
      content: toBase64(JSON.stringify(payload, null, 2))
    })
  });
  if (!response.ok) throw await githubError(response);
  return await response.json();
}

function toBase64(value) {
  const bytes = new TextEncoder().encode(value);
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += 8192) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 8192));
  }
  return btoa(binary);
}

function withoutLocation(event) {
  const { location, ...publicEvent } = event;
  return publicEvent;
}

async function githubError(response) {
  let message = `GitHub returned HTTP ${response.status}.`;
  try {
    const body = await response.json();
    if (body.message) message = `GitHub: ${body.message} (HTTP ${response.status}).`;
  } catch {
    // Keep the HTTP status when GitHub does not return JSON.
  }
  return new Error(message);
}
