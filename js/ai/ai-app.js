import './ai-manager.js';
import { getTrips, getReports, getEvents, getSamples, getTrip, deleteTripData } from '../storage/trip-store.js';
import { refreshDriverProfile } from './driver-profile.js';
import { uploadTripReport } from '../reports/github-upload.js';

const $ = id => document.getElementById(id);
let selectedReport = null;
let selectedTrip = null;
let selectedSamples = [];

const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, char => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
})[char]);
const fmtDate = timestamp => timestamp
  ? new Date(timestamp).toLocaleString([], { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })
  : 'Unavailable';
const fmtDuration = seconds => {
  const total = Math.max(0, Math.round(seconds || 0));
  return `${Math.floor(total / 3600)}h ${Math.floor((total % 3600) / 60)}m`;
};

function panel(title, value, sub = '') {
  return `<div class="ai-stat"><div class="ai-muted">${escapeHtml(title)}</div><strong>${escapeHtml(value)}</strong><small>${escapeHtml(sub)}</small></div>`;
}

async function render() {
  const [trips, reports, profile] = await Promise.all([
  getTrips(), getReports(), refreshDriverProfile()
  ]);
  const valid = reports.filter(report => report.score !== null);
  const average = valid.length
    ? Math.round(valid.reduce((sum, report) => sum + report.score, 0) / valid.length)
    : '—';
  $('aiStats').innerHTML = panel('Average score', average, `${valid.length} analysed trips`)
    + panel('Recorded trips', trips.length, 'Stored on this device')
    + panel('Possible events', reports.reduce((sum, report) => sum + (report.events?.length || 0), 0), 'Estimated from available sensors')
    + panel('Personal baseline', profile.baselineStatus === 'established' ? 'Ready' : 'Building', profile.notes);
  $('aiProfile').innerHTML = metric('Average moving speed', Number.isFinite(profile.averageDrivingSpeedKmh) ? `${profile.averageDrivingSpeedKmh} km/h` : '—')
    + metric('Possible harsh braking', Number.isFinite(profile.possibleBrakingPer100Km) ? `${profile.possibleBrakingPer100Km} per 100 km` : '—')
    + metric('Possible harsh acceleration', Number.isFinite(profile.possibleAccelerationPer100Km) ? `${profile.possibleAccelerationPer100Km} per 100 km` : '—')
    + metric('Mapped-limit overspeed', Number.isFinite(profile.overspeedEventsPer100Km) ? `${profile.overspeedEventsPer100Km} per 100 km` : '—');
  $('aiProfileNote').textContent = 'Calculated locally from non-simulated trips with sufficient data. These are historical estimates, not predictions.';
  $('aiModelStatus').textContent = 'Transparent rule-based analytics · no trained model installed';
  $('aiTripList').innerHTML = trips.slice(0, 40).map(trip => {
    const report = reports.find(item => item.tripId === trip.tripId);
    return `<div class="ai-trip"><div><b>${escapeHtml(fmtDate(trip.startTime))}${trip.simulated ? ' · simulation' : ''}</b>`
      + `<small>${Number((trip.totalDistance || 0) / 1000).toFixed(2)} km · ${trip.totalSamples || 0} samples</small></div>`
      + `<div class="ai-trip-right"><b>${escapeHtml(report?.score ?? '—')}</b>`
      + `<button data-report="${escapeHtml(trip.tripId)}">Report</button></div></div>`;
  }).join('') || '<p class="ai-muted">No trips found. Record a trip or run a labelled simulation.</p>';
  $('aiTrend').innerHTML = valid.slice(0, 10).reverse()
    .map(report => `<span title="${report.score}/100" style="height:${Math.max(4, report.score)}%"></span>`)
    .join('') || '<span class="ai-muted">Complete trips to build a score history.</span>';
}

function chart(samples, valueOf) {
  const values = samples.map(valueOf).filter(Number.isFinite);
  if (values.length < 2) return '<p class="ai-muted">Not enough reliable samples to chart.</p>';
  const low = Math.min(...values);
  const high = Math.max(...values);
  const range = high - low || 1;
  const points = values.filter((_, index) => index % Math.max(1, Math.ceil(values.length / 160)) === 0)
    .map((value, index, list) => {
      const x = list.length < 2 ? 0 : index / (list.length - 1) * 300;
      const y = 88 - (value - low) / range * 76;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    }).join(' ');
  return `<svg class="report-chart" viewBox="0 0 300 96" preserveAspectRatio="none" role="img">`
    + '<path class="chart-grid" d="M0 12H300M0 50H300M0 88H300"></path>'
    + `<polyline class="chart-line" points="${points}"></polyline></svg>`;
}

function metric(label, value) {
  return `<div class="report-metric"><small>${escapeHtml(label)}</small><strong>${escapeHtml(value)}</strong></div>`;
}

