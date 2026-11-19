import { useTonConnectUI } from '@tonconnect/ui-react';

export function useTonWalletAddress() {
  const [tonConnectUI] = useTonConnectUI();
  return tonConnectUI.wallet?.account.address ?? null;
}
