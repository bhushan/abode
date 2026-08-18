import { useEffect, useState } from "react";
import { getActiveTab, getVideoTime } from "@/lib/messages";

export interface UseVideoState {
  videoTime: number | null;
  rate: number;
  hasVideo: boolean | null;
  tabId: number | null;
  // optimistic local update so the active speed button flips before the next poll
  overrideRate: (next: number) => void;
}

// polls the active tab's best video every 500ms, works with or without a party
export function useVideoState(): UseVideoState {
  const [videoTime, setVideoTime] = useState<number | null>(null);
  const [rate, setRate] = useState(1);
  const [hasVideo, setHasVideo] = useState<boolean | null>(null);
  const [tabId, setTabId] = useState<number | null>(null);

  useEffect(() => {
    let active = true;
    const poll = async () => {
      const tab = await getActiveTab();
      if (!active) return;
      setTabId(tab?.id ?? null);
      const res = tab?.id != null ? await getVideoTime(tab.id) : undefined;
      if (!active) return;
      if (res === undefined) {
        // page not injectable: resolve the initial unknown to false, otherwise keep last value
        setHasVideo((h) => h ?? false);
        return;
      }
      setVideoTime(res?.currentTime ?? null);
      setRate(res?.playbackRate ?? 1);
      setHasVideo(res != null);
    };
    void poll();
    const iv = setInterval(() => void poll(), 500);
    const onActivated = () => void poll();
    chrome.tabs.onActivated.addListener(onActivated);
    return () => {
      active = false;
      clearInterval(iv);
      chrome.tabs.onActivated.removeListener(onActivated);
    };
  }, []);

  return { videoTime, rate, hasVideo, tabId, overrideRate: setRate };
}
