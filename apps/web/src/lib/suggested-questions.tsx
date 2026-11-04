import { createContext, type ReactNode, useContext, useEffect, useState } from 'react';
import { suggestedQuestions } from './chat-parts';
import { listWalletIds } from './transactions-api';

const genericQuestions = suggestedQuestions([]);
const SuggestedQuestionsContext = createContext<readonly string[]>(genericQuestions);

/** Mounted with a key for the signed-in identity; one lookup shared by both suggestion surfaces. */
export function SuggestedQuestionsProvider({ children }: { children: ReactNode }) {
  const [questions, setQuestions] = useState<readonly string[]>(genericQuestions);
  useEffect(() => {
    let cancelled = false;
    void listWalletIds()
      .then((wallets) => {
        if (!cancelled) setQuestions(suggestedQuestions(wallets));
      })
      .catch(() => {
        // Generic questions remain usable when the wallet lookup is unavailable.
      });
    return () => {
      cancelled = true;
    };
  }, []);
  return (
    <SuggestedQuestionsContext.Provider value={questions}>{children}</SuggestedQuestionsContext.Provider>
  );
}

export function useSuggestedQuestions() {
  return useContext(SuggestedQuestionsContext);
}
