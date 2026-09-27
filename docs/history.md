# Technical history

These notes describe earlier versions. The current state is in the [README](../README.md) and the [quality review](quality-review.md).

## History: quality review (2026-09-09)

The measurements below are from the previous architecture. For the current state, see the [2026-09-15 quality review](quality-review.md).

The page composition is reused while the captured frame does not change; camera and cursor keep animating every frame. In a local measurement of the same 9.553 s session at 1280×720/60 fps, render time went from 41.36 s to 19.84 s. Sampled memory went from 210 MB to 271 MB. These numbers are one measurement on this machine, not a guarantee for other scripts.

Movements of up to two pixels do not repeat the travel animation. The automatic interval ranges from 150 to 550 ms depending on the action; `pause` remains available for explicit editorial pacing. Focus stays in place during `expect` and the cursor stays visible while typing. `focus` accepts visible elements even when they are not clickable. `timeout` in the script accepts 1–120000 ms (default 10000).

Render uses `--pacing balanced` by default. Idle waits longer than 2.6 s are shortened with a time ramp that keeps the first and last 550 ms at real speed; clicks, typing, scrolling and the final interface response are not removed. Use `--pacing original` when the captured duration is meaningful and must be kept in full. `render.json` reports how many gaps were adjusted and how many seconds were saved.


## Motion references

The comfort review looked at the code of [Recordly: timings](https://github.com/webadderall/Recordly/blob/main/src/components/video-editor/videoPlayback/constants.ts), [region linking](https://github.com/webadderall/Recordly/blob/main/src/components/video-editor/videoPlayback/zoomRegionUtils.ts) and [OpenScreen: camera smoothing](https://github.com/siddharthvaddem/openscreen/blob/main/src/components/video-editor/videoPlayback/zoomSpring.ts). Recordly uses roughly 1.52 s in, 1.02 s out, and pan linking between nearby regions. OpenScreen applies a spring to the animated target to smooth out velocity discontinuities.

Our implementation is still our own: a critically damped spring with frequency 5.8/s (between the fast 8/s and slow 4.5/s versions), reaching about 99% of a fixed target in 1.15 s, moderate zoom, linking of short intervals, and a shared scale for nearby clicks/typing. Real inactivity still releases the zoom after 2.4 s; an imminent next action can extend the framing to avoid pulling back and then zooming in again. New captures use slightly longer cursor movements. Re-exporting does not change the speed of already recorded actions and scrolls.


## Naturalness review (2026-09-12)

Anticipation respects the moment the target became available in new captures, as well as the duration of earlier manual focus/typing. Later movements do not reactivate an expired focus. The cursor fades back in after inactivity, and connected groups share the same scale until the end of the group.

When needed, the export holds the last captured frame for a short time to complete the final zoom-out. `render.json` distinguishes `capturedDuration`, `duration` and `closingHoldSeconds`; the original capture stays intact. The balanced camera speed stays at 5.8/s.

Quality limits: the app's own transitions, already recorded scroll, JPEG resolution, poorly chosen containers and network waits still affect the video. Old captures have no `readyAt` and do not always separate typing from waiting; anticipation in those files is an estimate. In captures from that version, the arrow did not switch to hand/I-beam. Tests check continuity and timing, not subjective comfort or the app's semantic success: `expect` only checks visibility.

