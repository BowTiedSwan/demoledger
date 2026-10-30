import type { Plugin } from 'vite';

/**
 * Content-Security-Policy for the SPA, injected as a <meta> tag so it applies wherever the static
 * files are served. Strict in `build`; the dev policy only adds what Vite's dev server needs
 * (HMR websocket, the inline React Refresh preamble).
 * 'unsafe-inline' for styles is required by Radix/motion/sonner inline style attributes;
 * 'wasm-unsafe-eval' is required by the syntax highlighter.
 */
export function buildCsp(dev: boolean): string {
  const directives: Record<string, string[]> = {
    'default-src': ["'self'"],
    'script-src': ["'self'", "'wasm-unsafe-eval'", ...(dev ? ["'unsafe-inline'"] : [])],
    'style-src': ["'self'", "'unsafe-inline'"],
    'img-src': ["'self'", 'data:'],
    'font-src': ["'self'"],
    'connect-src': ["'self'", ...(dev ? ['ws://localhost:*', 'ws://127.0.0.1:*'] : [])],
    'object-src': ["'none'"],
    'base-uri': ["'self'"],
    'form-action': ["'self'"],
  };
  return Object.entries(directives)
    .map(([k, v]) => `${k} ${v.join(' ')}`)
    .join('; ');
}

export function cspPlugin(): Plugin {
  let dev = true;
  return {
    name: 'demoledger-csp',
    configResolved(config) {
      dev = config.command === 'serve';
    },
    transformIndexHtml() {
      return [
        {
          tag: 'meta',
          attrs: { 'http-equiv': 'Content-Security-Policy', content: buildCsp(dev) },
          injectTo: 'head-prepend',
        },
      ];
    },
  };
}
