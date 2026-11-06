const assert = require('node:assert/strict');
const Engine = require('../inbound-table-engine.js');
const rows = [
 {바코드:'demo-zero',상품명:'데모 간식',대분류:'간식',현재고:0},
 {바코드:'demo-negative',상품명:'데모 하네스',대분류:'하네스',현재고:-3},
 {바코드:'demo-positive',상품명:'데모 의류',대분류:'의류',현재고:8,품절일자:'2026-11-01'},
 {바코드:'demo-discontinued',상품명:'데모 단종 간식',대분류:'간식',현재고:0,단종:'단종'},
];
assert.deepEqual(Engine.filterRowsByCategories(rows, [], {mode:'soldout'}), rows, 'no category should show every supplied soldout row');
assert.deepEqual(Engine.filterRowsByCategories(rows, ['현재고0'], {mode:'soldout'}).map(r=>r.바코드), ['demo-zero']);
assert.deepEqual(Engine.filterRowsByCategories(rows, ['단종'], {mode:'soldout'}).map(r=>r.바코드), ['demo-discontinued']);
assert.deepEqual(Engine.filterRowsByCategories(rows, [], {mode:'inbound'}).map(r=>r.바코드), ['demo-negative','demo-positive'], 'inbound default must stay unchanged');
console.log('Soldout category regression checks passed');
