const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict'),{test}=require('node:test');
const source=fs.readFileSync(require('node:path').join(__dirname,'../app.js'),'utf8');
const fixtures=require('../portfolio-data.js'),Storage=require('../workspace-storage.js'),Mapping=require('../mapping-engine.js');
function between(start,end){return source.slice(source.indexOf(start),source.indexOf(end,source.indexOf(start)));}
function app(saved){
 const data=new Map();if(saved!==undefined)data.set('thezoos-english-portfolio-mapping-workspace',JSON.stringify(saved));
 const ctx={console,Date,Map,Set,JSON,PortfolioData:fixtures,WorkspaceStorage:Storage,MappingEngine:Mapping,localStorage:{getItem:k=>data.get(k)||null,setItem:(k,v)=>data.set(k,v)},alerts:[],alert:s=>ctx.alerts.push(s),toExcelHtml:rows=>JSON.stringify(rows),saveWorkspace(){},renderReviewItems(){},renderMappingPreviewRows(){},render(){},showToast(){}};ctx.window=ctx;
 vm.createContext(ctx);
 const boot=source.slice(0,source.indexOf('let adminVerification'));
 vm.runInContext(boot+between('function createWorkspaceState(','function replaceFixedMaster(')+between('function normalizeMaster(','function toCsv(')+between('function loadWorkspace(','function saveWorkspace(')+between('function getReviewSummary(','function parseReviewAnswer(')+between('function buildMasterExportFile(','function getJobHistoryRows('),ctx);
 vm.runInContext(between('window.applyRowCorrection =','function renderDrafts('),ctx);
 return ctx;
}
const state=ctx=>vm.runInContext('workspace',ctx);
test('saved empty lists and deleted master stay empty after startup',()=>{
 const ctx=app({...fixtures.workspace(),reviewItems:[],learningHistory:[],jobs:[],mappingPreviewRows:[],orderAnalysisRows:[],smartstoreReservations:[],masterHistory:[],fixedMaster:null});const w=state(ctx);
 for(const key of ['reviewItems','learningHistory','jobs','mappingPreviewRows','orderAnalysisRows','smartstoreReservations','masterHistory'])assert.equal(w[key].length,0,key);
 assert.equal(w.fixedMaster,null);
});
test('master export uses selected version catalog',()=>{const ctx=app(); const file=ctx.buildMasterExportFile({name:'custom.xlsx',productCatalog:[{productCode:'CUSTOM',barcode:'DEMO-1',productName:'선택한버전상품'}]});assert.ok(file.content.includes('선택한버전상품'));assert.ok(!file.content.includes('Zoo Bites'));});
test('invalid review correction quantities never save a learning record',()=>{for(const quantity of ['','0','-1','1.5','NaN','Infinity']){const ctx=app(),w=state(ctx),before=w.learningHistory.length;const row={querySelector:s=>({value:s==='.correction-product'?w.reviewItems[0].recommendedProduct:quantity})};ctx.applyRowCorrection(w.reviewItems[0].id,{closest:()=>row});assert.equal(w.learningHistory.length,before,quantity);assert.ok(ctx.alerts.length);}});
test('correction updates only linked preview and clears its final verdict',()=>{const ctx=app(),w=state(ctx),r=w.reviewItems[0];w.mappingPreviewRows=[{reviewId:r.id,주문번호:r.orderNo,주문내용:r.orderProduct+' 2개',자사상품명:'이전',수량:1,최종판정:'확인필요'},{reviewId:'another',주문번호:r.orderNo,주문내용:r.orderProduct,자사상품명:'별도품목',수량:1}];w.mappingDecisions=[{reviewId:r.id,mappedProduct:'이전',mappedQuantity:1,finalStatus:'확인필요'}];w.jobs=[{id:'j',status:'검토 필요',resultRows:w.mappingDecisions.slice()}];const row={querySelector:s=>({value:s==='.correction-product'?r.recommendedProduct:'2'})};ctx.applyRowCorrection(r.id,{closest:()=>row});assert.equal(w.mappingPreviewRows[0].수량,2);assert.equal(w.mappingPreviewRows[0].최종판정,'정상');assert.equal(w.mappingPreviewRows[1].자사상품명,'별도품목');assert.equal(w.mappingDecisions[0].finalStatus,'정상');assert.equal(w.jobs[0].status,'완료');});
test('same-quantity product mismatch is still included in review',()=>{const ctx=app(); const r={id:'qa-review',orderProduct:'치킨 트릿',mappedProduct:'연어 트릿',orderQuantity:1,expectedQuantity:1,mappedQuantity:1,accuracy:100,mismatches:['상품 불일치'],finalStatus:'확인필요'};assert.equal(ctx.getReviewSummary([r]).reviewRequiredCount,1);});
test('async smartstore form saves and rerenders after browser clears currentTarget',async()=>{
 const handlers=new Map(),nodes=new Map();let saved=0;
 function node(selector){if(!nodes.has(selector))nodes.set(selector,{value:'',textContent:'',innerHTML:'',addEventListener:(event,fn)=>handlers.set(selector+':'+event,fn),querySelector:()=>null});return nodes.get(selector);}
 const ctx={console,Date,document:{querySelector:node,querySelectorAll:()=>[],addEventListener(){}},workspace:{expiryLots:[],smartstoreReservations:[]},escapeHtml:String,loadStockScheduleRows:async()=>[{바코드:'DEMO-1',商品名:'demo',현재고:10}],SmartstoreInventoryEngine:global.SmartstoreInventoryEngine||require('../smartstore-inventory-engine.js'),saveWorkspace(){saved++;},showToast(){}};require('../smartstore-inventory-engine.js');ctx.SmartstoreInventoryEngine=global.SmartstoreInventoryEngine;ctx.window=ctx;vm.createContext(ctx);vm.runInContext(fs.readFileSync(require('node:path').join(__dirname,'../inventory-tools-ui.js'),'utf8'),ctx);
 node('#smartstore-product-code').value='DEMO-1';node('#smartstore-quantity').value='2';let resets=0;const event={preventDefault(){},currentTarget:{reset(){resets++;}}};const pending=handlers.get('#smartstore-form:submit')(event);event.currentTarget=null;await pending;assert.equal(saved,1);assert.equal(resets,1);assert.equal(ctx.workspace.smartstoreReservations.length,1);
});

