import { $$ } from './dom';
import { reducedMotion } from './motion';
import { initSeg, type Seg } from './seg';

/**
 * Colour theme: light, dark, or whatever the system prefers (the default).
 *
 * The inline script in index.html applies the stored choice before the first
 * paint; keep it in step with this file (same storage key, same rule). From
 * then on this module keeps <html data-theme> current: the header and menu
 * switches, a system change while the page is open, other tabs, and the
 * browser's theme-color. Canvas charts that bake colours in redraw through
 * onThemeChange.
 */
export type Theme = 'light' | 'dark';
export type ThemeChoice = Theme | 'system';

const KEY = 'cf-theme';
const system = window.matchMedia('(prefers-color-scheme: dark)');
const listeners = new Set<(theme: Theme) => void>();

function stored(): ThemeChoice {
  try {
    const value = localStorage.getItem(KEY);
    return value === 'light' || value === 'dark' ? value : 'system';
  } catch {
    return 'system';
  }
}

function store(choice: ThemeChoice): void {
  try {
    if (choice === 'system') localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, choice);
  } catch {
    /* private mode: the choice lasts for this page only */
  }
}

const resolve = (choice: ThemeChoice): Theme => (choice === 'system' ? (system.matches ? 'dark' : 'light') : choice);

export function currentTheme(): Theme {
  return document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light';
}

/** Call `callback` after every theme change; returns an unsubscribe function. */
export function onThemeChange(callback: (theme: Theme) => void): () => void {
  listeners.add(callback);
  return () => listeners.delete(callback);
}

/** The browser's own chrome (mobile address bar) follows the page surface. */
function syncThemeColor(): void {
  const bg = getComputedStyle(document.documentElement).getPropertyValue('--bg').trim();
  if (bg) document.querySelector('meta[name="theme-color"]')?.setAttribute('content', bg);
}

// The theme last asked for. A view transition runs its update a frame later,
// so a second click can arrive before the first one has landed.
let wanted: Theme = currentTheme();

function swap(): void {
  const root = document.documentElement;
  if (root.dataset.theme === wanted) return;
  // Switch in one step: without this, every element with a colour
  // transition would fade on its own schedule.
  root.classList.add('is-theme-switching');
  root.dataset.theme = wanted;
  void document.body.offsetWidth;
  syncThemeColor();
  for (const listener of listeners) {
    try {
      listener(wanted);
    } catch (error) {
      console.error('[theme]', error);
    }
  }
  root.classList.remove('is-theme-switching');
}

/** `animate` cross-fades the page; use it only for a click or key press on a visible page. */
function apply(theme: Theme, animate: boolean): void {
  if (theme === wanted && theme === currentTheme()) return;
  wanted = theme;
  if (animate && document.visibilityState === 'visible' && !reducedMotion() && 'startViewTransition' in document) {
    // `ready` rejects when a newer switch or a hidden tab skips the fade; the swap still runs.
    document.startViewTransition(swap).ready.catch(() => {});
  } else {
    swap();
  }
}

export function initTheme(): void {
  let choice = stored();
  apply(resolve(choice), false);
  syncThemeColor();

  const switches: Seg[] = [];
  const choose = (next: ThemeChoice, source?: Seg) => {
    choice = next;
    for (const seg of switches) if (seg !== source) seg.set(next, { silent: true });
    apply(resolve(next), Boolean(source));
  };
  for (const root of $$('[data-theme-switch]')) {
    // Check the stored choice first so the indicator starts there, unanimated.
    for (const button of $$<HTMLButtonElement>('.seg__btn', root)) {
      button.setAttribute('aria-checked', String(button.dataset.value === choice));
    }
    const seg: Seg = initSeg(root, (value) => {
      store(value as ThemeChoice);
      choose(value as ThemeChoice, seg);
    });
    switches.push(seg);
  }

  system.addEventListener('change', () => {
    if (choice === 'system') apply(resolve('system'), false);
  });
  // Another tab changed the choice.
  window.addEventListener('storage', (event) => {
    if (event.key === KEY || event.key === null) choose(stored());
  });
}
