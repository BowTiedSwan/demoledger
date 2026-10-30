// @vitest-environment jsdom
import { act, cleanup, render, screen } from '@testing-library/react';
import { useRef } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { isScrolled, SCROLLED_THRESHOLD, useScrolledWithin } from './use-scrolled';

afterEach(cleanup);

function Harness({ resetKey }: { resetKey?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const scrolled = useScrolledWithin(ref, resetKey);
  return (
    <div ref={ref}>
      <header data-testid="header" data-scrolled={scrolled} className="glass-header" />
      <div data-testid="inner-scroller" />
    </div>
  );
}

function scrollTo(el: HTMLElement, top: number) {
  el.scrollTop = top;
  el.dispatchEvent(new Event('scroll'));
}

describe('isScrolled', () => {
  it('is false at the top and true once past the threshold', () => {
    expect(isScrolled(0)).toBe(false);
    expect(isScrolled(SCROLLED_THRESHOLD)).toBe(false);
    expect(isScrolled(SCROLLED_THRESHOLD + 1)).toBe(true);
  });
});

describe('header scrolled state', () => {
  it('is transparent at the top and glass after an inner container scrolls', async () => {
    render(<Harness />);
    const header = screen.getByTestId('header');
    expect(header.getAttribute('data-scrolled')).toBe('false');
    await act(async () => scrollTo(screen.getByTestId('inner-scroller'), 120));
    expect(header.getAttribute('data-scrolled')).toBe('true');
    await act(async () => scrollTo(screen.getByTestId('inner-scroller'), 0));
    expect(header.getAttribute('data-scrolled')).toBe('false');
  });

  it('resets when the route key changes', async () => {
    const { rerender } = render(<Harness resetKey="/assistant" />);
    await act(async () => scrollTo(screen.getByTestId('inner-scroller'), 50));
    expect(screen.getByTestId('header').getAttribute('data-scrolled')).toBe('true');
    rerender(<Harness resetKey="/transactions" />);
    expect(screen.getByTestId('header').getAttribute('data-scrolled')).toBe('false');
  });
});
