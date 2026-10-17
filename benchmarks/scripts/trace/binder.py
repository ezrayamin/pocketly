"""Blocking binder calls made by the app in the startup window, by destination pid.

    python3 binder.py <atrace.txt[.gz]>
Name the pids with `adb shell ps -A -o PID,NAME` on the same boot (keystore2 was 1104).
"""
import collections, re, sys
from common import events, window

evs = list(events(sys.argv[1]))
pid, t0, t1 = window(evs)
pending, out = {}, collections.defaultdict(lambda: [0, 0.0])
for ts, kind, msg, tid, p, comm in evs:
    if kind != 'binder_transaction':
        continue
    if p == pid and 'reply=0' in msg and t0 <= ts <= t1 and not re.search(r'flags=0x(1|11)\b', msg):
        m = re.search(r'dest_proc=(\d+)', msg)
        if m:
            pending[tid] = (ts, m.group(1))
    elif 'reply=1' in msg:
        m = re.search(r'dest_thread=(\d+)', msg)
        if m and int(m.group(1)) in pending:
            a, dest = pending.pop(int(m.group(1)))
            out[dest][0] += 1
            out[dest][1] += ts - a
print(f'window {1000 * (t1 - t0):.0f} ms')
for dest, (n, d) in sorted(out.items(), key=lambda x: -x[1][1])[:8]:
    print('  %3d calls %7.1f ms  → pid %s' % (n, 1000 * d, dest))
