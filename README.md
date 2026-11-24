# SPEEDO v11

SPEEDO is a browser-based, local-first driving dashboard and trip analytics PWA. GitHub Pages is the deployment target; the app has no backend, account, cloud database, or runtime package-manager requirement.

## Features

- Digital and analogue GPS speedometers, heading, GPS accuracy, altitude, terrain profile, pitch/roll, speed warnings, and driving status.
- Existing v10 GPS tracking, tilt calibration and mount settings, OpenStreetMap speed-limit/camera lookup, simulation, local trip history, CSV/GPX export, and diagnostic logs.
- Local trip samples and analytics in IndexedDB, plus migration of legacy `speedo.trips` records without deleting their original LocalStorage data.
- Rule-based trip analytics with data-quality gating, estimated driving events, transparent scores, trip details, elevation profiles, route viewing, and JSON report export.
- Leaflet/OpenStreetMap map, one-tap saved places, and on-device place editing/deletion.
- Service-worker app-shell caching. External map tiles and the Leaflet CDN require a network connection.

Analytics are deterministic rules, not a trained machine-learning model or a safety assessment. GPS-derived acceleration, elevation, headings, and events can be inaccurate.

## Run and test

The app uses ES modules, geolocation, service workers, and IndexedDB. Open it from HTTPS (including GitHub Pages) or a local development origin such as `http://localhost`; opening `index.html` directly as `file://` is not supported.

Open `tests/analytics-tests.html` in the same HTTPS/localhost origin to run the browser-side analytics tests. The test page reports each result and a pass count. No Node.js or Python test runner is needed.

## Local data and migration

- Existing v10 trip records remain in LocalStorage under `speedo.trips`; the app imports a copy into its `speedo-ai` IndexedDB database and leaves the originals in place.
- The database upgrade adds the `places` store without deleting existing stores or trip records.
- Settings, sensor calibration, tilt configuration, and existing trip exports remain in their current LocalStorage keys.
- Trips, reports, analytics samples, and saved places are stored on this device. Export important data before clearing browser site data.
- A failed legacy LocalStorage trip save is surfaced in the dashboard; the IndexedDB analytics copy is retained.

## Maps and offline use

The dashboard, stored trips, analytics, reports, and saved places work without map services after the app assets have loaded. The map loads Leaflet from its public CDN and uses OpenStreetMap tiles; both need internet access. Tile caching/offline map availability is not promised. GPS and motion permissions and background execution vary by browser, especially on iOS.

## Reports and privacy

Trip reports are local by default. Open **Trips → Details** to view the trip report, elevation profile, and route action. The **Analytics** tab contains a single **Report to GitHub** button. Exact route coordinates are omitted from report exports and GitHub uploads unless **Include exact route coordinates** is selected in trip details. Event locations are also omitted unless that option is selected.

Uploads are explicit and manual. The token is not saved and is cleared from the input after the attempt. A token entered in a browser is still visible to scripts running on the same origin; use a dedicated, minimally scoped token and revoke it when no longer needed. Existing report paths are not intentionally overwritten; GitHub authentication, permissions, network, or duplicate-path errors are shown.

### Set up trip reports in GitHub

1. Choose or create the GitHub repository where reports should be stored. The app creates report files under `reports/`.
2. On GitHub, open **Settings → Developer settings → Personal access tokens → Fine-grained tokens → Generate new token**.
3. Limit the token to the repository that will receive the reports. Under **Repository permissions**, grant **Contents: Read and write**, then generate and copy the token.
4. In SPEEDO, open **Trips**, choose a saved trip, and tap **Details**. Confirm that a report is available. Leave **Include exact route coordinates** unchecked unless you intend to publish the trip’s location history.
5. Open **Analytics → Report to GitHub**. Enter the repository as `owner/name`, paste the token, and tap **Upload report**.
6. SPEEDO creates `reports/<trip-id>.json` as a commit in that repository. It will not overwrite an existing report for the same trip. The token is cleared after the upload attempt; enter it again for a later upload.

GitHub Pages hosting and report storage can use the same repository, but consider using a private repository if the report contains sensitive driving data. Reports in a public repository are publicly readable; leaving the route option unchecked does not remove all trip timing or non-location metrics.

Diagnostic log uploads are also manual. They require a token entered for the current page session; saved report/trip data is not included in log uploads. Coordinate blurring is enabled by default for logs.

## GitHub Pages deployment

1. Open the existing `Sambuddha-Debnath/Speedo` repository on GitHub and identify its current Pages deployment branch and folder.
2. Upload the updated `index.html`, `manifest.json`, `sw.js`, `README.md`, and the existing icon files to the deployment root.
3. Upload the complete `css/`, `js/`, `workers/`, and `tests/` folders, preserving their paths. Do not remove unrelated repository files.
4. Commit the changes to the existing Pages deployment branch.
5. In repository **Settings → Pages**, confirm Pages is still configured for that branch/folder and wait for the deployment to finish.
6. Open the published URL and hard-refresh desktop browsers. On mobile, fully close and reopen the installed PWA so the `SPEEDO-v11.1` service-worker cache is activated.

If GitHub's web upload UI does not preserve folders, create each file using its full repository path (for example `js/maps/map-screen.js`) and paste the corresponding file contents.

## Known limitations

- Mobile browsers may suspend GPS in the background; keep the app foregrounded during recording.
- Sensor availability and permission behavior vary. Pitch/roll describe the phone orientation and depend on calibration and mounting.
- GPS altitude, acceleration, event detection, and road speed-limit matches are estimates, not vehicle-grade measurements.
- The browser map is not native Apple CarPlay. Live maps, speed-limit/camera lookups, and GitHub uploads require internet access.
- The analytics browser test page does not certify real devices or live GitHub uploads; those require explicit on-device/service testing.