function scoreBreakdown(details) {
  if (!details?.components) return '<p class="ai-muted">No score was generated: the trip did not meet the minimum reliable-data requirements.</p>';
  const labels = {
    speedDiscipline: 'Speed discipline',
    braking: 'Braking',
    acceleration: 'Acceleration',
    cornering: 'Cornering',
    consistency: 'Consistency'
  };
  return `<div class="report-metrics">${Object.entries(details.components).map(([key, value]) => metric(labels[key] || key, `${value} points`)).join('')}</div>`
    + '<p class="ai-muted">Transparent rule-based score, up to 100 total points: speed discipline (35), braking (25), acceleration (20), cornering (10), and consistency (10), with event-rate penalties. It is not a machine-learning prediction or a safety certification.</p>';
}

async function openReport(tripId) {
  const [reports, events, samples, trip] = await Promise.all([
    getReports(), getEvents(tripId), getSamples(tripId), getTrip(tripId)
  ]);
  const report = reports.find(item => item.tripId === tripId);
  selectedReport = report || null;
  selectedTrip = trip || null;
  selectedSamples = samples;
  $('reportActions').hidden = !report;
  if (!report) {
    $('aiReport').innerHTML = '<p>No report is available. The trip may not have enough samples.</p>';
    return;
  }

  const metrics = report.metrics || {};
  const elevation = metrics.elevation || {};
  const quality = metrics.gpsQuality || {};
  const eventRows = events.sort((left, right) => left.timestamp - right.timestamp).map(event => `<div class="ai-event"><b>${escapeHtml(event.eventType.replaceAll('_', ' '))}</b>`
    + `<span>${escapeHtml(fmtDate(event.timestamp))} · ${escapeHtml(event.value)} ${escapeHtml(event.unit)} · confidence ${Math.round((event.confidence || 0) * 100)}% · ${escapeHtml(event.severity)}</span></div>`)
    .join('');
  const speedChart = chart(samples, sample => sample.quality.speedValid ? sample.vehicle.speed : null);
  const elevationChart = chart(samples, sample => Number.isFinite(sample.vehicle.altitude) ? sample.vehicle.altitude : null);
  const routeCount = samples.filter(sample => sample.quality.gpsValid).length;
  const routeSamples = samples.filter(sample => sample.quality.gpsValid);
  const routeStart = routeSamples[0];
  const routeEnd = routeSamples[routeSamples.length - 1];
  const speedBands = (metrics.speedDistribution || []).map(band =>
    `${escapeHtml(band.label)}: ${band.percent}%`).join(' · ');

  $('aiReport').innerHTML = `<div class="ai-report-score"><strong>${escapeHtml(report.score ?? '—')}</strong><span>${escapeHtml(report.scoreLabel || 'Insufficient data')}</span></div>`
    + `<p>${escapeHtml(report.scoreDetails?.reason || `${report.scoreDetails?.coverage ?? 0}% reliable data coverage. ${(report.events || []).length} estimated events detected.`)}</p>`
    + `<div class="report-metrics">${metric('Started', fmtDate(trip?.startTime))}${metric('Ended', fmtDate(trip?.endTime))}`
    + `${metric('Duration', fmtDuration(metrics.movingTimeSeconds + metrics.stationaryTimeSeconds || report.tripOverview?.durationSeconds))}`
    + `${metric('Distance', `${((metrics.distanceM || trip?.totalDistance || 0) / 1000).toFixed(2)} km`)}`
    + `${metric('Average / maximum', `${metrics.averageSpeedKmh ?? '—'} / ${metrics.maximumSpeedKmh ?? '—'} km/h`)}`
    + `${metric('Overspeed duration', fmtDuration(metrics.overspeedDurationSeconds))}</div>`
    + `<h3>Score breakdown</h3>${scoreBreakdown(report.scoreDetails)}`
    + `<h3>Speed over trip</h3>${speedChart}<p class="ai-muted">${speedBands || 'Speed distribution unavailable.'}</p>`
    + `<h3>Elevation profile</h3>${elevationChart}<p class="ai-muted">Start ${elevation.startM ?? '—'} m · range ${elevation.minimumM ?? '—'}–${elevation.maximumM ?? '—'} m · gain ${elevation.gainM ?? '—'} m · loss ${elevation.lossM ?? '—'} m</p>`
    + `<h3>Route and data quality</h3><p>${routeCount} GPS points · mean accuracy ±${quality.meanAccuracyM ?? '—'} m · ${quality.gapsOver10Seconds ?? 0} gaps over 10 seconds. GPS-derived values and events are estimates.</p>`
    + (routeStart ? `<p class="ai-muted">Start: ${routeStart.gps.latitude.toFixed(5)}, ${routeStart.gps.longitude.toFixed(5)} · End: ${routeEnd.gps.latitude.toFixed(5)}, ${routeEnd.gps.longitude.toFixed(5)}</p>` : '')
    + `<p class="ai-muted">Gradient range ${metrics.gradient?.minimumPercent ?? '—'}% to ${metrics.gradient?.maximumPercent ?? '—'}%.</p>`
    + (routeCount ? `<button class="btn sm" data-show-route="${escapeHtml(tripId)}">View route on map</button>` : '')
    + `<h3>Detected events</h3><div class="ai-event-list">${eventRows || '<p class="ai-muted">No events detected in the available data.</p>'}</div>`;
  $('reportUploadStatus').textContent = 'Uploads are manual. Tokens are not saved. A browser token is visible to scripts running on this site.';
}

