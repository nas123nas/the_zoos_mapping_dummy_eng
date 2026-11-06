const test = require('node:test');
const assert = require('node:assert/strict');
const E = require('../mapping-engine.js');
const row = (overrides = {}) => ({orderNo:'A', groupNo:'1', productText:'치킨 스틱', optionText:'', sourceText:'치킨 스틱', mappedProduct:'치킨 스틱', mappedQuantity:1, orderQuantity:1, ...overrides});

test('box quantities use pack size from the mapped product', () => {
  const result = E.judgeMappings([row({sourceText:'치킨 스틱 2박스', mappedProduct:'치킨 스틱 12개입', mappedQuantity:24})])[0];
  assert.equal(result.expectedQuantity, 24);
  assert.equal(result.quantityPass, true);
});
test('explicit option mismatch is not hidden by matching product words', () => {
  const result = E.judgeMappings([row({optionText:'맛: 오리', sourceText:'치킨 스틱 | 맛: 오리', mappedProduct:'치킨 스틱 닭고기'})])[0];
  assert.match(result.productDecision, /^상품 불일치/);
  assert.equal(result.finalStatus, '확인 필요');
});
test('another grouped product cannot satisfy the current product option', () => {
  const results = E.judgeMappings([
    row({productText:'간식', optionText:'맛: 오리', sourceText:'간식 | 맛: 오리', mappedProduct:'치킨 스틱'}),
    row({productText:'간식', sourceText:'간식 | 맛: 오리', mappedProduct:'오리 스틱'})
  ]);
  assert.match(results[0].productDecision, /^상품 불일치/);
});
test('a new group with missing sales information does not inherit the previous order', () => {
  const results = E.normalizeRows([['NO','판매상품 정보','연결된 상품명'], ['1','판매처\n123456\n치킨 스틱','치킨 스틱'], ['','', '오리 스틱'], ['2','', '치킨 스틱']]);
  assert.equal(results[1].orderNo, '123456');
  assert.equal(results[2].orderNo, '');
  assert.equal(results[2].sourceText, '');
});
test('piece, box, and explicit quantity comparisons remain correct', () => {
  for (const [sourceText, mappedProduct, mappedQuantity, expected] of [
    ['치킨 스틱 x 12개','치킨 스틱',12,12],
    ['치킨 스틱 2박스(12개입)','치킨 스틱',24,24],
    ['치킨 스틱 12개입','치킨 스틱',1,1],
    ['터키츄 2박스','터키츄',80,80],
    ['치킨 스틱 3개','치킨 스틱',2,3]
  ]) {
    const result = E.judgeMappings([row({sourceText,mappedProduct,mappedQuantity})])[0];
    assert.equal(result.expectedQuantity, expected, sourceText);
    assert.equal(result.quantityPass, mappedQuantity === expected, sourceText);
  }
});
test('empty input, missing mappings, and learning application retain review behavior', () => {
  assert.deepEqual(E.judgeMappings([]), []);
  assert.throws(() => E.normalizeRows([]), /행이 없습니다/);
  assert.throws(() => E.normalizeRows([['미지원']]), /지원하지 않는/);
  const original = row({mappedProduct:'', mappedQuantity:0});
  assert.equal(E.judgeMappings([original])[0].finalStatus,'확인 필요');
  const learned = E.judgeMappings([original], [{id:'L1',sourceText:'치킨 스틱',mappedProduct:'치킨 스틱',quantity:1}])[0];
  assert.equal(learned.learningApplied,true);
  assert.equal(learned.finalStatus,'정상');
  assert.equal(original.mappedProduct,'');
});

test('a mapped product without order text cannot be classified as normal', () => {
  const result = E.judgeMappings([row({productText:'', optionText:'', sourceText:''})])[0];
  assert.match(result.productDecision, /^상품 불일치/);
  assert.equal(result.finalStatus, '확인 필요');
});
