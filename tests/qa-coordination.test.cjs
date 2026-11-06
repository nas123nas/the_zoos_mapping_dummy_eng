const assert = require('node:assert/strict');
const test = require('node:test');
const memory = new Map();
global.localStorage = {getItem:key=>memory.get(key)||null,setItem:(key,value)=>memory.set(key,value)};
const engine = require('../inbound-coordination-engine.js');
test('clear restores original remarks and removes coordination ownership', () => {
  engine.clearAll();
  const log=engine.addLog({barcode:'1',confirmedDate:'2026-11-10'});
  const original={바코드:'1','비고(확정일)':'수입 원본 메모',다음입고:'2026-11-20'};
  let row=engine.applyConfirmedToSchedule([original]).rows[0];
  assert.equal(row['비고(확정일)'],'2026-11-10');
  row=engine.applyConfirmedToSchedule([row]).rows[0];
  engine.updateLog(log.id,{confirmedDate:''});
  row=engine.applyConfirmedToSchedule([row]).rows[0];
  assert.equal(row['비고(확정일)'],'수입 원본 메모');
  assert.equal(Object.hasOwn(row,'비고(확정일-담당자)'),false);
  assert.equal(row._coordinationOverride,undefined);
});
test('delete restores prior remarks while preserving a later manual change', () => {
  engine.clearAll();
  const log=engine.addLog({barcode:'2',confirmedDate:'2026-11-10'});
  let row=engine.applyConfirmedToSchedule([{바코드:'2','비고(확정일)':'원본','비고(확정일-담당자)':'구 원본'}]).rows[0];
  row['비고(확정일)']='수동 수정';
  engine.removeLog(log.id);
  row=engine.applyConfirmedToSchedule([row]).rows[0];
  assert.equal(row['비고(확정일)'],'수동 수정');
  assert.equal(row['비고(확정일-담당자)'],'구 원본');
  assert.equal(row._coordinationOverride,undefined);
});
test('date edits and JSON persistence retain the original pre-coordination remark', () => {
  engine.clearAll();
  const log=engine.addLog({barcode:'4',confirmedDate:'2026-11-10'});
  let row=engine.applyConfirmedToSchedule([{바코드:'4','비고(확정일)':'업로드 메모'}]).rows[0];
  engine.updateLog(log.id,{confirmedDate:'2026-11-12'});
  row=engine.applyConfirmedToSchedule([JSON.parse(JSON.stringify(row))]).rows[0];
  assert.equal(row['비고(확정일)'],'2026-11-12');
  engine.removeLog(log.id);
  row=engine.applyConfirmedToSchedule([row]).rows[0];
  assert.equal(row['비고(확정일)'],'업로드 메모');
});
test('a cleared latest log does not revive older confirmed dates or touch unowned rows', () => {
  engine.clearAll();
  engine.saveLogs([
    {id:'new',barcode:'3',confirmedDate:'',updatedAt:'2026-11-05 11:00:00'},
    {id:'old',barcode:'3',confirmedDate:'2026-11-10',updatedAt:'2026-11-04 11:00:00'},
  ]);
  const row={바코드:'3','비고(확정일)':'직접 입력'};
  assert.deepEqual(engine.applyConfirmedToSchedule([row]).rows,[row]);
});
