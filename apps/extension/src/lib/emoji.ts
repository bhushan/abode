// Reactions that can float over the video.
// MUST stay in sync with the REACTIONS allowlist in the relay
// (apps/relay/src/protocol.ts) or the relay silently drops anything extra.
export const REACTION_EMOJI = [
  '🏠', '😂', '❤️', '😱', '😢', '😍', '😡', '👍', '👎', '🔥',
  '🎉', '👏', '🙌', '🤯', '😴', '🥱', '🤔', '😮', '😅', '😭',
  '🥺', '😎', '🤩', '😇', '🙃', '😏', '😬', '🤣', '💀', '👀',
  '✨', '⭐', '💯', '🙏', '🤝', '💪', '🍿', '☕', '🎬', '📺',
  '🐾', '🍯', '🌙', '⚡', '💖', '💔', '🫶', '🤡', '🥳', '😤',
];

// the inline strip above the composer; the picker exposes REACTION_EMOJI in full
export const STRIP_EMOJI = ['🍿', '😂', '❤️', '😱', '🔥', '🎬', '👀'];
