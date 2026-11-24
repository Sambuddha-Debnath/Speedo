import './ai-manager.js';
import { deleteTripData, getReports, getEvents, getSamples, getTrip, getTrips } from '../storage/trip-store.js';
import { tripMetrics } from './trip-analysis.js';
import { calculateControlScore, calculateScore } from './scoring-engine.js';
import { buildDistanceWindows, distanceWeightedScore, periodBounds } from './analytics-dashboard.js';
import { uploadTripReport } from '../reports/github-upload.js';

const $ = id => document.getElementById(id);
let selectedReport = null;
let selectedTrip = null;
let selectedSamples = [];
let analyticsPresentation = 'compare';
let analyticsRequest = 0;
const controlScoreCache = new Map();

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
const dateInputValue = (period, date = new Date()) => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return period === 'day' ? `${year}-${month}-${day}`
    : period === 'month' ? `${year}-${month}` : String(year);
};

function chartLine(windows, field) {
  const values = windows.map(window => Number.isFinite(window[field]) ? window[field] : null);
  const points = values.map((value, index) => value === null
    ? null
    : `${(values.length < 2 ? 150 : index / (values.length - 1) * 300).toFixed(1)},${(88 - value * 0.76).toFixed(1)}`);
  return points.filter(Boolean).join(' ');
}

function analyticsChart(windows, presentation, profile) {
  const visible = windows.slice(-18);
  if (!visible.length || !visible.some(window => Number.isFinite(window.safetyScore) || Number.isFinite(window.controlScore))) {
    return '<p class="ai-muted">Not enough scored distance windows to chart yet.</p>';
  }
  const lines = presentation === 'compare'
    ? `<polyline class="safety-line" points="${chartLine(visible, 'safetyScore')}"></polyline><polyline class="control-line" points="${chartLine(visible, 'controlScore')}"></polyline>`
    : `<polyline class="profile-line" points="${chartLine(visible, profile === 'safety' ? 'safetyScore' : 'controlScore')}"></polyline>`;
  const legend = presentation === 'compare'
    ? '<p class="analytics-summary">Safety <span class="legend-safety">●</span> · Performance <span class="legend-control">●</span></p>'
    : `<p class="analytics-summary">${profile === 'safety' ? 'Safety score' : 'Estimated control consistency'} · last ${visible.length} distance windows</p>`;
  return `<svg class="analytics-chart" viewBox="0 0 300 100" role="img" aria-label="Score trend across cumulative distance windows">`
    + '<path class="chart-grid" d="M0 12H300M0 50H300M0 88H300"></path>'
    + lines + '</svg>' + legend;
}

function weakestFactor(records, key, maxima, advice) {
  const totals = {};
  const counts = {};
  for (const record of records) {
    const components = record[key]?.components;
    if (!components) continue;
    for (const [name, value] of Object.entries(components)) {
      if (!Number.isFinite(value) || !maxima[name]) continue;
      totals[name] = (totals[name] || 0) + value / maxima[name];
      counts[name] = (counts[name] || 0) + 1;
    }
  }
  const weakest = Object.keys(totals)
    .map(name => ({ name, ratio: totals[name] / counts[name] }))
    .sort((left, right) => left.ratio - right.ratio)[0];
  return weakest && weakest.ratio < 0.75 ? advice[weakest.name] : null;
}

function analyticsAdvice(records, profile) {
  const safetyAdvice = weakestFactor(records, 'safetyDetails', {
    speedDiscipline: 35, braking: 25, acceleration: 20, cornering: 10, consistency: 10
  }, {
    speedDiscipline: 'Review speed-limit events and plan a steadier pace.',
    braking: 'Leave more following distance and practice progressive braking.',
    acceleration: 'Work on smoother throttle inputs.',
    cornering: 'Reduce corner-entry speed on public roads and avoid abrupt turns.',
    consistency: 'Aim for steadier speeds when traffic and road conditions allow.'
  });
  const controlAdvice = weakestFactor(records, 'controlDetails', {
    longitudinalSmoothness: 40, corneringSmoothness: 35, accelerationConsistency: 25
  }, {
    longitudinalSmoothness: 'Practice smoother acceleration and braking transitions.',
    corneringSmoothness: 'Practice gradual, repeatable steering on a closed course.',
    accelerationConsistency: 'Work on repeatable control inputs; GPS estimates can be noisy.'
  });
  if (profile === 'safety') return safetyAdvice || 'Keep reviewing trip details and maintain your current habits.';
  if (profile === 'tarmac' || profile === 'dirt') {
    return controlAdvice
      ? `${controlAdvice} Race-context feedback is an estimate; use a closed course.`
      : 'Focus on repeatable control inputs on a closed course; this is not a lap-time or grip assessment.';
  }
  return [safetyAdvice, controlAdvice].filter(Boolean).join(' ') || 'Keep reviewing trip details and maintain your current habits.';
}

