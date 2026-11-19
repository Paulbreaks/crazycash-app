import type { PropsWithChildren } from 'react';
import { TelegramProvider } from './TelegramProvider';
import { TonConnectProvider } from './TonConnectProvider';

export function ShellProviders({ children }: PropsWithChildren) {
  return (
    <TelegramProvider>
      <TonConnectProvider>{children}</TonConnectProvider>
    </TelegramProvider>
  );
}
