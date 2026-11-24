# GitHub diagnostic-log setup

This guide configures SPEEDO to send diagnostic logs to a GitHub repository. The app does not use GitHub OAuth and does not upload in the background. You enter a fine-grained personal access token, then explicitly tap **Send now**.

## 1. Prepare a repository and branch

1. Choose a repository for diagnostic logs. A private repository is recommended because logs can include detailed driving and device information.
2. Create the destination branch before configuring the app. The default branch field is `logs`; **Save & test** checks that the branch exists but does not create it.
3. Keep the repository path in `owner/repository` form, for example `Sambuddha-Debnath/Speedo`.

The app's default repository and branch are `Sambuddha-Debnath/Speedo` and `logs`. You can change either value in Settings.

## 2. Create a narrowly scoped token

1. On GitHub, open **Settings → Developer settings → Personal access tokens → Fine-grained tokens → Generate new token**.
2. Select only the repository that will receive the logs.
3. Grant **Contents: Read and write** under repository permissions.
4. Set an expiry, generate the token, and copy it somewhere safe temporarily. Do not put it in source code, a log fixture, or a public issue.

## 3. Connect SPEEDO

1. Open **Settings → Debug logs**.
2. Enter the repository as `owner/name`; keep the branch as `logs` or enter another existing branch.
3. Leave **Blur coordinates** checked unless exact coordinates are required for an authorized, private test.
4. Paste the token and tap **Save & test**. This verifies repository and branch access; it does not upload the logs.
5. Tap **Send now** to upload the pending unique, non-simulated entries.
6. Tap **Remove token** when finished, or close/reload the app to clear the in-memory token.

The token input is cleared after **Save & test**. The token is held in page memory for the session; only the repository and branch are saved in local storage. The upload checkpoint is also stored locally so already-scanned entries are not resent.

## What is uploaded

Files are written under:

```text
logs/<device-id>/<UTC-date>/<UTC-time>-<session-id>-<suffix>.json
```

Each file contains a metadata object and up to 400 entries. Entries can include session, permission, GPS, speed, heading, elevation, pitch/roll, connectivity, and error events. A GPS `fix` record contains values such as coordinates, accuracy, measured/filtered speed, heading, speed limit, elevation, gradient, and tilt when available.

The local ring buffer retains the newest 6,000 entries. Uploads deduplicate local log IDs and advance a local checkpoint after successful batches. Simulated/test-trip entries are excluded from GitHub uploads and remain on the device. Uploading diagnostics does not upload the separate trip report or the full IndexedDB sample database.

## Coordinate and privacy handling

- Coordinate blurring is enabled by default and rounds coordinate fields to about two decimal places.
- Coordinates are always blurred when the destination repository is public, even if the checkbox is unchecked.
- In a private repository, unchecking the option can include more precise coordinates. Do so only with the driver's consent and appropriate access controls.
- Blurring does not hide timestamps, device/session identifiers, speeds, or all details that could identify a route.
- The upload is a direct GitHub Contents API request from the browser. The repository token is therefore available to scripts running on the same origin while the page is open.

## Using collected logs for later tests

Uploaded diagnostics are JSON evidence, not an automatic playback format. The app does not currently have a log-replay runner. A future replay fixture can map `fix` fields (`la`, `lo`, `acc`, `v`, `hd`, `lm`, `as`, `gr`, `tp`, `tr`) into the GPS, vehicle, road, and motion sample shape used by the analytics modules.

For test sessions that are intentionally filtered from uploads, use **Export file** in Debug logs to keep a local copy. Before adding any log to a repository fixture, review and remove identifying coordinates and metadata. The browser test suite uses synthetic fixtures in `tests/analytics-tests.html`; it does not require production logs or GitHub credentials.

## Troubleshooting

- **404 during Save & test:** confirm the repository spelling, branch name, and token's selected repository.
- **403 or write-permission error:** grant the token **Contents: Read and write**; check that organization policy permits the token.
- **No uploadable logs:** new logs may not exist, or the remaining entries may belong to simulated/test trips.
- **Logs remain pending:** keep the app online, review the status message, and retry with **Send now**. Do not repeatedly retry a successful upload if the local checkpoint could not be saved.