async function loadAnalyticsRecords(bounds) {
  const [trips, reports] = await Promise.all([getTrips(), getReports()]);
  const reportByTrip = new Map(reports.map(report => [report.tripId, report]));
  const candidates = trips.filter(trip => !trip.simulated && trip.status !== 'recording'
    && Number.isFinite(trip.startTime) && trip.startTime >= bounds.start && trip.startTime < bounds.end);
  const records = new Array(candidates.length);
  let cursor = 0;

  async function loadNext() {
    while (cursor < candidates.length) {
      const index = cursor++;
      const trip = candidates[index];
      const report = reportByTrip.get(trip.tripId);
      let samples = null;
      let events = report?.events;
      let safetyDetails = report?.scoreDetails || null;
      let controlDetails = report?.controlScoreDetails || null;
      let safetyScore = Number.isFinite(report?.score) ? report.score : Number.isFinite(trip.score) ? trip.score : null;
      let controlScore = Number.isFinite(report?.controlScore) ? report.controlScore : Number.isFinite(trip.controlScore) ? trip.controlScore : null;

      if (!Number.isFinite(safetyScore) || !Number.isFinite(controlScore)) {
        samples = await getSamples(trip.tripId);
      }
      if (!Number.isFinite(safetyScore)) {
        events ||= await getEvents(trip.tripId);
        safetyDetails = calculateScore(samples || [], events);
        safetyScore = safetyDetails.score;
      }
      if (!Number.isFinite(controlScore)) {
        controlDetails = controlScoreCache.get(trip.tripId) || calculateControlScore(samples || []);
        controlScoreCache.set(trip.tripId, controlDetails);
        controlScore = controlDetails.score;
      }

      const metrics = report?.metrics || (samples ? tripMetrics(samples) : null);
      const distanceM = Number(metrics?.distanceM || trip.totalDistance || 0);
      if (!Number.isFinite(safetyScore) && !Number.isFinite(controlScore)) continue;
      records[index] = {
        tripId: trip.tripId,
        startTime: trip.startTime,
        distanceKm: distanceM / 1000,
        safetyScore,
        controlScore,
        safetyDetails,
        controlDetails
      };
    }
  }

  await Promise.all(Array.from({ length: Math.min(4, candidates.length) }, () => loadNext()));
  return records.filter(Boolean);
}

