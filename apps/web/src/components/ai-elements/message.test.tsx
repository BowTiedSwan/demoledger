import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { isSameOriginPath, MessageResponse } from './message';

const render = (md: string) => renderToStaticMarkup(<MessageResponse>{md}</MessageResponse>);

describe('MessageResponse hardening', () => {
  it('renders no external <img> for a remote markdown image', () => {
    const html = render('![x](https://evil.example/a.png)');
    expect(html).not.toMatch(/<img/i);
    expect(html).not.toContain('evil.example');
  });

  it('renders no <img> for data URLs or raw HTML images', () => {
    expect(render('![x](data:image/png;base64,AAAA)')).not.toMatch(/<img/i);
    expect(render('<img src="https://evil.example/a.png">')).not.toMatch(/<img/i);
  });

  it('does not link to external sites', () => {
    const html = render('[click](https://evil.example/x)');
    expect(html).not.toContain('href="https://evil.example');
  });

  it('keeps same-origin transaction links', () => {
    expect(render('[TXN](/transactions?id=TXN-A-0001)')).toContain('href="/transactions?id=TXN-A-0001"');
  });

  it('isSameOriginPath rejects protocol-relative and absolute URLs', () => {
    expect(isSameOriginPath('/transactions')).toBe(true);
    expect(isSameOriginPath('//evil.example')).toBe(false);
    expect(isSameOriginPath('https://evil.example')).toBe(false);
    expect(isSameOriginPath(undefined)).toBe(false);
  });
});
