const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const Mapping=require('../mapping-engine.js');
const Portfolio=require('../portfolio-data.js');
const source=fs.readFileSync(require('node:path').join(__dirname,'../app.js'),'utf8');
const section=(start,end)=>source.slice(source.indexOf(start),source.indexOf(end,source.indexOf(start)));
function setup(files=[]){
  const nodes=new Map(), handlers=new Map(), toasts=[], downloads=[];
  const node=selector=>{
    if(!nodes.has(selector))nodes.set(selector,{files:[],dataset:{},addEventListener:(event,fn)=>handlers.set(selector+':'+event,fn)});
    return nodes.get(selector);
  };
  node('#order-file').files=files;
  const ctx={console:{error(){}},document:{querySelector:node},PortfolioData:Portfolio,MappingEngine:Mapping,workspace:Portfolio.workspace(),saveWorkspace(){},render(){},showToast:m=>toasts.push(m),calculateMatchScore:()=>100,downloadStoredFile:file=>downloads.push(file)};
  ctx.window=ctx;
  vm.createContext(ctx);
  vm.runInContext(section('function startMappingJobs(','function releaseFixedMaster(')+section('function getJobHistoryRows(','function downloadProcessedResult(')+section('function needsMappingReview(','function normalizeReviewItem(')+section('function buildJobHistoryExport(','function buildMasterExports(')+section('function downloadJobHistory(','function downloadMaster(')+section('function translateExportValue(','function renderInterpretation(')+section('function decisionToPreviewRow(','document.querySelector("#manual-file")?.addEventListener'),ctx);
  return {ctx,start:handlers.get('#start-mapping:click'),handlers,toasts,node,downloads};
}

test('starting without an upload maps the fixed demo CSV through the real engine', async()=>{
  const {ctx,start,node}=setup();
  const initial=ctx.workspace.jobs.length;
  await start();
  const job=ctx.workspace.jobs[0];
  assert.equal(ctx.workspace.jobs.length,initial+1);
  assert.equal(job.orderName,'demo-orders.csv');
  assert.ok(job.resultRows.length>0);
  assert.ok(job.resultRows.some(row=>row.finalStatus==='정상'));
  assert.ok(job.resultRows.some(row=>row.finalStatus==='확인 필요'));
  assert.equal(node('#mapping-result').hidden,false);
  assert.equal(ctx.getJobResultRows([job.id]).length,job.resultRows.length);
});

test('each seeded job exports its own saved order rows and empty history stays empty',()=>{
  const {ctx}=setup();
  const [a,b]=ctx.workspace.jobs;
  const aRows=ctx.getJobResultRows([a.id]), bRows=ctx.getJobResultRows([b.id]);
  assert.ok(aRows.length>0);
  assert.ok(bRows.length>0);
  assert.equal(aRows[0].작업ID,a.id);
  assert.notEqual(aRows[0].주문번호,bRows[0].주문번호);
  delete a.resultRows;
  assert.equal(ctx.getJobResultRows([a.id])[0].주문번호,aRows[0].주문번호);
  ctx.workspace.jobs=[{id:'custom',orderName:'uploaded.csv',resultRows:[]}];
  ctx.workspace.mappingDecisions=[{orderNo:'unrelated'}];
  assert.equal(ctx.getJobResultRows(['custom']).length,0);
  ctx.workspace.jobs=[];
  assert.equal(ctx.getJobHistoryRows().length,0);
});

test('a header-only upload creates no job and shows a clear error',async()=>{
  const {ctx,start,toasts}=setup([{name:'blank.csv',arrayBuffer:async()=>new ArrayBuffer(0)}]);
  ctx.XLSX={read:()=>({SheetNames:['Orders'],Sheets:{Orders:{}}}),utils:{sheet_to_json:()=>[['주문번호','상품명']]}};
  const initial=ctx.workspace.jobs.length;
  await start();
  assert.equal(ctx.workspace.jobs.length,initial);
  assert.match(toasts.at(-1),/blank\.csv.*주문 행/);
});



test('sample CSV and selected job Excel download contain their actual rows',()=>{
  const {ctx,handlers,downloads}=setup();
  handlers.get('#download-demo-order:click')();
  assert.equal(downloads[0].fileName,'demo-orders.csv');
  assert.match(downloads[0].content,/Order Number,Product Name,Order Quantity/);
  assert.match(downloads[0].content,/DEMO-BASE-001/);
  const [selected, other]=ctx.workspace.jobs;
  ctx.downloadJobHistory('excel',[selected.id]);
  assert.match(downloads[1].content,/<td>DEMO-H1-001<\/td>/);
  assert.ok(!downloads[1].content.includes(other.resultRows[0].orderNo));
});

test('completion modal downloads the successful current run instead of another job',async()=>{
  const {ctx,start,node,handlers,downloads}=setup([{name:'normal.csv',arrayBuffer:async()=>new ArrayBuffer(0)}]);
  ctx.XLSX={read:()=>({SheetNames:['Orders'],Sheets:{Orders:{}}}),utils:{sheet_to_json:()=>[
    ['주문번호','상품명','주문수량','연결된 상품명','매핑수량'],['QA-001','치킨 트릿',2,'치킨 트릿',2]
  ]}};
  await start();
  const modal=node('#mapping-complete-modal');
  assert.equal(modal.hidden,false);
  handlers.get('#download-excel-now-btn:click')({target:{closest:()=>modal}});
  assert.equal(modal.hidden,true);
  assert.match(downloads[0].content,/<td>QA-001<\/td>/);
  assert.ok(!downloads[0].content.includes('DEMO-H1-001'));
});
