import { getPlaces } from '../places/places.js';
import { getSamples } from '../storage/trip-store.js';

const $ = id => document.getElementById(id);
let map;
let vehicleMarker;
let route;
let followVehicle = true;
let currentFix = null;
let activeTripId = null;
let leafletPromise;
const placeMarkers = new Map();

function setStatus(message) {
  const status = $('mapStatus');
  if (status) status.textContent = message;
}

function loadLeaflet() {
  if (window.L) return Promise.resolve(window.L);
  if (leafletPromise) return leafletPromise;
  const pending = new Promise((resolve, reject) => {
    const stylesheet = document.createElement('link');
    stylesheet.rel = 'stylesheet';
    stylesheet.href = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css';
    stylesheet.onerror = () => reject(new Error('Could not load Leaflet styles'));
    document.head.append(stylesheet);
    const script = document.createElement('script');
    script.src = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js';
    script.onload = () => window.L ? resolve(window.L) : reject(new Error('Leaflet did not initialize'));
    script.onerror = () => reject(new Error('Could not load Leaflet. Check your internet connection.'));
    document.head.append(script);
  });
  leafletPromise = pending.catch(error => {
    leafletPromise = null;
    throw error;
  });
  return leafletPromise;
}

function makeVehicleIcon(heading) {
  return window.L.divIcon({
    className: 'vehicle-icon-wrap',
    html: `<div class="vehicle-icon" style="transform:rotate(${Number.isFinite(heading) ? heading : 0}deg)">▲</div>`,
    iconSize: [36, 36],
    iconAnchor: [18, 18]
  });
}

async function drawPlaces() {
  if (!map) return;
  const places = await getPlaces();
  const activeIds = new Set(places.map(place => place.placeId));
  for (const [id, marker] of placeMarkers) {
    if (!activeIds.has(id)) {
      marker.remove();
      placeMarkers.delete(id);
    }
  }
  places.forEach(place => {
    const point = [place.latitude, place.longitude];
    const existing = placeMarkers.get(place.placeId);
    if (existing) existing.setLatLng(point);
    else placeMarkers.set(place.placeId, window.L.marker(point).addTo(map).bindPopup(escapeHtml(place.name)));
  });
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, char => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  })[char]);
}

async function initializeMap() {
  try {
    const L = await loadLeaflet();
    if (!map) {
      map = L.map('liveMap', { zoomControl: true }).setView(
        currentFix ? [currentFix.latitude, currentFix.longitude] : [20, 0],
        currentFix ? 15 : 2
      );
      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 19,
        attribution: '&copy; OpenStreetMap contributors'
      }).addTo(map);
      route = L.polyline([], { color: '#b8ff5a', weight: 5, opacity: 0.85 }).addTo(map);
      map.on('dragstart', () => { followVehicle = false; });
    }
    map.invalidateSize();
    await drawPlaces();
    if (currentFix) updateVehicle(currentFix);
    if (activeTripId) await loadActiveRoute(activeTripId);
    setStatus(navigator.onLine ? 'OpenStreetMap tiles require an internet connection.' : 'Offline: map tiles are unavailable. Trips and saved places remain on this device.');
  } catch (error) {
    console.error('Live map unavailable', error);
    setStatus(error.message || 'Live map is unavailable in this browser.');
  }
}

function updateVehicle(fix) {
  currentFix = fix;
  if (!map || !window.L) return;
  const point = [fix.latitude, fix.longitude];
  if (!vehicleMarker) vehicleMarker = window.L.marker(point, { icon: makeVehicleIcon(fix.heading) }).addTo(map);
  else {
    vehicleMarker.setLatLng(point);
    vehicleMarker.setIcon(makeVehicleIcon(fix.heading));
  }
  if (fix.recording) route.addLatLng(point);
  if (followVehicle) map.panTo(point, { animate: false });
  const limit = Number.isFinite(fix.speedLimit) ? ` · speed limit ${fix.speedLimit} km/h` : '';
  const camera = fix.camera ? ` · ${fix.camera}` : '';
  setStatus(`${fix.simulated ? 'SIMULATION · ' : ''}GPS accuracy ±${Math.round(fix.accuracy)} m${limit}${camera}${navigator.onLine ? '' : ' · offline tiles unavailable'}`);
}

async function loadActiveRoute(tripId) {
  if (!tripId || !route) return;
  try {
    const samples = await getSamples(tripId);
    route.setLatLngs(samples
      .filter(sample => sample.quality.gpsValid && Number.isFinite(sample.gps.latitude) && Number.isFinite(sample.gps.longitude))
      .slice(-500)
      .map(sample => [sample.gps.latitude, sample.gps.longitude]));
  } catch (error) {
    console.error('Unable to load trip route', error);
    setStatus('Could not load the active trip route from local storage.');
  }
}

$('bm')?.addEventListener('click', () => {
  $('scrMap').classList.add('open');
  initializeMap();
});
$('mapClose')?.addEventListener('click', () => $('scrMap').classList.remove('open'));
$('mapRecenter')?.addEventListener('click', () => {
  followVehicle = true;
  if (map && currentFix) map.setView([currentFix.latitude, currentFix.longitude], Math.max(map.getZoom(), 15));
});
window.addEventListener('speedo:gps-fix', event => updateVehicle(event.detail));
window.addEventListener('speedo:places-updated', () => { drawPlaces().catch(console.error); });
window.addEventListener('speedo:ai-trip-state', event => {
  if (event.detail.recording) {
    activeTripId = event.detail.tripId;
    route?.setLatLngs([]);
    loadActiveRoute(event.detail.tripId);
  } else activeTripId = null;
});
window.addEventListener('speedo:place-selected', event => {
  const place = event.detail;
  if (!place) return;
  initializeMap().then(() => {
    if (!map) return;
    map.setView([place.latitude, place.longitude], 16);
    placeMarkers.get(place.placeId)?.openPopup();
  });
});
window.addEventListener('speedo:show-trip-route', event => {
  const points = (event.detail || [])
    .filter(sample => sample.quality.gpsValid && Number.isFinite(sample.gps.latitude) && Number.isFinite(sample.gps.longitude))
    .slice(-500)
    .map(sample => [sample.gps.latitude, sample.gps.longitude]);
  initializeMap().then(() => {
    if (!map) return;
    route.setLatLngs(points);
    if (points.length) {
      followVehicle = false;
      map.fitBounds(route.getBounds(), { padding: [24, 24] });
    }
  });
});
window.addEventListener('online', () => setStatus('Online · OpenStreetMap tiles require an internet connection.'));
window.addEventListener('offline', () => setStatus('Offline: map tiles are unavailable. Trips and saved places remain on this device.'));
