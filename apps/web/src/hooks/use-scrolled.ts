import { type RefObject, useEffect, useState } from 'react';

/** Pixels of scroll before the header turns into glass. */
export const SCROLLED_THRESHOLD = 4;

export function isScrolled(scrollTop: number, threshold = SCROLLED_THRESHOLD): boolean {
  return scrollTop > threshold;
}

/**
 * True while ANY element inside `ref` is scrolled down. Scroll events do not bubble, so this listens
 * in the capture phase: it works for `<main>` itself and for inner scrollers (the conversation uses
 * use-stick-to-bottom, whose scroll container is a descendant). `resetKey` clears the state on route change.
 */
export function useScrolledWithin(ref: RefObject<HTMLElement | null>, resetKey?: unknown): boolean {
  const [scrolled, setScrolled] = useState(false);

  // biome-ignore lint/correctness/useExhaustiveDependencies: resetKey is a deliberate re-run trigger
  useEffect(() => {
    setScrolled(false);
    const el = ref.current;
    if (!el) return;
    const onScroll = (e: Event) => {
      const target = e.target;
      if (target instanceof HTMLElement) setScrolled(isScrolled(target.scrollTop));
    };
    el.addEventListener('scroll', onScroll, { capture: true, passive: true });
    return () => el.removeEventListener('scroll', onScroll, { capture: true });
  }, [ref, resetKey]);

  return scrolled;
}
