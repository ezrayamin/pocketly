# Check 2026-10-17_mid-07

**A memory check, not a benchmark session:** what the PIN unlock leaves in memory, behind
BM-07's "+28 MB" in kmpCore (`2026-10-17_mid-04` and `mid-05`, absent in `mid-03`, which skipped
the lock screen), and whether Android can take it back. `benchmarks/scripts/unlock-memory.sh`,
3 rounds, builds alternating; raw `dumpsys meminfo` per snapshot in `unlock-memory/`,
`unlock-memory/summary.csv` generated from them.

## Setup
- Perf APKs as in mid-05 (app code as of `fa3b222`), PIN set, biometrics off.
- vivo V2538, airplane mode on, Wi-Fi and Bluetooth off, battery 100% on AC, 31.7 °C; not
  restarted for this check (uptime 38 min, after mid-05's session).
- Per build and round, each a cold start with BM-07's launch arguments (dataset reset, latency
  300 ms): **A** with `skipLock` (no unlock), Home, 5 s; **B** unlock with the in-app PIN on the
  lock screen, Home, 5 s; **C** `am send-trim-memory <pkg> RUNNING_CRITICAL`, 5 s; **D** Home key,
  10 s in the background.

## Results (median of 3 rounds; every round within ~4 MB)

| kmpCore − jsCore | A no unlock | B unlocked | C trimmed | D background |
|---|---:|---:|---:|---:|
| Total RSS | −2.3 MB | **+31.6 MB** | −2.8 MB | −2.6 MB |
| Total PSS | −4.2 MB | **+30.0 MB** | −7.1 MB | −6.1 MB |

Where the extra sits right after the unlock (round 1, detailed `dumpsys meminfo` rows):

| | jsCore B | kmpCore A | kmpCore B | kmpCore C |
|---|---:|---:|---:|---:|
| Dalvik heap: live objects (Heap Alloc) | 6.2 MB | 6.4 MB | 6.3 MB | 6.2 MB |
| Dalvik heap: private dirty | 5.5 MB | 13.8 MB | 8.8 MB | 5.5 MB |
| Dalvik heap: **private clean** | 15.0 MB | 0 MB | **45.1 MB** | 0.3 MB |
| Dalvik heap PSS | 20.6 MB | 13.9 MB | 54.0 MB | 8.0 MB |

(MB = 1,024 KB throughout.)

## What it means
- **It's heap that ART gives back, so it costs little.** Both builds hold the same live Java data
  after the unlock (~6.3 MB). kmpCore's PIN check (600,000 PBKDF2 iterations in javax.crypto)
  allocates enough short-lived objects to grow the heap; GC frees them, and the pages stay
  mapped as *clean* memory (45 MB). A `RUNNING_CRITICAL` trim (what Android sends under memory
  pressure) returns all of it: kmpCore then uses 2.8 MB *less* RSS than jsCore, and the same in
  the background. Clean pages are reclaimed without killing the app.
- **The same mechanism as BM-04's memory rounds** (clean pages left in the ART heap after heavy
  Kotlin work), and the same root: the work that creates the garbage is the crypto library's,
  not the architecture's. jsCore shows the effect at a third of the size (15 MB clean), from its
  own Java-side secure-storage and Keystore work during the unlock.
- **For BM-07:** Flashlight's `ramMax` is RSS, which counts these clean pages. The "+27.9 MB" in
  mid-05 is real resident memory at that moment but not memory the app holds on to; PSS after a
  trim is the fairer measure of cost.

## Limitations
- n = 3 per build and state; a check, not a §4.3 session (no restart, no statistics).
- One trigger tested (`RUNNING_CRITICAL`) plus backgrounding; real memory pressure on a smaller
  phone wasn't simulated.
