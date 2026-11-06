const assert = require('node:assert/strict');
const test = require('node:test');
global.PortfolioData = require('../portfolio-data.js');
const memory = new Map();
global.localStorage = {getItem: key => memory.get(key) || null, setItem: (key, value) => memory.set(key, value)};
const ops = require('../ops-dashboard-engine.js');
const inventory = require('../inventory-dashboard-engine.js');
const inbound = require('../inbound-table-engine.js');
test('recent inbound quantity uses the actual inbound source', () => {
  for (const row of PortfolioData.schedule()) {
    assert.equal(inbound.getRecentInboundQuantity(row), String(row.최근입고수량));
  }
  assert.equal(inbound.getRecentInboundQuantity({입고구분:'국내',국내최근입고수량:0,수입최근입고수량:80}), '0');
});
test('transfer rejects invalid or unavailable quantities before saving', () => {
  const sku = '8809911008001';
  for (const qty of [0, -1, 1.5, NaN, Infinity, 24]) {
    assert.throws(() => ops.requestTransfer(sku, qty, '보조창고'));
  }
  assert.deepEqual(ops.loadLocalMovements(), {});
  assert.equal(ops.requestTransfer(sku, 2, '보조창고').qty, 2);
});
test('transfer proposals fit one actual source warehouse', () => {
  for (const row of ops.buildDemoSnapshot().grid) {
    if (row.action !== 'transfer') continue;
    const proposal = ops.getTransferProposal(row);
    const source = {'3PL-가상센터':row.stockTplIcn, '보조창고':row.stockHqB, '이카운트도매':row.stockEcW}[proposal.from];
    assert.ok(Number.isInteger(proposal.qty) && proposal.qty > 0 && proposal.qty <= source);
  }
});
test('imported fixture stock has recent inbound evidence for depletion estimates', () => {
  for (const row of PortfolioData.schedule().filter(row => row.입고구분 === '수입')) {
    const result = inventory.enrichRowsWithDepletionMetrics([row])[0];
    assert.equal(result.inventoryHealth.latestInboundDateLabel, row.최근입고);
    assert.equal(result.inventoryHealth.latestInboundQuantity, row.최근입고수량);
    assert.equal(result.소진량계산가능, true);
  }
});