test('invalid master import does not produce an installable empty master', async()=>{const ctx=app();ctx.parseMasterCatalogFromFile=async()=>({productCatalog:[],message:'잘못된 파일'});vm.runInContext(between('  async function fileToStoredMaster(','  async function fileToBase64('),ctx);await assert.rejects(()=>ctx.fileToStoredMaster({name:'bad.csv',arrayBuffer:async()=>new ArrayBuffer(0)}));});
test('main search includes discontinued items without changing list category rules',()=>{
 const engine=require('../inventory-dashboard-engine.js');
 const item={productName:'데모 단종 상품',barcode:'0012345',isDiscontinued:true};
 assert.equal(engine.runInventoryMainSearch([item],'0012345').items.length,1);
 assert.equal(engine.filterInventoryItems([item],{query:'0012345'}).length,0);
});
test('dashboard search source includes every scheduled item, not just sold-out items',()=>{
 const ctx=app();ctx.enrichRowWithSeason=row=>row;ctx.getConfirmDateValue=()=>'';ctx.getConfirmMemoValue=()=>'';ctx.getSoldOutItems=rows=>rows.filter(r=>r.현재고===0);
 vm.runInContext(between('function buildSoldOutInboundDashboardSummary(','function renderDashboardCoordinationList(').split('\nfunction ')[0],ctx);
 const summary=ctx.buildSoldOutInboundDashboardSummary([{바코드:'01',상품명:'정상 재고',현재고:10},{바코드:'02',상품명:'품절',현재고:0}]);
 assert.equal(summary.allItems.length,2);assert.equal(summary.soldoutUnconfirmed.length,1);
});
