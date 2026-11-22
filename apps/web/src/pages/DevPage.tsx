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
  return new Intl.NumberFormat('ru-RU').format(value);
}

function ruleTitle(rule: string) {
  return rule === 'no_win' ? 'БЕЗ ВЫИГРЫША' : rule;
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
        if (isCurrent) setError('Не удалось загрузить игровую математику из API.');
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
  const rulesByMultiplier = useMemo(
    () =>
      [...(theory?.rules ?? [])].sort(
        (left, right) => left.multiplier - right.multiplier || left.rule.localeCompare(right.rule),
      ),
    [theory],
  );

  async function testSpin() {
    if (isSpinning) return;
    setIsSpinning(true);
    setError(null);

    try {
      setLastSpin(await getSlot777Spin());
    } catch {
      setError('Не удалось запросить тестовый спин из API.');
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
      setError('Не удалось запустить симуляцию RTP.');
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
        <p className="dev-eyebrow">CRAZY CASH · МАТЕМАТИКА ИГРЫ</p>
        <h2 id="dev-title">RTP лаборатория</h2>
        <p>Страница использует текущую серверную конфигурацию.</p>
      </section>

      {error ? <p className="dev-error" role="alert">{error}</p> : null}

      <section className="dev-summary-grid" aria-label="Сводка теоретического RTP">
        <article>
          <span>ТЕОРЕТИЧЕСКИЙ RTP</span>
          <strong>{theory ? formatPercentFromBasisPoints(theory.targetRtpBasisPoints) : '—'}</strong>
          <small>Ожидаемый возврат на каждые 100 поставленных кредитов.</small>
        </article>
        <article>
          <span>ПРЕИМУЩЕСТВО ИГРЫ</span>
          <strong>{theory ? formatPercentFromBasisPoints(10_000 - theory.targetRtpBasisPoints) : '—'}</strong>
          <small>Обратная величина ожидаемой маржи игры.</small>
        </article>
        <article>
          <span>БИЛЕТЫ ВЕСОВ</span>
          <strong>{totalWeight ? formatNumber(totalWeight) : '—'}</strong>
          <small>Каждый спин выбирает один криптографически случайный билет.</small>
        </article>
        <article>
          <span>РАССЧИТАННЫЙ RTP</span>
          <strong>{theory ? `${calculatedRtp.toFixed(3)}%` : '—'}</strong>
          <small>Сумма вероятность × множитель для каждого правила.</small>
        </article>
      </section>

      <section className="dev-panel" aria-labelledby="payout-title">
        <div className="dev-panel-heading">
          <div>
            <p className="dev-eyebrow">ТАБЛИЦА ВЫПЛАТ СЕРВЕРА</p>
            <h3 id="payout-title">Комбинации и веса</h3>
          </div>
          <span className="dev-badge">{isLoadingTheory ? 'ЗАГРУЗКА' : 'АКТУАЛЬНЫЕ ДАННЫЕ API'}</span>
        </div>

        <div className="dev-table-scroll">
          <table className="dev-table">
            <thead>
              <tr>
                <th>Правило</th>
                <th>Множитель</th>
                <th>Вес</th>
                <th>Вероятность</th>
                <th>Комбинации</th>
                <th>Вклад в RTP</th>
              </tr>
            </thead>
            <tbody>
              {rulesByMultiplier.map((rule) => (
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
          Пересекающиеся паттерны используют наибольший доступный множитель: например,
          <code> 777 </code> выплачивает ×200 вместо ×10 или ×2; <code>555</code> — ×100.
        </p>
      </section>

      <section className="dev-tools-grid">
        <article className="dev-panel" aria-labelledby="spin-test-title">
          <p className="dev-eyebrow">ПРОВЕРКА СЛУЧАЙНОСТИ</p>
          <h3 id="spin-test-title">Одиночный тестовый спин</h3>
          <button className="dev-button" type="button" onClick={() => void testSpin()} disabled={isSpinning}>
            {isSpinning ? 'ВРАЩЕНИЕ…' : 'ТЕСТОВЫЙ СПИН'}
          </button>

          {lastSpin ? (
            <dl className="dev-result-grid">
              <div><dt>КОМБИНАЦИЯ</dt><dd>{lastSpin.combination}</dd></div>
              <div><dt>ПРАВИЛО</dt><dd>{ruleTitle(lastSpin.rule)}</dd></div>
              <div><dt>МНОЖИТЕЛЬ</dt><dd>{lastSpin.multiplier ? `×${lastSpin.multiplier}` : 'БЕЗ ВЫИГРЫША'}</dd></div>
            </dl>
          ) : null}
        </article>

        <article className="dev-panel" aria-labelledby="simulation-title">
          <p className="dev-eyebrow">ПРОВЕРКА МОНТЕ-КАРЛО</p>
          <h3 id="simulation-title">Симуляция RTP</h3>
          <div className="dev-button-row">
            {SIMULATION_PRESETS.map((spins) => (
              <button
                key={spins}
                className="dev-button dev-button-secondary"
                type="button"
                onClick={() => void runSimulation(spins)}
                disabled={isSimulating}
              >
                {isSimulating ? 'РАСЧЁТ…' : formatNumber(spins)}
              </button>
            ))}
          </div>

          {simulation ? (
            <div className="dev-simulation-result">
              <div>
                <span>СИМУЛИРОВАННЫЙ RTP</span>
                <strong>{formatPercentFromBasisPoints(simulation.rtpBasisPoints)}</strong>
              </div>
              <div>
                <span>ОТКЛОНЕНИЕ</span>
                <strong className={simulationDelta !== null && simulationDelta < 0 ? 'dev-negative' : 'dev-positive'}>
                  {simulationDelta === null ? '—' : `${simulationDelta >= 0 ? '+' : ''}${formatPercentFromBasisPoints(simulationDelta)}`}
                </strong>
              </div>
              <div>
                <span>СПИНЫ</span>
                <strong>{formatNumber(simulation.spins)}</strong>
              </div>
            </div>
          ) : null}
        </article>
      </section>
    </main>
  );
}
