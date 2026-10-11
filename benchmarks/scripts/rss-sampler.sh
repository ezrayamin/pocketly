# Runs ON THE DEVICE (Android's mksh), pushed and started by bm-harness.sh in memory rounds.
#
#   sh rss-sampler.sh <pid> <out-file> <interval-s>
#
# Appends "<epoch s.µs> <VmRSS kB> <VmSwap kB>" to <out-file> about every <interval-s> until
# /proc/<pid> disappears (the runner force-stops the app). Everything is a shell builtin:
# forking `date` or `sleep` costs ~23 ms on the vivo V2538, a builtin read of
# /proc/<pid>/status ~0.3 ms. $EPOCHREALTIME is the clock `logcat -v epoch` uses, so samples
# line up with the harness's bench-mark lines. mksh arithmetic is 32-bit: no time math here.
# Pacing: `read -t` on a pipe nobody writes to (mkfifo is denied in /data/local/tmp); the
# sleep feeding it is killed at the end.
pid=$1
out=$2
interval=$3
sleep 86398 | {
  while [ -r /proc/$pid/status ]; do
    rss=
    swap=
    while read -r k v u; do
      case $k in
        VmRSS:) rss=$v ;;
        VmSwap:) swap=$v; break ;;
      esac
    done < /proc/$pid/status 2>/dev/null
    [ -n "$rss" ] && echo "$EPOCHREALTIME $rss ${swap:-0}"
    read -t $interval x
  done > $out
  pkill -f "^sleep 86398"
}
