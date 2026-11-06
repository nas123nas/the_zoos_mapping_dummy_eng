const test = require('node:test');
const assert = require('node:assert/strict');
const S = require('../workspace-storage.js');

test('saved master versions retain their own catalogs while omitting raw file payloads', () => {
  const current = {id:'new', name:'new.xlsx', content:'large-new', encoding:'base64', productCatalog:[{productCode:'002', productName:'New'}]};
  const previous = {id:'old', name:'old.xlsx', content:'large-old', encoding:'base64', productCatalog:[{productCode:'001', productName:'Old'}]};
  const workspace = {fixedMaster:current, masterHistory:[current,previous], productCatalog:current.productCatalog};
  const saved = S.parseStoredWorkspace(JSON.stringify(S.createPersistableWorkspace(workspace)));
  assert.deepEqual(saved.fixedMaster.productCatalog, [{productCode:'002', productName:'New'}]);
  assert.deepEqual(saved.masterHistory[1].productCatalog, [{productCode:'001', productName:'Old'}]);
  for (const master of [saved.fixedMaster, ...saved.masterHistory]) {
    assert.equal(Object.hasOwn(master,'content'),false);
    assert.equal(Object.hasOwn(master,'encoding'),false);
  }
  assert.equal(current.content, 'large-new');
  assert.equal(previous.content, 'large-old');
});

test('stored workspace rejects primitive and array roots', () => {
  for (const stored of ['null','false','true','42','"text"','[]','[{}]','invalid json']) {
    assert.equal(S.parseStoredWorkspace(stored),null,stored);
  }
  assert.deepEqual(S.parseStoredWorkspace('{}'),{});
});

test('malformed known array fields are normalized and valid empty arrays survive', () => {
  const fields = ['masterHistory','jobs','learningHistory','reviewDrafts','reviewItems','productCatalog','mappingPreviewRows','orderAnalysisRows','inboundUpdates','productMemos','containerInboundRecords','smartstoreReservations','expiryLots','rowOverrides','mappingDecisions'];
  for (const malformed of [null, false, 4, 'bad', {length:3}]) {
    const source = Object.fromEntries(fields.map(field => [field,malformed]));
    const parsed = S.parseStoredWorkspace(JSON.stringify(source));
    for (const field of fields) assert.deepEqual(parsed[field],[],field);
  }
  const source = {jobs:[], learningHistory:[{id:'L1'}], customValue:{keep:true}};
  assert.deepEqual(S.parseStoredWorkspace(JSON.stringify(source)),source);
});
