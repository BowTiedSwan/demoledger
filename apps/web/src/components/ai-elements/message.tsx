import { code } from '@streamdown/code';
import type { ComponentProps, HTMLAttributes } from 'react';
import { type Components, defaultRehypePlugins, Streamdown, type StreamdownProps } from 'streamdown';
import { cn } from '@/lib/utils';

export function Message({
  from,
  className,
  ...props
}: HTMLAttributes<HTMLDivElement> & { from: 'user' | 'assistant' }) {
  return (
    <div
      data-from={from}
      className={cn(
        'group flex w-full max-w-3xl flex-col gap-2',
        from === 'user' ? 'ml-auto items-end' : 'items-start',
        className,
      )}
      {...props}
    />
  );
}

export function MessageContent({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        'flex w-full min-w-0 flex-col gap-3 text-base',
        // User question: a right-aligned rounded bubble on a muted background.
        // Assistant answer: no box, no border, plain text on the page.
        'group-data-[from=user]:w-fit group-data-[from=user]:max-w-[85%] group-data-[from=user]:rounded-3xl group-data-[from=user]:bg-muted group-data-[from=user]:px-5 group-data-[from=user]:py-3',
        className,
      )}
      {...props}
    />
  );
}

/** Only same-origin absolute paths ("/transactions?id=...") are links; "//host" is protocol-relative. */
export function isSameOriginPath(href: string | undefined): href is string {
  return typeof href === 'string' && href.startsWith('/') && !href.startsWith('//') && !href.includes('\\');
}

/**
 * Model output is untrusted. Images are never loaded (a remote image URL is a data-exfiltration
 * channel), and links are limited to same-origin paths. Enforced twice: harden options for the
 * rehype pass, plus component overrides in case the plugin config changes.
 */
const hardenPlugin = defaultRehypePlugins.harden;
type RehypePlugins = NonNullable<StreamdownProps['rehypePlugins']>;
const origin = typeof window === 'undefined' ? 'http://localhost' : window.location.origin;
const hardenedRehypePlugins = [
  defaultRehypePlugins.raw,
  defaultRehypePlugins.sanitize,
  [
    Array.isArray(hardenPlugin) ? hardenPlugin[0] : hardenPlugin,
    {
      allowedImagePrefixes: [],
      allowedLinkPrefixes: [origin],
      allowedProtocols: [],
      defaultOrigin: origin,
      allowDataImages: false,
    },
  ],
] as RehypePlugins;

const safeComponents: Components = {
  img: ({ alt }) => (alt ? <span className="text-muted-foreground">[image removed: {alt}]</span> : null),
  a: ({ href, children }) =>
    isSameOriginPath(href) ? (
      <a href={href} className="underline underline-offset-4">
        {children}
      </a>
    ) : (
      <span>{children}</span>
    ),
};

/** Markdown answer. Streamdown tolerates unterminated markdown while the answer streams in. */
export function MessageResponse({ className, children, ...props }: ComponentProps<typeof Streamdown>) {
  return (
    <Streamdown
      plugins={{ code }}
      rehypePlugins={hardenedRehypePlugins}
      components={safeComponents}
      className={cn('[&>*:first-child]:mt-0 [&>*:last-child]:mb-0 break-words', className)}
      {...props}
    >
      {children}
    </Streamdown>
  );
}
