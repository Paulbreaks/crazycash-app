import { randomInt } from 'node:crypto';

export const SLOT777_TARGET_RTP_BASIS_POINTS = 9_845.9;
export const SLOT777_WEIGHT_TOTAL = 1_000_000;

export type Slot777RuleId =
  | 'no_win'
  | '0XX'
  | '7XX'
  | '00X'
  | '55X'
  | '77X'
  | '111'
  | '222'
  | '333'
  | '444'
  | '555'
  | '666'
  | '888'
  | '999'
  | '000'
  | '777';

export interface Slot777Spin {
  combination: string;
  digits: readonly [number, number, number];
  multiplier: number;
  rule: Slot777RuleId;
}

export interface Slot777RuleSummary {
  rule: Slot777RuleId;
  multiplier: number;
  weight: number;
  probabilityBasisPoints: number;
  availableCombinations: number;
}

const RULE_MULTIPLIERS: Record<Slot777RuleId, number> = {
  no_win: 0,
  '0XX': 1,
  '7XX': 2,
  '00X': 5,
  '55X': 8,
  '77X': 10,
  '000': 15,
  '111': 20,
  '222': 25,
  '333': 50,
  '444': 30,
  '555': 100,
  '666': 40,
  '888': 60,
  '999': 70,
  '777': 200,
};

// Весы заданы в миллионных долях. Сумма выплат составляет 984 590 тикетов,
// поэтому ожидаемый возврат игроку равен 98,459%.
const RULE_WEIGHTS: Record<Slot777RuleId, number> = {
  no_win: 794_960,
  '0XX': 85_060,
  '7XX': 85_750,
  '00X': 8_500,
  '55X': 8_500,
  '77X': 8_500,
  '000': 873,
  '111': 873,
  '222': 873,
  '333': 873,
  '444': 873,
  '555': 873,
  '666': 873,
  '888': 873,
  '999': 873,
  '777': 873,
};

const RULE_ORDER: readonly Slot777RuleId[] = [
  'no_win',
  '0XX',
  '7XX',
  '00X',
  '55X',
  '77X',
  '000',
  '111',
  '222',
  '333',
  '444',
  '555',
  '666',
  '888',
  '999',
  '777',
];

const EXACT_RULES: Readonly<Record<string, Slot777RuleId>> = {
  '000': '000',
  '111': '111',
  '222': '222',
  '333': '333',
  '444': '444',
  '555': '555',
  '666': '666',
  '777': '777',
  '888': '888',
  '999': '999',
};

function getRuleForDigits(first: number, second: number, third: number): Slot777RuleId {
  const combination = `${first}${second}${third}`;
  const exactRule = EXACT_RULES[combination];
  if (exactRule) return exactRule;

  // Пересекающиеся шаблоны всегда получают наибольший доступный множитель.
  if (first === 7 && second === 7) return '77X';
  if (first === 5 && second === 5) return '55X';
  if (first === 0 && second === 0) return '00X';
  if (first === 7) return '7XX';
  if (first === 0) return '0XX';
  return 'no_win';
}

function buildOutcomesByRule(): Readonly<Record<Slot777RuleId, readonly Slot777Spin[]>> {
  const outcomesByRule = Object.fromEntries(
    RULE_ORDER.map((rule) => [rule, [] as Slot777Spin[]]),
  ) as Record<Slot777RuleId, Slot777Spin[]>;

  for (let first = 0; first < 10; first += 1) {
    for (let second = 0; second < 10; second += 1) {
      for (let third = 0; third < 10; third += 1) {
        const rule = getRuleForDigits(first, second, third);
        outcomesByRule[rule].push({
          combination: `${first}${second}${third}`,
          digits: [first, second, third],
          multiplier: RULE_MULTIPLIERS[rule],
          rule,
        });
      }
    }
  }

  return outcomesByRule;
}

const OUTCOMES_BY_RULE = buildOutcomesByRule();

const WEIGHTED_RULES = (() => {
  let cumulativeWeight = 0;

  return RULE_ORDER.map((rule) => {
    cumulativeWeight += RULE_WEIGHTS[rule];
    return { rule, cumulativeWeight };
  });
})();

if (WEIGHTED_RULES.at(-1)?.cumulativeWeight !== SLOT777_WEIGHT_TOTAL) {
  throw new Error('Slot777 rule weights must add up to the configured total');
}

function pickRule(ticket: number): Slot777RuleId {
  const weightedRule = WEIGHTED_RULES.find((entry) => ticket < entry.cumulativeWeight);
  if (!weightedRule) throw new Error('Slot777 ticket is outside the configured weight range');
  return weightedRule.rule;
}

export function spinSlot777(): Slot777Spin {
  const rule = pickRule(randomInt(SLOT777_WEIGHT_TOTAL));
  const outcomes = OUTCOMES_BY_RULE[rule];
  return outcomes[randomInt(outcomes.length)]!;
}

export function getSlot777RuleSummary(): readonly Slot777RuleSummary[] {
  return RULE_ORDER.map((rule) => ({
    rule,
    multiplier: RULE_MULTIPLIERS[rule],
    weight: RULE_WEIGHTS[rule],
    probabilityBasisPoints: RULE_WEIGHTS[rule] / 100,
    availableCombinations: OUTCOMES_BY_RULE[rule].length,
  }));
}

export function getSlot777TheoreticalRtpBasisPoints(): number {
  const expectedPayoutTickets = RULE_ORDER.reduce(
    (total, rule) => total + RULE_WEIGHTS[rule] * RULE_MULTIPLIERS[rule],
    0,
  );

  return (expectedPayoutTickets * 10_000) / SLOT777_WEIGHT_TOTAL;
}

export function simulateSlot777(spins: number) {
  let totalPayout = 0;
  const resultCounts = Object.fromEntries(RULE_ORDER.map((rule) => [rule, 0])) as Record<
    Slot777RuleId,
    number
  >;

  for (let spin = 0; spin < spins; spin += 1) {
    const result = spinSlot777();
    totalPayout += result.multiplier;
    resultCounts[result.rule] += 1;
  }

  return {
    spins,
    totalStake: spins,
    totalPayout,
    rtpBasisPoints: Math.round((totalPayout * 10_000) / spins),
    resultCounts,
  };
}
