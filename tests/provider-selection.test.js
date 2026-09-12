import test from 'node:test';
import assert from 'node:assert/strict';
import { PROVIDERS, RECOMMENDED_RAIL, productionGate } from '../src/provider-selection.js';

test('Flaunch is selected for the combined no-gas and throughput target', () => {
  const flaunch = PROVIDERS.find(provider => provider.id === RECOMMENDED_RAIL);
  assert.equal(RECOMMENDED_RAIL, 'flaunch');
  assert.equal(flaunch.serviceFunded, true);
  assert.equal(flaunch.documentedRatePerHour, 120);
});

test('Bankr cannot meet the required throughput', () => {
  const bankr = PROVIDERS.find(provider => provider.id === 'bankr');
  assert.equal(bankr.documentedRatePerHour, 0.125);
  assert.match(bankr.reason, /three counted launches/);
});

test('selected rail stays blocked until both missing economic capabilities are verified', () => {
  assert.equal(productionGate('flaunch').allowed, false);
  assert.equal(productionGate('flaunch', { founderAllocationVerified: true }).allowed, false);
  assert.equal(productionGate('flaunch', { founderAllocationVerified: true, payoutsVerified: true }).allowed, true);
  assert.equal(productionGate('bankr', { founderAllocationVerified: true, payoutsVerified: true }).allowed, false);
});
