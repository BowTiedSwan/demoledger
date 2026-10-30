import { Link } from '@tanstack/react-router';
import { MotionConfig, motion } from 'motion/react';
import { cn } from '@/lib/utils';

const ITEMS = [
  { to: '/assistant', label: 'Assistant' },
  { to: '/transactions', label: 'Transactions' },
] as const;

const linkClass =
  'relative inline-flex min-h-11 items-center rounded-md px-3 text-sm transition-colors text-muted-foreground hover:text-foreground';

/**
 * Line-style navigation. These are routes, so they are links with aria-current="page" (set by the
 * router), not role="tab". Hover changes only the text colour; the active item gets a 2px underline
 * that slides between items (motion layoutId, disabled under reduced motion).
 */
export function NavLinks() {
  return (
    <MotionConfig reducedMotion="user">
      <nav aria-label="Main" className="flex">
        {ITEMS.map((item) => (
          <Link
            key={item.to}
            to={item.to}
            className={linkClass}
            activeProps={{ className: cn(linkClass, 'text-foreground') }}
          >
            {({ isActive }) => (
              <>
                {item.label}
                {isActive ? (
                  <motion.span
                    layoutId="nav-underline"
                    data-nav-indicator=""
                    aria-hidden
                    className="absolute inset-x-3 bottom-0 h-0.5 bg-foreground"
                    transition={{ duration: 0.2, ease: 'easeOut' }}
                  />
                ) : null}
              </>
            )}
          </Link>
        ))}
      </nav>
    </MotionConfig>
  );
}
