import { ThinkingOrb } from 'thinking-orbs';
import { Shimmer } from './shimmer';
import { STEP_ROW_CLASS } from './tool';

/**
 * The initial "working on it" indicator, before the assistant message has any visible content:
 * the monochrome ThinkingOrb plus a Shimmer status line. Same row height as a tool row. The orb and
 * the shimmer both render a static frame under prefers-reduced-motion.
 */
export function WaitingOrb({ label }: { label: string }) {
  return (
    <div className={STEP_ROW_CLASS} data-testid="waiting-orb">
      <ThinkingOrb state="solving" size={20} aria-label="Working on your question" />
      <Shimmer>{label}</Shimmer>
    </div>
  );
}
