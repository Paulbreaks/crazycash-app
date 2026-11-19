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
