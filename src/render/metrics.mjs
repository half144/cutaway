const round = value => Number.isFinite(value) ? +value.toFixed(3) : null;

// Objective signals for tuning: pumping shows up as short overview gaps, fidgety framing as short
// close-ups, and choppy capture as a low source frame rate while the page scrolls.
export function motionMetrics(track, { shots, report, timeline }) {
  const episodes = [];
  let start = null;
  let zoomedSamples = 0;
  for (const sample of track) {
    const zoomed = sample.zoom > 1.02;
    if (zoomed) zoomedSamples++;
    if (zoomed && start === null) start = sample.t;
    if (!zoomed && start !== null) {
      episodes.push({ start, end: sample.t });
      start = null;
    }
  }
  if (start !== null) episodes.push({ start, end: track.at(-1).t });
  const gaps = episodes.slice(1).map((episode, index) => episode.start - episodes[index].end);

  const scrolls = timeline.scrolls ?? [];
  const scrollSeconds = scrolls.reduce((sum, scroll) => sum + scroll.end - scroll.start, 0);
  const scrollFrames = timeline.frames.filter(frame => scrolls.some(scroll => frame.t >= scroll.start && frame.t <= scroll.end)).length;

  return {
    shots: shots.length,
    zoomedShare: round(zoomedSamples / track.length),
    zoomEpisodes: episodes.length,
    shortestZoomSeconds: round(Math.min(...episodes.map(episode => episode.end - episode.start))),
    shortestOverviewGapSeconds: round(Math.min(...gaps)),
    skippedFocuses: report.skippedFocuses,
    droppedShots: report.droppedShots,
    sourceFpsDuringScroll: scrollSeconds > 0 ? round(scrollFrames / scrollSeconds) : null,
  };
}
