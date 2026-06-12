// Reactions that can float over the video.
// MUST stay in sync with the REACTIONS allowlist in the relay
// (apps/relay/src/protocol.ts) or the relay silently drops anything extra.
export const REACTION_EMOJI = [
  '🐻', '😂', '❤️', '😱', '😢', '😍', '😡', '👍', '👎', '🔥',
  '🎉', '👏', '🙌', '🤯', '😴', '🥱', '🤔', '😮', '😅', '😭',
  '🥺', '😎', '🤩', '😇', '🙃', '😏', '😬', '🤣', '💀', '👀',
  '✨', '⭐', '💯', '🙏', '🤝', '💪', '🍿', '☕', '🎬', '📺',
  '🐾', '🍯', '🌙', '⚡', '💖', '💔', '🫶', '🤡', '🥳', '😤',
];

// the strip shown inline above the composer; the picker exposes the full set
// the inline strip above the composer; REACTION_EMOJI is the full set
export const STRIP_EMOJI = ['🍿', '😂', '❤️', '😱', '🔥', '🎬', '👀'];
