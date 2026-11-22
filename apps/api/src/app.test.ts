import assert from 'node:assert/strict';
import test from 'node:test';

Object.assign(process.env, {
  NODE_ENV: 'test',
  API_ORIGIN: 'http://localhost:20069',
  DATABASE_URL: 'mysql://test:test@mysql:3306/crazy_cash',
  TON_RPC_TESTNET_URL: 'https://testnet.toncenter.com/api/v2/jsonRPC',
  TON_RPC_MAINNET_URL: 'https://toncenter.com/api/v2/jsonRPC',
});

test('rejects TON deposit amounts below 0.1 GRAM', async () => {
  const { InvalidDepositAmountError, parseDepositAmount } = await import('./modules/ton/deposits.js');

  assert.equal(parseDepositAmount('0.1'), 100n);
  assert.equal(parseDepositAmount('0.10'), 100n);
  assert.throws(() => parseDepositAmount('0.01'), InvalidDepositAmountError);
});

test('uses decreasing exact-win weights while preserving the configured RTP', async () => {
  const {
    SLOT777_TARGET_RTP_BASIS_POINTS,
    SLOT777_WEIGHT_TOTAL,
    getSlot777RuleSummary,
    getSlot777TheoreticalRtpBasisPoints,
  } = await import('./modules/slot777/engine.js');
  const rules = getSlot777RuleSummary();
  const exactWins = rules
    .filter((rule) => /^\d{3}$/.test(rule.rule))
    .sort((left, right) => left.multiplier - right.multiplier);

  assert.equal(rules.reduce((total, rule) => total + rule.weight, 0), SLOT777_WEIGHT_TOTAL);
  assert.equal(getSlot777TheoreticalRtpBasisPoints(), SLOT777_TARGET_RTP_BASIS_POINTS);

  for (let index = 1; index < exactWins.length; index += 1) {
    assert.ok(exactWins[index - 1]!.weight > exactWins[index]!.weight);
  }
});

test('uses the sanitized Nginx forwarding address for request.ip', async () => {
  const { buildApp } = await import('./app.js');
  const app = buildApp();
  app.get('/__test/request-ip', (request) => ({ ip: request.ip }));
  await app.ready();

  try {
    const response = await app.inject({
      method: 'GET',
      url: '/__test/request-ip',
      headers: { 'x-forwarded-for': '203.0.113.42' },
    });
    assert.equal(response.statusCode, 200);
    assert.deepEqual(response.json(), { ip: '203.0.113.42' });
  } finally {
    await app.close();
  }
});
