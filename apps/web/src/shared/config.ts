export const config = {
  apiBaseUrl: import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:3000',
  telegramBotName: import.meta.env.VITE_TG_BOT_NAME?.trim() ?? '',
};
