import { useCallback, useEffect, useRef, useState } from "react";
import { Logo } from "@/components/Logo";
import { Avatar } from "@/components/Avatar";
import { TintPicker } from "@/components/TintPicker";
import { useRoomState } from "@/hooks/useRoomState";
import { useVideoState } from "@/hooks/useVideoState";
import { getActiveTab, sendToBackground } from "@/lib/messages";
import { buildInviteLink, STORAGE_KEYS } from "@/lib/room";
import { getIdentity, setIdentityName, setIdentityTint, MAX_NAME, type Identity } from "@/lib/identity";
import { getServerUrl } from "@/lib/server";
import { pingServer } from "@/lib/socket";
import { openPanel } from "@/lib/panel";
import { canRunOn, hostOf, requestAccessTo } from "@/lib/site";
import { startRoom } from "@/lib/startRoom";

export function Popup() {
  const { inRoom, roomCode } = useRoomState();
  const { hasVideo, tabId } = useVideoState();
  const [you, setYou] = useState<Identity | null>(null);
  const [reachable, setReachable] = useState<boolean | null>(null);
  const [link, setLink] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [editing, setEditing] = useState(false);
  // Null while unknown. The manifest names the platforms this build ships, so a
  // site outside that list needs a grant before the content script exists there.
  const [site, setSite] = useState<{ url: string; host: string; allowed: boolean } | null>(null);

  useEffect(() => {
    void getIdentity().then(setYou);
    void getServerUrl().then((url) => void pingServer(url).then(setReachable));
  }, []);

  const checkSite = useCallback(async () => {
    const tab = await getActiveTab();
    if (!tab?.url) return setSite(null);
    setSite({ url: tab.url, host: hostOf(tab.url), allowed: await canRunOn(tab.url) });
  }, []);

  useEffect(() => {
    void checkSite();
  }, [checkSite]);

  // In a room, build the link immediately: sharing it is the entire point of
  // having started one, and the inherited UI buried it two clicks deep.
  useEffect(() => {
    if (!inRoom || !roomCode) {
      setLink(null);
      return;
    }
    void (async () => {
      const data = await chrome.storage.local.get(STORAGE_KEYS.anchorTabId);
      const anchorId = data[STORAGE_KEYS.anchorTabId];
      let tab: chrome.tabs.Tab | undefined;
      if (typeof anchorId === "number") tab = await chrome.tabs.get(anchorId).catch(() => undefined);
      if (!tab?.url) tab = await getActiveTab();
      if (tab?.url) setLink(buildInviteLink(tab.url, roomCode));
    })();
  }, [inRoom, roomCode]);

  // tabId comes from the poll rather than a fresh query: awaiting anything here
  // would spend the click's user activation, which is the only thing that lets a
  // side panel open at all.
  function start() {
    void startRoom(tabId, {
      openPanel: (id) => void openPanel(id),
      send: sendToBackground,
      close: () => window.close(),
    });
  }

  // Straight off the click: Chrome refuses a permission request that has had an
  // await in front of it, because the user activation is already spent.
  function allowSite() {
    if (!site) return;
    void requestAccessTo(site.url).then((granted) => {
      if (granted) void checkSite();
    });
  }

  function copy() {
    if (!link) return;
    navigator.clipboard?.writeText(link).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  }

  function rename(name: string) {
    setYou((y) => (y ? { ...y, name } : y));
    void setIdentityName(name);
  }

  function retint(tint: number) {
    setYou((y) => (y ? { ...y, tint } : y));
    void setIdentityTint(tint);
  }

  return (
    <div className="relative overflow-hidden bg-ab-ink pb-3.5">
      {/* one warm light source above the room: the thesis, stated once */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 -top-10 h-40"
        style={{ background: "radial-gradient(60% 100% at 50% 0%, rgba(232,169,79,.11), transparent 72%)" }}
      />
      <header className="relative flex items-center gap-2 px-3.5 pb-2.5 pt-3.5">
        <Logo size={22} />
        {inRoom && roomCode ? (
          <span className="ml-auto font-mono text-[11px] tracking-[.04em] text-ab-faint">{roomCode}</span>
        ) : null}
      </header>

      {inRoom ? (
        <InRoom
          link={link}
          copied={copied}
          onCopy={copy}
          onOpenPanel={() => {
            if (tabId != null) void openPanel(tabId).then(() => window.close());
            else window.close();
          }}
          onLeave={() => void sendToBackground({ type: "WB_LEAVE_ROOM", tabId: tabId ?? undefined }).catch(() => {})}
        />
      ) : (
        <Idle
          you={you}
          editing={editing}
          onToggleEdit={() => setEditing((e) => !e)}
          onRename={rename}
          onRetint={retint}
          hasVideo={hasVideo}
          reachable={reachable}
          site={site}
          onAllowSite={allowSite}
          onStart={start}
        />
      )}
    </div>
  );
}

const CARD = "mx-3.5 rounded-xl border border-ab-edge bg-ab-raised";

function InRoom({
  link,
  copied,
  onCopy,
  onOpenPanel,
  onLeave,
}: {
  link: string | null;
  copied: boolean;
  onCopy: () => void;
  onOpenPanel: () => void;
  onLeave: () => void;
}) {
  return (
    <div className="animate-ab-in">
      <div className={`${CARD} p-3`}>
        <div className="text-[11px] font-semibold uppercase tracking-[.1em] text-ab-faint">Invite link</div>
        <p className="mt-1 text-[12.5px] leading-[1.45] text-ab-dim">
          Send this to whoever you're watching with. Opening it puts them in the room, on this video.
        </p>

        <div className="mt-2.5 rounded-lg border border-ab-edge bg-ab-sunk px-2.5 py-2">
          <div className="break-all font-mono text-[10.5px] leading-[1.5] text-ab-dim">
            {link ?? "Working out what you're watching…"}
          </div>
        </div>

        <button
          type="button"
          onClick={onCopy}
          disabled={!link}
          aria-label="Copy invite link"
          className="mt-2.5 w-full rounded-lg bg-ab-lamp px-3 py-2.5 text-[13.5px] font-semibold text-ab-ink transition-all enabled:hover:brightness-105 enabled:active:scale-[.99] disabled:opacity-40"
        >
          {copied ? "Copied" : "Copy invite link"}
        </button>
      </div>

      {/* Nothing in the UI said where playback is driven from, so people looked for
          buttons that were never meant to exist. */}
      <p className="mt-2.5 px-3.5 text-[12px] leading-[1.5] text-ab-dim">
        Play, pause and seek with the site's own player. Everyone in the room follows.
      </p>

      <div className="mt-2.5 flex gap-2 px-3.5">
        <button
          type="button"
          onClick={onOpenPanel}
          className="flex-1 rounded-lg border border-ab-edge-strong px-3 py-2 text-[12.5px] font-semibold text-ab-cream transition-colors hover:bg-ab-raised"
        >
          Open chat
        </button>
        <button
          type="button"
          onClick={onLeave}
          className="rounded-lg border border-ab-edge px-3 py-2 text-[12.5px] font-semibold text-ab-dim transition-colors hover:text-ab-lost"
        >
          Leave
        </button>
      </div>
    </div>
  );
}

function Idle({
  you,
  editing,
  onToggleEdit,
  onRename,
  onRetint,
  hasVideo,
  reachable,
  site,
  onAllowSite,
  onStart,
}: {
  you: Identity | null;
  editing: boolean;
  onToggleEdit: () => void;
  onRename: (name: string) => void;
  onRetint: (tint: number) => void;
  hasVideo: boolean | null;
  reachable: boolean | null;
  site: { url: string; host: string; allowed: boolean } | null;
  onAllowSite: () => void;
  onStart: () => void;
}) {
  const nameRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (editing) nameRef.current?.focus();
  }, [editing]);

  const needsSite = site !== null && !site.allowed;
  const blocked = hasVideo === false || reachable === false || needsSite;

  return (
    <div className="animate-ab-in">
      <div className={`${CARD} p-2.5`}>
        <div className="flex items-center gap-2.5">
          <Avatar name={you?.name ?? "?"} tint={you?.tint ?? 0} size={30} ring />
          {editing ? (
            <input
              ref={nameRef}
              value={you?.name ?? ""}
              onChange={(e) => onRename(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === "Escape") onToggleEdit();
              }}
              maxLength={MAX_NAME}
              placeholder="your name"
              aria-label="Your name"
              className="min-w-0 flex-1 rounded-lg border border-ab-edge-strong bg-ab-sunk px-2.5 py-1.5 text-[13px] font-medium text-ab-cream outline-none placeholder:text-ab-faint"
            />
          ) : (
            <>
              <span className="min-w-0 flex-1 overflow-hidden text-ellipsis whitespace-nowrap text-[13.5px] font-medium text-ab-cream">
                {you?.name}
              </span>
              <button
                type="button"
                onClick={onToggleEdit}
                className="shrink-0 rounded-md px-2 py-1 text-[11.5px] font-semibold text-ab-faint transition-colors hover:text-ab-cream"
              >
                Edit
              </button>
            </>
          )}
        </div>
        {/* Closing on blur would eat the first click on a colour swatch, so the
            editor stays open until you dismiss it deliberately. */}
        {editing ? (
          <div className="mt-2.5 flex items-center gap-2 px-0.5">
            <TintPicker value={you?.tint ?? 0} onPick={onRetint} />
            <button
              type="button"
              onClick={onToggleEdit}
              className="ml-auto shrink-0 rounded-md px-2 py-1 text-[11.5px] font-semibold text-ab-lamp transition-opacity hover:opacity-80"
            >
              Done
            </button>
          </div>
        ) : null}
      </div>

      <div className="mt-2.5 px-3.5">
        {/* Abode ships support for a named list of services rather than asking
            for every page you visit, so an unlisted site is a question, not a
            dead end. */}
        {needsSite ? (
          <button
            type="button"
            onClick={onAllowSite}
            className="w-full rounded-xl border border-ab-edge-strong px-3 py-3 text-[14px] font-semibold text-ab-cream transition-colors hover:bg-ab-raised"
          >
            Turn on Abode for {site.host || "this site"}
          </button>
        ) : (
          <button
            type="button"
            onClick={onStart}
            disabled={blocked}
            className="w-full rounded-xl bg-ab-lamp px-3 py-3 text-[14px] font-semibold text-ab-ink transition-all enabled:hover:brightness-105 enabled:active:scale-[.99] disabled:opacity-40"
          >
            Start watching together
          </button>
        )}

        <p className="mt-2 text-[12px] leading-[1.5] text-ab-dim">
          {needsSite
            ? "Abode ships with Netflix and Crunchyroll built in. Any other site needs your say-so first."
            : hasVideo === false
              ? "Open something to watch first, then start a room here."
              : reachable === false
                ? "Can't reach the relay. Check your connection and reopen this."
                : "You'll get a link to send. Everyone watches on their own account."}
        </p>
      </div>
    </div>
  );
}
