/**
 * Segmented control / tab strip with a sliding indicator.
 * Works for role="radio" (aria-checked) and role="tab" (aria-selected) buttons,
 * with roving tabindex and arrow-key navigation (automatic activation).
 */
export interface Seg {
  value(): string;
  set(value: string, options?: { focus?: boolean; silent?: boolean }): void;
  refresh(): void;
}

export function initSeg(root: HTMLElement, onChange?: (value: string) => void): Seg {
  const buttons = Array.from(root.querySelectorAll<HTMLButtonElement>('.seg__btn'));
  const indicator = root.querySelector<HTMLElement>('.seg__indicator');
  const isTab = buttons[0]?.getAttribute('role') === 'tab';
  const attr = isTab ? 'aria-selected' : 'aria-checked';
  const keyOf = (button: HTMLButtonElement) => button.dataset.value ?? button.dataset.code ?? '';
  let current = buttons.find((b) => b.getAttribute(attr) === 'true') ?? buttons[0];

  const place = (animate: boolean) => {
    if (!indicator || !current || !current.offsetWidth) return;
    if (!animate) indicator.style.transition = 'none';
    // Sub-pixel geometry relative to the seg's padding box, so the indicator
    // fits exactly and also follows buttons that wrap into a grid.
    const box = current.getBoundingClientRect();
    const host = root.getBoundingClientRect();
    const x = box.left - host.left - root.clientLeft + root.scrollLeft;
    const y = box.top - host.top - root.clientTop;
    indicator.style.width = `${box.width}px`;
    indicator.style.height = `${box.height}px`;
    indicator.style.transform = `translate(${x}px, ${y}px)`;
    if (!animate) {
      void indicator.offsetWidth;
      indicator.style.removeProperty('transition');
    }
  };

  const reveal = (button: HTMLButtonElement) => {
    if (root.scrollWidth <= root.clientWidth) return;
    const left = button.offsetLeft;
    const right = left + button.offsetWidth;
    if (left < root.scrollLeft) root.scrollTo({ left: left - 24, behavior: 'smooth' });
    else if (right > root.scrollLeft + root.clientWidth) {
      root.scrollTo({ left: right - root.clientWidth + 24, behavior: 'smooth' });
    }
  };

  const set: Seg['set'] = (value, { focus = false, silent = false } = {}) => {
    const next = buttons.find((b) => keyOf(b) === value);
    if (!next) return;
    const changed = next !== current;
    current = next;
    for (const b of buttons) {
      const on = b === next;
      b.setAttribute(attr, String(on));
      b.tabIndex = on ? 0 : -1;
    }
    place(true);
    reveal(next);
    if (focus) next.focus();
    if (changed && !silent) onChange?.(value);
  };

  for (const button of buttons) {
    button.tabIndex = button === current ? 0 : -1;
    button.addEventListener('click', () => set(keyOf(button)));
  }

  root.addEventListener('keydown', (event) => {
    const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
    if (index < 0) return;
    const n = buttons.length;
    let next = -1;
    switch (event.key) {
      case 'ArrowRight':
      case 'ArrowDown':
        next = (index + 1) % n;
        break;
      case 'ArrowLeft':
      case 'ArrowUp':
        next = (index - 1 + n) % n;
        break;
      case 'Home':
        next = 0;
        break;
      case 'End':
        next = n - 1;
        break;
      default:
        return;
    }
    event.preventDefault();
    set(keyOf(buttons[next]), { focus: true });
  });

  place(false);
  root.classList.add('is-ready');
  new ResizeObserver(() => place(false)).observe(root);
  document.fonts?.ready.then(() => place(false));

  return {
    value: () => (current ? keyOf(current) : ''),
    set,
    refresh: () => place(false),
  };
}