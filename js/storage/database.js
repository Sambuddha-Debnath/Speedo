const DB_NAME = 'speedo-ai';
const DB_VERSION = 1;
const STORES = {
  trips: { keyPath: 'tripId', indexes: ['startTime', 'status'] },
  tripSamples: { keyPath: 'sampleId', indexes: ['tripId', 'timestamp'] },
  drivingEvents: { keyPath: 'eventId', indexes: ['tripId', 'eventType', 'timestamp'] },
  tripReports: { keyPath: 'tripId', indexes: ['score', 'createdAt'] },
  driverProfile: { keyPath: 'profileId', indexes: ['updatedAt'] },
  modelMetadata: { keyPath: 'modelId', indexes: ['status'] }
};
let dbPromise;
export function openSpeedoDB() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      for (const [name, config] of Object.entries(STORES)) {
        const store = db.objectStoreNames.contains(name)
          ? request.transaction.objectStore(name)
          : db.createObjectStore(name, { keyPath: config.keyPath });
        for (const index of config.indexes) if (!store.indexNames.contains(index)) store.createIndex(index, index, { unique: false });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('Unable to open SPEEDO AI database'));
    request.onblocked = () => reject(new Error('SPEEDO AI database upgrade is blocked by another open tab'));
  });
  return dbPromise;
}
export async function transaction(storeNames, mode, callback) {
  const db = await openSpeedoDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeNames, mode);
    let result;
    try { result = callback(tx); } catch (error) { reject(error); return; }
    tx.oncomplete = () => resolve(result);
    tx.onerror = () => reject(tx.error || new Error('IndexedDB transaction failed'));
    tx.onabort = () => reject(tx.error || new Error('IndexedDB transaction aborted'));
  });
}
export async function put(store, value) { return transaction([store], 'readwrite', tx => tx.objectStore(store).put(value)); }
export async function add(store, value) { return transaction([store], 'readwrite', tx => tx.objectStore(store).add(value)); }
export async function get(store, key) {
  const db = await openSpeedoDB();
  return new Promise((resolve, reject) => { const r = db.transaction(store).objectStore(store).get(key); r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); });
}
export async function getAll(store) {
  const db = await openSpeedoDB();
  return new Promise((resolve, reject) => { const r = db.transaction(store).objectStore(store).getAll(); r.onsuccess = () => resolve(r.result || []); r.onerror = () => reject(r.error); });
}
export async function getByIndex(store, index, value) {
  const db = await openSpeedoDB();
  return new Promise((resolve, reject) => { const r = db.transaction(store).objectStore(store).index(index).getAll(value); r.onsuccess = () => resolve(r.result || []); r.onerror = () => reject(r.error); });
}
export async function deleteByIndex(store, index, value) {
  const db = await openSpeedoDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, 'readwrite'); const req = tx.objectStore(store).index(index).openCursor(IDBKeyRange.only(value));
    req.onsuccess = () => { const cursor = req.result; if (cursor) { cursor.delete(); cursor.continue(); } };
    tx.oncomplete = resolve; tx.onerror = () => reject(tx.error);
  });
}
