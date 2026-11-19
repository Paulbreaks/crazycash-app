import { useEffect, useMemo, useState } from 'react';
import {
  getSlot777Simulation,
  getSlot777Spin,
  getSlot777Theory,
  type Slot777Simulation,
  type Slot777Spin,
  type Slot777Theory,
} from '../features/slot777/api';

const WEIGHT_TOTAL = 1_000_000;
const SIMULATION_PRESETS = [10_000, 100_000, 1_000_000] as const;

function formatPercentFromBasisPoints(value: number, digits = 2) {
  return `${(value / 100).toFixed(digits)}%`;
}

function formatNumber(value: number) {
  return new Intl.NumberFormat('en-US').format(value);
}

function ruleTitle(rule: string) {
  return rule === 'no_win' ? 'NO WIN' : rule;
}

function expectedRtpContribution(weight: number, multiplier: number) {
  return (weight * multiplier * 100) / WEIGHT_TOTAL;
}

export function DevPage() {
  const [theory, setTheory] = useState<Slot777Theory | null>(null);
  const [lastSpin, setLastSpin] = useState<Slot777Spin | null>(null);
  const [simulation, setSimulation] = useState<Slot777Simulation | null>(null);
  const [isLoadingTheory, setIsLoadingTheory] = useState(true);
  const [isSpinning, setIsSpinning] = useState(false);
  const [isSimulating, setIsSimulating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let isCurrent = true;

    void getSlot777Theory()
      .then((result) => {
        if (isCurrent) setTheory(result);
      })
      .catch(() => {
        if (isCurrent) setError('Could not load the game mathematics from the API.');
      })
      .finally(() => {
        if (isCurrent) setIsLoadingTheory(false);
      });

    return () => {
      isCurrent = false;
    };
  }, []);

  const totalWeight = useMemo(
    () => theory?.rules.reduce((total, rule) => total + rule.weight, 0) ?? 0,
    [theory],
  );
  const calculatedRtp = useMemo(
    () => theory?.rules.reduce(
      (total, rule) => total + expectedRtpContribution(rule.weight, rule.multiplier),
      0,
    ) ?? 0,
    [theory],
  );

  async function testSpin() {
    if (isSpinning) return;
    setIsSpinning(true);
    setError(null);

    try {
      setLastSpin(await getSlot777Spin());
    } catch {
      setError('Could not request a test spin from the API.');
    } finally {
      setIsSpinning(false);
    }
  }

  async function runSimulation(spins: number) {
    if (isSimulating) return;
    setIsSimulating(true);
    setError(null);

    try {
      setSimulation(await getSlot777Simulation(spins));
    } catch {
      setError('Could not run the RTP simulation.');
    } finally {
      setIsSimulating(false);
    }
  }

  const simulationDelta = simulation && theory
    ? simulation.rtpBasisPoints - theory.targetRtpBasisPoints
    : null;

  return (
    <main className="dev-page page">
      <section className="dev-hero" aria-labelledby="dev-title">
        <p className="dev-eyebrow">CRAZY CASH · GAME MATH</p>
        <h2 id="dev-title">RTP and payout demonstration</h2>
        <p>
          This page reads the current server configuration. Probabilities, result
          selection and simulations come from the API; the browser only displays them.
        </p>
      </section>

      {error ? <p className="dev-error" role="alert">{error}</p> : null}

      <section className="dev-summary-grid" aria-label="Theoretical RTP summary">
        <article>
          <span>THEORETICAL RTP</span>
          <strong>{theory ? formatPercentFromBasisPoints(theory.targetRtpBasisPoints) : '—'}</strong>
          <small>Expected return per 100 credits wagered.</small>
        </article>
        <article>
          <span>HOUSE EDGE</span>
          <strong>{theory ? formatPercentFromBasisPoints(10_000 - theory.targetRtpBasisPoints) : '—'}</strong>
          <small>The complementary expected casino margin.</small>
        </article>
        <article>
          <span>WEIGHT TICKETS</span>
          <strong>{totalWeight ? formatNumber(totalWeight) : '—'}</strong>
          <small>Every spin draws one cryptographically random ticket.</small>
        </article>
        <article>
          <span>CALCULATED RTP</span>
          <strong>{theory ? `${calculatedRtp.toFixed(3)}%` : '—'}</strong>
          <small>Sum of probability × multiplier for every rule.</small>
        </article>
      </section>

      <section className="dev-panel" aria-labelledby="payout-title">
        <div className="dev-panel-heading">
          <div>
            <p className="dev-eyebrow">SERVER PAYTABLE</p>
            <h3 id="payout-title">Combinations and weights</h3>
          </div>
          <span className="dev-badge">{isLoadingTheory ? 'LOADING' : 'LIVE API DATA'}</span>
        </div>

        <div className="dev-table-scroll">
          <table className="dev-table">
            <thead>
              <tr>
                <th>Rule</th>
                <th>Multiplier</th>
                <th>Weight</th>
                <th>Probability</th>
                <th>Combinations</th>
                <th>RTP contribution</th>
              </tr>
            </thead>
            <tbody>
              {theory?.rules.map((rule) => (
                <tr key={rule.rule} className={rule.multiplier === 0 ? 'dev-loss-row' : undefined}>
                  <td><code>{ruleTitle(rule.rule)}</code></td>
                  <td>{rule.multiplier ? `×${rule.multiplier}` : '—'}</td>
                  <td>{formatNumber(rule.weight)}</td>
                  <td>{formatPercentFromBasisPoints(rule.probabilityBasisPoints, 3)}</td>
                  <td>{rule.availableCombinations}</td>
                  <td>{rule.multiplier ? `${expectedRtpContribution(rule.weight, rule.multiplier).toFixed(3)}%` : '0.000%'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <p className="dev-note">
          Overlapping patterns resolve to the highest available multiplier: for example,
          <code> 777 </code> pays ×200 rather than ×10 or ×2; <code>555</code> pays ×100.
        </p>
      </section>

      <section className="dev-tools-grid">
        <article className="dev-panel" aria-labelledby="spin-test-title">
          <p className="dev-eyebrow">RANDOMNESS CHECK</p>
          <h3 id="spin-test-title">Single test spin</h3>
          <p className="dev-copy">Requests one non-persistent outcome. It does not change any account balance.</p>
          <button className="dev-button" type="button" onClick={() => void testSpin()} disabled={isSpinning}>
            {isSpinning ? 'SPINNING…' : 'TEST SPIN'}
          </button>

          {lastSpin ? (
            <dl className="dev-result-grid">
              <div><dt>COMBINATION</dt><dd>{lastSpin.combination}</dd></div>
              <div><dt>RULE</dt><dd>{ruleTitle(lastSpin.rule)}</dd></div>
              <div><dt>MULTIPLIER</dt><dd>{lastSpin.multiplier ? `×${lastSpin.multiplier}` : 'NO WIN'}</dd></div>
            </dl>
          ) : null}
        </article>

        <article className="dev-panel" aria-labelledby="simulation-title">
          <p className="dev-eyebrow">MONTE CARLO CHECK</p>
          <h3 id="simulation-title">RTP simulation</h3>
          <p className="dev-copy">A simulated result will vary around theoretical RTP. It never uses player funds.</p>
          <div className="dev-button-row">
            {SIMULATION_PRESETS.map((spins) => (
              <button
                key={spins}
                className="dev-button dev-button-secondary"
                type="button"
                onClick={() => void runSimulation(spins)}
                disabled={isSimulating}
              >
                {isSimulating ? 'RUNNING…' : formatNumber(spins)}
              </button>
            ))}
          </div>

          {simulation ? (
            <div className="dev-simulation-result">
              <div>
                <span>SIMULATED RTP</span>
                <strong>{formatPercentFromBasisPoints(simulation.rtpBasisPoints)}</strong>
              </div>
              <div>
                <span>DIFFERENCE</span>
                <strong className={simulationDelta !== null && simulationDelta < 0 ? 'dev-negative' : 'dev-positive'}>
                  {simulationDelta === null ? '—' : `${simulationDelta >= 0 ? '+' : ''}${formatPercentFromBasisPoints(simulationDelta)}`}
                </strong>
              </div>
              <div>
                <span>SPINS</span>
                <strong>{formatNumber(simulation.spins)}</strong>
              </div>
            </div>
          ) : null}
        </article>
      </section>
    </main>
  );
}
