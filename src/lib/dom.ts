export const SVG_NS = 'http://www.w3.org/2000/svg';

export function $<T extends Element = HTMLElement>(selector: string, root: ParentNode = document): T | null {
  return root.querySelector<T>(selector);
}

export function $$<T extends Element = HTMLElement>(selector: string, root: ParentNode = document): T[] {
  return Array.from(root.querySelectorAll<T>(selector));
}

type Attrs = Record<string, string | number | null | undefined>;

export function setAttrs(el: Element, attrs: Attrs): void {
  for (const [key, value] of Object.entries(attrs)) {
    if (value === null || value === undefined) el.removeAttribute(key);
    else el.setAttribute(key, String(value));
  }
}

/** Create an SVG element with attributes, optionally appending it to a parent. */
export function svgEl<K extends keyof SVGElementTagNameMap>(
  tag: K,
  attrs: Attrs = {},
  parent?: Element,
): SVGElementTagNameMap[K] {
  const el = document.createElementNS(SVG_NS, tag);
  setAttrs(el, attrs);
  if (parent) parent.append(el);
  return el;
}

export function cssVar(name: string, el: Element = document.documentElement): string {
  return getComputedStyle(el).getPropertyValue(name).trim();
}

/**
 * Observe an element's content-box size. The callback runs once per animation
 * frame at most and only when the size actually changes.
 */
export function onResize(el: Element, callback: (width: number, height: number) => void): () => void {
  let frame = 0;
  let lastW = -1;
  let lastH = -1;
  const ro = new ResizeObserver((entries) => {
    const box = entries[entries.length - 1].contentRect;
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(() => {
      const w = Math.round(box.width);
      const h = Math.round(box.height);
      if (w === lastW && h === lastH) return;
      lastW = w;
      lastH = h;
      callback(w, h);
    });
  });
  ro.observe(el);
  return () => {
    cancelAnimationFrame(frame);
    ro.disconnect();
  };
}

export function debounce<A extends unknown[]>(fn: (...args: A) => void, ms: number): (...args: A) => void {
  let timer = 0;
  return (...args: A) => {
    window.clearTimeout(timer);
    timer = window.setTimeout(() => fn(...args), ms);
  };
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}