# Session 2026-10-11_mid-02

Follow-up to `2026-10-11_mid-01`, same day, same phone state. Two questions: where kmpCore's
"+61 MB" in BM-04's memory rounds comes from, and what BM-04 costs when the payload is already in
the core (BM-04b). Raw files are never edited; `summary.md` / `summary.csv` come from
`benchmarks/scripts/collect.ts`, which reads only the harness folders (`bm-04`, `bm-04b`); the two
memory checks below are read by hand.

## Code and device
- `memory-home/` and `memory-after-bm04/`: the `83bcc5e` perf APKs (tag `bench/2026-10-11_mid-01`).
- `bm-04/`, `bm-04b/` (timing and `memory/` rounds): the commit with these results, which adds
  `stageIngestPayload` / `ingestStaged` (BM-04b) and the `rssStart` metric. BM-04's code path is
  unchanged from `83bcc5e`.
- vivo V2538, OS `16.0.21.0`, refresh-rate setting 120 Hz (`device.json`), airplane mode on,
  Wi-Fi and Bluetooth off, on the charger, battery 100%.

## Where the +61 MB comes from
`2026-10-11_mid-01` reported kmpCore's RSS ~61 MB above jsCore's in the idle second before the
measured BM-04 runs (PSS +61 MB after the run).

1. **It isn't there at launch.** In all 10 memory-round cold starts of `mid-01`, the sampler's
   first readings (~2 s before measuring) are 161–163 MB in both builds. jsCore grows ~40 MB and
   kmpCore ~101 MB during setup and the five warm-up ingests.
2. **It isn't there outside benchmark mode** (`memory-home/`). A normal cold start to Home, no
   launch arguments, `dumpsys meminfo` 10 s later, 3 per build alternating: PSS 115–116 MB and RSS
   ~238 MB in both builds (rounds 2–3; jsCore's round 1 read 87 / 207 MB). Dalvik Heap PSS 22.3
   (kmpCore) vs 19.2 MB (jsCore).
3. **It is the ingest work, and kmpCore keeps it** (`memory-after-bm04/`). After a BM-04 run
   (5 warm-up + 10 ingests of the 1.3 MB payload), RSS sampled for 60 s, then `dumpsys meminfo`,
   2 per build:

   | 60 s after the run | jsCore | kmpCore |
   |---|---:|---:|
   | TOTAL PSS | 116 MB | 225 MB |
   | VmRSS over the 60 s | 208–212 MB | 321–331 MB |
   | Dalvik Heap, live objects (Heap Alloc) | 5.0 MB | 5.0 MB |
   | Dalvik Heap, private clean | 14.6 MB | 133–136 MB |

   jsCore is back at its Home-launch PSS. kmpCore holds ~110 MB more for at least 60 s, as clean
   pages in the Dalvik heap region, while its live Java objects are the same as jsCore's. The
   breakdown by mapping (`/proc/<pid>/smaps`) isn't readable from `adb shell` on a non-debuggable
   build, so the mechanism is not identified; a Perfetto heap profile would show it.

**Conclusion.** Not a fixed cost of KMP and not the harness loading data differently (both builds
build their inputs through the same Core API). It is memory kmpCore retains after parsing large
payloads in Kotlin. The harness needs no fix, but `rssBaseline` was misleading as a name for
"after setup and warm-up"; benchmarking.md §5.2 now says so, and `rssStart` (first second
sampled) is reported next to it.

The first attempt at check 3 is not kept: its RSS columns were empty (a quoting bug in the
sampling command) and its jsCore launch lost its logs. Only its 60 s meminfo was readable
(kmpCore Dalvik Heap PSS 148.7 MB), consistent with the rounds above.

## BM-04 and BM-04b (timing)
- `bm-harness.sh <dir> BM-04`, then `BM-04b`: 5 rounds, alternating builds, 5 warm-up + 10
  measured per cold start → 50 per build. Battery 27–29 °C. Same payload in both scenarios and
  builds (checksums in `summary.md`); BM-04b stages it in the core (`stageIngestPayload`, not
  timed) before every run and times `ingestStaged()`.
- Relaunched cold starts (lost logs, §4.3): BM-04 3 (all jsCore), BM-04b 0; memory rounds:
  BM-04 0, BM-04b 1 (kmpCore).

  | Median (n = 50) | BM-04 jsCore | BM-04 kmpCore | BM-04b jsCore | BM-04b kmpCore |
  |---|---:|---:|---:|---:|
  | End-to-end | 65.2 ms | 81.3 ms | 66.1 ms | 72.9 ms |
  | Parse + validate | 26.4 ms | 24.7 ms | 27.4 ms | 31.1 ms |
  | Write | 38.5 ms | 40.6 ms | 38.7 ms | 40.1 ms |
  | Bridge overhead | 0.0 ms | 9.9 ms | 0.0 ms | 0.7 ms |

  BM-04: kmpCore +14.3 ms (+25%, 95% CI +8.1 to +19.4), meaningful. BM-04b: kmpCore +5.6 ms
  (+10%, CI +0.9 to +8.3), **not meaningful** (IQRs overlap). Staging removes 9.2 ms of bridge
  overhead, as expected; jsCore is unchanged (65.2 → 66.1 ms).
- **kmpCore's parse step slows down after ~10 ingests in a process, in every launch.** Parse +
  validate is 17–21 ms for the first ~10 ingests since launch (5 warm-up + ~5 measured), then
  30–64 ms for the rest (one launch, BM-04b round 3, stepped up after 7). In BM-04b, kmpCore's
  runs before the step have a median end-to-end of 59.8 ms (21 runs), after it 75.9 ms (29 runs);
  jsCore stays at 64–68 ms throughout. That split describes the data; the medians above are the
  result. In `mid-01` the same step appeared in 4 of 5 BM-04 launches.
- Likely linked to the memory finding above (kmpCore retains ~110 MB after repeated 1.3 MB
  parses): both appear after the same work, in the ART heap. Not investigated; a Perfetto trace
  of one kmpCore BM-04b launch (GC events, heap size) would show it.
- Rows over the 10% CV rule, reported as is: kmpCore end-to-end (15.4% / 16.1%) and compute
  (35% / 34%) in both scenarios, from the step above; jsCore compute (12.7% / 14.2%); BM-04
  storage (jsCore 10.3%, kmpCore 11.3%); BM-04 kmpCore bridge overhead (12.6%). BM-04b's
  bridge overhead (0.7 ms median, CV 20.5%) is below 2 ms, so the CV rule doesn't apply (§4.3).

## BM-04 and BM-04b (memory rounds)
- Same as `mid-01`: kmpCore's RSS is ~62 MB above jsCore's after setup and warm-up (`rssBaseline`
  262.3 vs 200.5 MB), PSS after the run +61 MB. Staging changes nothing (BM-04b +61.5 MB).
- New `rssStart` (first second sampled, before setup): 171.1 vs 175.7 MB, +4.5 MB (+2.7%), not
  meaningful by the 5% rule. The gap opens during setup and warm-up, as shown above.
- Swap: VmSwap moved > 1 MB in 5 rounds of each scenario, as in `mid-01` (kmpCore pages zygote
  memory back in); kmpCore's ingest-time deltas (~2 MB) stay within that noise.
