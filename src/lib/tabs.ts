import { $, $$ } from './dom';
import { EASE_OUT, initReveal, reducedMotion } from './motion';
import { focusTarget, jumpTo, ScrollTrigger, scrollToTarget, targetY } from './scroll';

/**
 * Tabs. The page stays one document, shown one tab at a time: every
 * `main > [data-panel]` belongs to a tab (the hero and the overview story make
 * up the first), and `:root[data-tab]` picks the tab on screen. The inline
 * script in index.html sets it before first paint; this module takes over.
 *
 * Every in-page link, back/forward and deep link goes through `go()`: `#papers`
 * opens the Papers tab at its top, `#overview` scrolls to the story below the
 * hero, `#method-SMB` opens Methodology on SMB. Switching tabs jumps (the new
 * tab starts at its top or at the target); within a tab, links still scroll
 * smoothly. A tab's scripts run the first time it is shown (`onFirstShow`).
 */

export const TABS = ['overview', 'factors', 'methodology', 'papers', 'download', 'market'] as const;
export type Tab = (typeof TABS)[number];

const TITLES: Record<Tab, string> = {
  overview: '',
  factors: 'Factors',
  methodology: 'Methodology',
  papers: 'Papers',
  download: 'Download',
  market: 'Market overview',
};
const BASE_TITLE = document.title;

/**
 * `cf:target` detail. Dispatched once the target's tab is on screen and before
 * scrolling, so a tab can open nested content (a methodology tab, a factor)
 * and point the scroll and focus somewhere else.
 */
export interface TargetDetail {
  id: string;
  scroll: Element;
  focus: HTMLElement;
}

/** `cf:tab` detail: dispatched after a tab comes on screen and the page has been scrolled into place. */
export interface TabDetail {
  tab: Tab;
}

export interface Destination {
  tab: Tab;
  /** Element id ('' for the top of the page). */
  id: string;
  /** Where to scroll; null for the top of the page. */
  scroll: Element | null;
  focus: HTMLElement | null;
}

export interface GoOptions {
  /** History entry: 'push' for link clicks (default), 'none' when the URL is already right. */
  history?: 'push' | 'none';
  /** URL fragment to record; defaults to `#id`. */
  hash?: string;
  /** Runs once the tab is on screen (and set up), before scrolling: e.g. select a factor. */
  prepare?: () => void;
  /** Scroll position to restore (back/forward) instead of scrolling to the target. */
  y?: number;
  /** What to focus once there; defaults to the target. `false` leaves focus alone. */
  focus?: HTMLElement | null | false;
  /** Fade the tab in when it changes (not on first load). */
  fade?: boolean;
}

const root = document.documentElement;
const loaders = new Map<Tab, Array<() => void>>();
const loaded = new Set<Tab>();
let current: Tab | null = null;
/** The location.hash last handled, so hashchange after popstate is not handled twice. */
let handled: string | null = null;

const isTab = (value: string | undefined): value is Tab => (TABS as readonly string[]).includes(value ?? '');
const panelsOf = (tab: Tab) => $$(`main > [data-panel="${tab}"]`);

function decode(hash: string): string {
  try {
    return decodeURIComponent(hash.replace(/^#/, ''));
  } catch {
    return '';
  }
}

/** Run `init` the first time `tab` is shown (at once if it already has been). */
export function onFirstShow(tab: Tab, init: () => void): void {
  if (loaded.has(tab)) {
    init();
    return;
  }
  loaders.set(tab, [...(loaders.get(tab) ?? []), init]);
}

/** Call `load` once, as soon as the reader points at or focuses a link to `tab` (to fetch its code early). */
export function onIntent(tab: Tab, load: () => void): void {
  const selector = `a[href="#${tab}"]`;
  const handler = (event: Event) => {
    if (!(event.target instanceof Element) || !event.target.closest(selector)) return;
    document.removeEventListener('pointerover', handler);
    document.removeEventListener('focusin', handler);
    load();
  };
  document.addEventListener('pointerover', handler, { passive: true });
  document.addEventListener('focusin', handler);
}

function resolve(id: string): Destination | null {
  if (!id || id === 'top') return { tab: 'overview', id: '', scroll: null, focus: $<HTMLElement>('.brand') };
  const el = document.getElementById(id);
  const panel = el?.closest<HTMLElement>('main > [data-panel]');
  const tab = panel?.dataset.panel;
  if (!el || !panel || !isTab(tab)) return null;
  // A tab's own section opens the tab at the top of the page.
  const opensTab = el === panel && panel === panelsOf(tab)[0];
  return { tab, id, scroll: opensTab ? null : el, focus: el };
}

/** Put a tab on screen, running its scripts the first time. Returns whether the tab changed. */
function show(tab: Tab): boolean {
  if (tab === current) return false;
  current = tab;
  root.dataset.tab = tab;
  for (const link of $$<HTMLAnchorElement>('a[data-nav]')) {
    const on = link.dataset.nav === tab;
    link.classList.toggle('is-active', on);
    if (on) link.setAttribute('aria-current', 'page');
    else link.removeAttribute('aria-current');
  }
  document.title = TITLES[tab] ? `${TITLES[tab]} · Crypto Factor` : BASE_TITLE;
  if (!loaded.has(tab)) {
    loaded.add(tab);
    const inits = loaders.get(tab) ?? [];
    loaders.delete(tab);
    for (const init of inits) init();
  }
  return true;
}

function record(hash: string, from: number): void {
  const url = hash || location.pathname + location.search;
  saveScroll(from); // where the reader was, for back
  try {
    if (hash === location.hash) history.replaceState({ y: null }, '', url);
    else history.pushState({ y: null }, '', url);
  } catch {
    // History can be unavailable (sandboxed frames); the tab still changes.
  }
}

/**
 * Navigate to an element id ('' or 'top' for the top of the page): show its
 * tab, record the history entry, scroll and move focus. Returns where it went
 * (after any `cf:target` retargeting), or null, doing nothing, when the id is
 * not inside a tab.
 */
export function go(id: string, options: GoOptions = {}): Destination | null {
  const dest = resolve(id);
  if (!dest) return null;
  const { history: mode = 'push', hash = dest.id ? `#${dest.id}` : '', prepare, y, fade = true } = options;
  const from = window.scrollY; // before the page changes length
  const first = !loaded.has(dest.tab);
  const changed = show(dest.tab);
  prepare?.();

  let { scroll, focus } = dest;
  if (scroll && focus) {
    const detail: TargetDetail = { id: dest.id, scroll, focus };
    document.dispatchEvent(new CustomEvent<TargetDetail>('cf:target', { detail }));
    ({ scroll, focus } = detail);
  }
  if (options.focus !== undefined) focus = options.focus || null;
  if (mode === 'push') record(hash, from);
  handled = location.hash;

  const settle = () => {
    if (focus) focusTarget(focus);
  };
  // The page has a new length: re-measure the scroll-driven effects before
  // scrolling, as refresh() puts the page back at the scroll position it last
  // saw, which predates the jump below.
  if (changed) ScrollTrigger.refresh();
  if (y !== undefined) jumpTo(y);
  else if (changed) {
    jumpTo(scroll ? targetY(scroll) : 0);
    settle();
  } else scrollToTarget(scroll ?? 'top', settle);

  if (changed) {
    const panels = panelsOf(dest.tab);
    if (fade && !reducedMotion()) {
      for (const panel of panels) {
        panel.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 400, easing: `cubic-bezier(${EASE_OUT.join(',')})` });
      }
    }
    // Entrances are measured against the final scroll position.
    if (first) requestAnimationFrame(() => panels.forEach((panel) => initReveal(panel)));
    document.dispatchEvent(new CustomEvent<TabDetail>('cf:tab', { detail: { tab: dest.tab } }));
  }
  return { ...dest, scroll, focus };
}

