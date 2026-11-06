const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '..');
assert.ok(fs.existsSync(path.join(root, 'portfolio-data.js')), 'shared portfolio fixtures must exist');
const D = require('../portfolio-data.js');
const s = D.schedule();
assert.ok(D.catalog.length >= 50);
assert.equal(new Set(D.catalog.map(p=>p.barcode)).size, D.catalog.length);
assert.equal(new Set(D.catalog.map(p=>p.productCode)).size, D.catalog.length);
const names = new Map(D.catalog.map(p=>[p.barcode,p.productName]));
const w = D.workspace();
for (const [key,min] of Object.entries({mappingPreviewRows:10,orderAnalysisRows:20,reviewItems:4,learningHistory:6,jobs:4,smartstoreReservations:6,expiryLots:8,masterHistory:2})) assert.ok(w[key].length>=min,key);
assert.ok(D.coordination().length>=16);
assert.equal(s.length, D.catalog.length);
for(const r of s) { assert.equal(names.get(r.바코드),r.상품명); assert.ok(r.현재고>=0); assert.ok(r.최근입고 < r.다음입고); }
for(const r of w.reviewItems) assert.equal(names.get(r.barcode),r.recommendedProduct);
for(const r of [...w.mappingPreviewRows,...w.orderAnalysisRows]) assert.ok(D.catalog.some(p=>p.productName===r.자사상품명));
for(const r of w.smartstoreReservations) { const p=s.find(p=>p.바코드===r.productCode); assert.ok(p && r.quantity>0 && r.quantity<=p.현재고); }
for(const r of w.expiryLots) { assert.equal(names.get(r.barcode),r.productName); assert.ok(r.manufacturedDate<=r.inboundDate && r.expiryDate>r.manufacturedDate); }
for(const r of w.reviewItems) assert.ok(r.orderQuantity > r.mappedQuantity, 'review must be actionable');
for(const r of D.coordination()) if(r.confirmedDate && r.status==='입고완료') assert.ok(r.reqDate <= r.confirmedDate, 'request precedes completion');
for(const r of w.mappingPreviewRows){const review=w.reviewItems.find(v=>v.orderNo===r.주문번호);if(review)assert.equal(r.수량,review.orderQuantity, 'linked order quantity');}
const ops=D.ops();
for(const [k,n] of Object.entries({wholesalePending:12,wholesaleDone:4,retailAll:12,pendingSlips:16,inboundLines:16})) assert.ok(ops[k].length>=n,k);
for(const r of s) assert.equal(Object.values(ops.zoneStock.bySku[r.바코드]).reduce((a,b)=>a+b,0),r.현재고);
for(const r of [...ops.wholesalePending,...ops.wholesaleDone,...ops.retailAll]) assert.equal(names.get(r.sku),r.productName);
for(const p of ops.wholesalePending) assert.equal(ops.pendingSlips.filter(r=>r.slipNo===p.orderNo).reduce((n,r)=>n+r.qty,0),p.qty);
for(const file of fs.readdirSync(root).filter(f=>/\.(js|html)$/.test(f))) { const text=fs.readFileSync(path.join(root,file),'utf8'); assert.ok(!/https:\/\/docs\.google\.com\/spreadsheets\/d\//.test(text),file+' sheet URL'); assert.ok(!/[\w.+-]+@gmail\.com/.test(text),file+' personal email'); assert.ok(!/thezoos-(?!english-portfolio-)|order-mapping-(?!english-portfolio-)/.test(text),file+' legacy storage'); }
const context={console,PortfolioData:D,localStorage:{getItem:()=>null},Date}; context.window=context; vm.createContext(context);vm.runInContext(fs.readFileSync(path.join(root,'ops-dashboard-engine.js'),'utf8'),context);
let calls=0;context.PortfolioData={...D,ops:()=>{calls++;return D.ops();}};const snap=context.OpsDashboardEngine.buildDemoSnapshot();assert.ok(calls<=10,'ops fixtures rebuilt per product'); assert.equal(snap.grid.length,D.catalog.length); for(const row of snap.grid){const plan=ops.inboundLines.find(p=>p.sku===row.sku);assert.equal(row.inboundDate,plan.date);assert.equal(row.inboundQty,plan.qty);}
console.log(JSON.stringify({products:D.catalog.length,schedule:s.length,workspace:Object.fromEntries(Object.entries(w).filter(([,v])=>Array.isArray(v)).map(([k,v])=>[k,v.length])),coordination:D.coordination().length,ops:Object.fromEntries(Object.entries(ops).filter(([,v])=>Array.isArray(v)).map(([k,v])=>[k,v.length]))},null,2));
