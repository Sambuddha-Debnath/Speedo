# SPEEDO features and testing map

This is a code map and repeatable validation guide for the current browser app. It is not a certification of vehicle-grade sensors or a real-device safety system.

## Feature-to-code map

| Feature | Main implementation | Useful entry points |
| --- | --- | --- |
| Dashboard, GPS tracking, trip start/stop, legacy trip log, exports, debug-log ring buffer and GitHub log uploader | `js/main.js` | `onPos`, `start`, `stop`, `renderTrips`, `readSince`, `upload` |
| Pitch/roll gravity reference | `js/main.js`, `js/tilt/tilt-reference.js`, `index.html` | `onOri`, `finishCal`, `currentTiltReference`, `activateTilt`, `tiltUI`, `createTiltReference`, `calculateTiltAngles`; the dashboard tile `#att` is the only calibration control |
| Trip sample normalization and GPS-derived features | `js/ai/data-processor.js` | `normaliseSample`, `featureVector` |
| Estimated driving events | `js/ai/event-detector.js`, `workers/analytics-worker.js` | `detectEvents`; the worker emits live event results |
| Safety and control-consistency scores | `js/ai/scoring-engine.js` | `calculateScore`, `calculateControlScore` |
| Per-trip metrics and report persistence | `js/ai/trip-analysis.js` | `tripMetrics`, `analyseTrip` |
| Day/month/year filters and cumulative distance windows | `js/ai/analytics-dashboard.js` | `periodBounds`, `buildDistanceWindows`, `distanceWeightedScore` |
| Analytics UI, score presentation toggle, coaching summary, trip details and report upload | `js/ai/ai-app.js`, `index.html`, `css/analytics.css` | `renderAnalytics`, `openReport`, `uploadSelectedReport` |
| Local trip/sample/event/report storage | `js/storage/database.js`, `js/storage/trip-store.js` | `openSpeedoDB`, `getTrips`, `getSamples`, `saveReport` |
| GitHub trip-report upload (separate from diagnostic logs) | `js/reports/github-upload.js` | `uploadTripReport` |
| Map, route view, saved places | `js/maps/map-screen.js`, `js/places/places.js` | map and place event handlers |
| Diagnostic log filtering and test-trip exclusion | `js/logs/upload-filter.js`, `js/main.js` | `uniqueUploadableLogs`, `upload` |
| Browser tests | `tests/analytics-tests.html` | synthetic unit and mocked-upload cases |
| App-shell cache | `sw.js` | `C` cache version and `A` asset list |

## Run the browser tests

1. Serve the repository from a local HTTP origin (ES modules, IndexedDB, and workers do not work reliably from `file://`):

   ```sh
   python -m http.server 8127
   ```

2. Open `http://localhost:8127/tests/analytics-tests.html`.
3. Confirm the page reports all tests passing. The suite covers sample quality, event classification, safety/control scoring, horizontal/vertical tilt-reference math, calendar ranges, distance windows, report uploads, simulated-trip filtering, and duplicate protection.
4. Open `http://localhost:8127/` for the manual app checks below.

No GitHub token is needed for the browser suite. Upload tests mock GitHub's API.

## Manual app checks

### Tilt and orientation

1. Place the device in the desired level position on a stable, level surface.
2. Tap the **Tilt** tile. Grant motion/orientation permission if prompted; verify pitch and roll begin at approximately zero.
3. Tilt the device forward/back and left/right; verify both axes update relative to the stored gravity reference.
4. Tap the tile again while level to recalibrate and save a new reference.
5. Reload, start a trip, and confirm the stored baseline is reused. Rotate the device between portrait and landscape and verify the pitch/roll display still responds.
6. Confirm the bottom bar contains no separate Level button and Settings contains no duplicate tilt/reset controls.

Synthetic browser events can check code paths, but only physical hardware can validate a device's sensor coordinate system, permission behavior, mounting, and orientation changes.

### Analytics and trip log

1. Complete or import a non-simulated trip with at least 30 reliable GPS/speed samples and at least 60% valid coverage.
2. Open **Trips**. Confirm aggregate Safety and Performance scores appear above **Trip log**.
3. Switch between **Compare scores** and **Driver profile**; try Safety, Tarmac racing context, and Dirt racing context.
4. Test Day, Month, and Year ranges. Try distance windows of 10 km, 100 km, and 10,000 km; values must be in 10 km increments.
5. Review the `?` explanation and a trip's details. Ineligible trips should report insufficient data instead of receiving a misleading score.
6. Confirm simulated trips stay in the local log but are excluded from the aggregate driver analytics and GitHub diagnostic-log uploads.

Distance charts group trip-level scores into cumulative distance windows. A trip that crosses a window boundary contributes its trip-level score proportionally to each window; the app does not claim to rescore individual kilometre segments.

### Other app features

- **GPS/speed:** grant location permission, record a trip, and check speed, heading, elevation, route samples, and trip summary.
- **Driving events:** test estimated acceleration/braking and mapped speed-limit events with synthetic data or controlled test data; do not provoke unsafe driving to test the app.
- **Places:** save the same location twice and verify the proximity de-duplication, then edit/delete a place.
- **Trip details:** verify the speed/elevation charts, route action, event list, and coordinate-inclusion consent.
- **Trip report upload:** use a disposable private repository and least-privilege token; verify duplicate reports are not overwritten.
- **Diagnostic logs:** follow [GitHub diagnostic-log setup](./GITHUB-LOG-UPLOAD.md). The upload is manual and separate from trip-report upload.
- **Responsive layout:** check dashboard, Settings, Trips, filters, and the trip log in narrow portrait and short landscape viewports; confirm no horizontal overflow and that the log remains scrollable.

## Score interpretation

- **Safety** is the existing transparent rule-based score for speed-limit events, braking, acceleration, cornering, and speed consistency.
- **Performance** is a GPS-derived control-consistency estimate based on longitudinal smoothness, heading-change smoothness, and acceleration consistency. It is not a lap-time, racing-line, tire-grip, or competitive-performance score.
- Tarmac and Dirt are manually selected session contexts. The app has no surface sensor, and this version applies the same control-consistency model to both.
- Scores are unavailable when reliable sample count or coverage is too low. GPS noise can still affect estimates.
- A score is feedback, not a safety certification. Racing-oriented feedback is only for a closed course; never chase a score on public roads.

## Collected logs and replay

Diagnostic log uploads contain event records such as `fix`, `start`, `stop`, `gps`, and `error`; see [GitHub diagnostic-log setup](./GITHUB-LOG-UPLOAD.md) for the schema, privacy behavior, and exclusions. They are useful for reviewing real sessions and preparing reviewed fixtures.

There is no automatic uploaded-log playback runner in this version. The current unit tests use deterministic synthetic samples; a future replay feature would need to convert the abbreviated `fix` entries into the normalized sample shape in `js/ai/data-processor.js`. Simulated/test-trip logs are intentionally not uploaded, though they can be exported locally for fixture preparation after reviewing their contents.
