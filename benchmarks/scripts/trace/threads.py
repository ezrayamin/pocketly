"""Per-thread running time (sched_switch) and app dlopens in the startup window.

    python3 threads.py <atrace.txt[.gz]>
"""
import collections, re, sys
from common import events, window

evs = list(events(sys.argv[1]))
pid, t0, t1 = window(evs)
tids = {e[3] for e in evs if e[4] == pid}
switch = re.compile(r'prev_comm=(.*) prev_pid=(\d+) .* next_comm=(.*) next_pid=(\d+)')
run, since, name = collections.Counter(), {}, {}
for ts, kind, msg, tid, p, comm in evs:
    m = switch.search(msg) if kind == 'sched_switch' else None
    if not m:
        continue
    prev, nxt = int(m.group(2)), int(m.group(4))
    if prev in since:
        a, b = max(since.pop(prev), t0), min(ts, t1)
        if b > a:
            run[prev] += b - a
    if nxt in tids:
        since[nxt], name[nxt] = ts, m.group(3)
print(f'window {1000 * (t1 - t0):.0f} ms; app threads on CPU {1000 * sum(run.values()):.0f} ms')
for tid, d in run.most_common(8):
    print('  %6.1f ms  %s' % (1000 * d, name.get(tid, tid)))
stack, dl = collections.defaultdict(list), collections.Counter()
for ts, kind, msg, tid, p, comm in evs:
    if kind != 'tracing_mark_write' or tid not in tids:
        continue
    if msg.startswith('B|'):
        stack[tid].append((ts, msg.split('|', 2)[2]))
    elif msg.startswith('E') and stack[tid]:
        a, n = stack[tid].pop()
        if n.startswith('dlopen: /data/app') and ' - ' not in n and a < t1:
            dl[n.rsplit('/', 1)[-1]] += ts - a
print('app library loads (dlopen) %.1f ms' % (1000 * sum(dl.values())))
for n, d in dl.most_common(8):
    print('  %6.1f ms  %s' % (1000 * d, n))
