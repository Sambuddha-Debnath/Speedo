# SPEEDO AI – local-first analytics implementation

This package extends the supplied SPEEDO v9 PWA without replacing its speedometer, OSM lookups, camera alerts, GPS acquisition, CSV/GPX exports, or diagnostic logging.

## What is implemented

- A separate `speedo-ai` IndexedDB database with trip metadata, GPS samples, events, reports, profile, and model metadata stores.
- One-time migration of legacy `speedo.trips` localStorage records. Original trip records and exports are left intact.
- Live trip/sample event hooks from the existing GPS code. Samples are stored locally as the trip is recorded.
- Normalisation and data-quality flags for GPS, speed, heading, altitude, gradient, pitch, and roll.
- Rule-based possible harsh-braking, possible harsh-acceleration, possible sharp-corner, and mapped-speed-limit overspeed event detection.
- Explainable score calculation with data-coverage gating; insufficient data produces no score.
- Per-trip reports, score history, and a simple personal baseline that requires multiple analysed trips.
- Analytics screen in the existing app.
- Optional Web Worker for sample processing.
- Offline service-worker caching for the new same-origin modules.
- Optional ONNX model manager and a Python training/export pipeline.

## Run it

The PWA uses geolocation, service workers, modules, and IndexedDB. Serve this folder from a secure context (HTTPS or localhost); do not open `index.html` as a `file://` URL.

1. Deploy the complete folder to the same HTTPS origin as the existing SPEEDO app, or run a local static server.
2. Open the app and allow location access.
3. Tap **AI** once to open the analytics screen and allow the legacy-trip migration to finish.
4. Record a real trip or use Settings → Simulation to exercise the pipeline. Simulation trips are labelled and should not be mixed with real-world score validation.
5. Stop the trip. The report is generated locally after the trip ends.

## Important behaviour and limitations

- No AI API, account, server, or cloud analytics is used. The analytics engine itself makes no network requests.
- The existing OSM speed-limit/camera feature still needs its normal internet access; it is independent of AI.
- GPS-derived acceleration and heading are noisy. Events are deliberately named `possible_*`, include confidence values, and should not be treated as verified driving behaviour.
- The initial scoring weights and thresholds are engineering starting points, not validated safety standards. Calibrate them against labelled real-world data before relying on comparisons.
- The app does not guarantee background GPS collection. Mobile browsers can suspend a PWA when backgrounded or the screen is locked.
- Device pitch/roll are phone orientation, not calibrated vehicle chassis measurements. Mount position and permissions affect them.
- The first release uses deterministic analytics. It does not bundle a fabricated or unvalidated model.

## Optional ML phase

The model loader expects the ONNX Runtime Web browser bundle (exposing the `ort` browser global) at:

`vendor/onnxruntime-web/ort.min.js`

and a validated model at:

`models/driving-style-v1.onnx` (plus the generated `models/driving-style-v1.labels.json` label map)

Neither binary is bundled in this source package. This avoids downloading executable dependencies at runtime and avoids pretending a trained model exists without labelled training data. If you choose to add them, obtain the runtime and matching WASM assets from its official distribution, review its licence, self-host them, and update the service-worker asset list. The model manager will then attempt local WASM inference. If either asset is absent, rule-based analytics continue working.

### Train a model on your own machine

1. Create a Python environment and install `ml/requirements.txt`.
2. Build a CSV with the columns in `ml/driving_training_template.csv`.
3. Use manually reviewed labels. Do not label data solely by running the same threshold rules that the model is meant to independently assess.
4. Collect at least 200 labelled samples and at least two classes; more balanced, diverse samples are strongly preferred.
5. Run from the `ml` directory:

   `python train_driving_style.py your_training_data.csv --out ../models/driving-style-v1.onnx`

6. Review the holdout precision/recall and false-positive rates. Do not ship a model based only on overall accuracy.
7. Add the local ONNX Runtime Web bundle and model to the paths above. Add both paths to the service-worker cache list if you want them available offline after first install.

The training script is a starting pipeline. It is not proof that a model trained on a small personal dataset will generalise to different vehicles, phones, mounts, road types, or weather.

## Tests

Open `tests/analytics-tests.html` from the same local HTTPS/localhost server. It runs browser-side smoke tests for normalisation, acceleration feature extraction, overspeed detection, and insufficient-data scoring.

## Data management

The AI Clear button deletes SPEEDO AI records only. It does not delete the legacy `speedo.trips` data or diagnostic logs. Clearing browser site data will remove local trips and analytics. Export or back up important trip data before clearing site data.
