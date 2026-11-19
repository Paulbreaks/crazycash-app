import type { PropsWithChildren } from 'react';
import { initTelegram } from '../../features/telegram/init';

initTelegram();

export function TelegramProvider({ children }: PropsWithChildren) {
  return <>{children}</>;
}
