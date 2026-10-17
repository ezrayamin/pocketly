"""Shared parsing for `adb shell atrace` text output (plain or .gz)."""
import gzip
import re

LINE = re.compile(r'^\s*(.+?)-(\d+)\s+\(\s*(\d+|-+)\)\s+\[(\d+)\]\s+\S+\s+([\d.]+): (\S+): (.*)$')


def events(path):
    """(ts, kind, msg, tid, pid, comm) for every event line."""
    opener = gzip.open if path.endswith('.gz') else open
    with opener(path, 'rt', errors='replace') as f:
        for line in f:
            m = LINE.match(line)
            if m:
                yield float(m.group(5)), m.group(6), m.group(7), int(m.group(2)), m.group(3).strip(), m.group(1)


def window(evs):
    """The app's pid and its bindApplication → reportFullyDrawn window (s)."""
    start = next(e for e in evs if e[1] == 'tracing_mark_write' and e[2].endswith('|bindApplication'))
    pid = start[2].split('|')[1]
    end = next((e for e in evs if e[1] == 'tracing_mark_write' and e[2].startswith('B|%s|' % pid)
                and 'reportFullyDrawn' in e[2]), None)
    if end is None:
        raise SystemExit('no reportFullyDrawn in the trace')
    return pid, start[0], end[0]
