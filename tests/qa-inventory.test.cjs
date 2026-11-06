const test = require('node:test');
const assert = require('node:assert/strict');
require('../expiry-lot-engine.js');
require('../smartstore-inventory-engine.js');
const C = require('../container-inbound-engine.js');
const E = globalThis.ExpiryLotEngine;
const S = globalThis.SmartstoreInventoryEngine;
const header = ['바코드', '수량', '제조일자', '유통기한'];
test('expiry dates accept unpadded dates and reject invalid calendar days', () => {
  assert.equal(E.parseDate('2026-2-3'), '2026-02-03');
  assert.equal(E.parseDate('2026-02-30'), '');
  assert.equal(C.parseDateText('2026-02-301'), '');
});
test('lot import rejects invalid rows instead of silently changing totals', () => {
  for (const quantity of [1.5, -1, 'bad']) {
    assert.equal(E.parseContainerLots([header, ['001', quantity]], {fileName:'20261105.xlsx'}).ok, false);
  }
  assert.equal(E.parseContainerLots([header, ['001', 2, '2026-02-30']], {}).ok, false);
  assert.equal(E.parseContainerLots([header, ['001', 2, '2026-01-01', '2026-02-01']], {}).ok, false);
  assert.equal(E.parseContainerLots([header, ['001', 2], ['합계', 'bad']], {}).ok, false);
  assert.equal(E.parseContainerLots([header, ['001', 2]], {defaultManufacturedDate:'bad'}).ok, false);
});
test('valid import keeps leading zero barcodes and blank dates', () => {
  const result = E.parseContainerLots([header, ['001.0', 2], ['합계', 2]], {fileName:'20261105.xlsx'});
  assert.equal(result.ok, true);
  assert.equal(result.lots[0].barcode, '001');
  assert.equal(result.missingDates, 1);
});
test('FIFO consumes blank expiry first, then earliest expiry, and bounds allocation', () => {
  const lots = [
    {id:'late', barcode:'001', quantity:3, expiryDate:'2028-01-01'},
    {id:'early', barcode:'001', quantity:3, expiryDate:'2027-01-01'},
    {id:'blank', barcode:'001', quantity:3, expiryDate:''},
  ];
  assert.deepEqual(E.allocateRemainingLots(lots, {' 001.0 ':4}).map(l=>[l.id,l.remainingQuantity]), [['early',1],['late',3]]);
  assert.equal(E.summarizeStockAllocation(lots, {' 001.0 ':12}).byBarcode['001'].expiryUnassigned, 3);
  assert.deepEqual(E.allocateRemainingLots([{barcode:'001',quantity:Infinity}], {'001':10}), []);
  assert.deepEqual(E.allocateRemainingLots(lots, {'001':Infinity}), []);
});
test('reservation import uses consistent barcode identities', () => {
  const products = [{바코드:' 001.0 ', 현재고:10}];
  const result = S.parseReservationRows([['바코드','전용수량'],['001',3]], products);
  assert.equal(result.ok, true);
  assert.equal(S.getReservedQuantity([{productCode:'001.0',quantity:3}],products[0]),3);
});
test('availability stays finite and never reports negative available units', () => {
  const product = {바코드:'001',현재고:2};
  assert.equal(S.summarizeAvailability(product,[{productCode:'001',quantity:3}]).regularAvailable,0);
  assert.equal(S.getReservedQuantity([{productCode:'001',quantity:Infinity}],product),0);
  assert.equal(S.validateReservation({productCode:'001',quantity:true},product).ok,false);
});
test('container rows reject malformed and fractional piece quantities', () => {
  const headers = ['바코드','상품명','박스수량','낱개수량','입수','제조일자'];
  for (const quantity of ['2oops',1.5,-1,'']) {
    assert.equal(C.parseContainerInboundRows([headers,['001','juice',1,quantity,12,'2026-01-01']]).length,0);
  }
  assert.equal(C.parseContainerInboundRows([headers,['001','juice',1,'1,200',12,'2026-01-01']])[0].낱개수량,1200);
});
test('container derived expiry follows 18 months minus one day at month end', () => {
  const headers = ['바코드','상품명','박스수량','낱개수량','입수','제조일자'];
  for (const date of ['2026-01-31','2024-08-31','2024-02-29']) {
    const row = C.parseContainerInboundRows([headers,['001','juice',1,12,12,date]])[0];
    assert.equal(row.유통기한,E.expiryFromManufactured(date));
  }
});
test('batch dates preserve each existing lot date pair', () => {
  const lots = [{barcode:'001',expiryDate:'2027-07-31',manufacturedDate:''}];
  const result = E.applyBatchDatesToLots(lots,'2026-01-01','');
  assert.equal(result[0].manufacturedDate,E.manufacturedFromExpiry('2027-07-31'));
});
test('vendor balances share stock, preserve consumption, and default legacy rows to Smartstore', () => {
  const product = {바코드:'001',현재고:10};
  const original = [{productCode:'001',quantity:6}];
  const add = S.mergeReservations(original, [{productCode:'001',vendor:'직영몰',quantity:4}], [product]);
  assert.equal(add.ok,true);
  assert.equal(S.summarizeAvailability(product,add.reservations).regularAvailable,0);
  assert.equal(S.mergeReservations(add.reservations,[{productCode:'001',vendor:'직영몰',quantity:5}],[product]).ok,false);
  const used = S.consumeReservation(add.reservations,'001','스마트스토어',6);
  assert.equal(used.ok,true);
  assert.equal(used.reservations.length,2);
  assert.equal(S.reservationBalance(used.reservations[0]).remaining,0);
  assert.equal(S.reservationBalance(used.reservations[0]).consumed,6);
  assert.equal(S.consumeReservation(used.reservations,'001','스마트스토어',1).ok,false);
  assert.equal(S.summarizeAvailability(product,used.reservations).regularAvailable,0);
  assert.equal(S.mergeReservations(used.reservations,[{productCode:'001',quantity:3}],[product]).ok,false);
  const renewed = S.mergeReservations(used.reservations,[{productCode:'001',quantity:3}],[{...product,현재고:13}]);
  assert.deepEqual(S.reservationBalance(renewed.reservations[0]),{registered:9,consumed:6,remaining:3});
});
test('lot consumption preserves the lot and decreases only its remaining units', () => {
  const lots = [{id:'a',barcode:'001',quantity:5,expiryDate:'2026-11-06'},{id:'b',barcode:'001',quantity:5,expiryDate:'2026-12-06'}];
  const stock = {'001':7};
  assert.equal(E.consumeLot(lots,stock,'a',3).ok,false);
  const used = E.consumeLot(lots,stock,'a',2);
  assert.equal(used.ok,true);
  assert.equal(used.lots.length,2);
  assert.equal(used.lots[0].consumedQuantity,2);
  assert.deepEqual(E.allocateRemainingLots(used.lots,stock).map(l=>[l.id,l.remainingQuantity]),[['b',5]]);
  assert.equal(E.expiryStatus('2026-11-05','2026-11-06'),'expired');
  assert.equal(E.expiryStatus('2026-11-06','2026-11-06'),'near');
  assert.equal(E.expiryStatus('2026-12-06','2026-11-06'),'near');
  assert.equal(E.expiryStatus('2026-12-07','2026-11-06'),'normal');
});
