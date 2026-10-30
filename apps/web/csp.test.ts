import { describe, expect, it } from 'vitest';
import { buildCsp } from './csp';

describe('buildCsp', () => {
  it('production policy has no inline scripts, no ws and no remote images', () => {
    const csp = buildCsp(false);
    expect(csp).toContain("img-src 'self' data:");
    expect(csp).toContain("connect-src 'self'");
    expect(csp).not.toContain('ws:');
    expect(csp).toMatch(/script-src 'self' 'wasm-unsafe-eval'(;|$)/);
    expect(csp).toContain("object-src 'none'");
  });

  it('dev policy only adds HMR needs', () => {
    const csp = buildCsp(true);
    expect(csp).toContain('ws://localhost:*');
    expect(csp).toContain("'unsafe-inline'");
    expect(csp).toContain("img-src 'self' data:");
  });
});