function renderAnalytics() {
  const request = ++analyticsRequest;
  const results = $('analyticsResults');
  const period = $('analyticsPeriod').value;
  const periodValue = $('analyticsDate').value;
  const windowKm = Number($('distanceWindowKm').value);
  let bounds;
  try {
    bounds = periodBounds(period, periodValue);
    if (!Number.isInteger(windowKm) || windowKm < 10 || windowKm > 10000 || windowKm % 10 !== 0) {
      throw new RangeError('Choose a distance window from 10 to 10,000 km in 10 km steps.');
    }
  } catch (error) {
    results.innerHTML = `<p class="ai-muted">${escapeHtml(error.message)}</p>`;
    return;
  }

  results.innerHTML = '<p class="ai-muted">Analyzing trips for this period…</p>';
  loadAnalyticsRecords(bounds).then(records => {
    if (request !== analyticsRequest) return;
    const windows = buildDistanceWindows(records, windowKm);
    if (!records.length || !windows.length) {
      results.innerHTML = '<p class="ai-muted">No scored, non-simulated trips in this period yet. Complete a trip with reliable GPS and speed samples to build your analytics.</p>';
      return;
    }

    const safety = distanceWeightedScore(windows, 'safetyScore');
    const control = distanceWeightedScore(windows, 'controlScore');
    const totalKm = records.reduce((total, record) => total + record.distanceKm, 0);
    const profile = $('scoreProfile').value;
    const selectedScore = profile === 'safety' ? safety : control;
    const profileName = profile === 'safety' ? 'Safety'
      : profile === 'tarmac' ? 'Tarmac racing context' : 'Dirt racing context';
    const scoreMarkup = analyticsPresentation === 'compare'
      ? `<div class="analytics-overview">${scoreCard('Safety', safety, 'Rule-based road-safety score')}${scoreCard('Performance', control, 'Estimated control consistency')}</div>`
      : `<div class="analytics-profile-card"><small>${escapeHtml(profileName)}</small><strong>${selectedScore ?? '—'}</strong><p>${Number.isFinite(selectedScore) ? 'Average score across eligible distance windows.' : 'Not enough reliable data to calculate this profile.'}</p></div>`;
    const chart = analyticsChart(windows, analyticsPresentation, profile);
    const advice = analyticsAdvice(records, analyticsPresentation === 'compare' ? 'compare' : profile);
    results.innerHTML = scoreMarkup + chart
      + `<p class="analytics-summary">${records.length} analyzed trip${records.length === 1 ? '' : 's'} · ${totalKm.toFixed(1)} km · ${windows.length} distance window${windows.length === 1 ? '' : 's'} of ${windowKm} km · selected ${escapeHtml(periodValue)}</p>`
      + `<p class="analytics-coach"><b>Next step:</b> ${escapeHtml(advice)}</p>`
      + '<p class="analytics-note">Tarmac/Dirt is a manual context label; the same GPS-based control model is used for both.</p>';
  }).catch(error => {
    if (request !== analyticsRequest) return;
    console.error('Unable to build trip analytics', error);
    results.innerHTML = `<p class="ai-muted">Analytics could not be loaded: ${escapeHtml(error.message || 'check local trip storage and try again.')}</p>`;
  });
}

function scoreCard(title, score, caption) {
  const label = !Number.isFinite(score) ? 'Insufficient data'
    : score >= 90 ? 'Very consistent'
      : score >= 80 ? 'Consistent'
        : score >= 65 ? 'Developing' : 'Needs review';
  return `<div class="analytics-score-card"><small>${escapeHtml(title)}</small><strong>${Number.isFinite(score) ? score : '—'}</strong><span>${escapeHtml(Number.isFinite(score) ? label : caption)}</span></div>`;
}

