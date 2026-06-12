/** A person in the room, as the relay reports them. */
export interface Member {
  id?: string;
  name: string;
  tint: number;
  host?: boolean;
  you?: boolean;
}

/** Inline snapshot of a replied-to message: chat history is never stored. */
export interface ReplyRef {
  mid?: string;
  from: string;
  text: string;
}

export interface Message {
  id: number;
  /** Shared cross-client id, so a reply points at the same message everywhere. */
  mid?: string;
  type: 'system' | 'chat';
  from?: string;
  tint?: number;
  text: string;
  mine?: boolean;
  /** Position in the video when this was said, in seconds. */
  at?: number | null;
  replyTo?: ReplyRef;
}
