export interface ParsedStream {
  chunks: Record<string, unknown>[];
  text: string;
  dataParts: Record<string, unknown>[];
  sources: string[];
}

/** Parse a UI message stream (SSE) response body into chunks. Used by tests and scripts. */
export async function parseUiStream(res: Response): Promise<ParsedStream> {
  const raw = await res.text();
  const chunks = raw
    .split('\n')
    .filter((l) => l.startsWith('data: ') && !l.includes('[DONE]'))
    .map((l) => JSON.parse(l.slice(6)) as Record<string, unknown>);
  return {
    chunks,
    text: chunks
      .filter((c) => c.type === 'text-delta')
      .map((c) => c.delta as string)
      .join(''),
    dataParts: chunks.filter((c) => typeof c.type === 'string' && c.type.startsWith('data-')),
    sources: chunks.filter((c) => c.type === 'source-url').map((c) => c.sourceId as string),
  };
}
