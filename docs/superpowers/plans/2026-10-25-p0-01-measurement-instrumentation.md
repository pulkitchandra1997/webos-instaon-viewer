# P0-01 Measurement Instrumentation

## Intent

Add a small, browser-compatible diagnostics module that measures per-camera and aggregate presentation behavior without changing transport, recorder, decoder, or TV state. The measurements support simulator and offline-fixture evidence for latency, dropped/replaced frames, decode time, and presentation queue depth.

## Scope

- In scope: frame receipt, pending-paint replacement, queue depth, decode duration, source-to-presentation latency, per-channel snapshots, and build inclusion.
- Out of scope: physical-TV testing, recorder changes, synchronized-capture claims, automatic telemetry upload, packet capture, and performance optimization.

## Approach

Use a pure `CameraDiagnostics` module with explicit `received`, `replaced`, and `painted` events. The UI owns presentation timing; the worker forwards the bridge packet timestamp with each decoded frame. This is preferred over transport-side logging because it measures the actual UI presentation path and remains testable without vendor assets or network access.

## Acceptance

- Offline tests prove aggregate and per-channel counters, queue depth, decode-time aggregates, and valid/invalid latency samples.
- UI integration records replacement drops before requestAnimationFrame and presentation latency after paint.
- The module is copied into private app builds and does not add credentials, network calls, or persistent telemetry.
- Full offline tests, build-independent source checks, and privacy/history scans pass.
