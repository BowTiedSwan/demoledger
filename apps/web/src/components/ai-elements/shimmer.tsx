import { cn } from '@/lib/utils';

/** Animated status text. Under reduced motion it falls back to plain muted text (see globals.css). */
export function Shimmer({ children, className }: { children: string; className?: string }) {
  return <span className={cn('shimmer text-sm', className)}>{children}</span>;
}