function makeExportDocument(includeRoute) {
  const route = includeRoute ? selectedSamples
    .filter(sample => sample.quality.gpsValid && Number.isFinite(sample.gps.latitude) && Number.isFinite(sample.gps.longitude))
    .map(sample => ({
      timestamp: new Date(sample.timestamp).toISOString(),
      latitude: sample.gps.latitude,
      longitude: sample.gps.longitude
    })) : undefined;
  return {
    application: 'SPEEDO v11',
    generatedAt: new Date().toISOString(),
    locationCoordinatesIncluded: Boolean(includeRoute),
    trip: {
      tripId: selectedReport.tripId,
      startTime: selectedTrip?.startTime ?? null,
      endTime: selectedTrip?.endTime ?? null,
      simulated: selectedReport.simulated,
      score: selectedReport.score,
      scoreLabel: selectedReport.scoreLabel,
      scoreDetails: selectedReport.scoreDetails,
      metrics: selectedReport.metrics,
      events: selectedReport.events.map(event => includeRoute ? event : withoutLocation(event))
    },
    ...(route ? { route } : {})
  };
}

function withoutLocation(event) {
  const { location, ...publicEvent } = event;
  return publicEvent;
}

function downloadReport() {
  if (!selectedReport) return;
  const documentData = makeExportDocument($('includeRoute').checked);
  const blob = new Blob([JSON.stringify(documentData, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `speedo-v11-${selectedReport.tripId}.json`;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function uploadSelectedReport() {
  if (!selectedReport) return;
  const tokenInput = $('reportToken');
  const token = tokenInput.value;
  const uploadButton = $('uploadReport');
  uploadButton.disabled = true;
  $('reportUploadStatus').textContent = 'Uploading only the selected report…';
  try {
    const result = await uploadTripReport({
      repository: $('reportRepo').value,
      token,
      report: selectedReport,
      includeRoute: $('includeRoute').checked,
      samples: selectedSamples
    });
    $('reportUploadStatus').textContent = `Upload succeeded: ${result.content?.path || 'report saved to GitHub'}`;
  } catch (error) {
    $('reportUploadStatus').textContent = `Upload failed: ${error.message}`;
  } finally {
    tokenInput.value = '';
    uploadButton.disabled = false;
  }
}

function setup() {
  $('bt')?.addEventListener('click', () => {
    render().catch(error => console.error('Unable to render trip analytics', error));
  });
  $('aiTripList')?.addEventListener('click', event => {
    const button = event.target.closest('[data-report]');
    if (button) openReport(button.dataset.report).catch(error => console.error('Unable to load trip report', error));
  });
  $('aiReport')?.addEventListener('click', async event => {
    const button = event.target.closest('[data-show-route]');
    if (!button) return;
    $('scrTrips').classList.remove('open');
    $('scrMap').classList.add('open');
    window.dispatchEvent(new CustomEvent('speedo:show-trip-route', { detail: selectedSamples }));
  });
  $('aiRefresh')?.addEventListener('click', () => render().catch(error => console.error('Unable to refresh analytics', error)));
  $('exportReport')?.addEventListener('click', downloadReport);
  $('uploadReport')?.addEventListener('click', () => uploadSelectedReport());
  $('aiClear')?.addEventListener('click', async () => {
    if (!confirm('Delete all SPEEDO analytics and imported trip copies from this device? Original legacy trip records remain untouched.')) return;
    try {
      const trips = await getTrips();
      for (const trip of trips) await deleteTripData(trip.tripId);
      selectedReport = selectedTrip = null;
      $('reportActions').hidden = true;
      await render();
    } catch (error) {
      console.error('Unable to clear local analytics', error);
    }
  });
  window.addEventListener('speedo-ai-trip-state', event => {
    if (!event.detail.recording && $('scrTrips').classList.contains('open')) {
      render().catch(error => console.error('Unable to refresh completed trip analytics', error));
    }
  });
  window.addEventListener('speedo-ai-ready', event => {
    if ($('aiModelStatus')) $('aiModelStatus').textContent = event.detail.model?.message || 'Local analytics ready';
    if ($('scrTrips').classList.contains('open')) render().catch(error => console.error('Unable to render analytics', error));
  });
  window.addEventListener('speedo-ai-error', event => {
    const message = `Analytics issue: ${event.detail?.message || 'check local storage and try again.'}`;
    if ($('aiModelStatus')) $('aiModelStatus').textContent = message;
    window.dispatchEvent(new CustomEvent('speedo:notice', { detail: message }));
  });
}

setup();
