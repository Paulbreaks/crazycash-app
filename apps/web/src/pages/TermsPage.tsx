import { Link } from 'react-router-dom';

export function TermsPage() {
  return (
    <main className="entry-page min-h-dvh" aria-labelledby="terms-title">
      <section className="entry-phone">
        <div className="entry-phone__content terms-content">
          <header className="terms-hero">
            <Link to="/" className="entry-logo" aria-label="Crazy Cash home">
              <img src="/logo_amim.webp" alt="Crazy Cash" />
            </Link>
            <h1 id="terms-title">TERMS AND CONDITIONS</h1>
          </header>

          <article className="terms-card">
            <section>
              <h2>ACCEPTANCE</h2>
              <p>By accessing Crazy Cash, creating a session, connecting a wallet, or topping up a balance, you agree to these Terms and Conditions.</p>
            </section>
            <section>
              <h2>GAME MODES</h2>
              <p>FUN mode uses virtual credits with no monetary value. GRAM mode uses balance credited after a confirmed blockchain deposit.</p>
            </section>
            <section>
              <h2>DEPOSITS AND WITHDRAWALS</h2>
              <p>The minimum top-up and withdrawal amounts are 0.1 GRAM. Each transaction is limited to 100 GRAM. Deposits and withdrawals are settled only after blockchain verification.</p>
            </section>
            <section>
              <h2>FINAL GAMEPLAY RESULTS</h2>
              <p>Settled gameplay results are final. GRAM spent or lost during gameplay cannot be reversed, refunded, or exchanged after settlement.</p>
            </section>
            <section>
              <h2>SUPPORT AND CHANGES</h2>
              <p>Contact the project operator through the configured support channel for a payment issue. Continued use after an update means acceptance of the revised terms.</p>
            </section>
          </article>
        </div>
      </section>
    </main>
  );
}
