export type PopupMessage =
  | { type: 'WB_START_ROOM'; code: string; tabId: number }
  | { type: 'WB_JOIN_ROOM'; code: string; tabId: number }
  | { type: 'WB_LEAVE_ROOM'; tabId?: number }
  // the popup can only make the synchronous native attempt before it closes, so
  // the worker is asked to see it through and fall back if nothing opened
  | { type: 'WB_ENSURE_PANEL'; tabId: number }
  // runs the Google OAuth flow in the background so it survives the popup closing
  | { type: 'WB_LOGIN' };

export type ContentMessage =
  | { type: 'ROOM_STATE'; inRoom: boolean; memberCount: number }
  // fired from the landing page join click; the background opens the side panel, joins, then navigates
  | { type: 'WB_JOIN_INVITE'; code: string; url: string };

export type TabMessage =
  | { type: 'START_ROOM'; code: string; anchor: boolean }
  | { type: 'JOIN_ROOM'; code: string; anchor: boolean }
  | { type: 'LEAVE_ROOM' }
  | { type: 'SET_RATE'; rate: number }
  // asks the page to host the panel itself, for browsers with no side panel API
  | { type: 'OPEN_PANEL' };

export interface VideoState {
  currentTime: number;
  duration: number;
  paused: boolean;
  playbackRate: number;
}

export type RuntimeMessage = PopupMessage | ContentMessage;

// Returns the promise so a caller that is about to destroy its own document (the
// popup closing itself) can wait for delivery. Closing first can drop the message.
export function sendToBackground(msg: RuntimeMessage): Promise<void> {
  return chrome.runtime.sendMessage(msg).then(() => undefined);
}

export function sendToTab(tabId: number, msg: TabMessage): void {
  void chrome.tabs.sendMessage(tabId, msg).catch(() => {});
}

export async function getActiveTab(): Promise<chrome.tabs.Tab | undefined> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

function readBestVideoInPage(): { currentTime: number; duration: number; paused: boolean; playbackRate: number } | null {
  const videos = [...document.querySelectorAll('video')];
  if (videos.length === 0) {
    const collect = (root: Document | ShadowRoot) => {
      root.querySelectorAll('*').forEach((el) => {
        const sr = (el as HTMLElement).shadowRoot;
        if (sr) {
          videos.push(...sr.querySelectorAll('video'));
          collect(sr);
        }
      });
    };
    collect(document);
  }
  if (videos.length === 0) return null;
  // playing first, then longest (the feature, not a hero/ad clip), then largest
  const best = videos
    .map((v) => ({
      v,
      playing: v.paused ? 0 : 1,
      dur: Number.isFinite(v.duration) ? v.duration : 0,
      area: v.clientWidth * v.clientHeight,
    }))
    .sort((a, b) => b.playing - a.playing || b.dur - a.dur || b.area - a.area)[0].v;
  return { currentTime: best.currentTime, duration: best.duration, paused: best.paused, playbackRate: best.playbackRate };
}

// self-contained copy of the best-video pick: executeScript funcs cannot close over shared helpers
function setRateOnBestVideo(rate: number): void {
  const videos = [...document.querySelectorAll('video')];
  if (videos.length === 0) {
    const collect = (root: Document | ShadowRoot) => {
      root.querySelectorAll('*').forEach((el) => {
        const sr = (el as HTMLElement).shadowRoot;
        if (sr) {
          videos.push(...sr.querySelectorAll('video'));
          collect(sr);
        }
      });
    };
    collect(document);
  }
  if (videos.length === 0) return;
  const best = videos
    .map((v) => ({
      v,
      playing: v.paused ? 0 : 1,
      dur: Number.isFinite(v.duration) ? v.duration : 0,
      area: v.clientWidth * v.clientHeight,
    }))
    .sort((a, b) => b.playing - a.playing || b.dur - a.dur || b.area - a.area)[0].v;
  best.playbackRate = rate;
}

// sets the rate directly, no party/content-script state needed
export async function setVideoRate(tabId: number, rate: number): Promise<void> {
  try {
    await chrome.scripting.executeScript({
      target: { tabId, allFrames: true },
      func: setRateOnBestVideo,
      args: [rate],
    });
  } catch {
    // page not injectable, nothing to do
  }
}

// in a party the content script owns the video and syncs peers; otherwise inject directly
export function applyPlaybackRate(tabId: number, rate: number, inRoom: boolean): void {
  if (inRoom) sendToTab(tabId, { type: 'SET_RATE', rate });
  else void setVideoRate(tabId, rate);
}

// null = no video anywhere, undefined = page not injectable (keep last value)
export async function getVideoTime(tabId: number): Promise<VideoState | null | undefined> {
  try {
    const results = await chrome.scripting.executeScript({
      target: { tabId, allFrames: true },
      func: readBestVideoInPage,
    });
    const states = results
      .map((r) => r.result)
      .filter((s): s is VideoState => s != null);
    if (states.length === 0) return null;
    states.sort((a, b) => Number(!b.paused) - Number(!a.paused) || b.duration - a.duration);
    return states[0];
  } catch {
    return undefined;
  }
}
