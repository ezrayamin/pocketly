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

## Addendum: the steady-state gap
After the trim and in the background, kmpCore isn't just back to jsCore's size, it's below it.
Per round, kmpCore − jsCore, from `unlock-memory/summary.csv` (App Summary rows):

| State | Total PSS | Code PSS | Java Heap PSS | Native Heap PSS |
|---|---|---|---|---|
| A no unlock | −5.6 / −4.1 / −4.1 MB | −3.6 / −3.5 / −3.4 MB | −0.5 / −0.9 / −0.9 MB | +0.6 / −0.2 / −0.1 MB |
| C trimmed | −7.2 / −4.8 / −7.1 MB | −3.9 / −3.9 / −3.8 MB | −1.8 / −0.2 / −1.8 MB | −0.3 / −0.7 / −0.4 MB |
| D background | −6.4 / −4.7 / −6.9 MB | −3.1 / −3.7 / −3.2 MB | −1.6 / −0.6 / −1.0 MB | −1.2 / −1.3 / −0.0 MB |

- **4.7–7.2 MB less PSS in kmpCore** after the trim or in the background (round 2 is the small
  one in both states), and 4.1–5.6 MB less before any unlock: a baseline difference, not
  something the trim creates.
- **Code is 3.1–3.9 MB of it**, in every state and round (round 1, trimmed: 24.0 vs 20.2 MB).
  The detailed rows put it in `.apk mmap` (19.9 vs 15.9 MB), not `.so mmap` (3.4 MB in both);
  `.art mmap` is 3.4 vs 2.4 MB and `.dex mmap` 3.9 vs 4.3 MB.
- **Why `.apk mmap`:** native libraries and the Hermes bundle are stored uncompressed in the
  APK and mapped from it directly. Uncompressed entries only jsCore's arm64 APK has:
  `libQuickCrypto.so` 9,132 KB (OpenSSL), `libop-sqlite.so` 1,564 KB, and its bundle is
  2,511 KB vs 1,794 KB; kmpCore has `libPocketlyCoreKmp.so` 1,668 KB instead. The same libraries
  as BM-08's size split (`2026-10-17_mid-06`): the storage and crypto choices show up in memory as
  well as in size. Only part of each file is resident, and which part can't be read:
  `/proc/<pid>/maps` is denied to `adb shell` on this build, so the split per file is not
  measured.
- **For the report:** memory cost is PSS after a trim or in the background. BM-07's +27.9 MB
  (RSS, right after the unlock) sits next to these rows: a moment, not what the app keeps.
- **Scope:** the PIN path only. A biometric unlock doesn't run PBKDF2; not measured here.
