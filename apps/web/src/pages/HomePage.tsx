import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { createGuestSession } from '../features/auth/api';
import { ApiRequestError } from '../shared/api-client';
import { config } from '../shared/config';

const BOT_NAME_PLACEHOLDERS = new Set(['', 'change_me', 'your_bot_name']);

function PlayIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className="entry-action__icon">
      <path d="m7.2 4.5 11.4 7.1c.8.5.8 1.7 0 2.2L7.2 21c-.9.6-2.1-.1-2.1-1.2V5.7c0-1.1 1.2-1.8 2.1-1.2Z" />
    </svg>
  );
}

function TelegramIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className="entry-action__icon">
      <path d="M21 3.8 17.7 20c-.2 1-1.4 1.3-2.1.8l-4.8-3.5-2.2 2.1c-.5.5-1.4.2-1.4-.6v-3l10.4-9.5L4.9 14.1.3 12.6c-1-.3-1-1.7 0-2.1l18.9-7.3c.9-.4 2 .4 1.8 1.3Z" />
    </svg>
  );
}

export function HomePage() {
  const navigate = useNavigate();
  const [isCreatingGuest, setIsCreatingGuest] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const normalizedBotName = config.telegramBotName.replace(/^@/, '').toLowerCase();
  const telegramLinkAvailable = !BOT_NAME_PLACEHOLDERS.has(normalizedBotName);

  async function playAsGuest() {
    if (isCreatingGuest) return;
    setIsCreatingGuest(true);
    setError(null);

    try {
      await createGuestSession();
      // Сессия хранится API в HttpOnly cookie, поэтому в адресную строку и
      // localStorage ничего чувствительного не попадает.
      // Представление /game выбирается самим Shell по реальному контексту
      // (Telegram Mini App или размер окна), а не URL-параметром, которому
      // нельзя доверять как источнику прав или типа устройства.
      navigate('/game');
    } catch (requestError) {
      setError(
        requestError instanceof ApiRequestError && requestError.status === 429
          ? 'Слишком много попыток. Попробуйте позже.'
          : 'Не удалось создать гостевую сессию. Проверьте подключение к API.',
      );
    } finally {
      setIsCreatingGuest(false);
    }
  }

  function playInTelegram() {
    if (!telegramLinkAvailable) return;
    window.location.assign(`https://t.me/${normalizedBotName}?startapp=play`);
  }

  return (
    <main className="entry-page min-h-dvh" aria-labelledby="entry-title">
      <section className="entry-phone" aria-labelledby="entry-title">
        <div className="entry-phone__content">
          <header className="entry-hero">
            <h1 id="entry-title" className="sr-only">Crazy Cash</h1>
            <div className="entry-logo" aria-hidden="true">
              <img src="/logo_amim.webp" alt="" />
            </div>
          </header>

          <section className="entry-actions" aria-labelledby="entry-actions-title">
            <h2 id="entry-actions-title" className="sr-only">Game launch options</h2>
            <button
              className="entry-action entry-action--telegram"
              type="button"
              onClick={playInTelegram}
              disabled={!telegramLinkAvailable || isCreatingGuest}
            >
              <TelegramIcon />
              <span>PLAY IN TELEGRAM</span>
            </button>
            <button
              className="entry-action entry-action--guest"
              type="button"
              onClick={() => void playAsGuest()}
              disabled={isCreatingGuest}
            >
              <PlayIcon />
              <span>{isCreatingGuest ? 'CREATING SESSION…' : 'PLAY IN BROWSER'}</span>
            </button>
          </section>

          <div className="entry-feedback" aria-live="polite" aria-atomic="true">
            {!telegramLinkAvailable ? (
              <p className="entry-hint">Telegram launch will be available after the bot username is configured.</p>
            ) : null}
            {error ? <p className="entry-error" role="alert">{error}</p> : null}
          </div>

          <footer className="entry-footer">
            <Link to="/terms" className="entry-terms">TERMS AND CONDITIONS</Link>
          </footer>
        </div>
      </section>
    </main>
  );
}
