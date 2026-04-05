import { useEffect } from 'react';

type MessageHandler = (message: Record<string, unknown>) => void;

export function useChromeMessage(handler: MessageHandler) {
  useEffect(() => {
    const listener = (message: Record<string, unknown>) => {
      handler(message);
    };
    chrome.runtime.onMessage.addListener(listener);
    return () => chrome.runtime.onMessage.removeListener(listener);
  }, [handler]);
}

export async function sendMessage<T>(
  message: Record<string, unknown>,
): Promise<T> {
  return chrome.runtime.sendMessage(message);
}
