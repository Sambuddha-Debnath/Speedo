import { getAll, openSpeedoDB, put, transaction } from '../storage/database.js';

const $ = id => document.getElementById(id);
const PLACE_TOLERANCE_METERS = 50;
let latestFix = null;

function makeId() {
  return crypto.randomUUID?.() || `place-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export async function getPlaces() {
  return (await getAll('places')).sort((a, b) => b.createdAt - a.createdAt);
}

function distanceMeters(first, second) {
  const radians = Math.PI / 180;
  const lat1 = first.latitude * radians;
  const lat2 = second.latitude * radians;
  const dLat = (second.latitude - first.latitude) * radians;
  const dLon = (second.longitude - first.longitude) * radians;
  const a = Math.sin(dLat / 2) ** 2
    + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 6371000 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

async function addPlaceIfUnique(place) {
  const db = await openSpeedoDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('places', 'readwrite');
    const store = tx.objectStore('places');
    let duplicate = false;
    const request = store.openCursor();
    request.onsuccess = () => {
      const cursor = request.result;
      if (!cursor) {
        if (!duplicate) store.add(place);
        return;
      }
      if (distanceMeters(cursor.value, place) <= PLACE_TOLERANCE_METERS) duplicate = true;
      cursor.continue();
    };
    request.onerror = () => reject(request.error || new Error('Could not check saved places.'));
    tx.oncomplete = () => resolve(!duplicate);
    tx.onerror = () => reject(tx.error || new Error('Could not save this place.'));
    tx.onabort = () => reject(tx.error || new Error('Saving this place was aborted.'));
  });
}

async function savePlace() {
  if (!latestFix) {
    window.dispatchEvent(new CustomEvent('speedo:notice', { detail: 'Start GPS tracking to save your current location.' }));
    return;
  }
  if (latestFix.simulated) {
    window.dispatchEvent(new CustomEvent('speedo:notice', { detail: 'A simulated position cannot be saved as a real place.' }));
    return;
  }
  const name = `Saved place ${new Date().toLocaleString([], { dateStyle: 'short', timeStyle: 'short' })}`;
  const saved = await addPlaceIfUnique({
    placeId: makeId(),
    name,
    description: '',
    category: 'Saved',
    latitude: latestFix.latitude,
    longitude: latestFix.longitude,
    createdAt: Date.now()
  });
  if (!saved) {
    window.dispatchEvent(new CustomEvent('speedo:notice', { detail: 'A saved place is already within 50 m. No duplicate was added.' }));
    return;
  }
  await renderPlaces();
  window.dispatchEvent(new CustomEvent('speedo:places-updated'));
  window.dispatchEvent(new CustomEvent('speedo:notice', { detail: 'Place saved on this device.' }));
}

async function editPlace(placeId) {
  const place = (await getPlaces()).find(item => item.placeId === placeId);
  if (!place) return;
  const name = window.prompt('Place name:', place.name)?.trim();
  if (!name) return;
  const description = window.prompt('Description:', place.description || '');
  if (description === null) return;
  const category = window.prompt('Category:', place.category || 'Saved');
  if (category === null) return;
  await put('places', { ...place, name, description: description.trim(), category: category.trim() || 'Saved' });
  await renderPlaces();
  window.dispatchEvent(new CustomEvent('speedo:places-updated'));
}

async function deletePlace(placeId) {
  if (!window.confirm('Delete this saved place from this device?')) return;
  await transaction(['places'], 'readwrite', tx => tx.objectStore('places').delete(placeId));
  await renderPlaces();
  window.dispatchEvent(new CustomEvent('speedo:places-updated'));
}

export async function renderPlaces() {
  const container = $('placesList');
  if (!container) return;
  let places;
  try {
    places = await getPlaces();
  } catch (error) {
    container.innerHTML = '<p class="ai-muted">Could not load saved places. Check device storage and try again.</p>';
    throw error;
  }
  container.innerHTML = places.map(place => `
    <article class="place-card">
      <div>
        <strong>${escapeHtml(place.name)}</strong>
        <small>${escapeHtml(place.category || 'Saved')} · ${Number(place.latitude).toFixed(5)}, ${Number(place.longitude).toFixed(5)}</small>
        ${place.description ? `<p>${escapeHtml(place.description)}</p>` : ''}
      </div>
      <div class="place-actions">
        <button class="btn sm" data-place-open="${escapeHtml(place.placeId)}">Map</button>
        <button class="btn sm" data-place-edit="${escapeHtml(place.placeId)}">Edit</button>
        <button class="btn sm" data-place-delete="${escapeHtml(place.placeId)}">Delete</button>
      </div>
    </article>`).join('') || '<p class="ai-muted">No saved places yet. Use Save Place from the dashboard or map.</p>';
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, char => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  })[char]);
}

function reportPlaceError(error) {
  console.error('Saved place operation failed', error);
  window.dispatchEvent(new CustomEvent('speedo:notice', { detail: 'Saved place could not be updated. Check device storage and try again.' }));
}

window.addEventListener('speedo:gps-fix', event => { latestFix = event.detail; });
window.addEventListener('speedo:save-place-request', () => { savePlace().catch(reportPlaceError); });
window.addEventListener('speedo:places-open', () => { renderPlaces().catch(reportPlaceError); });

['savePlace', 'savePlaceDash'].forEach(id => {
  $(id)?.addEventListener('click', () => window.dispatchEvent(new CustomEvent('speedo:save-place-request')));
});
$('openPlaces')?.addEventListener('click', () => {
  $('scrPlaces').classList.add('open');
  renderPlaces().catch(reportPlaceError);
});
$('mapPlaces')?.addEventListener('click', () => {
  $('scrMap').classList.remove('open');
  $('scrPlaces').classList.add('open');
  renderPlaces().catch(reportPlaceError);
});
$('placesClose')?.addEventListener('click', () => $('scrPlaces').classList.remove('open'));
$('placesList')?.addEventListener('click', async event => {
  const button = event.target.closest('button');
  if (!button) return;
  const placeId = button.dataset.placeOpen || button.dataset.placeEdit || button.dataset.placeDelete;
  try {
    if (button.dataset.placeOpen) {
      const place = (await getPlaces()).find(item => item.placeId === placeId);
      if (place) {
        $('scrPlaces').classList.remove('open');
        $('scrMap').classList.add('open');
        window.dispatchEvent(new CustomEvent('speedo:place-selected', { detail: place }));
      }
    } else if (button.dataset.placeEdit) await editPlace(placeId);
    else if (button.dataset.placeDelete) await deletePlace(placeId);
  } catch (error) {
    reportPlaceError(error);
  }
});
