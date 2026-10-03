# Superseded BM-01 run

Complete and clean (2 warm-up + 20 measured per build), but its **timeToFullDisplayMs is not
"Home rendered"**: `reportFullyDrawn()` was called from a React effect, which runs after React
commits but before Fabric mounts/draws the native views. Android therefore stamped an earlier
frame, and when JS finished before the first frame (13/20 jsCore runs, 12/20 kmpCore runs)
TTFD was clamped to the *empty* first frame (TTFD == TTID).

Fixed by reporting from native code in the draw pass of the first frame that contains
`<FullyDrawnMarker />` (apps/mobile/src/FullyDrawnMarker.tsx, android/.../FullyDrawnReporter.kt).
timeToInitialDisplayMs here is still a valid measurement of the first (empty) frame.
Kept for transparency; NOT used in summary.csv.