function setAnalyticsDateInput() {
  const period = $('analyticsPeriod').value;
  const input = $('analyticsDate');
  input.type = period === 'day' ? 'date' : period === 'month' ? 'month' : 'number';
  input.value = dateInputValue(period);
  input.setAttribute('aria-label', `Selected ${period}`);
  if (period === 'year') {
    input.min = '2000';
    input.max = String(new Date().getFullYear());
    input.step = '1';
  } else {
    input.removeAttribute('min');
    input.removeAttribute('max');
    input.removeAttribute('step');
  }
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
  $('tripDetailTitle').textContent = trip
    ? `${fmtDate(trip.startTime)}${trip.simulated ? ' · simulation' : ''}`
    : 'Trip details';
  selectedReport = report || null;
  selectedTrip = trip || null;
  selectedSamples = samples;
  $('includeRoute').checked = false;
  $('exportReport').disabled = !report;
  if (!trip) {
    $('aiReport').innerHTML = '<p class="ai-muted">Trip details are unavailable in local storage.</p>';
    return;
  }

  const metrics = report?.metrics || tripMetrics(samples);
  const elevation = metrics.elevation || {};
  const quality = metrics.gpsQuality || {};
  const eventRows = events.sort((left, right) => left.timestamp - right.timestamp).map(event => `<div class="ai-event"><b>${escapeHtml(event.eventType.replaceAll('_', ' '))}</b>`
    + `<span>${escapeHtml(fmtDate(event.timestamp))} · ${escapeHtml(event.value)} ${escapeHtml(event.unit)} · confidence ${Math.round((event.confidence || 0) * 100)}% · ${escapeHtml(event.severity)}</span></div>`)
    .join('');
  const speedChart = chart(samples, sample => sample.quality.speedValid ? sample.vehicle.speed : null);
  const elevationChart = chart(samples, sample => Number.isFinite(sample.vehicle.altitude) ? sample.vehicle.altitude : null);
  const routeSamples = samples.filter(sample => sample.quality.gpsValid
    && Number.isFinite(sample.gps.latitude) && Number.isFinite(sample.gps.longitude));
  const routeCount = routeSamples.length;
  const routeStart = routeSamples[0];
  const routeEnd = routeSamples[routeSamples.length - 1];
  const speedBands = (metrics.speedDistribution || []).map(band =>
    `${escapeHtml(band.label)}: ${band.percent}%`).join(' · ');
  const scoreSummary = report
    ? `<div class="ai-report-score"><strong>${escapeHtml(report.score ?? '—')}</strong><span>${escapeHtml(report.scoreLabel || 'Insufficient data')}</span></div>`
      + `<p>${escapeHtml(report.scoreDetails?.reason || `${report.scoreDetails?.coverage ?? 0}% reliable data coverage. ${(report.events || []).length} estimated events detected.`)}</p>`
      + `<h3>Score breakdown</h3>${scoreBreakdown(report.scoreDetails)}`
    : '<p class="ai-muted">No driving score was generated for this trip. The measurements below are still available.</p>';
  const controlSummary = Number.isFinite(report?.controlScore)
    ? `<div class="ai-report-score"><strong>${escapeHtml(report.controlScore)}</strong><span>Estimated control consistency</span></div>`
      + `<p class="ai-muted">${escapeHtml(report.controlScoreDetails?.reason || 'Estimated from GPS-derived changes; not a lap-time or grip result.')}</p>`
    : '<p class="ai-muted">Control consistency score unavailable for this trip.</p>';
  const durationSeconds = metrics.movingTimeSeconds + metrics.stationaryTimeSeconds
    || report?.tripOverview?.durationSeconds
    || (trip.endTime ? (trip.endTime - trip.startTime) / 1000 : 0);

  $('aiReport').innerHTML = scoreSummary + controlSummary
    + `<div class="report-metrics">${metric('Started', fmtDate(trip.startTime))}${metric('Ended', fmtDate(trip.endTime))}`
    + `${metric('Duration', fmtDuration(durationSeconds))}`
    + `${metric('Distance', `${((metrics.distanceM || trip.totalDistance || 0) / 1000).toFixed(2)} km`)}`
    + `${metric('Average / maximum', `${metrics.averageSpeedKmh ?? '—'} / ${metrics.maximumSpeedKmh ?? '—'} km/h`)}`
    + `${metric('Overspeed duration', fmtDuration(metrics.overspeedDurationSeconds))}</div>`
    + `<h3>Speed over trip</h3>${speedChart}<p class="ai-muted">${speedBands || 'Speed distribution unavailable.'}</p>`
    + `<h3>Elevation profile</h3>${elevationChart}<p class="ai-muted">Start ${elevation.startM ?? '—'} m · range ${elevation.minimumM ?? '—'}–${elevation.maximumM ?? '—'} m · gain ${elevation.gainM ?? '—'} m · loss ${elevation.lossM ?? '—'} m</p>`
    + `<h3>Route and data quality</h3><p>${routeCount} GPS points · mean accuracy ±${quality.meanAccuracyM ?? '—'} m · ${quality.gapsOver10Seconds ?? 0} gaps over 10 seconds. GPS-derived values and events are estimates.</p>`
    + (routeStart ? `<p class="ai-muted">Start: ${routeStart.gps.latitude.toFixed(5)}, ${routeStart.gps.longitude.toFixed(5)} · End: ${routeEnd.gps.latitude.toFixed(5)}, ${routeEnd.gps.longitude.toFixed(5)}</p>` : '')
    + `<p class="ai-muted">Gradient range ${metrics.gradient?.minimumPercent ?? '—'}% to ${metrics.gradient?.maximumPercent ?? '—'}%.</p>`
    + (routeCount ? `<button class="btn sm" data-show-route="${escapeHtml(tripId)}">View route on map</button>` : '')
    + `<h3>Detected events</h3><div class="ai-event-list">${eventRows || '<p class="ai-muted">No events detected in the available data.</p>'}</div>`;
  $('reportUploadStatus').textContent = 'Uploads are manual. The token is cleared after the upload attempt.';
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
      controlScore: selectedReport.controlScore,
      controlScoreDetails: selectedReport.controlScoreDetails,
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
  setAnalyticsDateInput();
  renderAnalytics();
  $('analyticsPeriod').addEventListener('change', () => {
    setAnalyticsDateInput();
    renderAnalytics();
  });
  $('analyticsDate').addEventListener('change', renderAnalytics);
  $('distanceWindowKm').addEventListener('change', renderAnalytics);
  $('scoreProfile').addEventListener('change', renderAnalytics);
  $('analyticsViewToggle')?.addEventListener('click', event => {
    const button = event.target.closest('[data-analytics-view]');
    if (!button) return;
    analyticsPresentation = button.dataset.analyticsView;
    document.querySelectorAll('[data-analytics-view]').forEach(item => {
      const active = item === button;
      item.classList.toggle('on', active);
      item.setAttribute('aria-pressed', String(active));
    });
    $('profileFilter').hidden = analyticsPresentation !== 'profile';
    renderAnalytics();
  });
  window.addEventListener('speedo:trips-open', () => {
    $('savedTripsList').hidden = false;
    $('tripDetailPanel').hidden = true;
    renderAnalytics();
  });
  window.addEventListener('speedo-ai-trip-state', event => {
    if (!event.detail?.recording) renderAnalytics();
  });
  window.addEventListener('speedo-ai-ready', renderAnalytics);
  window.addEventListener('speedo:trip-log-updated', renderAnalytics);
  window.addEventListener('speedo:trip-delete-request', event => {
    const tripId = event.detail?.tripId;
    if (!tripId) return;
    deleteTripData(tripId).then(renderAnalytics).catch(error => {
      console.error('Unable to delete trip analytics', error);
      window.dispatchEvent(new CustomEvent('speedo:notice', { detail: 'Trip was removed from the log, but its analytics could not be deleted.' }));
    });
  });
  window.addEventListener('speedo:trip-detail-request', event => {
    const tripId = event.detail?.tripId;
    if (!tripId) return;
    $('savedTripsList').hidden = true;
    $('tripDetailPanel').hidden = false;
    $('tripDetailTitle').textContent = 'Loading trip…';
    $('aiReport').innerHTML = '<p class="ai-muted">Loading saved trip details…</p>';
    openReport(tripId).catch(error => {
      console.error('Unable to load trip details', error);
      $('aiReport').innerHTML = '<p class="ai-muted">Trip details could not be loaded from this device.</p>';
    });
  });
  $('tripDetailBack')?.addEventListener('click', () => {
    $('tripDetailPanel').hidden = true;
    $('savedTripsList').hidden = false;
  });
  $('aiReport')?.addEventListener('click', async event => {
    const button = event.target.closest('[data-show-route]');
    if (!button) return;
    $('scrTrips').classList.remove('open');
    $('scrMap').classList.add('open');
    window.dispatchEvent(new CustomEvent('speedo:show-trip-route', { detail: selectedSamples }));
  });
  $('reportToGitHub')?.addEventListener('click', () => {
    if (!selectedReport) {
      window.alert('Open a saved trip with an available report first.');
      return;
    }
    if (selectedReport.simulated) {
      window.alert('Simulated test trips stay on this device and cannot be uploaded.');
      return;
    }
    $('scrReport').classList.add('open');
  });
  $('exportReport')?.addEventListener('click', downloadReport);
  $('uploadReport')?.addEventListener('click', () => uploadSelectedReport());
  window.addEventListener('speedo-ai-error', event => {
    const message = `Analytics issue: ${event.detail?.message || 'check local storage and try again.'}`;
    window.dispatchEvent(new CustomEvent('speedo:notice', { detail: message }));
  });
}

setup();
