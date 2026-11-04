// @vitest-environment jsdom
import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SuggestedQuestionsProvider, useSuggestedQuestions } from './suggested-questions';
import { listWalletIds } from './transactions-api';

vi.mock('./transactions-api', () => ({ listWalletIds: vi.fn() }));
afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});

function Questions() {
  return (
    <div>
      {useSuggestedQuestions().map((q) => (
        <p key={q}>{q}</p>
      ))}
    </div>
  );
}

describe('organization-scoped suggestions', () => {
  it('drops old organization results, including an in-flight response after switching identity', async () => {
    let finishAlpha!: (wallets: string[]) => void;
    vi.mocked(listWalletIds)
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            finishAlpha = resolve;
          }),
      )
      .mockResolvedValueOnce(['WALLET-B-001', 'WALLET-B-002']);
    const view = render(
      <SuggestedQuestionsProvider key="alpha">
        <Questions />
      </SuggestedQuestionsProvider>,
    );
    expect(screen.queryByText(/WALLET-/)).toBeNull();
    view.rerender(
      <SuggestedQuestionsProvider key="beta">
        <Questions />
      </SuggestedQuestionsProvider>,
    );
    await screen.findByText('Why did wallet WALLET-B-001 have failed transactions?');
    await act(async () => finishAlpha(['WALLET-A-001', 'WALLET-A-002']));
    expect(screen.queryByText(/WALLET-A-/)).toBeNull();
    expect(screen.getByText('Summarize recent activity for WALLET-B-002.')).toBeTruthy();
  });

  it('keeps generic suggestions usable when the wallet lookup fails', async () => {
    vi.mocked(listWalletIds).mockRejectedValue(new Error('offline'));
    await act(async () => {
      render(
        <SuggestedQuestionsProvider>
          <Questions />
        </SuggestedQuestionsProvider>,
      );
    });
    expect(screen.queryByText(/WALLET-/)).toBeNull();
    expect(screen.getByText('How many failed transactions occurred yesterday?')).toBeTruthy();
  });
});
