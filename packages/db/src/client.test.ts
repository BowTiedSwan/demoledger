import { describe, expect, it, vi } from 'vitest';
import { createPool } from './client';

describe('createPool', () => {
  it('handles idle-client errors instead of crashing the process', async () => {
    const onError = vi.fn();
    const pool = createPool('postgres://nobody@127.0.0.1:1/none', { onError });
    const err = new Error('terminating connection due to administrator command');
    expect(() => pool.emit('error', err)).not.toThrow();
    expect(onError).toHaveBeenCalledWith(err);
    await pool.end();
  });

  it('logs by default when no handler is given', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const pool = createPool('postgres://nobody@127.0.0.1:1/none', { applicationName: 'test' });
    expect(() => pool.emit('error', new Error('boom'))).not.toThrow();
    expect(spy).toHaveBeenCalledOnce();
    spy.mockRestore();
    await pool.end();
  });
});
