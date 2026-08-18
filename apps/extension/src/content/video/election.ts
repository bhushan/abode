/**
 * Which `<video>` on the page is the one people are watching.
 *
 * Pages are full of video that is not the film: autoplaying trailers in a rail,
 * an ad clip, a one-pixel tracking element. Largest-visible-wins is crude and
 * has held up across every platform tried so far, and the floor keeps the
 * tracking pixels out.
 */
export const MIN_AREA = 120 * 90;

export const areaOf = (v: HTMLVideoElement): number => v.clientWidth * v.clientHeight;

export function pickVideo(doc: Document = document): HTMLVideoElement | null {
  const videos = [...doc.querySelectorAll('video')];
  if (videos.length === 0) return null;
  return videos.reduce((best, v) => (areaOf(v) > areaOf(best) ? v : best));
}
