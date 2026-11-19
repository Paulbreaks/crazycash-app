import { initData, miniApp } from '@telegram-apps/sdk';

let bootstrapped = false;

export function initTelegram() {
  if (bootstrapped) return;
  bootstrapped = true;

  try {
    miniApp.mount();
    initData.restore();
  } catch {
    // Local browser mode outside Telegram is expected during development.
  }
}
