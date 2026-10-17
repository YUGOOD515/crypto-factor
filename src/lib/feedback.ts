import { animate } from 'motion';
import { reducedMotion } from './motion';

let live: HTMLElement | null = null;

/** Polite screen-reader announcement. */
export function announce(message: string): void {
  if (!live) {
    live = document.createElement('div');
    live.className = 'visually-hidden';
    live.setAttribute('role', 'status');
    live.setAttribute('aria-live', 'polite');
    document.body.append(live);
  }
  const region = live;
  region.textContent = '';
  window.setTimeout(() => {
    region.textContent = message;
  }, 60);
}

export async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    /* fall through to the legacy path */
  }
  const area = document.createElement('textarea');
  area.value = text;
  area.setAttribute('readonly', '');
  area.style.position = 'fixed';
  area.style.top = '0';
  area.style.opacity = '0';
  document.body.append(area);
  area.select();
  let ok = false;
  try {
    ok = document.execCommand('copy');
  } catch {
    ok = false;
  }
  area.remove();
  return ok;
}

const timers = new WeakMap<HTMLElement, number>();

/** Temporarily swap a button label (e.g. "Copied") and show the done state. */
export function flashButton(button: HTMLElement, text: string, ms = 1800): void {
  const label = button.querySelector<HTMLElement>('.btn__label');
  if (label) {
    label.dataset.label ??= label.textContent ?? '';
    label.textContent = text;
  }
  button.classList.add('is-done');
  if (!reducedMotion()) {
    animate(button, { transform: ['scale(1)', 'scale(0.95)', 'scale(1)'] }, { duration: 0.32, ease: 'easeOut' });
  }
  window.clearTimeout(timers.get(button));
  timers.set(
    button,
    window.setTimeout(() => {
      if (label?.dataset.label !== undefined) label.textContent = label.dataset.label;
      button.classList.remove('is-done');
    }, ms),
  );
}