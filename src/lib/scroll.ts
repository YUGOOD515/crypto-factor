import Lenis from 'lenis';
import { gsap } from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { reducedMotion } from './motion';

gsap.registerPlugin(ScrollTrigger);

let lenis: Lenis | null = null;

/** Lenis smooth scrolling driven by the GSAP ticker so ScrollTrigger stays in sync. */
export function initSmoothScroll(): void {
  if (reducedMotion()) return;
  lenis = new Lenis({ autoRaf: false, lerp: 0.12, smoothWheel: true, anchors: false });
  lenis.on('scroll', ScrollTrigger.update);
  gsap.ticker.add((time) => lenis?.raf(time * 1000));
  gsap.ticker.lagSmoothing(0);
}

export function onScroll(callback: () => void): void {
  let frame = 0;
  window.addEventListener(
    'scroll',
    () => {
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        callback();
      });
    },
    { passive: true },
  );
}

function headerHeight(): number {
  return document.querySelector<HTMLElement>('[data-header]')?.offsetHeight ?? 64;
}

function offsetFor(el: Element): number {
  const margin = parseFloat(getComputedStyle(el).scrollMarginTop);
  return Number.isFinite(margin) && margin > 0 ? margin : headerHeight();
}

const easeOutQuart = (t: number) => 1 - (1 - t) ** 4;

/** Smoothly scroll to an element (or the top) below the fixed header. */
export function scrollToTarget(target: Element | 'top', onDone?: () => void): void {
  const y =
    target === 'top' ? 0 : Math.max(0, target.getBoundingClientRect().top + window.scrollY - offsetFor(target));
  if (lenis) {
    const distance = Math.abs(y - window.scrollY);
    const duration = Math.min(1.6, 0.6 + distance / 6000);
    lenis.scrollTo(y, { duration, easing: easeOutQuart, force: true, onComplete: () => onDone?.() });
    return;
  }
  window.scrollTo({ top: y, behavior: reducedMotion() ? 'auto' : 'smooth' });
  if (onDone) window.setTimeout(onDone, reducedMotion() ? 0 : 600);
}

/** Move keyboard focus to a scrolled-to element without a second scroll jump. */
export function focusTarget(el: HTMLElement): void {
  if (!el.matches('a, button, input, select, textarea, [tabindex]')) el.setAttribute('tabindex', '-1');
  el.focus({ preventScroll: true });
}

export function lockScroll(locked: boolean): void {
  document.documentElement.classList.toggle('is-locked', locked);
  if (locked) lenis?.stop();
  else lenis?.start();
}

export { gsap, ScrollTrigger };