/** Go to whatever the URL's hash points at; an unknown hash shows the first tab. */
function follow(options: GoOptions, hash = location.hash): Destination | null {
  return go(decode(hash), options) ?? go('', options);
}

/** Keep the reader's scroll position in the current history entry, for back, forward and reload. */
function saveScroll(y = window.scrollY): void {
  try {
    history.replaceState({ ...(history.state ?? {}), y }, '');
  } catch {
    // History can be unavailable (sandboxed frames), or rate-limited.
  }
}

export function initTabs(): void {
  root.dataset.router = 'on';
  // Back, forward and reload return to positions saved here, not the
  // browser's. Set through ScrollTrigger, which otherwise puts
  // history.scrollRestoration back to what it found on every refresh.
  ScrollTrigger.clearScrollMemory('manual');

  // First load (or a reload, which returns to where the reader was). The
  // inline script in index.html has taken a deep link's hash off the URL for
  // now (so the browser does not scroll to it as well) and puts it back.
  const saved = (history.state as { y?: unknown } | null)?.y;
  const restoring = typeof saved === 'number';
  const options: GoOptions = { history: 'none', y: restoring ? saved : undefined, focus: false, fade: false };
  const start = follow(options, root.dataset.hash ?? location.hash);
  delete root.dataset.hash;
  // Web fonts can still move a deep-linked target after the first jump.
  const deep = !restoring ? start?.scroll : null;
  if (deep && document.fonts) {
    const at = window.scrollY;
    document.fonts.ready.then(() => {
      if (Math.abs(window.scrollY - at) < 2) jumpTo(targetY(deep));
    });
  }

  document.addEventListener('click', (event) => {
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    const link = event.target instanceof Element ? event.target.closest<HTMLAnchorElement>('a[href^="#"]') : null;
    const href = link?.getAttribute('href') ?? '';
    if (!link || href === '#') return;
    const target = decode(href);
    if (target === 'main') {
      // Skip link: into the content of the current tab.
      const main = $('main');
      if (!main) return;
      event.preventDefault();
      focusTarget(main);
      scrollToTarget(main);
      return;
    }
    if (go(target, { hash: href })) event.preventDefault();
  });

  // A hash typed into the address bar fires popstate, then the browser scrolls
  // to and focuses that element itself (without the header offset, or the
  // retargeting of cf:target), then hashchange: settle once more there.
  let again: (() => void) | null = null;
  window.addEventListener('popstate', (event) => {
    const y = (event.state as { y?: unknown } | null)?.y;
    const back = typeof y === 'number';
    const dest = follow({ history: 'none', y: back ? y : undefined, focus: back ? false : undefined });
    again =
      dest && !back
        ? () => {
            jumpTo(dest.scroll ? targetY(dest.scroll) : 0);
            if (dest.focus) focusTarget(dest.focus);
          }
        : null;
  });
  window.addEventListener('hashchange', () => {
    if (location.hash !== handled) follow({ history: 'none' });
    else again?.();
    again = null;
  });
  let timer = 0;
  window.addEventListener(
    'scroll',
    () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => saveScroll(), 250);
    },
    { passive: true },
  );
  window.addEventListener('pagehide', () => saveScroll());
}
