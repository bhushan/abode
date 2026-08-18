import css from '../content.css?inline';

/**
 * The layer Abode paints on top of somebody else's page.
 *
 * It lives in a shadow root, and that is the whole point of this module. The
 * inherited build declared `css: ['content.css']` in the manifest, which injects
 * our stylesheet into every page anybody visits: our rules can restyle their
 * site, and their rules can restyle our reactions. A shadow root ends both
 * directions at once, and costs one element.
 *
 * Fullscreen is the other reason it exists. Only the fullscreen subtree paints,
 * so the host has to move into it. Moving a div is free, which is why this is
 * not worth the top-layer trick the panel needs.
 */
export const OVERLAY_ID = 'ab-overlay';

let stage: HTMLElement | null = null;

/** In fullscreen only that subtree paints; a bare `<video>` cannot host children. */
export function overlayHost(): Element {
  const fs = document.fullscreenElement;
  if (!fs) return document.documentElement;
  return fs.tagName === 'VIDEO' ? (fs.parentElement ?? document.documentElement) : fs;
}

function build(): HTMLElement {
  const host = document.createElement('div');
  host.id = OVERLAY_ID;
  host.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:2147483646;border:0;margin:0;padding:0';

  const shadow = host.attachShadow({ mode: 'open' });
  const style = document.createElement('style');
  style.textContent = css;

  const inner = document.createElement('div');
  inner.className = 'ab-stage';

  shadow.append(style, inner);
  return host;
}

/** The element reactions and notes are appended to, mounted where it will paint. */
export function overlayStage(): Element {
  const existing = document.getElementById(OVERLAY_ID);
  const host = existing ?? build();
  const parent = overlayHost();
  if (host.parentElement !== parent) parent.appendChild(host);

  stage = host.shadowRoot?.querySelector('.ab-stage') ?? null;
  if (!stage) throw new Error('overlay lost its stage');
  return stage;
}

/** Follow the video into or out of fullscreen. No-op when nothing is painted. */
export function moveOverlay(): void {
  const host = document.getElementById(OVERLAY_ID);
  if (!host) return;
  const parent = overlayHost();
  if (host.parentElement !== parent) parent.appendChild(host);
}

export function removeOverlay(): void {
  document.getElementById(OVERLAY_ID)?.remove();
  stage = null;
}
