with app as (select upid, start_ts from process where name like 'com.pocketly.%' order by start_ts desc limit 1),
fd as (select min(s.ts) as ts from slice s join thread_track tt on s.track_id = tt.id join thread t using (utid)
       where t.upid = (select upid from app) and s.name like 'reportFullyDrawn%'),
ff as (select min(s.ts + s.dur) as ts from slice s join thread_track tt on s.track_id = tt.id join thread t using (utid)
       where t.upid = (select upid from app) and t.is_main_thread = 1 and s.name like 'Choreographer#doFrame%')
select 'MARK first frame done', printf('%.1f', ((select ts from ff) - (select start_ts from app)) / 1e6), '' union all
select 'MARK reportFullyDrawn', printf('%.1f', ((select ts from fd) - (select start_ts from app)) / 1e6), '' union all
select * from (
  select 'CPU ' || t.name,
         printf('%.1f', sum(min(ss.ts + ss.dur, (select ts from fd)) - max(ss.ts, (select start_ts from app))) / 1e6),
         'ms running, process start → fully drawn'
  from sched ss join thread t using (utid)
  where t.upid = (select upid from app) and ss.ts < (select ts from fd) and ss.ts + ss.dur > (select start_ts from app)
  group by t.name order by 2 desc limit 8) union all
select * from (
  select 'MAIN ' || s.name, printf('%.1f', sum(s.dur) / 1e6), count(*) || 'x, first frame → fully drawn'
  from slice s join thread_track tt on s.track_id = tt.id join thread t using (utid)
  where t.upid = (select upid from app) and t.is_main_thread = 1
    and s.ts >= (select ts from ff) and s.ts < (select ts from fd)
    and (s.name like 'MountItemDispatcher%' or s.name in ('traversal', 'animation') or s.name like 'draw-VRI%')
  group by s.name order by sum(s.dur) desc);
