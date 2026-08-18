import { useCallback, useEffect, useRef, useState } from "react";
import { Logo, Mark } from "@/components/Logo";
import { Avatar } from "@/components/Avatar";
import { LockStrip } from "@/components/LockStrip";
import { ControlLock } from "@/components/ControlLock";
import { syncStateOf } from "@/lib/syncState";
import { useRoomState } from "@/hooks/useRoomState";
import { useVideoState } from "@/hooks/useVideoState";
import { getIdentity, tintOf, type Identity } from "@/lib/identity";
import { linkify } from "@/lib/linkify";
import { shouldOfferFollow } from "@/lib/follow";
import { getActiveTab } from "@/lib/messages";
import { getSeat } from "@/lib/seat";
import { getServerUrl } from "@/lib/server";
import { formatTimecode } from "@/lib/timecode";
import { joinRoom, type ConnStatus, type RoomConnection, type VideoContentInfo } from "@/lib/socket";
import { STRIP_EMOJI } from "@/lib/emoji";
import type { Member, Message } from "@/lib/types";

export function SidePanel() {
  const { inRoom, roomCode } = useRoomState();
  const { videoTime } = useVideoState();

  const [identity, setIdentity] = useState<Identity | null>(null);
  const [status, setStatus] = useState<ConnStatus>("connecting");
  const [members, setMembers] = useState<Member[]>([]);
  const [messages, setMessages] = useState<Message[]>([]);
  const [content, setContent] = useState<VideoContentInfo | null>(null);
  const [typers, setTypers] = useState<Map<string, string>>(new Map());
  const [locked, setLocked] = useState(false);
  const [tabUrl, setTabUrl] = useState<string | null>(null);
  const [draft, setDraft] = useState("");

  const conn = useRef<RoomConnection | null>(null);
  const nextId = useRef(1);
  // Socket callbacks need the current position, but must not re-subscribe every
  // time the video moves, so it is mirrored into a ref from an effect.
  const timeRef = useRef<number | null>(null);
  useEffect(() => {
    timeRef.current = videoTime;
  }, [videoTime]);

  useEffect(() => {
    void getIdentity().then(setIdentity);
  }, []);

  // The room can move on to the next episode without this tab. Polled rather
  // than pushed, because a tab navigating is not an event the panel receives.
  useEffect(() => {
    const read = () => void getActiveTab().then((t) => setTabUrl(t?.url ?? null));
    read();
    const iv = setInterval(read, 2_000);
    return () => clearInterval(iv);
  }, []);

  const push = useCallback((m: Omit<Message, "id">) => {
    setMessages((prev) => [...prev, { ...m, id: nextId.current++ }].slice(-300));
  }, []);

  useEffect(() => {
    if (!inRoom || !roomCode || !identity) return;
    let live = true;
    let connection: RoomConnection | undefined;

    void (async () => {
      const [serverUrl, seat] = await Promise.all([getServerUrl(), getSeat()]);
      if (!live) return;
      connection = joinRoom(
        serverUrl,
        roomCode,
        identity,
        {
        onStatus: setStatus,
        onLock: setLocked,
        onMembers: (list, selfId) => setMembers(list.map((m) => ({ ...m, you: m.id === selfId }))),
        onContent: setContent,
        onSystem: (text) => push({ type: "system", text, at: timeRef.current }),
        onChat: ({ from, text, mid, replyTo }) =>
          push({
            type: "chat",
            from,
            text,
            mid,
            replyTo,
            at: timeRef.current,
            tint: undefined,
          }),
        onTyping: ({ fromId, from, typing }) =>
          setTypers((prev) => {
            const next = new Map(prev);
            if (typing) next.set(fromId, from);
            else next.delete(fromId);
            return next;
          }),
        },
        seat,
      );
      conn.current = connection;
    })();

    return () => {
      live = false;
      connection?.disconnect();
      conn.current = null;
    };
  }, [inRoom, roomCode, identity, push]);

  function send() {
    const text = draft.trim();
    if (!text || !conn.current) return;
    conn.current.sendChat(text);
    conn.current.sendTyping(false);
    push({ type: "chat", from: identity?.name, text, mine: true, at: videoTime, tint: identity?.tint });
    setDraft("");
  }

  if (!inRoom) return <Empty />;

  const tintFor = (name?: string) => members.find((m) => m.name === name)?.tint;

  return (
    <div className="relative flex h-screen flex-col overflow-hidden bg-ab-ink text-ab-cream">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 -top-10 h-48"
        style={{ background: "radial-gradient(60% 100% at 50% 0%, rgba(232,169,79,.13), transparent 72%)" }}
      />
      <LockStrip state={syncStateOf(status)} at={videoTime} title={content?.title || undefined}>
        <ControlLock
          locked={locked}
          canToggle={members.some((m) => m.you && m.host)}
          hostName={members.find((m) => m.host)?.name}
          onToggle={(next) => conn.current?.setLock(next)}
        />
      </LockStrip>

      <MemberRail members={members} />

      {shouldOfferFollow(content, tabUrl) ? (
        <FollowBanner
          title={content!.title}
          onFollow={() => {
            void getActiveTab().then((t) => {
              if (t?.id != null) void chrome.tabs.update(t.id, { url: content!.url });
            });
          }}
        />
      ) : null}

      <Feed messages={messages} tintFor={tintFor} />

      {typers.size > 0 ? (
        <div className="px-3 pb-1 text-[11.5px] text-ab-faint">
          {[...typers.values()].join(", ")} {typers.size === 1 ? "is" : "are"} typing…
        </div>
      ) : null}

      <div className="border-t border-ab-edge px-3 pb-3 pt-2">
        <div className="mb-2 flex w-fit gap-0.5 rounded-[10px] border border-ab-edge bg-ab-sunk p-0.5">
          {STRIP_EMOJI.map((emoji) => (
            <button
              key={emoji}
              type="button"
              aria-label={`React ${emoji}`}
              onClick={() => conn.current?.sendReaction(emoji)}
              className="rounded-[7px] px-1.5 py-1.5 text-[15px] leading-none transition-all hover:scale-[1.22] hover:bg-ab-edge active:scale-95"
            >
              {emoji}
            </button>
          ))}
        </div>
        <div className="flex items-end gap-2">
          <textarea
            value={draft}
            rows={1}
            placeholder="Message the room"
            aria-label="Message the room"
            onChange={(e) => {
              setDraft(e.target.value);
              conn.current?.sendTyping(e.target.value.length > 0);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                send();
              }
            }}
            className="max-h-24 min-h-[38px] flex-1 resize-none rounded-lg border border-ab-edge bg-ab-raised px-2.5 py-2 text-[13px] leading-[1.4] text-ab-cream outline-none placeholder:text-ab-faint focus:border-ab-edge-strong"
          />
          <button
            type="button"
            onClick={send}
            disabled={!draft.trim()}
            aria-label="Send"
            className="h-[38px] shrink-0 rounded-lg bg-ab-lamp px-3 text-[13px] font-semibold text-ab-ink transition-all enabled:hover:brightness-105 enabled:active:scale-95 disabled:opacity-30"
          >
            Send
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * The room moved on and this tab did not.
 *
 * An offer rather than a navigation: moving somebody's tab out from under them
 * loses their place, and two people are sometimes on different pages on purpose.
 */
function FollowBanner({ title, onFollow }: { title: string; onFollow: () => void }) {
  return (
    <div className="flex items-center gap-2 border-b border-ab-edge bg-ab-raised px-3 py-2">
      <div className="min-w-0 flex-1">
        <div className="text-[10.5px] font-semibold uppercase tracking-[.09em] text-ab-faint">Room moved on</div>
        <div className="overflow-hidden text-ellipsis whitespace-nowrap text-[12.5px] text-ab-cream" title={title}>
          {title}
        </div>
      </div>
      <button
        type="button"
        onClick={onFollow}
        className="shrink-0 rounded-lg bg-ab-lamp px-2.5 py-1.5 text-[12px] font-semibold text-ab-ink transition-all hover:brightness-105 active:scale-95"
      >
        Catch up
      </button>
    </div>
  );
}

function MemberRail({ members }: { members: Member[] }) {
  if (members.length === 0) return null;
  return (
    <div className="flex flex-wrap items-center gap-1.5 border-y border-ab-edge px-3 py-2">
      {members.map((m) => (
        <span
          key={m.id ?? m.name}
          className="flex items-center gap-1.5 rounded-full border border-ab-edge bg-ab-raised py-0.5 pl-0.5 pr-2"
        >
          <Avatar name={m.name} tint={m.tint} size={19} />
          <span className="text-[11.5px] font-medium text-ab-dim">{m.you ? "You" : m.name}</span>
          {m.host ? <span className="text-[9.5px] font-semibold uppercase tracking-[.08em] text-ab-faint">host</span> : null}
        </span>
      ))}
    </div>
  );
}

function Feed({ messages, tintFor }: { messages: Message[]; tintFor: (name?: string) => number | undefined }) {
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => {
    end.current?.scrollIntoView({ block: "end" });
  }, [messages.length]);

  if (messages.length === 0) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-3 px-9 text-center">
        <Mark size={32} />
        <p className="text-[12.5px] leading-[1.55] text-ab-dim">
          Nothing said yet. Messages are stamped with where you are in the video, so the log reads back like notes.
        </p>
        <p className="text-[12px] leading-[1.5] text-ab-faint">
          Play, pause and seek with the site's own player. Everyone in the room follows.
        </p>
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto px-3 py-2">
      {messages.map((m) =>
        m.type === "system" ? (
          <div key={m.id} className="animate-ab-msg flex items-center gap-2.5 py-2">
            <span aria-hidden="true" className="h-px flex-1 bg-ab-edge" />
            <span className="whitespace-nowrap text-[10.5px] text-ab-faint">{m.text}</span>
            <span aria-hidden="true" className="h-px flex-1 bg-ab-edge" />
          </div>
        ) : (
          <div key={m.id} className="animate-ab-msg flex gap-2 py-[3px]">
            <span className="mt-[3px] shrink-0 font-mono text-[10.5px] tabular-nums text-ab-faint">
              {formatTimecode(m.at)}
            </span>
            <span
              className="mt-[1px] shrink-0 text-[12.5px] font-semibold"
              style={{ color: tintOf((m.mine ? m.tint : tintFor(m.from)) ?? 0) }}
            >
              {m.mine ? "You" : m.from}
            </span>
            <span className="min-w-0 break-words text-[13px] leading-[1.45] text-ab-cream">
              {linkify(m.text, "underline decoration-ab-faint hover:decoration-ab-cream")}
            </span>
          </div>
        ),
      )}
      <div ref={end} />
    </div>
  );
}

function Empty() {
  return (
    <div className="flex h-screen flex-col items-center justify-center gap-3 bg-ab-ink px-8 text-center">
      <Logo size={26} />
      <p className="mt-1 text-[13px] font-medium text-ab-cream">No room yet</p>
      <p className="text-[12px] leading-[1.5] text-ab-dim">
        Open something to watch, then start a room from the Abode button in your toolbar. Or open an invite link
        somebody sent you.
      </p>
    </div>
  );
}
