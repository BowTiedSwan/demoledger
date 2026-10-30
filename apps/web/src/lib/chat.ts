import { Chat } from '@ai-sdk/react';
import { askDataPartSchemas } from '@demoledger/shared';
import { DefaultChatTransport } from 'ai';
import { useSyncExternalStore } from 'react';
import type { ChatMessage } from './chat-parts';

/**
 * One Chat per signed-in browser session, kept at module scope so the conversation survives
 * navigating to /transactions (via a source link) and back. Reset on sign-in and sign-out.
 * The transient `data-status` parts only reach `onData`; they feed a tiny external store.
 */
let chat: Chat<ChatMessage> | null = null;
/** Server-side history key. In memory only: a page reload starts a new conversation. */
let conversationId = crypto.randomUUID();
let pendingFocus = false;
let statusLabel: string | null = null;
const listeners = new Set<() => void>();

const chatListeners = new Set<() => void>();
const focusListeners = new Set<() => void>();

export function getConversationId(): string {
  return conversationId;
}

function setStatusLabel(next: string | null) {
  if (statusLabel === next) return;
  statusLabel = next;
  for (const l of listeners) l();
}

function createChat(): Chat<ChatMessage> {
  return new Chat<ChatMessage>({
    transport: new DefaultChatTransport({
      api: '/api/ask',
      credentials: 'include',
      // Resolved per request, so a new conversation sends its new ID.
      body: () => ({ conversationId }),
    }),
    dataPartSchemas: askDataPartSchemas,
    onData: (part) => {
      if (part.type === 'data-status') setStatusLabel(part.data.label);
    },
    onFinish: () => setStatusLabel(null),
    onError: () => setStatusLabel(null),
  });
}

export function getChat(): Chat<ChatMessage> {
  chat ??= createChat();
  return chat;
}

/** Stop any stream, drop the messages, and start a new server-side conversation. */
export function resetChat(): void {
  chat?.stop();
  chat = null;
  conversationId = crypto.randomUUID();
  setStatusLabel(null);
  for (const l of chatListeners) l();
}

/** Ask the assistant page to focus its prompt input (now if mounted, else when it mounts). */
export function requestPromptFocus(): void {
  pendingFocus = true;
  for (const l of focusListeners) l();
}

/** Subscribe to focus requests; also consumes one that arrived before mount. */
export function onPromptFocusRequest(cb: () => void): () => void {
  focusListeners.add(cb);
  if (pendingFocus) cb();
  return () => {
    focusListeners.delete(cb);
  };
}

export function consumePromptFocus(): void {
  pendingFocus = false;
}

/** The current Chat; re-renders the caller when a new conversation replaces it. */
export function useChatInstance(): Chat<ChatMessage> {
  return useSyncExternalStore(
    (cb) => {
      chatListeners.add(cb);
      return () => chatListeners.delete(cb);
    },
    getChat,
    getChat,
  );
}

export function clearStatusLabel(): void {
  setStatusLabel(null);
}

/** Latest transient progress label (e.g. "Searching transactions"), or null. */
export function useStatusLabel(): string | null {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => statusLabel,
    () => null,
  );
}
