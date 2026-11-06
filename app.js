const STORAGE_KEY = "thezoos-english-portfolio-mapping-workspace";
const GEMINI_KEY_STORAGE = "order-mapping-english-portfolio-gemini-key";
const GEMINI_MODEL_STORAGE = "order-mapping-english-portfolio-gemini-model";
const ADMIN_MODE_STORAGE = "order-mapping-english-portfolio-admin-mode";
const ADMIN_PASSWORD_STORAGE = "order-mapping-english-portfolio-admin-password";
const SOLDOUT_THRESHOLD_STORAGE = "thezoos-english-portfolio-soldout-stock-threshold";
const DATA_BASIS_STORAGE = "thezoos-english-portfolio-data-basis-v1";
const DEFAULT_ADMIN_PASSWORD = "PortfolioDemo!2026";
const ADMIN_RECOVERY_EMAIL = "portfolio@example.invalid";
const STOCK_SCHEDULE_CSV_URL = "";
const STOCK_SCHEDULE_VIEW_URL = "#inbound";
const demoDefaults = window.PortfolioData.workspace();
const defaultProductCatalog = demoDefaults.productCatalog;
const defaultMappingPreviewRows = demoDefaults.mappingPreviewRows;
const defaultOrderAnalysisRows = demoDefaults.orderAnalysisRows;
const defaultReviewItems = demoDefaults.reviewItems;
const defaultLearningHistory = demoDefaults.learningHistory;
const defaultJobs = demoDefaults.jobs;
const initialMaster = demoDefaults.fixedMaster;
let workspace = loadWorkspace();

function ensureWorkspaceDemoData() {
  Object.entries(demoDefaults).forEach(([key, value]) => {
    if (Array.isArray(value) && !Array.isArray(workspace[key])) workspace[key] = value;
  });
  if (!Array.isArray(workspace.containerInboundRecords)) workspace.containerInboundRecords = [];
}
ensureWorkspaceDemoData();


let adminVerification = null;
let stockScheduleCache = null;
let dataBasisState = loadDataBasisState();
let soldOutStockThreshold = (() => {
  try {
    const stored = Number(localStorage.getItem(SOLDOUT_THRESHOLD_STORAGE));
    return stored >= 0 && stored <= 1000 && stored % 100 === 0 ? stored : 0;
  } catch (_) {
    return 0;
  }
})();

function createWorkspaceState(fixedMaster) {
  const normalizedMaster = normalizeMaster(fixedMaster, 1);
  return {
    fixedMaster: normalizedMaster,
    masterHistory: [normalizedMaster],
    jobs: defaultJobs.slice(),
    learningHistory: defaultLearningHistory.slice(),
    reviewDrafts: [],
    reviewItems: defaultReviewItems.slice(),
    productCatalog: defaultProductCatalog.slice(),
    mappingPreviewRows: defaultMappingPreviewRows.slice(),
    orderAnalysisRows: defaultOrderAnalysisRows.slice(),
    selectedReviewItem: defaultReviewItems[0] || null,
    ...window.PortfolioData.workspace(),
    inboundUpdates: [],
    productMemos: [],
    containerInboundRecords: [],
  };
}

function replaceFixedMaster(state, fixedMaster) {
  const normalizedMaster = normalizeMaster(fixedMaster, state.masterHistory.length + 1);
  return { ...state, fixedMaster: normalizedMaster, masterHistory: [normalizedMaster, ...state.masterHistory], productCatalog: getMasterProductCatalog(normalizedMaster, state.productCatalog) };
}

function startMappingJob(state, orderFile) {
  const now = new Date();
  const timeStr = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')} ${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}:${String(now.getSeconds()).padStart(2,'0')}`;
  return {
    ...state,
    jobs: [{ id: `job-${state.jobs.length + 1}`, orderName: orderFile.name, masterName: state.fixedMaster.name, status: "매핑 준비", createdAt: timeStr }, ...state.jobs],
  };
}

function startMappingJobs(state, orderFiles, resultsByFile = []) {
  const now = new Date();
  const timeStr = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')} ${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}:${String(now.getSeconds()).padStart(2,'0')}`;
  const jobs = orderFiles.map((orderFile, index) => ({
    id: `job-${state.jobs.length + index + 1}`,
    orderName: orderFile.name,
    masterName: state.fixedMaster?.name || "고정 마스터 없음",
    status: (resultsByFile[index] || []).some((row) => row.finalStatus !== "정상") ? "검토 필요" : "완료",
    createdAt: timeStr,
    resultRows: resultsByFile[index] || [],
  }));
  return { ...state, jobs: [...jobs, ...state.jobs] };
}

function releaseFixedMaster(state) {
  if (!state.fixedMaster) return state;
  const releasedMaster = { ...state.fixedMaster, fixed: false };
  return {
    ...state,
    fixedMaster: releasedMaster,
    masterHistory: state.masterHistory.map((master) => (master.id === releasedMaster.id ? releasedMaster : master)),
    productCatalog: defaultProductCatalog,
  };
}

function deleteMasters(state, masterIds) {
  const masterIdSet = new Set(masterIds);
  const masterHistory = state.masterHistory.filter((master) => !masterIdSet.has(master.id));
  const fixedMaster = masterIdSet.has(state.fixedMaster?.id) ? masterHistory.find((master) => master.fixed) || masterHistory[0] || null : state.fixedMaster;
  return { ...state, fixedMaster, masterHistory, productCatalog: getMasterProductCatalog(fixedMaster) };
}

function getMasterProductCatalog(master, fallback = defaultProductCatalog) {
  return master?.productCatalog?.length ? master.productCatalog : fallback || defaultProductCatalog;
}

function selectReviewItem(reviewItemId) {
  const reviewItem = getReviewSummary(workspace.reviewItems || defaultReviewItems).items.find((item) => item.id === reviewItemId);
  if (!reviewItem) return;
  workspace.selectedReviewItem = reviewItem;
  saveWorkspace();
  renderReviewItems();
  renderSelectedReviewItem();
}

function getReviewSummary(reviewItems, learningHistory = []) {
  const resolvedReviewIds = new Set((learningHistory || []).map((item) => item.reviewItemId).filter(Boolean));
  const items = (reviewItems || [])
    .filter((item) => !resolvedReviewIds.has(item.id))
    .map((item) => {
      const normalized = normalizeReviewItem(item);
      if (Array.isArray(normalized.mismatches)) return normalized;
      const mismatches = [];
      const quantityGap = Number(normalized.expectedQuantity ?? normalized.orderQuantity ?? 0) - Number(normalized.mappedQuantity ?? 0);
      if (quantityGap > 0) mismatches.push(`수량 ${quantityGap}개 부족`);
      if (quantityGap < 0) mismatches.push(`수량 ${Math.abs(quantityGap)}개 초과`);
      if (normalized.orderProduct && normalized.mappedProduct && normalized.orderProduct !== normalized.mappedProduct) mismatches.push("상품명 해석 차이");
      if (Number(normalized.accuracy) < Number(normalized.threshold ?? 95)) mismatches.push(`정확도 기준 ${normalized.threshold ?? 95}% 미달`);
      return { ...normalized, mismatches };
    })
    .filter(needsMappingReview);
  return { items, reviewRequiredCount: items.length };
}

function needsMappingReview(item) {
  return Boolean(window.MappingEngine?.needsQuantityCorrection(item))
    || Boolean(item.mismatches?.length)
    || Boolean(item.finalStatus && item.finalStatus !== "정상")
    || Number(item.accuracy ?? 100) < Number(item.threshold ?? 95);
}

function normalizeReviewItem(item) {
  return {
    orderProduct: item.orderProduct || item.sourceText || "주문사 상품 확인 필요",
    orderQuantity: Number(item.orderQuantity ?? item.expectedQuantity ?? 0),
    mappedProduct: item.mappedProduct || item.productCode || "자사 매핑 확인 필요",
    mappedQuantity: Number(item.mappedQuantity ?? 0),
    expectedQuantity: Number(item.expectedQuantity ?? item.orderQuantity ?? 0),
    accuracy: Number(item.accuracy ?? 0),
    threshold: Number(item.threshold ?? 95),
    ...item,
  };
}

function parseReviewAnswer(rawText, selectedReviewItem = null) {
  const productCode = rawText.match(/\bPD[\w-]+\b/i)?.[0] || selectedReviewItem?.productCode || "확인 필요";
  const quantities = [...rawText.matchAll(/(\d+)\s*(개|ea|EA|수량)/g)].map((match) => Number(match[1]));
  return { rawText, productCode, quantity: quantities.at(-1) || 0 };
}

function buildGeminiExplanationPrompt(question) {
  return [
    "너는 주문 매핑 업무를 설명하는 내부 도움말 봇이다.",
    "주문내용, 옵션1, 옵션2, 자사상품명, 수량, 비고, 검토필요 사유를 사용자가 이해하기 쉽게 한국어로 설명한다.",
    "정확하지 않은 내용은 단정하지 말고 어떤 데이터가 더 필요한지 말한다.",
    `사용자 질문: ${question}`,
  ].join("\n");
}

function verifyAdminPassword(password) {
  return String(password || "") === getAdminPassword();
}

function canShowBotAdminSettings(isAdminMode) {
  return Boolean(isAdminMode);
}

function getAdminPassword() {
  return localStorage.getItem(ADMIN_PASSWORD_STORAGE) || DEFAULT_ADMIN_PASSWORD;
}

function createAdminVerification(purpose) {
  return {
    purpose,
    email: ADMIN_RECOVERY_EMAIL,
    code: String(Math.floor(100000 + Math.random() * 900000)),
    createdAt: Date.now(),
  };
}

function verifyAdminCode(verification, code) {
  return Boolean(verification?.code) && String(code || "") === verification.code;
}

function resolveBotQuestion(question) {
  const normalizedQuestion = normalizeText(question);
  const productCatalog = workspace.productCatalog?.length ? workspace.productCatalog : defaultProductCatalog;
  const barcode = question.match(/\b\d{8,14}\b/)?.[0];
  if (barcode) {
    const product = productCatalog.find((item) => item.barcode === barcode);
    if (product) return { handled: true, answer: `${barcode}의 상품명은 ${product.productName}입니다.\n자사상품코드: ${product.productCode}` };
  }

  if (normalizedQuestion.includes("바코드")) {
    const product = productCatalog.find((item) => normalizedQuestion.includes(normalizeText(item.productName)));
    if (product) return { handled: true, answer: `${product.productName}의 바코드는 ${product.barcode}입니다.\n자사상품코드: ${product.productCode}` };
  }

  const nameMatches = window.HelpBotSearch?.findCatalogMatches(question, productCatalog) || [];
  if (nameMatches.length) {
    const rows = nameMatches.slice(0, 10).map((product, index) =>
      `${index + 1}. ${product.productName}\n   바코드: ${product.barcode || "-"}\n   자사상품코드: ${product.productCode || "-"}`,
    );
    const suffix = nameMatches.length > 10 ? `\n\n외 ${nameMatches.length - 10}개 상품이 더 있습니다.` : "";
    return { handled: true, answer: [`상품명 키워드와 일치하는 상품은 총 ${nameMatches.length}개입니다.`, ...rows].join("\n\n") + suffix };
  }

  if (normalizedQuestion.includes("주문") && (normalizedQuestion.includes("많은") || normalizedQuestion.includes("인기"))) {
    const rows = workspace.orderAnalysisRows?.length ? workspace.orderAnalysisRows : defaultOrderAnalysisRows;
    const source = findOrderSource(question, rows);
    const topItem = getTopOrderedItem(rows, source);
    if (topItem) return { handled: true, answer: formatOrderPopularityAnswer(rows, source, topItem, workspace.orderAnalysisUpdatedAt) };
  }

  return { handled: false, answer: "" };
}

  async function resolveStockQuestionFromSheet(question) {
  try {
    const rows = await loadStockScheduleRows();
      const productCatalog = workspace.productCatalog?.length ? workspace.productCatalog : defaultProductCatalog;
      const hasCatalogMatch = Boolean(window.HelpBotSearch?.findCatalogMatches(question, productCatalog).length);
      const hasScheduleMatch = Boolean(window.HelpBotSearch?.findScheduleNameMatches(question, rows).length);
      const hasLookupWords = /(입고|재고|근거|스케줄|예정|품절|바코드|상품명|상품\s*이름|무슨\s*상품|어떤\s*상품|찾아|알려)/.test(question);
      if (!hasCatalogMatch && !hasScheduleMatch && !hasLookupWords && !/\b\d{8,14}\b/.test(question)) return { handled: false, answer: "" };
      return resolveStockScheduleQuestion(question, rows, new Date(), workspace.productCatalog || []);
  } catch (error) {
    return {
      handled: true,
      answer: `입고 스케줄을 불러오지 못했습니다.\n구글시트가 외부 CSV 읽기를 허용하는지 확인해주세요.\n오류내용: ${error.message}`,
    };
  }
}


/** 전체 화면용 통합 데모 데이터 (구글시트/API 대신 사용) */
const USE_ALL_DEMO_DATA = true;

/** 포트폴리오/데모용 업체명 마스킹: 01업체, 02업체 ... */
const VENDOR_MASK_ENABLED = true;
const _vendorMaskMap = new Map();
function maskVendorName(name) {
  if (!VENDOR_MASK_ENABLED) return name || "-";
  const key = String(name || "").trim();
  if (!key || key === "-") return "-";
  // 이미 마스킹된 형태
  if (/^\d{2}업체$/.test(key)) return key;
  // 채널성 명칭은 유지
  if (/스마트스토어|쿠팡|자사몰|더조스몰/.test(key)) return key;
  if (!_vendorMaskMap.has(key)) {
    const n = String(_vendorMaskMap.size + 1).padStart(2, "0");
    _vendorMaskMap.set(key, n + "업체");
  }
  return _vendorMaskMap.get(key);
}
function maskVendorInText(text) {
  if (!VENDOR_MASK_ENABLED || text == null) return text;
  let s = String(text);
  // known raw vendor tokens in demo
  // All bundled vendor labels are fictional.
  return s;
}



function buildFullDemoScheduleRows() { return window.PortfolioData.schedule(); }

async function loadStockScheduleRows() {
  const enrichBarcodes = (rows) => window.InboundTableEngine?.enrichMissingBarcodes(rows, workspace.productCatalog || []) || rows;
  const withContainerRecords = (rows) => [...rows, ...(workspace.containerInboundRecords || [])];
  const finalizeRows = (rows) => {
    const finalized = enrichBarcodes(withContainerRecords(rows));
    return window.StockRowVisibility?.filterVisibleProductRows(finalized) || finalized;
  };
  // 전체 데모 모드: 외부 시트/API 대신 내장 데모 데이터만 사용
  if (typeof USE_ALL_DEMO_DATA !== "undefined" && USE_ALL_DEMO_DATA) {
    // 데모 데이터는 항상 최신 빌더로 재생성 (빈칸 채움 반영)
    const demo = buildFullDemoScheduleRows();
    demo.__demoFull = true;
    stockScheduleCache = applySavedInboundUpdates(demo);
    return finalizeRows(stockScheduleCache);
  }
  if (stockScheduleCache) return finalizeRows(stockScheduleCache);
  try {
    const response = await fetch(STOCK_SCHEDULE_CSV_URL);
    if (!response.ok) throw new Error(`구글시트 응답 오류 ${response.status}`);
    stockScheduleCache = applySavedInboundUpdates(parseStockScheduleCsv(await response.text()));
    return finalizeRows(stockScheduleCache);
  } catch (error) {
    stockScheduleCache = applySavedInboundUpdates(await loadStockScheduleRowsByJsonp());
    return finalizeRows(stockScheduleCache);
  }
}

function loadDataBasisState() {
  if (window.DataBasisSnapshot) return window.DataBasisSnapshot.loadState(localStorage);
  try {
    return JSON.parse(localStorage.getItem(DATA_BASIS_STORAGE) || "null");
  } catch (_) {
    return null;
  }
}

function saveDataBasisState() {
  try {
    localStorage.setItem(DATA_BASIS_STORAGE, JSON.stringify(dataBasisState));
  } catch (_) {}
  window.DataBasisEngine?.renderBasisTimes(document, dataBasisState);
}

function applySheetBasisMetadata(sources) {
  dataBasisState = window.DataBasisSnapshot?.loadState(localStorage) || { version: 1, sources: sources || {} };
  saveDataBasisState();
}

window.DataBasisEngine?.renderBasisTimes(document, dataBasisState);

function initializeDataBasisEditor() {
  const card = document.querySelector(".data-basis-card");
  if (!card || !window.DataBasisSnapshot) return;
  card.classList.add("data-basis-editable");
  card.tabIndex = 0;
  card.setAttribute("role", "button");
  card.setAttribute("aria-expanded", "false");
  card.title = "클릭하여 기준 일시 수정";
  card.insertAdjacentHTML("beforeend", `<form id="data-basis-editor" class="data-basis-editor" hidden novalidate>
    <label>국내
      <span class="data-basis-input-row">
        <input type="datetime-local" data-basis-input="domestic" required />
        <button type="button" class="secondary compact-button" data-basis-now="domestic">현시점</button>
      </span>
    </label>
    <label>수입
      <span class="data-basis-input-row">
        <input type="datetime-local" data-basis-input="import" required />
        <button type="button" class="secondary compact-button" data-basis-now="import">현시점</button>
      </span>
    </label>
    <label>현재고
      <span class="data-basis-input-row">
        <input type="datetime-local" data-basis-input="stock" required />
        <button type="button" class="secondary compact-button" data-basis-now="stock">현시점</button>
      </span>
    </label>
    <div class="data-basis-editor-actions">
      <button type="button" class="secondary compact-button" data-basis-now-all>전체 현시점</button>
      <button type="button" class="secondary compact-button" data-basis-reset>기본값 복원</button>
      <button type="submit" class="primary compact-button">저장</button>
    </div>
  </form>`);
  const editor = card.querySelector("#data-basis-editor");
  const openEditor = () => {
    ["domestic", "import", "stock"].forEach((source) => {
      editor.querySelector(`[data-basis-input="${source}"]`).value = window.DataBasisSnapshot.toInputValue(dataBasisState?.sources?.[source]?.updatedAt);
    });
    editor.hidden = false;
    card.setAttribute("aria-expanded", "true");
  };
  const closeEditor = () => {
    editor.hidden = true;
    card.setAttribute("aria-expanded", "false");
  };
  card.addEventListener("click", (event) => {
    if (event.target.closest("input, button, form")) return;
    editor.hidden ? openEditor() : closeEditor();
  });
  card.addEventListener("keydown", (event) => {
    if ((event.key === "Enter" || event.key === " ") && !event.target.closest("input, button")) {
      event.preventDefault();
      editor.hidden ? openEditor() : closeEditor();
    }
  });
  editor.addEventListener("submit", (event) => {
    event.preventDefault();
    event.stopPropagation();
    const values = {};
    let missing = null;
    ["domestic", "import", "stock"].forEach((source) => {
      const input = editor.querySelector(`[data-basis-input="${source}"]`);
      let v = window.DataBasisSnapshot.fromInputValue(input?.value);
      // 브라우저가 초 단위를 주거나 형식이 달라도 한 번 더 보정
      if (!v && input?.value) {
        const cleaned = String(input.value).replace(/(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}).*/, "$1");
        v = window.DataBasisSnapshot.fromInputValue(cleaned);
        if (v) input.value = cleaned;
      }
      values[source] = v;
      if (!v && !missing) missing = source;
    });
    if (missing) {
      showToast("날짜와 시간을 모두 확인해주세요. (현시점 후 저장)");
      return;
    }
    dataBasisState = window.DataBasisSnapshot.createState(values);
    window.DataBasisSnapshot.saveState(localStorage, dataBasisState);
    saveDataBasisState();
    closeEditor();
    showToast("파일 데이터 기준 일시를 저장했습니다.");
  });
  editor.querySelector("[data-basis-reset]").addEventListener("click", () => {
    dataBasisState = window.DataBasisSnapshot.resetState(localStorage);
    saveDataBasisState();
    closeEditor();
    showToast("파일 데이터 기준 일시를 기본값으로 복원했습니다.");
  });

  const setNowValue = (source) => {
    const input = editor.querySelector(`[data-basis-input="${source}"]`);
    if (!input) return;
    const next = window.DataBasisSnapshot.toInputValue(new Date());
    input.value = next;
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
  };

  editor.querySelectorAll("[data-basis-now]").forEach((button) => {
    button.addEventListener("click", () => {
      setNowValue(button.dataset.basisNow);
      showToast(`${button.dataset.basisNow === "domestic" ? "국내" : button.dataset.basisNow === "import" ? "수입" : "현재고"} 기준을 현시점으로 넣었습니다. 저장을 눌러 반영하세요.`);
    });
  });

  editor.querySelector("[data-basis-now-all]")?.addEventListener("click", () => {
    ["domestic", "import", "stock"].forEach(setNowValue);
    showToast("국내·수입·현재고 기준을 모두 현시점으로 넣었습니다. 저장을 눌러 반영하세요.");
  });
}

initializeDataBasisEditor();

function applySavedInboundUpdates(rows) {
  if (!window.InboundUpdateEngine) return rows;
  return window.InboundUpdateEngine.applyInboundUpdates(rows, workspace.inboundUpdates || []).rows;
}

function loadStockScheduleRowsByJsonp() {
  return new Promise((resolve, reject) => {
    const callbackName = `__theZoosStockSchedule${Date.now()}`;
    const script = document.createElement("script");
    const cleanup = () => {
      delete window[callbackName];
      script.remove();
    };
    window[callbackName] = (payload) => {
      try {
        cleanup();
        resolve(parseGoogleVisualizationTable(payload?.table));
      } catch (error) {
        reject(error);
      }
    };
    script.onerror = () => {
      cleanup();
      reject(new Error("구글시트 JSONP 로딩 실패"));
    };
    reject(new Error("포트폴리오는 내장 데모 데이터를 사용합니다."));
    return;
    document.head.appendChild(script);
  });
}

function parseGoogleVisualizationTable(table) {
  const rows = (table?.rows || []).map((row) => (row.c || []).map((cell) => cell?.f ?? cell?.v ?? ""));
  const labels = (table?.cols || []).map((column) => column?.label || "");
  const withHeader = labels.some(Boolean) ? [labels, ...rows] : rows;
  const parsed = window.DataBasisSnapshot?.readSheetMetadata(window.DataBasisEngine, withHeader) || { rows: withHeader, sources: {} };
  applySheetBasisMetadata(parsed.sources);
  return parseStockScheduleRows(parsed.rows);
}

function parseStockScheduleCsv(csvText) {
  const rows = parseCsv(csvText).filter((row) => row.some((cell) => String(cell).trim()));
  const parsed = window.DataBasisSnapshot?.readSheetMetadata(window.DataBasisEngine, rows) || { rows, sources: {} };
  applySheetBasisMetadata(parsed.sources);
  return parseStockScheduleRows(parsed.rows);
}

function parseStockScheduleRows(rows) {
  const headerIndex = rows.findIndex((row) => (row.includes("상품명") || row.includes("제품명")) && (row.includes("바코드") || row.includes("입고예정일") || row[1] === ""));
  if (headerIndex < 0) return [];
  const headers = rows[headerIndex].map((header) => String(header).trim());
  if (!headers.includes("바코드") && headers[1] === "") headers[1] = "바코드";
  if (!headers.includes("현재고") && headers[4] === "") headers[4] = "현재고";
  if (!headers[0]) headers[0] = "단종";
  const fallbackHeaders = {
    12: "국내최근입고일",
    13: "국내최근입고수량",
    14: "국내다음입고일",
    15: "국내다음입고예정수량",
    17: "수입주문일",
    18: "수입선적일",
    19: "수입입고일",
    20: "수입최근입고수량",
    23: "수입예정주문일",
    24: "수입예정선적일",
    26: "다음입고예정수량",
    29: "시트메모",
  };
  headers.forEach((header, index) => {
    if (!header) headers[index] = fallbackHeaders[index] || `빈컬럼${index}`;
  });
  return rows.slice(headerIndex + 1).map((row) => {
    const item = {};
    headers.forEach((header, index) => {
      let key = header;
      if (key === "제품명") key = "상품명";
      item[key] = row[index] ?? "";
    });
    return item;
  });
}

  function resolveStockScheduleQuestion(question, scheduleRows, today = new Date(), productCatalog = []) {
    const stockIntent = hasStockScheduleIntent(question);
    const lookupIntent = hasProductLookupIntent(question) || Boolean(window.HelpBotSearch?.findScheduleNameMatches(question, scheduleRows).length);
    if (!stockIntent && !lookupIntent) return { handled: false, answer: "" };
  if (isWeeklyInboundQuestion(question)) {
    const items = getWeeklyInboundItems(scheduleRows, today);
    return { handled: true, answer: formatWeeklyInboundAnswer(items) };
  }
    const barcode = question.match(/\b\d{8,14}\b/)?.[0];
    const masterMatches = findProductCatalogMatches(question, productCatalog, barcode);
    const items = findStockScheduleItems(question, scheduleRows, barcode, masterMatches);
  if (!items.length) {
    return {
      handled: true,
      answer: "입고 스케줄에서 해당 상품을 찾지 못했습니다. 바코드 전체 또는 상품명 일부를 다시 입력해주세요.",
    };
  }
    if (lookupIntent && !stockIntent) {
      return { handled: true, answer: formatProductLookupAnswer(items, barcode) };
    }
    const detailed = /(근거|상세|요약|보여줘|설명)/.test(question);
    return { handled: true, answer: items.length > 1 ? formatMultipleStockAnswer(items, detailed) : detailed ? formatDetailedStockAnswer(items[0]) : formatSimpleStockAnswer(items[0]) };
  }

  function hasStockScheduleIntent(question) {
    return /(입고|재고|근거|스케줄|예정|품절)/.test(question);
  }

  function hasProductLookupIntent(question) {
    return /\b\d{8,14}\b/.test(question) || /(바코드|상품명|상품\s*이름|무슨\s*상품|어떤\s*상품|찾아|알려)/.test(question);
  }

function isWeeklyInboundQuestion(question) {
  return /(이번\s*주|금주|이번주)/.test(question) && /(입고\s*상품|입고\s*예정|입고\s*품목|입고)/.test(question);
}

function formatWeeklyInboundAnswer(items) {
  if (!items.length) return "이번주 입고예정 품목이 없습니다.";
  const preview = items.slice(0, 10).map((item, index) => {
    const container = item.컨테이너표시 ? ` / 컨테이너: ${item.컨테이너표시}` : "";
    const remark = window.HelpBotSearch?.formatConfirmedRemark(item);
    return `${index + 1}. ${item.상품명 || "-"}\n   입고예정일: ${item.입고예정일 || "-"} / 구분: ${item.입고구분표시 || "-"}${container} / 현재고: ${item.현재고 || "-"} / 입고예정수량: ${item.다음입고예정수량표시 || "-"}${remark ? `\n   ${remark}` : ""}`;
  });
  const suffix = items.length > 10 ? `\n\n외 ${items.length - 10}건은 '이번주 입고예정' 메뉴에서 확인하세요.` : "";
  return [`이번주 입고예정 품목은 총 ${items.length}건입니다.`, ...preview].join("\n\n") + suffix;
}

function findStockScheduleItems(question, scheduleRows, barcode, masterMatches = []) {
    const masterBarcodes = new Set(masterMatches.map((item) => item.barcode).filter(Boolean));
    if (barcode) return scheduleRows.filter((row) => String(row.바코드 || "").includes(barcode));
  const normalizedQuestion = normalizeText(question);
  const baseTokens = buildStockBaseTokens(question);
  const queryTokens = buildStockQueryTokens(question);
  const exactPhrase = normalizeText(baseTokens.join(""));
  const scored = scheduleRows
    .map((row) => {
        const name = normalizeText(row.상품명);
        if (!name) return { row, score: 0 };
        let score = 0;
        if (masterBarcodes.has(String(row.바코드 || "").trim())) score += 20;
        if (exactPhrase && name.includes(exactPhrase)) score += 10;
      queryTokens.forEach((token) => {
        if (name.includes(normalizeText(token))) score += token.length >= 3 ? 3 : 1;
      });
      return { row, score };
    })
    .filter((item) => item.score > 0)
    .sort((left, right) => right.score - left.score || String(left.row.상품명 || "").localeCompare(String(right.row.상품명 || "")));
  if (!scored.length) return [];
    const preferredMatches = scored.filter((item) => (exactPhrase && normalizeText(item.row.상품명).includes(exactPhrase)) || masterBarcodes.has(String(item.row.바코드 || "").trim()));
    if (preferredMatches.length) return preferredMatches.map((item) => item.row);
    const bestScore = scored[0].score;
    return scored.filter((item) => item.score === bestScore || item.score >= 3).map((item) => item.row);
  }

  function findProductCatalogMatches(question, productCatalog = [], barcode) {
    const normalizedQuestion = normalizeText(question);
    const tokens = buildStockQueryTokens(question);
    return (productCatalog || []).filter((product) => {
      if (barcode && String(product.barcode || "").includes(barcode)) return true;
      const name = normalizeText(product.productName);
      if (!name) return false;
      if (tokens.length && tokens.every((token) => name.includes(normalizeText(token)))) return true;
      return normalizedQuestion.includes(name) || name.includes(normalizedQuestion);
    });
  }

  function buildStockQueryTokens(question) {
  const baseTokens = buildStockBaseTokens(question);
  const expanded = new Set(baseTokens);
  baseTokens.forEach((token) => {
    if (token.includes("미니")) expanded.add("미니");
    if (token.includes("스틱")) expanded.add("스틱");
  });
  return [...expanded];
}

function buildStockBaseTokens(question) {
  return String(question || "")
    .toLowerCase()
    .replace(/최근입고|다음입고|입고예정일|알려줘|근거|내용|보여줘|현재고|상세|요약|설명|입고|재고|스케줄|예정|상품명|바코드/g, " ")
    .split(/[^\da-z가-힣]+/i)
    .filter((token) => token.length >= 2);
}

  function formatMultipleStockAnswer(items, detailed) {
    const kindCount = new Set(items.map((item) => normalizeText(item.상품명)).filter(Boolean)).size;
    const rows = items.map((item, index) => {
    const lines = [
      `${index + 1}. ${item.상품명 || "상품명 없음"}`,
      `   바코드: ${item.바코드 || "-"}`,
      `   현재고: ${item.현재고 || "-"}`,
      `   최근입고: ${item.최근입고 || item.국내최근입고일 || item.입고일 || "-"}`,
      `   다음입고: ${item.다음입고 || item.국내다음계획일 || item.입고예상일 || "-"}`,
    ];
    const remark = window.HelpBotSearch?.formatConfirmedRemark(item);
    if (remark) lines.push(`   ${remark}`);
    if (detailed) {
      lines.push(`   업데이트일시: ${item.업데이트일시 || "-"}`);
      lines.push(`   메모: ${item.메모 || item.국내스케줄입고메모사항 || item.완료참고품목 || item.예정참고품목 || "-"}`);
    }
    return lines.join("\n");
    });
    return [`총 ${kindCount}종, ${items.length}건이 검색됐습니다.`, ...rows].join("\n\n");
  }

  function formatProductLookupAnswer(items, barcode) {
    const kindCount = new Set(items.map((item) => normalizeText(item.상품명)).filter(Boolean)).size;
    const preview = items.slice(0, 10).map((item, index) => {
      return [
        `${index + 1}. ${item.상품명 || "상품명 없음"}`,
        `   바코드: ${item.바코드 || "-"}`,
        `   현재고: ${item.현재고 || "-"}`,
        `   다음입고: ${item.다음입고 || item.국내다음계획일 || item.입고예상일 || "-"}`,
        window.HelpBotSearch?.formatConfirmedRemark(item) ? `   ${window.HelpBotSearch.formatConfirmedRemark(item)}` : "",
      ].filter(Boolean).join("\n");
    });
    const suffix = items.length > 10 ? `\n\n외 ${items.length - 10}건은 상품명을 더 구체적으로 입력하면 줄일 수 있습니다.` : "";
    const title = barcode ? `${barcode}로 찾은 상품은 총 ${kindCount}종, ${items.length}건입니다.` : `상품명으로 찾은 바코드는 총 ${kindCount}종, ${items.length}건입니다.`;
    return [title, ...preview].join("\n\n") + suffix;
  }

  function findStockScheduleItem(question, scheduleRows, barcode) {
  return findStockScheduleItems(question, scheduleRows, barcode)[0];
}

function legacyFindStockScheduleItem(question, scheduleRows, barcode) {
  if (barcode) return scheduleRows.find((row) => String(row.바코드 || "").includes(barcode));
  const normalizedQuestion = normalizeText(question);
  const queryTokens = buildStockQueryTokens(question);
  return scheduleRows.find((row) => {
    const name = normalizeText(row.상품명);
    if (!name) return false;
    if (normalizedQuestion.includes(name) || name.includes(normalizedQuestion.replace(/최근입고|다음입고|입고예정일|알려줘|근거|내용|보여줘|현재고/g, ""))) return true;
    return queryTokens.filter((token) => name.includes(token)).length >= Math.min(2, queryTokens.length);
  });
}

function formatSimpleStockAnswer(item) {
  return [
    `${item.상품명 || "해당 상품"} 입고 정보입니다.`,
    `바코드: ${item.바코드 || "-"}`,
    `최근입고: ${item.최근입고 || item.국내최근입고일 || item.입고일 || "-"}`,
    `다음입고: ${item.다음입고 || item.국내다음계획일 || item.입고예상일 || "-"}`,
    `현재고: ${item.현재고 || "-"}`,
    window.HelpBotSearch?.formatConfirmedRemark(item) || "",
  ].filter(Boolean).join("\n");
}

function formatDetailedStockAnswer(item) {
  return [
    `${item.상품명 || "해당 상품"}의 입고 스케줄 근거입니다.`,
    `업데이트일시: ${item.업데이트일시 || "-"}`,
    `바코드: ${item.바코드 || "-"}`,
    `상품명: ${item.상품명 || "-"}`,
    `최근입고: ${item.최근입고 || item.국내최근입고일 || item.입고일 || "-"}`,
    `다음입고: ${item.다음입고 || item.국내다음계획일 || item.입고예상일 || "-"}`,
    `현재고: ${item.현재고 || "-"}`,
    `메모: ${item.메모 || item.국내스케줄입고메모사항 || item.완료참고품목 || item.예정참고품목 || "-"}`,
    window.HelpBotSearch?.formatConfirmedRemark(item) || "",
  ].filter(Boolean).join("\n");
}

let windowInboundFilterMode = "this-week";
let windowInboundCustomStart = null;
let windowInboundCustomEnd = null;
const inboundListStates = {
  inbound: { query: "", categories: [], season: "", sortKey: "입고예정정렬일", sortDirection: "asc", sortType: "date" },
  soldout: {
    query: "",
    categories: [],
    season: "",
    columnFilters: { 품절상태표시: null, 품절일: null },
    sortKey: "품절일",
    sortDirection: "asc",
    sortType: "date",
  },
};
let activeInboundHistoryKey = "";
let currentInboundItemsByKey = new Map();
let activeSoldOutHistoryKey = "";
let currentSoldOutItemsByKey = new Map();
let currentSoldOutColumnFilterOptions = { 품절상태표시: [], 품절일: [] };
let soldOutRenderRequestId = 0;
let activeInventoryDetailKey = "";
let currentInventoryItemsByKey = new Map();
let currentInventoryDashboardSummary = null;
let inventoryMainSearchQuery = "";
const inventoryDashboardStates = {
  pressure: { query: "", category: "전체", season: "" },
  deadstock: { query: "", category: "전체", season: "" },
  arrival: { query: "", category: "전체", season: "" },
};
const inventoryDashboardGroups = {
  pressure: {
    itemsKey: "soldoutConfirmed",
    cardCountId: "dashboard-pressure-count",
    cardCategoriesId: "dashboard-pressure-card-categories",
    filterId: "dashboard-pressure-category-filters",
    listCountId: "dashboard-pressure-list-count",
    bodyId: "dashboard-risk-body",
    panelId: "dashboard-pressure-panel",
    empty: "품절 중 입고확정일이 있는 품목이 없습니다.",
    qualifier: "품절·확정",
  },
  deadstock: {
    itemsKey: "soldoutUnconfirmed",
    cardCountId: "dashboard-deadstock-count",
    cardCategoriesId: "dashboard-deadstock-card-categories",
    filterId: "dashboard-deadstock-category-filters",
    listCountId: "dashboard-deadstock-list-count",
    bodyId: "dashboard-deadstock-body",
    panelId: "dashboard-deadstock-panel",
    empty: "품절 중 입고일이 미정인 품목이 없습니다.",
    qualifier: "품절·미정",
  },
  arrival: {
    itemsKey: "coordinationOpen",
    cardCountId: "dashboard-arrival-risk-count",
    cardCategoriesId: "dashboard-arrival-card-categories",
    filterId: "dashboard-arrival-category-filters",
    listCountId: "dashboard-arrival-list-count",
    bodyId: "dashboard-arrival-body",
    panelId: "dashboard-arrival-panel",
    empty: "진행 중 입고협의 건이 없습니다.",
    qualifier: "협의 진행",
  },
};
const inboundListColumns = {
  inbound: [
    ["입고예정정렬일", "date"], ["바코드", "text"], ["상품명", "text"], ["현재고", "number"],
    ["일평균소진량", "number"], ["최근입고수량표시", "number"], ["다음입고예정수량표시", "number"], ["입고구분표시", "text"],
    ["컨테이너표시", "text"], ["제조일자", "date"], ["유통기한", "date"], ["입고파일명", "text"],
    ["메모표시", "text"], ["비고(확정일)", "date"],
  ],
  soldout: [
    ["바코드", "text"], ["상품명", "text"], ["현재고", "number"], ["일평균소진량", "number"], ["품절일", "date"], ["최근입고내용", "text"],
    ["최근입고수량표시", "number"], ["다음입고내용", "text"], ["다음입고예정수량표시", "number"],
    ["비고(확정일)", "date"], ["단종", "text"],
  ],
};

function clothingSeasonLabel(row) {
  const enriched = enrichRowWithSeason(row);
  return enriched.시즌예상 || "미분류";
}

function syncListSeasonFilter(listKey, sourceItems) {
  const state = inboundListStates[listKey];
  const filters = listKey === "soldout"
    ? document.querySelector("#soldout-category-filters")
    : document.querySelector("#inbound .inbound-category-filters");
  if (!filters) return;
  const clothingOn = (state.categories || []).includes("의류");
  let wrap = filters.querySelector(".clothing-season-filter");
  if (!clothingOn) {
    state.season = "";
    wrap?.remove();
    return;
  }
  const labels = [...new Set((sourceItems || [])
    .filter((row) => (window.InboundTableEngine?.getInboundKeywordCategories?.(row) || []).includes("의류"))
    .map(clothingSeasonLabel))]
    .sort((a, b) => String(a).localeCompare(String(b), "ko"));
  if (state.season && !labels.includes(state.season)) state.season = "";
  if (!wrap) {
    wrap = document.createElement("label");
    wrap.className = "clothing-season-filter";
    wrap.innerHTML = `시즌(예상) <select data-list-season="${listKey}"></select>`;
    wrap.querySelector("select").addEventListener("change", (event) => {
      inboundListStates[listKey].season = event.target.value || "";
      if (listKey === "inbound") renderWeeklyInbound();
      else renderSoldOutItems();
    });
    filters.appendChild(wrap);
  }
  const select = wrap.querySelector("select");
  const current = state.season || "";
  select.innerHTML = `<option value="">전체</option>${labels.map((label) => `<option value="${escapeHtml(label)}"${label === current ? " selected" : ""}>${escapeHtml(label)}</option>`).join("")}`;
}

function prepareInboundListItems(items, listKey) {
  const engine = window.InboundTableEngine;
  if (!engine) return items;
  const state = inboundListStates[listKey];
  const fields = inboundListColumns[listKey].map(([key]) => key);
  const searched = engine.filterRows(items, state.query, fields);
  let filtered = searched;
  if (listKey === "inbound") {
    filtered = engine.filterRowsByCategories(searched, state.categories, { mode: "inbound" });
  } else if (listKey === "soldout") {
    filtered = engine.filterRowsByCategories(searched, state.categories || [], { mode: "soldout" });
    filtered = engine.filterRowsBySelectedValues(filtered, state.columnFilters);
  }
  if ((state.categories || []).includes("의류") && state.season) {
    filtered = filtered.filter((row) => {
      const enriched = typeof enrichRowWithSeason === "function" ? enrichRowWithSeason(row) : row;
      const label = enriched.시즌예상 || enriched.시즌코드 || "미분류";
      return label === state.season;
    });
  }
  return engine.sortRows(filtered, {
    key: state.sortKey,
    direction: state.sortDirection,
    type: state.sortType,
  });
}

function renderSoldOutColumnFilterMenu(renderList = renderSoldOutItems) {
  const menu = document.querySelector("#soldout-column-filter-menu");
  const trigger = document.querySelector("#soldout-column-filter-button");
  if (!menu || !trigger) return;
  const state = inboundListStates.soldout;
  const groups = [
    ["품절상태표시", "상태"],
    ["품절일", "품절일"],
  ];
  menu.replaceChildren();
  const heading = document.createElement("strong");
  heading.className = "excel-filter-title";
  heading.textContent = "조회된 열 내용 필터";
  menu.appendChild(heading);
  groups.forEach(([field, label]) => {
    const options = currentSoldOutColumnFilterOptions[field] || [];
    const selected = state.columnFilters[field];
    const selectedSet = Array.isArray(selected) ? new Set(selected) : new Set(options);
    const group = document.createElement("fieldset");
    group.className = "excel-filter-group";
    const legend = document.createElement("legend");
    legend.textContent = label;
    group.appendChild(legend);
    const allLabel = document.createElement("label");
    allLabel.className = "excel-filter-option excel-filter-all";
    const allInput = document.createElement("input");
    allInput.type = "checkbox";
    allInput.checked = selected === null;
    allInput.addEventListener("change", () => {
      state.columnFilters[field] = allInput.checked ? null : [];
      closeSoldOutHistory();
      renderList();
    });
    allLabel.append(allInput, document.createTextNode(" 전체 선택"));
    group.appendChild(allLabel);
    const optionList = document.createElement("div");
    optionList.className = "excel-filter-options";
    options.forEach((value) => {
      const optionLabel = document.createElement("label");
      optionLabel.className = "excel-filter-option";
      const input = document.createElement("input");
      input.type = "checkbox";
      input.checked = selectedSet.has(value);
      input.addEventListener("change", () => {
        const next = Array.isArray(state.columnFilters[field])
          ? new Set(state.columnFilters[field])
          : new Set(options);
        if (input.checked) next.add(value);
        else next.delete(value);
        state.columnFilters[field] = next.size === options.length ? null : [...next];
        closeSoldOutHistory();
        renderList();
      });
      optionLabel.append(input, document.createTextNode(` ${value}`));
      optionList.appendChild(optionLabel);
    });
    if (!options.length) {
      const empty = document.createElement("span");
      empty.className = "excel-filter-empty";
      empty.textContent = "선택 가능한 값이 없습니다.";
      optionList.appendChild(empty);
    }
    group.appendChild(optionList);
    menu.appendChild(group);
  });
  const activeCount = Object.values(state.columnFilters).reduce((count, values) => count + (Array.isArray(values) ? values.length : 0), 0);
  trigger.classList.toggle("active", Object.values(state.columnFilters).some(Array.isArray));
  trigger.textContent = activeCount ? `▼ ${activeCount}` : "▼";
  trigger.setAttribute("aria-label", activeCount ? `상태와 품절일 필터 ${activeCount}개 선택됨` : "상태와 품절일 필터");
  trigger.setAttribute("aria-pressed", String(Object.values(state.columnFilters).some(Array.isArray)));
}

function syncSoldOutColumnFilterOptions(items) {
  const engine = window.InboundTableEngine;
  if (!engine) return;
  ["품절상태표시", "품절일"].forEach((field) => {
    const options = engine.getUniqueColumnValues(items, field);
    const selected = inboundListStates.soldout.columnFilters[field];
    if (Array.isArray(selected) && selected.length) {
      const availableSelected = selected.filter((value) => options.includes(value));
      inboundListStates.soldout.columnFilters[field] = !availableSelected.length || availableSelected.length === options.length
        ? null
        : availableSelected;
    }
    currentSoldOutColumnFilterOptions[field] = options;
  });
  renderSoldOutColumnFilterMenu();
}

function setupSoldOutColumnFilter(header, renderList) {
  const sortButton = header.querySelector(".table-sort-button");
  if (!sortButton || document.querySelector("#soldout-column-filter-button")) return;
  const controls = document.createElement("div");
  controls.className = "excel-filter-header-controls";
  const trigger = document.createElement("button");
  trigger.type = "button";
  trigger.id = "soldout-column-filter-button";
  trigger.className = "excel-filter-button";
  trigger.textContent = "▼";
  trigger.setAttribute("aria-haspopup", "true");
  trigger.setAttribute("aria-expanded", "false");
  const menu = document.createElement("div");
  menu.id = "soldout-column-filter-menu";
  menu.className = "excel-filter-menu";
  menu.hidden = true;
  controls.append(sortButton, trigger);
  header.replaceChildren(controls);
  document.body.appendChild(menu);
  const positionMenu = () => {
    const position = window.TableControls?.calculateOverlayPosition(
      trigger.getBoundingClientRect(),
      { width: menu.offsetWidth || 320, height: menu.offsetHeight || 420 },
      { width: window.innerWidth, height: window.innerHeight },
      12,
    );
    if (!position) return;
    menu.style.left = `${position.left}px`;
    menu.style.top = `${position.top}px`;
    menu.style.maxHeight = `${position.maxHeight}px`;
  };
  trigger.addEventListener("click", (event) => {
    event.stopPropagation();
    const open = menu.hidden;
    menu.hidden = !open;
    trigger.setAttribute("aria-expanded", String(open));
    if (open) {
      renderSoldOutColumnFilterMenu(renderList);
      positionMenu();
    }
  });
  menu.addEventListener("click", (event) => event.stopPropagation());
  document.addEventListener("click", () => {
    menu.hidden = true;
    trigger.setAttribute("aria-expanded", "false");
  });
  document.addEventListener("keydown", (event) => {
    if (event.key !== "Escape") return;
    menu.hidden = true;
    trigger.setAttribute("aria-expanded", "false");
  });
  window.addEventListener("resize", () => {
    if (!menu.hidden) positionMenu();
  });
  renderSoldOutColumnFilterMenu(renderList);
}

function closeInboundHistory() {
  activeInboundHistoryKey = "";
  const panel = document.querySelector("#inbound-history-panel");
  if (panel) {
    panel.hidden = true;
    panel.replaceChildren();
    window.HistoryPanelPlacement?.restoreOutsideTable(
      panel,
      document.querySelector("#inbound"),
      document.querySelectorAll(".inbound-inline-detail-row"),
    );
  }
  document.querySelectorAll(".inbound-product-button[aria-expanded='true']")
    .forEach((button) => button.setAttribute("aria-expanded", "false"));
}

function renderDepletionMetric(item, { compact = false } = {}) {
  if (!item?.소진량계산가능) {
    return compact
      ? `<div class="history-depletion-summary"><span>일평균 소진량 <b>계산 자료 없음</b></span><small>${escapeHtml(item?.소진량산정기간 || "최근 입고일 없음")}</small></div>`
      : `<span class="depletion-metric-unavailable">계산 자료 없음</span>`;
  }
  const average = formatInventoryQuantity(item.일평균소진량, "개/일");
  const period = item.소진량산정기간 || "산정 기간 없음";
  return compact
    ? `<div class="history-depletion-summary"><span>일평균 소진량 <b>${escapeHtml(average)}</b></span><small>산정 기간 ${escapeHtml(period)}</small></div>`
    : `<strong>${escapeHtml(average)}</strong><small>${escapeHtml(period)}</small>`;
}

function renderSharedProductSummary(row) {
  const detail = window.ProductDetailEngine?.buildProductDetail(row, { reservations: workspace.smartstoreReservations || [] });
  if (!detail) return "";
  const formatInboundSummary = (record) => {
    if (!record.date) return "-";
    const quantity = Number.isFinite(record.quantity) ? `${record.quantity.toLocaleString("en-US")}개` : "-";
    return `${record.date} · ${quantity}`;
  };
  const latest = formatInboundSummary(detail.latestInbound);
  const next = formatInboundSummary(detail.nextInbound);
  return `<div class="product-detail-summary"><article><span>전체 현재고</span><b>${detail.totalStock.toLocaleString("en-US")}개</b></article><article><span>일반 판매 가능</span><b>${detail.regularAvailable.toLocaleString("en-US")}개</b></article><article><span>스마트스토어 전용</span><b>${detail.smartstoreReserved.toLocaleString("en-US")}개</b></article><article><span>최근 입고 날짜·수량</span><b>${escapeHtml(latest)}</b></article><article><span>다음 입고예정 날짜·수량</span><b>${escapeHtml(next)}</b></article><article><span>다음 입고 비고</span><b>${escapeHtml(detail.nextInbound.note || "-")}</b></article></div>`;
}

function getDisplayedConfirmedRemark(anchorRow) {
  const table = anchorRow?.closest?.("table");
  const headers = [...(table?.tHead?.rows?.[0]?.cells || [])];
  const columnIndex = headers.findIndex((cell) => ["비고(확정일)", "Confirmed-Date Notes"].includes(cell.textContent.trim()));
  return columnIndex >= 0 ? String(anchorRow.cells[columnIndex]?.textContent || "").trim() : "";
}

function withClickedConfirmedRemark(item, anchorRow) {
  const displayedValue = getDisplayedConfirmedRemark(anchorRow);
  return window.InboundTableEngine?.withDisplayedConfirmedRemark?.(item, displayedValue) || item;
}

function showInboundHistory(item, itemKey, anchorRow = null) {
  const panel = document.querySelector("#inbound-history-panel");
  if (!panel) return;
  if (activeInboundHistoryKey === itemKey && !panel.hidden) {
    closeInboundHistory();
    return;
  }
  activeInboundHistoryKey = itemKey;
  window.HistoryPanelPlacement?.restoreOutsideTable(
    panel,
    document.querySelector("#inbound"),
    document.querySelectorAll(".inbound-inline-detail-row"),
  );
  const detailItem = withClickedConfirmedRemark(item, anchorRow);
  let history = window.InboundTableEngine?.buildRecentInboundHistory(detailItem) || [];
  // 데모: 빈 업체/수량/참고를 반려동물 샘플로 채움
  const demoVendors = ["01업체", "02업체", "03업체", "04업체", "05업체"];
  const demoNotes = ["데모: 안전재고 확보", "데모: 시즌 물량", "데모: 리오더", "데모: 이벤트 대응", "데모: 유통기한 확인"];
  history = (history.length ? history : [
    { date: detailItem.다음입고 || detailItem.입고예정일 || "2026-11-10", type: "입고예정", vendor: "01업체", quantity: detailItem.다음입고예정수량 || detailItem.다음입고예정수량표시 || 50, note: "데모 입고예정" },
    { date: detailItem.최근입고 || "2026-10-20", type: detailItem.입고구분 || "국내", vendor: "02업체", quantity: detailItem.최근입고수량 || 30, note: "데모 최근입고" },
  ]).map((record, i) => ({
    ...record,
    vendor: record.vendor && record.vendor !== "-" ? record.vendor : demoVendors[i % demoVendors.length],
    quantity: record.quantity && record.quantity !== "-" ? record.quantity : (detailItem.다음입고예정수량 || detailItem.최근입고수량 || 20 + i * 5),
    note: record.note && record.note !== "-" ? record.note : demoNotes[i % demoNotes.length],
  }));
  const rows = history.map((record) => `<tr><td>${escapeHtml(record.date || "-")}</td><td><span class="inbound-history-type">${escapeHtml(record.type || "-")}</span></td><td>${escapeHtml(typeof maskVendorName==="function"?maskVendorName(record.vendor):(record.vendor||"-"))}</td><td class="inbound-history-quantity">${escapeHtml(record.quantity || "-")}</td><td>${escapeHtml(record.note || "-")}</td></tr>`).join("");
  panel.innerHTML = `<div class="inbound-history-heading"><div><p class="eyebrow">INBOUND HISTORY</p><h4>${escapeHtml(item.상품명 || "상품")} 최근 입고·입고예정 내역</h4><p>${escapeHtml(item.바코드 || "바코드 없음")} · 입고현황 자동화의 최근 분석 결과</p>${renderDepletionMetric(item, { compact: true })}</div><button type="button" class="inbound-history-close" aria-label="입고내역 닫기">×</button></div>${renderSharedProductSummary(detailItem)}${renderProductCoordHistoryHtml(item.바코드, item.상품명)}<div class="inbound-history-table-wrap"><table class="inbound-history-table"><thead><tr><th>날짜</th><th>구분</th><th>업체</th><th>수량</th><th>참고</th></tr></thead><tbody>${rows}</tbody></table></div>${renderProductExpiryLotsHtml(item.바코드, item.상품명)}`;
  panel.hidden = false;
  bindProductDetailEditors(panel, item.바코드, item.상품명);
  document.querySelectorAll(".inbound-product-button").forEach((button) => {
    button.setAttribute("aria-expanded", String(button.dataset.inboundKey === itemKey));
  });
  panel.querySelector(".inbound-history-close")?.addEventListener("click", closeInboundHistory);
  panel.scrollIntoView?.({ behavior: "smooth", block: "nearest" });
}

function closeSoldOutHistory() {
  activeSoldOutHistoryKey = "";
  const panel = document.querySelector("#soldout-history-panel");
  if (panel) {
    panel.hidden = true;
    panel.replaceChildren();
    window.HistoryPanelPlacement?.restoreOutsideTable(
      panel,
      document.querySelector("#soldout"),
      document.querySelectorAll(".soldout-inline-detail-row"),
    );
  }
  document.querySelectorAll(".soldout-product-button[aria-expanded='true']")
    .forEach((button) => button.setAttribute("aria-expanded", "false"));
}

function showSoldOutHistory(item, itemKey, anchorRow = null) {
  const panel = document.querySelector("#soldout-history-panel");
  if (!panel) return;
  if (activeSoldOutHistoryKey === itemKey && !panel.hidden) {
    closeSoldOutHistory();
    return;
  }
  activeSoldOutHistoryKey = itemKey;
  window.HistoryPanelPlacement?.restoreOutsideTable(
    panel,
    document.querySelector("#soldout"),
    document.querySelectorAll(".soldout-inline-detail-row"),
  );
  const detailItem = withClickedConfirmedRemark(item, anchorRow);
  let history = window.InboundTableEngine?.buildRecentInboundHistory(detailItem) || [];
  // 데모: 빈 업체/수량/참고를 반려동물 샘플로 채움
  const demoVendors = ["01업체", "02업체", "03업체", "04업체", "05업체"];
  const demoNotes = ["데모: 안전재고 확보", "데모: 시즌 물량", "데모: 리오더", "데모: 이벤트 대응", "데모: 유통기한 확인"];
  history = (history.length ? history : [
    { date: detailItem.다음입고 || detailItem.입고예정일 || "2026-11-10", type: "입고예정", vendor: "01업체", quantity: detailItem.다음입고예정수량 || detailItem.다음입고예정수량표시 || 50, note: "데모 입고예정" },
    { date: detailItem.최근입고 || "2026-10-20", type: detailItem.입고구분 || "국내", vendor: "02업체", quantity: detailItem.최근입고수량 || 30, note: "데모 최근입고" },
  ]).map((record, i) => ({
    ...record,
    vendor: record.vendor && record.vendor !== "-" ? record.vendor : demoVendors[i % demoVendors.length],
    quantity: record.quantity && record.quantity !== "-" ? record.quantity : (detailItem.다음입고예정수량 || detailItem.최근입고수량 || 20 + i * 5),
    note: record.note && record.note !== "-" ? record.note : demoNotes[i % demoNotes.length],
  }));
  const rows = history.map((record) => `<tr><td>${escapeHtml(record.date || "-")}</td><td><span class="inbound-history-type">${escapeHtml(record.type || "-")}</span></td><td>${escapeHtml(typeof maskVendorName==="function"?maskVendorName(record.vendor):(record.vendor||"-"))}</td><td class="inbound-history-quantity">${escapeHtml(record.quantity || "-")}</td><td>${escapeHtml(record.note || "-")}</td></tr>`).join("");
  panel.innerHTML = `<div class="inbound-history-heading"><div><p class="eyebrow">STOCK &amp; INBOUND HISTORY</p><h4>${escapeHtml(item.상품명 || "상품")} 최근 입고·입고예정 내역</h4><p>${escapeHtml(item.바코드 || "바코드 없음")} · 품절 검색 결과의 최근 분석 데이터</p>${renderDepletionMetric(item, { compact: true })}</div><button type="button" class="inbound-history-close" aria-label="입고내역 닫기">×</button></div>${renderSharedProductSummary(detailItem)}${renderProductCoordHistoryHtml(item.바코드, item.상품명)}<div class="inbound-history-table-wrap"><table class="inbound-history-table"><thead><tr><th>날짜</th><th>구분</th><th>업체</th><th>수량</th><th>참고</th></tr></thead><tbody>${rows}</tbody></table></div>${renderProductExpiryLotsHtml(item.바코드, item.상품명)}`;
  panel.hidden = false;
  bindProductDetailEditors(panel, item.바코드, item.상품명);
  document.querySelectorAll(".soldout-product-button").forEach((button) => {
    button.setAttribute("aria-expanded", String(button.dataset.soldoutKey === itemKey));
  });
  panel.querySelector(".inbound-history-close")?.addEventListener("click", closeSoldOutHistory);
  panel.scrollIntoView?.({ behavior: "smooth", block: "nearest" });
}

function setupInboundListControls(listKey, tableBodySelector, searchId, renderList) {
  const table = document.querySelector(tableBodySelector)?.closest("table");
  const title = table?.closest(".result")?.querySelector(".section-title");
  if (!table || !title || document.querySelector(`#${searchId}`)) return;
  const search = document.createElement("input");
  search.id = searchId;
  search.type = "search";
  search.className = "table-search-input";
  search.placeholder = "검색할 내용을 입력해주세요";
  search.setAttribute("aria-label", `${listKey === "inbound" ? "입고예정" : "품절"} 목록 전체 열 검색`);
  const deferredSearch = window.TableControls?.createDeferredSearchState(inboundListStates[listKey].query);
  const searchForm = document.createElement("form");
  searchForm.className = "table-search-form";
  searchForm.setAttribute("role", "search");
  const searchButton = document.createElement("button");
  searchButton.type = "submit";
  searchButton.className = "table-search-button";
  searchButton.setAttribute("aria-label", "검색 실행");
  searchButton.textContent = "🔍";
  searchForm.append(search, searchButton);
  if (listKey === "inbound") {
    const filters = document.createElement("div");
    filters.className = "inbound-category-filters";
    filters.setAttribute("aria-label", "상품 키워드 단일 선택 필터");
    ["의류", "하네스", "간식", "장난감", "리테일A", "리테일B", "리테일C", "단종", "현재고0"].forEach((category) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "inbound-category-chip";
      button.textContent = category;
      button.dataset.category = category;
      button.setAttribute("aria-pressed", "false");
      button.addEventListener("click", () => {
        const selected = window.InboundTableEngine?.toggleSingleCategory(
          inboundListStates.inbound.categories,
          category,
        ) || [];
        inboundListStates.inbound.categories = selected;
        inboundListStates.inbound.season = selected.includes("의류") ? inboundListStates.inbound.season : "";
        filters.querySelectorAll(".inbound-category-chip").forEach((chip) => {
          const isActive = selected.includes(chip.dataset.category);
          chip.classList.toggle("active", isActive);
          chip.setAttribute("aria-pressed", String(isActive));
        });
        closeInboundHistory();
        renderList();
      });
      filters.appendChild(button);
    });
    title.appendChild(filters);
    let historyPanel = document.querySelector("#inbound-history-panel");
    if (!historyPanel) {
      historyPanel = document.createElement("section");
      historyPanel.id = "inbound-history-panel";
      historyPanel.className = "inbound-history-panel";
      historyPanel.hidden = true;
      table.before(historyPanel);
    }
    table.tBodies[0]?.addEventListener("click", (event) => {
      const button = event.target.closest?.(".inbound-product-button");
      if (!button) return;
      const item = currentInboundItemsByKey.get(button.dataset.inboundKey);
      if (item) showInboundHistory(item, button.dataset.inboundKey, button.closest("tr"));
    });
  } else if (listKey === "soldout") {
    let historyPanel = document.querySelector("#soldout-history-panel");
    if (!historyPanel) {
      historyPanel = document.createElement("section");
      historyPanel.id = "soldout-history-panel";
      historyPanel.className = "inbound-history-panel";
      historyPanel.hidden = true;
      table.before(historyPanel);
    }
    if (!title.querySelector("#soldout-category-filters")) {
      const filters = document.createElement("div");
      filters.id = "soldout-category-filters";
      filters.className = "inbound-category-filters";
      filters.setAttribute("aria-label", "품절 목록 분류 필터");
      ["국내", "수입", "의류", "하네스", "간식", "장난감", "리테일A", "리테일B", "리테일C", "단종", "현재고0"].forEach((category) => {
        const button = document.createElement("button");
        button.type = "button";
        button.className = "inbound-category-chip";
        button.textContent = category;
        button.dataset.category = category;
        button.setAttribute("aria-pressed", "false");
        button.addEventListener("click", () => {
          const selected = window.InboundTableEngine?.toggleSingleCategory(
            inboundListStates.soldout.categories || [],
            category,
          ) || [];
          inboundListStates.soldout.categories = selected;
          inboundListStates.soldout.season = selected.includes("의류") ? inboundListStates.soldout.season : "";
          filters.querySelectorAll(".inbound-category-chip").forEach((chip) => {
            const isActive = selected.includes(chip.dataset.category);
            chip.classList.toggle("active", isActive);
            chip.setAttribute("aria-pressed", String(isActive));
          });
          closeSoldOutHistory();
          renderList();
        });
        filters.appendChild(button);
      });
      const reset = document.createElement("button");
      reset.type = "button";
      reset.id = "soldout-reset-categories";
      reset.className = "secondary";
      reset.textContent = "카테고리 초기화";
      reset.addEventListener("click", () => {
        inboundListStates.soldout.categories = [];
        inboundListStates.soldout.season = "";
        filters.querySelectorAll(".inbound-category-chip").forEach((chip) => {
          chip.classList.remove("active");
          chip.setAttribute("aria-pressed", "false");
        });
        closeSoldOutHistory();
        renderList();
      });
      filters.appendChild(reset);
      title.appendChild(filters);
    }
    table.tBodies[0]?.addEventListener("click", (event) => {
      const button = event.target.closest?.(".soldout-product-button");
      if (!button) return;
      const item = currentSoldOutItemsByKey.get(button.dataset.soldoutKey);
      if (item) showSoldOutHistory(item, button.dataset.soldoutKey, button.closest("tr"));
    });
  }
  title.appendChild(searchForm);
  search.addEventListener("input", () => deferredSearch?.setDraft(search.value));
  searchForm.addEventListener("submit", (event) => {
    event.preventDefault();
    inboundListStates[listKey].query = deferredSearch?.submit() ?? search.value;
    if (listKey === "inbound") closeInboundHistory();
    if (listKey === "soldout") closeSoldOutHistory();
    renderList();
  });
  [...(table.tHead?.rows[0]?.cells || [])].forEach((header, index) => {
    const [key, type] = inboundListColumns[listKey][index];
    const label = header.textContent.trim();
    const button = document.createElement("button");
    button.type = "button";
    button.className = "table-sort-button";
    button.textContent = label;
    button.dataset.sortKey = key;
    header.textContent = "";
    header.appendChild(button);
    header.setAttribute("aria-sort", "none");
    if (listKey === "soldout" && index === 4) setupSoldOutColumnFilter(header, renderList);
    button.addEventListener("click", () => {
      const state = inboundListStates[listKey];
      state.sortDirection = state.sortKey === key && state.sortDirection === "asc" ? "desc" : "asc";
      state.sortKey = key;
      state.sortType = type;
      [...table.tHead.rows[0].cells].forEach((cell) => cell.setAttribute("aria-sort", "none"));
      header.setAttribute("aria-sort", state.sortDirection === "asc" ? "ascending" : "descending");
      if (listKey === "inbound") closeInboundHistory();
      if (listKey === "soldout") closeSoldOutHistory();
      renderList();
    });
  });
}

function rowOverrideKey(row) {
  const name = String(row?.상품명 || row?.제품명 || "").replace(/^\(단종\)\s*/, "").trim();
  const barcode = String(row?.바코드 || "").replace(/\.0$/, "").trim();
  const bl = String(row?.BL || row?.컨테이너원본 || "").trim();
  const date = String(row?.입고예정정렬일 || row?.입고예정원본일 || "").trim();
  return [name, barcode, bl, date].join("|");
}

function findRowOverride(row) {
  const key = row?._editKey || rowOverrideKey(row);
  return (workspace.rowOverrides || []).find((item) => item.key === key) || null;
}

function applyRowOverride(row) {
  const key = rowOverrideKey(row);
  const edit = (workspace.rowOverrides || []).find((item) => item.key === key);
  if (!edit) return { ...row, _editKey: key };
  const discontinued = Boolean(edit.discontinued);
  return {
    ...row,
    _editKey: key,
    수동단종: discontinued,
    단종: discontinued ? "단종" : (row.단종 || ""),
    컨테이너표시: edit.containerName != null ? edit.containerName : row.컨테이너표시,
  };
}

function upsertRowOverride(key, patch) {
  if (!key) return;
  if (!Array.isArray(workspace.rowOverrides)) workspace.rowOverrides = [];
  const idx = workspace.rowOverrides.findIndex((item) => item.key === key);
  const prev = idx >= 0 ? workspace.rowOverrides[idx] : { key };
  const next = { ...prev, ...patch, key, updatedAt: new Date().toISOString() };
  if (!next.discontinued && !String(next.containerName || "").trim()) {
    workspace.rowOverrides = workspace.rowOverrides.filter((item) => item.key !== key);
  } else if (idx >= 0) {
    workspace.rowOverrides[idx] = next;
  } else {
    workspace.rowOverrides.unshift(next);
  }
  saveWorkspace();
}

function getWeeklyInboundItems(scheduleRows, targetStart, targetEnd) {
  let start, end;
  if (targetStart && targetEnd && targetStart instanceof Date && targetEnd instanceof Date) {
    start = targetStart;
    end = targetEnd;
  } else {
    const today = targetStart || new Date();
    const range = getWeekRange(today);
    start = range.start;
    end = range.end;
  }
  const normalizedRows = scheduleRows
    .map((row) => {
      const plannedInboundValue = row.다음입고 || row.국내다음계획일 || row.입고예상일 || row.예정입항일 || row.입고예정일 || "";
      const schedule = window.InboundTableEngine?.resolveInboundSchedule?.(row, plannedInboundValue) || {};
      const inboundDate = parseInboundDate(schedule.effectiveDate || plannedInboundValue);
      const plannedDate = parseInboundDate(schedule.plannedDate || plannedInboundValue);
      return inboundDate ? {
        ...row,
        입고예정원본일: plannedDate ? formatDate(plannedDate) : "",
        입고예정확정일: schedule.confirmedDate || "",
        입고예정일: formatKoreanDate(inboundDate),
        입고예정정렬일: formatDate(inboundDate),
        최근입고수량표시: getRecentInboundQuantity(row),
        다음입고예정수량표시: getNextInboundQuantity(row),
        입고구분표시: getInboundType(row),
        컨테이너표시: getContainerInfo(row),
      } : null;
    })
    .filter(Boolean)
    .map(applyRowOverride);
  const filteredRows = window.InboundTableEngine?.filterRowsByDateRange
    ? window.InboundTableEngine.filterRowsByDateRange(normalizedRows, start, end)
    : normalizedRows.filter((row) => parseInboundDate(row.입고예정정렬일) >= start && parseInboundDate(row.입고예정정렬일) <= end);
  return filteredRows
    .sort((left, right) => parseInboundDate(left.입고예정정렬일) - parseInboundDate(right.입고예정정렬일) || String(left.상품명 || "").localeCompare(String(right.상품명 || "")));
}

function getSoldOutItems(scheduleRows, stockThreshold = soldOutStockThreshold) {
  const expiryConsumed = window.ExpiryLotEngine?.consumedStockByBarcode?.(workspace.expiryLots || []) || {};
  return scheduleRows
    .map((row) => {
      const rawStock = String(row.현재고 ?? "").trim().replace(/,/g, "");
      const stock = rawStock ? Number(rawStock) : NaN;
      const barcode = String(row.바코드 || row.상품코드 || "").replace(/\.0$/, "").replace(/\s+/g, "");
      const stockAfterExpiry = stock < 0 ? stock : Math.max(0, stock - (expiryConsumed[barcode] || 0));
      const availability = Number.isFinite(stock) && stock >= 0
        ? window.SmartstoreInventoryEngine?.summarizeAvailability({ ...row, 현재고: stockAfterExpiry }, workspace.smartstoreReservations || [])
        : null;
      const statusRow = availability ? { ...row, 현재고: availability.regularAvailable } : row;
      let status = window.InboundTableEngine?.getSoldOutStatus(statusRow, stockThreshold)
        || (String(row.품절일자 || "").trim() ? "soldout" : "");
      if (availability?.status === "smartstore-available") status = "smartstore";
      if (!status) return null;
      const schedule = window.InboundTableEngine?.resolveInboundSchedule?.(
        row,
        row.다음입고 || row.국내다음계획일 || row.입고예상일 || row.예정입항일 || row.입고예정일 || "",
      ) || {};
      return {
        ...row,
        현재고: availability?.totalStock ?? row.현재고,
        스마트스토어전용수량: availability?.smartstoreReserved || 0,
        일반판매가능수량: availability?.regularAvailable ?? row.현재고,
        품절상태: status,
        품절상태표시: status === "smartstore" ? "전용 업체 출고가능" : (status === "near" ? "⚠ 품절임박" : "품절"),
        품절일: row.품절일자 || (status === "near"
          ? `현재고 1~${stockThreshold.toLocaleString("en-US")}개`
          : (status === "smartstore" ? `전용 ${availability.smartstoreReserved.toLocaleString("en-US")}개` : "현재고 0 이하")),
        최근입고내용: row.최근입고 || row.국내최근입고일 || row.수입입고일 || "-",
        다음입고내용: schedule.effectiveDate
          ? `${schedule.effectiveDate}${schedule.changed ? ` (확정 · 기존 ${schedule.plannedDate})` : ""}`
          : row.다음입고 || row.입고예상일 || "-",
        최근입고수량표시: getRecentInboundQuantity(row),
        다음입고예정수량표시: getNextInboundQuantity(row),
        입고구분표시: getInboundType(row),
        컨테이너표시: getContainerInfo(row),
      };
    })
    .filter(Boolean)
    .map(applyRowOverride)
    .sort((left, right) => String(left.품절일).localeCompare(String(right.품절일)) || String(left.상품명 || "").localeCompare(String(right.상품명 || "")));
}

function getWeekRange(today) {
  const date = new Date(today);
  date.setHours(0, 0, 0, 0);
  const day = date.getDay() || 7;
  const start = new Date(date);
  start.setDate(date.getDate() - day + 1);
  const end = new Date(start);
  end.setDate(start.getDate() + 6);
  end.setHours(23, 59, 59, 999);
  return { start, end };
}

function parseInboundDate(value) {
  const text = String(value || "").trim();
  const full = text.match(/20\d{2}[-./]\d{1,2}[-./]\d{1,2}/)?.[0];
  const short = full ? "" : text.match(/\b\d{2}[-./]\d{1,2}[-./]\d{1,2}\b/)?.[0];
  const veryShortMatch = (full || short) ? null : text.match(/(?:^|\b)(\d{1,2})[-./](\d{1,2})(?:$|\b)/);

  if (full || short) {
    const raw = full || short;
    const parts = raw.split(/[-./]/).map(Number);
    const year = parts[0] < 100 ? 2000 + parts[0] : parts[0];
    const parsed = new Date(year, parts[1] - 1, parts[2]);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }

  if (veryShortMatch) {
    const year = new Date().getFullYear();
    const month = Number(veryShortMatch[1]);
    const day = Number(veryShortMatch[2]);
    const parsed = new Date(year, month - 1, day);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }

  return null;
}

function formatDate(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function formatKoreanDate(date) {
  const weekDays = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day} (${weekDays[date.getDay()]})`;
}

function getNextInboundQuantity(row) {
  const direct = String(row.다음입고예정수량 || "").trim();
  if (direct) return direct;
  const nextMemo = String(row.다음입고 || "").match(/메모:\s*([^)]+)/)?.[1]?.trim();
  if (nextMemo) return nextMemo;
  return String(row.국내스케줄입고메모사항 || "").match(/특이사항:\s*([^\n]+)/)?.[1]?.trim() || "";
}

function getRecentInboundQuantity(row) {
  return window.InboundTableEngine?.getRecentInboundQuantity(row) ?? String(row.국내최근입고수량 || row.수입최근입고수량 || row.수입입고수량 || "").trim();
}

function getInboundType(row) {
    const plannedType = String(row["국내/수입"] || row.다음입고 || "").trim();
    const hasImportSchedule = row.입고예상일 && (row.예정입항일 || row.BL || row.수입예정업체 || row.수입업체 || !String(row.국내다음계획일 || "").trim());
    return plannedType.includes("수입") || hasImportSchedule ? "수입 컨테이너" : "국내입고";
  }

function getContainerInfo(row) {
  if (getInboundType(row) !== "수입 컨테이너") return "";
  return [row.BL, row.수입예정업체 || row.수입업체].filter(Boolean).join(" / ");
}

function parseCsv(csvText) {
  const rows = [];
  let row = [];
  let cell = "";
  let quoted = false;
  const text = String(csvText || "");
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    const next = text[index + 1];
    if (char === '"' && quoted && next === '"') {
      cell += '"';
      index += 1;
    } else if (char === '"') {
      quoted = !quoted;
    } else if (char === "," && !quoted) {
      row.push(cell);
      cell = "";
    } else if ((char === "\n" || char === "\r") && !quoted) {
      if (char === "\r" && next === "\n") index += 1;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else {
      cell += char;
    }
  }
  row.push(cell);
  rows.push(row);
  return rows;
}

function normalizeText(value) {
  return String(value || "").replace(/\s+/g, "").toLowerCase();
}

function findOrderSource(question, rows) {
  const normalizedQuestion = normalizeText(question);
  return [...new Set(rows.map((row) => row.주문사).filter(Boolean))].find((source) => normalizedQuestion.includes(normalizeText(source))) || "";
}

function getTopOrderedItem(rows, source) {
  const totals = new Map();
  rows
    .filter((row) => !source || row.주문사 === source)
    .forEach((row) => {
      totals.set(row.자사상품명, (totals.get(row.자사상품명) || 0) + Number(row.수량 || 0));
    });
  return [...totals.entries()]
    .map(([productName, quantity]) => ({ productName, quantity }))
    .sort((left, right) => right.quantity - left.quantity)[0];
}

function formatOrderPopularityAnswer(rows, source, topItem, updatedAt) {
  const sourceCount = new Set(rows.map((row) => row.주문사).filter(Boolean)).size;
  const sourceRows = rows.filter((row) => !source || row.주문사 === source);
  const sourceLabel = source || "전체 주문사";
  const basisDate = updatedAt || "현재 작업 데이터 기준";

  return [
    `${sourceLabel} 기준 가장 주문이 많은 품목은 ${topItem.productName}입니다.`,
    `집계 수량: ${topItem.quantity}개`,
    "",
    "근거",
    "- 참조데이터명: 주문사 인기품목 분석 데이터",
    `- 근거 데이터 일시: ${basisDate}`,
    `- 분석 범위: 총 ${rows.length}건 중 ${sourceRows.length}건`,
    `- 주문사 총 ${sourceCount}군데`,
    `- 대상 주문사: ${sourceLabel}`,
  ].join("\n");
}

function loadWorkspace() {
  const saved = localStorage.getItem(STORAGE_KEY);
  const base = createWorkspaceState(initialMaster);
  if (!saved) return { ...base, fileModes: {} };
  const parsed = window.WorkspaceStorage?.parseStoredWorkspace(saved);
  if (!parsed) return { ...base, fileModes: {} };
  let reviewItems = parsed.reviewItems || [];
  // 낡은 테스트 데이터 필터링
  reviewItems = reviewItems.filter(item => item.id !== 'review-1' && item.id !== 'review-2');

  const masterHistory = (Array.isArray(parsed.masterHistory) ? parsed.masterHistory : base.masterHistory).map((master, index) => normalizeMaster(master, index + 1));
  const savedMaster = Object.prototype.hasOwnProperty.call(parsed, "fixedMaster") ? parsed.fixedMaster : base.fixedMaster;
  const fixedMaster = savedMaster ? normalizeMaster(savedMaster, 1) : null;
  return {
    ...base,
    ...parsed,
    fixedMaster,
    masterHistory,
    reviewItems,
    selectedReviewItem: parsed.selectedReviewItem?.orderProduct && parsed.selectedReviewItem?.id !== 'review-1' && parsed.selectedReviewItem?.id !== 'review-2'
                        ? parsed.selectedReviewItem
                        : (getReviewSummary(reviewItems).items[0] || null),
    learningHistory: parsed.learningHistory || [],
    reviewDrafts: parsed.reviewDrafts || [],
    fileModes: parsed.fileModes || {},
    containerInboundRecords: parsed.containerInboundRecords || [],
    orderAnalysisUpdatedAt: parsed.orderAnalysisUpdatedAt || base.orderAnalysisUpdatedAt,
  };
}

function saveWorkspace() {
  const persistable = window.WorkspaceStorage?.createPersistableWorkspace(workspace) || workspace;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(persistable));
    return true;
  } catch (error) {
    console.error("작업공간 저장 실패", error);
    showToast("브라우저 저장 공간이 부족합니다. 원본 파일은 제외하고 현재 결과만 유지합니다.");
    return false;
  }
}

function fileNames(id) {
  const files = [...(document.querySelector(id).files || [])];
  if (!files.length) return "파일을 선택하세요";
  if (files.length === 1) return files[0].name;
  return `${files[0].name} 외 ${files.length - 1}개`;
}

function showToast(message) {
  const toast = document.querySelector("#toast");
  toast.textContent = message;
  toast.classList.add("show");
  setTimeout(() => toast.classList.remove("show"), 2600);
}

function loadGeminiSettings() {
  const keyInput = document.querySelector("#gemini-api-key");
  const modelInput = document.querySelector("#gemini-model");
  if (keyInput) keyInput.value = localStorage.getItem(GEMINI_KEY_STORAGE) || "";
  if (modelInput) modelInput.value = localStorage.getItem(GEMINI_MODEL_STORAGE) || modelInput.value || "gemini-3.5-flash";
}

function renderAdminMode() {
  const isAdminMode = localStorage.getItem(ADMIN_MODE_STORAGE) === "true";
  const settings = document.querySelector("#bot-admin-settings");
  const adminGate = document.querySelector("#admin-gate");
  const toggle = document.querySelector("#admin-mode-toggle");
  if (settings) settings.hidden = !canShowBotAdminSettings(isAdminMode) || Boolean(adminGate?.hidden);
  if (toggle) toggle.textContent = isAdminMode ? "관리자 모드 해제" : "관리자 모드";
  // 물류 대시보드 API 설정 패널 토글
  const opsAdmin = document.querySelector("#ops-admin-api-panel");
  if (opsAdmin) opsAdmin.hidden = !isAdminMode;
  if (isAdminMode && document.querySelector("#ops.page.active") && window.OpsDashboardUI) {
    window.OpsDashboardUI.render();
  }
}

function toggleAdminAccessPanel() {
  const adminGate = document.querySelector("#admin-gate");
  const accessButton = document.querySelector("#admin-access-toggle");
  if (!adminGate) return;
  adminGate.hidden = !adminGate.hidden;
  if (accessButton) accessButton.textContent = adminGate.hidden ? "관리자모드 사용하기" : "관리자모드 닫기";
  if (adminGate.hidden) {
    document.querySelector("#admin-login").hidden = true;
    document.querySelector("#password-recovery").hidden = true;
    document.querySelector("#bot-admin-settings").hidden = true;
  } else {
    renderAdminMode();
  }
}

function hideAdminAccessPanel() {
  document.querySelector("#admin-gate").hidden = true;
  document.querySelector("#admin-access-toggle").textContent = "관리자모드 사용하기";
  document.querySelector("#admin-login").hidden = true;
  document.querySelector("#password-recovery").hidden = true;
  document.querySelector("#bot-admin-settings").hidden = true;
}


function toggleAdminLogin() {
  const isAdminMode = localStorage.getItem(ADMIN_MODE_STORAGE) === "true";
  if (isAdminMode) {
    localStorage.removeItem(ADMIN_MODE_STORAGE);
    document.querySelector("#admin-login").hidden = true;
    renderAdminMode();
    showToast("관리자 모드를 해제했습니다.");
    return;
  }
  document.querySelector("#admin-login").hidden = !document.querySelector("#admin-login").hidden;
  document.querySelector("#admin-password").focus();
}

function submitAdminPassword() {
  const password = document.querySelector("#admin-password").value.trim();
  if (!verifyAdminPassword(password)) return showToast("관리자 비밀번호가 맞지 않습니다.");
  localStorage.setItem(ADMIN_MODE_STORAGE, "true");
  document.querySelector("#admin-password").value = "";
  document.querySelector("#admin-login").hidden = true;
  renderAdminMode();
  showToast("관리자 모드가 켜졌습니다.");
}

function requestAdminCode(purpose) {
  adminVerification = createAdminVerification(purpose);
  sendAdminVerificationEmail(adminVerification);
}

function sendAdminVerificationEmail(verification) {
  const answer = document.querySelector("#bot-answer");
  answer.innerHTML = `
    <div class="admin-verification-card">
      <p class="eyebrow">ADMIN VERIFICATION</p>
      <h4>인증코드가 준비됐습니다</h4>
      <div class="admin-code-box"><strong>${escapeHtml(verification.code)}</strong><button type="button" data-copy-admin-code="${escapeHtml(verification.code)}">코드 복사</button></div>
      <p>이 코드를 입력창에 붙여넣으세요.</p>
      <small>현재 버전은 정적 웹사이트라 실제 이메일 발송은 서버 연동 후 가능합니다. 발송 대상: ${escapeHtml(verification.email)}</small>
    </div>
  `;
  answer.querySelector("[data-copy-admin-code]")?.addEventListener("click", copyAdminVerificationCode);
  showToast("인증코드가 준비됐습니다. 복사해서 입력하세요.");
}

async function copyAdminVerificationCode(event) {
  const code = event.currentTarget.dataset.copyAdminCode;
  try {
    await navigator.clipboard.writeText(code);
    showToast("인증코드를 복사했습니다.");
  } catch (error) {
    showToast(`복사하지 못했습니다. 인증코드: ${code}`);
  }
}

function requestPasswordChangeCode() {
  requestAdminCode("password-change");
}

function changeAdminPassword() {
  const code = document.querySelector("#admin-change-code").value.trim();
  const nextPassword = document.querySelector("#new-admin-password").value.trim();
  if (!verifyAdminCode(adminVerification, code) || adminVerification?.purpose !== "password-change") return showToast("인증코드가 맞지 않습니다.");
  if (!nextPassword) return showToast("새 비밀번호를 입력하세요.");
  localStorage.setItem(ADMIN_PASSWORD_STORAGE, nextPassword);
  document.querySelector("#admin-change-code").value = "";
  document.querySelector("#new-admin-password").value = "";
  adminVerification = null;
  showToast("관리자 비밀번호를 변경했습니다.");
}

function requestPasswordRecovery() {
  adminVerification = createAdminVerification("password-recovery");
  document.querySelector("#password-recovery").hidden = false;
  sendAdminVerificationEmail(adminVerification);
}

function verifyPasswordRecovery() {
  const code = document.querySelector("#recovery-code").value.trim();
  if (!verifyAdminCode(adminVerification, code) || adminVerification?.purpose !== "password-recovery") return showToast("인증코드가 맞지 않습니다.");
  document.querySelector("#bot-answer").textContent = `인증되었습니다. 현재 관리자 비밀번호는 ${getAdminPassword()} 입니다.`;
  document.querySelector("#recovery-code").value = "";
  adminVerification = null;
}


/** 헬프봇 — 사용자 질문 → 관련 선택지 → 상세 답변 (데모 데이터) */
let botContext = {
  question: "",
  intent: "",
  options: [],
};

function getBotDemoCatalog() {
  return (workspace.productCatalog?.length ? workspace.productCatalog : defaultProductCatalog).slice();
}
function getBotDemoOrders() {
  return (workspace.orderAnalysisRows?.length ? workspace.orderAnalysisRows : defaultOrderAnalysisRows).slice();
}

function renderBotAnswerHtml(html) {
  const answer = document.querySelector("#bot-answer");
  if (!answer) return;
  answer.innerHTML = html;
}

function botChoiceButtons(choices) {
  return `<div class="bot-choice-list">${choices.map((c) =>
    `<button type="button" class="bot-choice-btn" data-bot-choice="${c.id}">${c.label}</button>`
  ).join("")}</div>`;
}

function normalizeBotText(s) {
  return String(s || "").toLowerCase().replace(/\s+/g, "");
}

/** 질문 분석 → 그 질문과 관련된 선택지 */
async function buildChoicesFromQuestion(question) {
  const q = String(question || "").trim();
  const nq = normalizeBotText(q);
  const catalog = getBotDemoCatalog();
  const orders = getBotDemoOrders();
  let rows = [];
  try { rows = await loadStockScheduleRows(); } catch (_) {}

  const barcode = q.match(/\b\d{8,14}\b/)?.[0];
  if (barcode) {
    const hit = catalog.find((p) => p.barcode === barcode);
    const schedule = (rows || []).filter((r) => String(r.바코드 || "") === barcode);
    const options = [];
    options.push({ id: "detail:product:" + barcode, label: hit ? `상품 정보 — ${hit.productName}` : `바코드 ${barcode} 상품 정보` });
    if (schedule.length) options.push({ id: "detail:inbound:" + barcode, label: "최근/다음 입고 일정 자세히" });
    options.push({ id: "detail:stock:" + barcode, label: "재고·출고대기 현황 자세히" });
    return {
      intent: "barcode",
      intro: `질문하신 바코드 <b>${barcode}</b> 에 대해 어떤 내용을 자세히 볼까요?`,
      options,
    };
  }

  const looseHits = catalog.filter((p) => {
    const tokens = String(p.productName).split(/\s+/).filter((t) => t.length >= 2);
    return tokens.some((t) => nq.includes(normalizeBotText(t)));
  });
  const products = looseHits.slice(0, 8);

  if (products.length && (/바코드|상품명|찾아|알려/.test(nq) || /\b(?:barcode|sku|product name|find|look up)\b/i.test(q))) {
    return {
      intent: "name_lookup",
      intro: `질문과 관련된 상품이 <b>${products.length}개</b> 있습니다. 자세히 볼 상품을 선택해 주세요.`,
      options: products.map((p) => ({
        id: "detail:product:" + p.barcode,
        label: `${p.productName}`,
      })),
    };
  }

  if (/주문|인기|많은|판매/.test(nq) || /\b(?:popular|best[ -]sell(?:ing|ers?)|top sellers?|order volume)\b/i.test(q)) {
    const sources = [...new Set(orders.map((r) => r.주문사).filter(Boolean))];
    return {
      intent: "popular",
      intro: `주문·인기 품목 질문이시네요. <b>어느 기준</b>으로 상세 순위를 볼지 선택해 주세요.`,
      options: [
        { id: "detail:pop:ALL", label: "전체 주문사 합산 순위" },
        ...sources.map((s) => ({ id: "detail:pop:" + s, label: `${s} 인기 품목` })),
      ],
    };
  }

  if (/입고|입항|스케줄|예정/.test(nq) || /\b(?:inbound|receipts?|arrivals?|delivery schedule)\b/i.test(q)) {
    if (products.length) {
      return {
        intent: "inbound",
        intro: `입고 일정을 자세히 볼 상품을 선택해 주세요.`,
        options: products.map((p) => ({ id: "detail:inbound:" + p.barcode, label: p.productName })),
      };
    }
    const list = (rows || []).filter((r) => r.다음입고 || r.입고예정일).slice(0, 8);
    return {
      intent: "inbound",
      intro: `입고 관련 질문입니다. 상세 일정을 볼 상품을 선택해 주세요.`,
      options: list.map((r) => ({
        id: "detail:inbound:" + (r.바코드 || ""),
        label: `${r.상품명 || r.제품명 || "상품"} · 다음 ${r.다음입고 || r.입고예정일 || "-"}`,
      })),
    };
  }

  if (/재고|출고|부족|품절/.test(nq) || /\b(?:stock|inventory|shipments?|dispatch|shortages?|stockouts?)\b/i.test(q)) {
    if (window.OpsDashboardEngine?.loadSnapshot) {
      const snap = await window.OpsDashboardEngine.loadSnapshot();
      const matchedBarcodes = new Set(products.map((product) => product.barcode));
      const grid = (snap.grid || []).filter((row) => !products.length || matchedBarcodes.has(row.sku))
        .sort((a, b) => Number(a.afterShip) - Number(b.afterShip)).slice(0, 8);
      return {
        intent: "stock",
        intro: `재고·출고 관련 질문입니다. 자세히 볼 상품을 선택해 주세요.`,
        options: grid.map((r) => ({
          id: "detail:stocksku:" + r.sku,
          label: `${r.productName} · 대기 ${r.demand} / 예상 ${r.afterShip}`,
        })),
      };
    }
  }

  if (/사용|방법|어떻게|메뉴/.test(nq) || /\b(?:how (?:to|do|can)|help|guide|menu)\b/i.test(q)) {
    return {
      intent: "howto",
      intro: `이용 방법이 궁금하신 메뉴를 선택해 주세요.`,
      options: [
        { id: "detail:howto:dashboard", label: "대시보드" },
        { id: "detail:howto:mapping", label: "주문매핑" },
        { id: "detail:howto:inbound", label: "입고예정·품절리스트" },
        { id: "detail:howto:ops", label: "재고현황" },
        { id: "detail:howto:coord", label: "협의보드" },
      ],
    };
  }

  if (products.length) {
    return {
      intent: "product_pick",
      intro: `질문과 비슷한 상품이 <b>${products.length}개</b> 있습니다. 해당하는 것을 선택해 주세요.`,
      options: products.map((p) => ({ id: "detail:product:" + p.barcode, label: p.productName })),
    };
  }

  return {
    intent: "clarify",
    intro: `「${q}」에 대해 어떤 상세 내용이 필요하신가요?`,
    options: [
      { id: "detail:clarify:product", label: "상품명·바코드 조회" },
      { id: "detail:clarify:inbound", label: "입고 일정" },
      { id: "detail:clarify:stock", label: "재고·출고대기" },
      { id: "detail:clarify:popular", label: "주문사 인기품목" },
      { id: "detail:howto:dashboard", label: "사이트 사용 방법" },
    ],
  };
}

function showBotChoices(intro, options) {
  botContext.options = options;
  renderBotAnswerHtml(`
    <p>${intro}</p>
    <p class="bot-hint">항목을 선택하면 데모 데이터로 자세히 답변합니다.</p>
    ${botChoiceButtons(options)}
  `);
}

async function answerBotDetail(choiceId) {
  const catalog = getBotDemoCatalog();
  const orders = getBotDemoOrders();
  let rows = [];
  try { rows = await loadStockScheduleRows(); } catch (_) {}

  if (choiceId === "detail:clarify:product") {
    showBotChoices("조회할 상품을 선택해 주세요.", catalog.slice(0, 8).map((p) => ({ id: "detail:product:" + p.barcode, label: p.productName })));
    return;
  }
  if (choiceId === "detail:clarify:inbound") {
    const list = (rows || []).filter((r) => r.다음입고 || r.입고예정일).slice(0, 8);
    showBotChoices("입고 상세를 볼 상품을 선택해 주세요.", list.map((r) => ({ id: "detail:inbound:" + r.바코드, label: `${r.상품명 || r.제품명} · ${r.다음입고 || r.입고예정일}` })));
    return;
  }
  if (choiceId === "detail:clarify:stock") {
    if (window.OpsDashboardEngine?.loadSnapshot) {
      const snap = await window.OpsDashboardEngine.loadSnapshot();
      showBotChoices("재고 상세를 볼 상품을 선택해 주세요.", (snap.grid || []).slice(0, 8).map((r) => ({ id: "detail:stocksku:" + r.sku, label: r.productName })));
    }
    return;
  }
  if (choiceId === "detail:clarify:popular") {
    const sources = [...new Set(orders.map((r) => r.주문사).filter(Boolean))];
    showBotChoices("주문사를 선택해 주세요.", [{ id: "detail:pop:ALL", label: "전체 합산" }, ...sources.map((s) => ({ id: "detail:pop:" + s, label: s }))]);
    return;
  }

  if (choiceId.startsWith("detail:product:")) {
    const bc = choiceId.replace("detail:product:", "");
    const p = catalog.find((x) => x.barcode === bc);
    if (!p) { renderBotAnswerHtml("<p>상품을 찾지 못했습니다.</p>"); return; }
    renderBotAnswerHtml(`
      <p><strong>상세 답변 · 상품 정보</strong></p>
      <p class="bot-hint">질문: ${botContext.question || "-"}</p>
      <ul class="bot-detail-list">
        <li><b>상품명</b> ${p.productName}</li>
        <li><b>바코드</b> ${p.barcode}</li>
        <li><b>자사상품코드</b> ${p.productCode || "-"}</li>
      </ul>`);
    return;
  }

  if (choiceId.startsWith("detail:inbound:")) {
    const bc = choiceId.replace("detail:inbound:", "");
    const r = (rows || []).find((x) => String(x.바코드 || "") === bc);
    if (!r) { renderBotAnswerHtml("<p>입고 데모 데이터가 없습니다.</p>"); return; }
    renderBotAnswerHtml(`
      <p><strong>상세 답변 · 입고 일정</strong></p>
      <p class="bot-hint">질문: ${botContext.question || "-"}</p>
      <ul class="bot-detail-list">
        <li><b>상품명</b> ${r.상품명 || r.제품명 || "-"}</li>
        <li><b>바코드</b> ${r.바코드 || "-"}</li>
        <li><b>현재고</b> ${r.현재고 ?? "-"}</li>
        <li><b>최근입고</b> ${r.최근입고 || "-"} · ${r.최근입고수량 ?? "-"}개</li>
        <li><b>다음입고</b> ${r.다음입고 || r.입고예정일 || "-"} · 예정 ${r.다음입고예정수량 ?? "-"}개</li>
        <li><b>구분/컨테이너</b> ${r.입고구분 || "-"} / ${r.컨테이너 || "-"}</li>
      </ul>`);
    return;
  }

  if (choiceId.startsWith("detail:stock:") || choiceId.startsWith("detail:stocksku:")) {
    const key = choiceId.replace("detail:stocksku:", "").replace("detail:stock:", "");
    const snap = window.OpsDashboardEngine ? await window.OpsDashboardEngine.loadSnapshot() : { grid: [] };
    const row = (snap.grid || []).find((x) => String(x.sku) === String(key));
    if (!row) { renderBotAnswerHtml("<p>재고현황에서 해당 SKU를 찾지 못했습니다.</p>"); return; }
    const risk = Number(row.afterShip) < 0 ? "출고 후 재고 부족(마이너스) 예상" : "출고 후 재고 여유";
    renderBotAnswerHtml(`
      <p><strong>상세 답변 · 재고/출고</strong></p>
      <p class="bot-hint">질문: ${botContext.question || "-"}</p>
      <ul class="bot-detail-list">
        <li><b>상품명</b> ${row.productName}</li>
        <li><b>출고대기</b> ${row.demand}개 ${row.channels ? "· " + row.channels : ""}</li>
        <li><b>택배출고량</b> ${row.retailDoneQty || 0}개</li>
        <li><b>전체/메인/기타</b> ${row.stockTotal} / ${row.stockMain} / ${row.stockOther}</li>
        <li><b>출고 후 예상</b> ${row.afterShip} — ${risk}</li>
        <li><b>입고예정</b> ${row.inboundDate || "-"} · ${row.inboundQty || 0}개</li>
      </ul>`);
    return;
  }

  if (choiceId.startsWith("detail:pop:")) {
    const src = choiceId.replace("detail:pop:", "");
    const filtered = src === "ALL" ? orders : orders.filter((r) => r.주문사 === src);
    const map = new Map();
    filtered.forEach((r) => {
      const k = r.자사상품명 || "-";
      map.set(k, (map.get(k) || 0) + Number(r.수량 || 0));
    });
    const ranked = [...map.entries()].sort((a, b) => b[1] - a[1]);
    const lines = ranked.map(([name, qty], i) => `<li><b>${i + 1}위</b> ${name} — <b>${qty}개</b></li>`).join("") || "<li>데이터 없음</li>";
    renderBotAnswerHtml(`
      <p><strong>상세 답변 · 인기품목</strong> (${src === "ALL" ? "전체" : src})</p>
      <p class="bot-hint">질문: ${botContext.question || "-"}</p>
      <ol class="bot-detail-list">${lines}</ol>`);
    return;
  }

  if (choiceId.startsWith("detail:howto:")) {
    const key = choiceId.replace("detail:howto:", "");
    const guides = {
      dashboard: "대시보드에서 협의보드 현황과 재고 요약을 봅니다. 좌측 하위 메뉴로 섹션 이동이 가능합니다.",
      mapping: "주문매핑에서 주문 파일을 올리고 자동 매핑을 실행합니다. 확인 필요 건은 매핑수정에서 처리합니다.",
      inbound: "입고예정은 기간별 스케줄, 품절리스트는 현재고 기준 품절·임박을 보여 줍니다.",
      ops: "재고현황은 SKU별 출고대기·창고재고·택배출고·출고 후 예상·입고예정을 한 표로 보여 줍니다.",
      coord: "협의보드는 회신대기 → 업체조율확정 → 입고완료 순으로 상태를 관리합니다.",
    };
    renderBotAnswerHtml(`
      <p><strong>상세 답변 · 사용 방법</strong></p>
      <p class="bot-hint">질문: ${botContext.question || "-"}</p>
      <p>${guides[key] || "해당 안내가 없습니다."}</p>`);
  }
}

function openBotDrawer() {
  document.querySelector("#bot-drawer").hidden = false;
  renderBotAnswerHtml(`
    <p><strong>질문을 입력해 주세요.</strong></p>
    <p class="bot-hint">Try "Zoo Bites chicken barcode", "best sellers", or "goat milk inbound".</p>
    <p class="bot-hint">Ask a question, then choose an option for a detailed answer.</p>`);
  document.querySelector("#bot-question")?.focus();
}

function closeBotDrawer() {
  document.querySelector("#bot-drawer").hidden = true;
  hideAdminAccessPanel();
}

function saveGeminiSettings() {
  const apiKey = document.querySelector("#gemini-api-key").value.trim();
  const model = document.querySelector("#gemini-model").value.trim() || "gemini-3.5-flash";
  if (!apiKey) return showToast("Gemini API 키를 입력하세요.");
  localStorage.setItem(GEMINI_KEY_STORAGE, apiKey);
  localStorage.setItem(GEMINI_MODEL_STORAGE, model);
  showToast("Gemini 설정을 이 브라우저에 저장했습니다.");
}

async function askGemini() {
  const question = document.querySelector("#bot-question").value.trim();
  if (!question) return showToast("질문을 입력해 주세요.");
  botContext.question = question;
  renderBotAnswerHtml(`<p class="bot-hint">질문과 관련된 선택지를 준비하는 중…</p>`);
  const built = await buildChoicesFromQuestion(question);
  botContext.intent = built.intent;
  if (!built.options?.length) {
    renderBotAnswerHtml(`<p>관련 선택지를 만들지 못했습니다. 상품명·바코드·주문사 등을 넣어 다시 질문해 주세요.</p>`);
    return;
  }
  showBotChoices(built.intro, built.options);
}

document.addEventListener("click", (event) => {
  const btn = event.target?.closest?.("[data-bot-choice]");
  if (!btn) return;
  const id = btn.getAttribute("data-bot-choice");
  if (id) answerBotDetail(id);
});


function addFileModeControls() {
  [
    { inputId: "master-file", key: "master" },
    { inputId: "manual-file", key: "manual" },
  ].forEach(({ inputId, key }) => {
    const input = document.querySelector(`#${inputId}`);
    const dropzone = input?.closest(".dropzone");
    if (!dropzone || dropzone.nextElementSibling?.dataset.fileMode === key) return;
    dropzone.insertAdjacentHTML(
      "afterend",
      `<div class="file-mode" data-file-mode="${key}"><span>파일 사용 방식</span><button type="button" data-mode="replace">이번 작업만</button><button type="button" data-mode="fixed">고정해서 계속 사용</button></div>`,
    );
    const mode = workspace.fileModes[key] || (key === "master" ? "fixed" : "replace");
    const container = document.querySelector(`[data-file-mode="${key}"]`);
    container.querySelectorAll("button").forEach((button) => {
      button.classList.toggle("selected", button.dataset.mode === mode);
      button.addEventListener("click", () => {
        workspace.fileModes[key] = button.dataset.mode;
        saveWorkspace();
        container.querySelectorAll("button").forEach((item) => item.classList.toggle("selected", item === button));
        showToast(button.dataset.mode === "fixed" ? "이 파일을 다음 작업에서도 사용하도록 고정했습니다." : "이번 작업에만 사용하는 방식으로 바꿨습니다.");
      });
    });
  });
}

function addDashboardReviewShortcut() {
  const reviewCard = document.querySelector(".cards article:nth-child(3)");
  if (!reviewCard) return;
  reviewCard.classList.add("clickable-review");
  reviewCard.tabIndex = 0;
  reviewCard.title = "검토 필요 항목 보기";
  const openReview = () => {
    openPage("review");
    document.querySelector("#review-result").hidden = false;
    renderReviewItems();
    renderSelectedReviewItem();
  };
  reviewCard.addEventListener("click", openReview);
  reviewCard.addEventListener("keydown", (event) => {
    if (event.key === "Enter" || event.key === " ") openReview();
  });
}

function addDashboardJobShortcut() {
  const jobCard = document.querySelector(".cards article:nth-child(2)");
  if (!jobCard) return;
  jobCard.classList.add("clickable-review");
  jobCard.tabIndex = 0;
  jobCard.title = "이번 달 작업 이력 보기";
  const openHistory = () => openPage("history");
  jobCard.addEventListener("click", openHistory);
  jobCard.addEventListener("keydown", (event) => {
    if (event.key === "Enter" || event.key === " ") openHistory();
  });
}

function addCorrectionPanel() {
  const reviewResult = document.querySelector("#review-result");
  if (!reviewResult || document.querySelector("#correction-text")) return;
  reviewResult.insertAdjacentHTML(
    "beforeend",
    `<div class="correction"><div><p class="eyebrow">정답 검증</p><h3 id="selected-review-title">검토 건을 선택하세요</h3><p id="selected-review-detail"></p></div><textarea id="correction-text" placeholder="예: 터키츄링 S 1박스는 PD25123100040으로 40개 반영"></textarea><div class="interpretation" id="interpretation" hidden></div><div class="correction-actions"><button id="save-draft" class="secondary">이 건 임시저장</button><label class="confirm-check"><input id="approve-confirm" type="checkbox" /> 해석한 내용이 맞습니다</label><button id="approve-drafts" class="primary">승인 후 반영</button></div><div id="draft-list" class="draft-list"></div><div class="processed-results"><p class="eyebrow">처리 결과 내보내기</p><div id="processed-list" class="processed-list"></div></div><p id="correction-status" class="correction-status"></p></div>`,
  );
  document.querySelector("#correction-text").addEventListener("input", renderInterpretation);
  document.querySelector("#save-draft").addEventListener("click", saveCurrentDraft);
  document.querySelector("#approve-drafts").addEventListener("click", approveDrafts);
}

function saveCurrentDraft() {
  const selected = workspace.selectedReviewItem;
  const rawText = document.querySelector("#correction-text").value.trim();
  const parsed = parseReviewAnswer(rawText, selected);
  if (!selected) return showToast("먼저 검토 필요 항목을 선택하세요.");
  if (!rawText || parsed.productCode === "확인 필요" || !parsed.quantity) return showToast("수량을 입력하세요. 상품은 선택된 자사매핑정보를 기준으로 반영합니다.");
  workspace.reviewDrafts = [
    {
      reviewItemId: selected.id,
      orderNo: selected.orderNo,
      sourceText: selected.sourceText,
      option1: selected.option1,
      option2: selected.option2,
      rawText,
      productCode: parsed.productCode,
      mappedProduct: findProductNameByCode(parsed.productCode) || parsed.productCode,
      mappedQuantity: parsed.quantity,
      quantity: parsed.quantity,
      savedAt: new Date().toISOString(),
      timestamp: Date.now(),
    },
    ...(workspace.reviewDrafts || []),
  ];
  saveWorkspace();
  renderDrafts();
  document.querySelector("#correction-text").value = "";
  renderInterpretation();
  showToast("이 검토 건을 임시저장했습니다.");
}

function approveDrafts() {
  if (!document.querySelector("#approve-confirm").checked) return showToast("반영 전 해석 확인 체크가 필요합니다.");

  const rawText = document.querySelector("#correction-text").value.trim();
  if (rawText && workspace.selectedReviewItem) {
    const selected = workspace.selectedReviewItem;
    const parsed = parseReviewAnswer(rawText, selected);
    if (parsed.productCode !== "확인 필요" && parsed.quantity) {
      workspace.reviewDrafts = [
        {
          reviewItemId: selected.id,
          orderNo: selected.orderNo,
          sourceText: selected.sourceText,
          option1: selected.option1,
          option2: selected.option2,
          rawText,
          productCode: parsed.productCode,
          mappedProduct: findProductNameByCode(parsed.productCode) || parsed.productCode,
          mappedQuantity: parsed.quantity,
          quantity: parsed.quantity,
          savedAt: new Date().toISOString(),
          timestamp: Date.now(),
        },
        ...(workspace.reviewDrafts || []),
      ];
      document.querySelector("#correction-text").value = "";
    } else {
      return showToast("수량을 입력하세요. 상품은 선택된 자사매핑정보를 기준으로 반영합니다.");
    }
  }

  if (!(workspace.reviewDrafts || []).length) return showToast("승인할 임시저장 건이 없습니다.");
  workspace.learningHistory = [...workspace.reviewDrafts, ...(workspace.learningHistory || [])];
  workspace.reviewDrafts = [];
  workspace.jobs = (workspace.jobs || []).map((job) => ({ ...job, status: "검토완료" }));
  saveWorkspace();
  render();
  renderDrafts();
  renderProcessedResults();
  document.querySelector("#approve-confirm").checked = false;
  document.querySelector("#correction-status").textContent = "승인된 정답을 매핑 기준과 학습 이력에 반영했습니다.";
  showToast("검토 정답을 최종 반영했습니다.");
}

function findReviewItem(reviewItemId) {
  const reviewItems = getReviewSummary(workspace.reviewItems || defaultReviewItems, workspace.learningHistory).items;
  return reviewItems.find((item) => item.id === reviewItemId) || (workspace.reviewItems || defaultReviewItems).find((item) => item.id === reviewItemId) || null;
}

function findProductNameByCode(productCode) {
  const productCatalog = workspace.productCatalog?.length ? workspace.productCatalog : defaultProductCatalog;
  return productCatalog.find((item) => item.productCode === productCode)?.productName || "";
}

function buildProcessedRow(record) {
  const reviewItem = findReviewItem(record.reviewItemId) || {};
  const beforeQuantity = Number(reviewItem.mappedQuantity ?? 0);
  const afterQuantity = Number(record.quantity ?? 0);
  const productName = record.productName || findProductNameByCode(record.productCode) || reviewItem.mappedProduct || "";
  const reason = reviewItem.mismatches?.length ? reviewItem.mismatches.join(", ") : "사용자 승인 반영";
  return {
    작업구분: "수동 매핑 검토",
    처리상태: "승인 반영",
    주문번호: record.orderNo,
    주문내용: reviewItem.orderProduct || record.sourceText,
    옵션1: reviewItem.option1 || "",
    옵션2: reviewItem.option2 || "",
    기존자사상품명: reviewItem.mappedProduct || "",
    기존자사상품코드: reviewItem.productCode || "",
    기존매핑수량: beforeQuantity,
    수정자사상품명: productName,
    수정자사상품코드: record.productCode,
    수정수량: afterQuantity,
    수량차이: afterQuantity - beforeQuantity,
    정확도: `${reviewItem.accuracy ?? ""}${reviewItem.accuracy === undefined ? "" : "%"}`,
    검토사유: reason,
    사용자정답: record.rawText,
  };
}

function buildProcessedExport(target, reviewItemId) {
  const record = (workspace.learningHistory || []).find((item) => item.reviewItemId === reviewItemId);
  if (!record) return null;
  const rows = [buildProcessedRow(record)];
  const content = target === "excel" ? toExcelHtml(rows) : toCsv(rows);
  return {
    fileName: target === "excel" ? `mapping-correction_${record.orderNo}.xls` : `mapping-correction_${record.orderNo}.csv`,
    mimeType: target === "excel" ? "application/vnd.ms-excel;charset=utf-8" : "text/csv;charset=utf-8",
    content,
  };
}

function getMappingPreviewRows() {
  return Array.isArray(workspace.mappingPreviewRows) ? workspace.mappingPreviewRows : defaultMappingPreviewRows;
}

function buildJobHistoryExport(target, selectedJobIds = []) {
  const rows = getJobResultRows(selectedJobIds);
  if (!rows.length) return null;
  const content = target === "excel" ? toExcelHtml(rows) : toCsv(rows);
  return {
    fileName: target === "excel" ? "mapping-job-results.xls" : "mapping-job-results.csv",
    mimeType: target === "excel" ? "application/vnd.ms-excel;charset=utf-8" : "text/csv;charset=utf-8",
    content,
  };
}

function buildMasterExports(selectedMasterIds = []) {
  const masterIdSet = new Set(selectedMasterIds);
  return (workspace.masterHistory || [])
    .filter((master) => !masterIdSet.size || masterIdSet.has(master.id))
    .map((master) => buildMasterExportFile(master))
    .filter(Boolean);
}

function buildMasterExportFile(master) {
  if (master.content) {
    return {
      fileName: master.name,
      mimeType: master.mimeType || "application/octet-stream",
      content: master.content,
      encoding: master.encoding || "base64",
    };
  }
  const catalog = master.productCatalog
    || (master.id === workspace.fixedMaster?.id ? workspace.productCatalog : null)
    || demoDefaults.masterHistory.find(version => version.id === master.id)?.productCatalog;
  if (!catalog?.length) return null;
  return {
    fileName: `${String(master.name || "product-catalog").replace(/\.(xlsx|xls|csv)$/i, "")}_products.xls`,
    mimeType: "application/vnd.ms-excel;charset=utf-8",
    content: toExcelHtml(getFallbackMasterRows(catalog)),
    encoding: "text",
  };
}

function getFallbackMasterRows(catalog = defaultProductCatalog) {
  return catalog.map((product) => ({
    자사상품코드: product.productCode,
    바코드: product.barcode,
    자사상품명: product.productName,
    기준수량: 1,
    박스입수: "",
  }));
}

function getJobHistoryRows(selectedJobIds = []) {
  const selectedJobIdSet = new Set(selectedJobIds);
  const jobs = workspace.jobs;
  const hasReviewedRecords = Boolean((workspace.learningHistory || []).length);
  return jobs.filter((job) => !selectedJobIdSet.size || selectedJobIdSet.has(job.id)).map((job) => ({
    id: job.id,
    작업파일: job.orderName,
    적용마스터: job.masterName,
    상태: hasReviewedRecords && job.status === "매핑 준비" ? "검토완료" : job.status,
    실행시각: job.createdAt || "방금 전",
  }));
}

function getJobResultRows(selectedJobIds = []) {
  const selectedJobIdSet = new Set(selectedJobIds);
  const jobs = workspace.jobs;
  const targetJobs = jobs.filter((job) => !selectedJobIdSet.size || selectedJobIdSet.has(job.id));
  return targetJobs.flatMap((job) => {
    const decisions = Array.isArray(job.resultRows) ? job.resultRows : window.PortfolioData.demoJobResultRows(job.id);
    return decisions.map((decision) => ({
      작업ID: job.id,
      작업파일: job.orderName,
      ...MappingEngine.toHistoryRow(decision),
      작업상태: job.status,
    }));
  });
}

function downloadProcessedResult(target, reviewItemId) {
  const output = buildProcessedExport(target, reviewItemId);
  if (!output) return showToast("다운로드할 처리 결과가 없습니다.");
  const blob = new Blob([output.content], { type: output.mimeType });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = output.fileName;
  link.click();
  URL.revokeObjectURL(link.href);
  showToast(target === "excel" ? "엑셀 파일을 다운로드했습니다." : "구글시트 추가용 CSV를 다운로드했습니다.");
}

function downloadJobHistory(target, selectedJobIds = getCheckedValues("[data-job-check]:checked")) {
  if (!selectedJobIds.length) return showToast("다운로드할 작업 이력을 체크하세요.");
  const output = buildJobHistoryExport(target, selectedJobIds);
  if (!output) return showToast("선택한 작업에 저장된 매핑 결과가 없습니다.");
  downloadStoredFile(output);
  showToast(target === "excel" ? "선택한 작업 이력 엑셀 파일을 다운로드했습니다." : "선택한 작업 이력 CSV를 다운로드했습니다.");
}

function downloadMaster(target) {
  const selectedMasterIds = getCheckedValues("[data-master-check]:checked");
  if (!selectedMasterIds.length) return showToast("다운로드할 마스터 파일을 체크하세요.");
  const outputs = buildMasterExports(selectedMasterIds);
  if (!outputs.length) return showToast("선택한 이력에 저장된 상품목록이 없습니다.");
  outputs.forEach((output) => downloadStoredFile(output));
  showToast("선택한 마스터의 상품목록을 다운로드했습니다.");
}

function downloadStoredFile(output) {
  const blob = output.encoding === "base64" ? base64ToBlob(output.content, output.mimeType) : new Blob([output.content], { type: output.mimeType });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = output.fileName;
  link.click();
  URL.revokeObjectURL(link.href);
}

function base64ToBlob(base64, mimeType) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return new Blob([bytes], { type: mimeType });
}

  async function fileToStoredMaster(file) {
    const buffer = await file.arrayBuffer();
    const parseResult = await parseMasterCatalogFromFile(file, buffer);
    if (!parseResult.productCatalog?.length) throw new Error(parseResult.message || "유효한 상품이 없는 마스터는 등록할 수 없습니다.");
    return {
      name: file.name,
      originalName: file.name,
      mimeType: file.type || "application/octet-stream",
      productCatalog: parseResult.productCatalog,
      parseMessage: parseResult.message,
      fixedAt: new Date().toISOString().slice(0, 10),
      owner: "공용",
    };
  }

  async function fileToBase64(file) {
    const buffer = await file.arrayBuffer();
    return arrayBufferToBase64(buffer);
  }

  function arrayBufferToBase64(buffer) {
    let binary = "";
    const bytes = new Uint8Array(buffer);
    bytes.forEach((byte) => {
      binary += String.fromCharCode(byte);
    });
    return btoa(binary);
  }

  async function parseMasterCatalogFromFile(file, buffer) {
    try {
      const lowerName = String(file.name || "").toLowerCase();
      if (/\.xls[xmb]?$/i.test(lowerName)) {
        const workbook = await readWorkbook(buffer);
        const rows = workbook.SheetNames.flatMap((sheetName) => XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], { header: 1, raw: false, defval: "" }));
        const productCatalog = parseMasterCatalogRows(rows);
        return { productCatalog, message: productCatalog.length ? `${productCatalog.length}개 상품을 즉시 반영했습니다.` : "엑셀에서 자사상품코드/상품명 헤더를 찾지 못했습니다." };
      }
      const text = new TextDecoder("utf-8").decode(buffer);
      const delimiter = lowerName.endsWith(".tsv") ? "\t" : ",";
      const productCatalog = parseMasterCatalogFromText(text, delimiter);
      return { productCatalog, message: productCatalog.length ? `${productCatalog.length}개 상품을 즉시 반영했습니다.` : "파일에서 자사상품코드/상품명 헤더를 찾지 못했습니다." };
    } catch (error) {
      return { productCatalog: [], message: `마스터 상품목록 자동 반영 실패: ${error.message}` };
    }
  }

  async function readWorkbook(buffer) {
    if (!window.XLSX) await loadScript("https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js");
    if (!window.XLSX) throw new Error("엑셀 해석 라이브러리를 불러오지 못했습니다.");
    return window.XLSX.read(buffer, { type: "array" });
  }

  const pendingScripts = new Map();
  function loadScript(src) {
    if (window.XLSX) return Promise.resolve();
    if (pendingScripts.has(src)) return pendingScripts.get(src);
    const loading = new Promise((resolve, reject) => {
      document.querySelector(`script[src="${src}"]`)?.remove();
      const script = document.createElement("script");
      script.src = src;
      script.onload = resolve;
      script.onerror = () => {
        script.remove();
        reject(new Error("엑셀 처리 기능을 불러오지 못했습니다."));
      };
      document.head.appendChild(script);
    }).finally(() => pendingScripts.delete(src));
    pendingScripts.set(src, loading);
    return loading;
  }

  function parseMasterCatalogFromText(text, delimiter) {
    const rawText = String(text || "");
    const rows = rawText.trimStart().startsWith("<")
      ? parseHtmlTableRows(rawText)
      : delimiter === "\t"
        ? rawText.split(/\r?\n/).map((line) => line.split("\t"))
        : parseCsv(rawText);
    return parseMasterCatalogRows(rows);
  }

  function parseMasterCatalogRows(rows) {
    const cleanRows = (rows || []).filter((row) => row.some((cell) => String(cell).trim()));
    const headerIndex = cleanRows.findIndex((row) => findHeaderIndex(row, ["자사상품코드", "상품코드", "코드"]) >= 0 && findHeaderIndex(row, ["상품명", "자사상품명", "품명"]) >= 0);
    if (headerIndex < 0) return [];
    const headers = cleanRows[headerIndex].map((header) => normalizeHeader(header));
    const codeIndex = findHeaderIndex(headers, ["자사상품코드", "상품코드", "코드", "productcode"]);
    const barcodeIndex = findHeaderIndex(headers, ["바코드", "barcode", "jan", "ean"]);
    const nameIndex = findHeaderIndex(headers, ["자사상품명", "상품명", "품명", "productname", "name"]);
    if (codeIndex < 0 || nameIndex < 0) return [];
    const catalog = cleanRows.slice(headerIndex + 1).map((row) => ({
      productCode: String(row[codeIndex] || "").trim(),
      barcode: barcodeIndex >= 0 ? String(row[barcodeIndex] || "").trim() : "",
      productName: String(row[nameIndex] || "").trim(),
    })).filter((item) => item.productCode && item.productName);
    return [...new Map(catalog.map((item) => [item.productCode, item])).values()];
  }

  function parseHtmlTableRows(html) {
    return [...String(html || "").matchAll(/<tr[\s\S]*?<\/tr>/gi)].map((rowMatch) =>
      [...rowMatch[0].matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi)].map((cellMatch) =>
        cellMatch[1].replace(/<[^>]+>/g, "").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").trim(),
      ),
    );
  }

  function normalizeHeader(value) {
    return String(value || "").replace(/\s+/g, "").toLowerCase();
  }

  function findHeaderIndex(row, candidates) {
    const normalizedCandidates = candidates.map(normalizeHeader);
    return row.findIndex((cell) => normalizedCandidates.includes(normalizeHeader(cell)));
  }

function getCheckedValues(selector) {
  return [...document.querySelectorAll(selector)].map((input) => input.value);
}

function normalizeMaster(master, index) {
  return {
    id: master.id || `master-${index}`,
    fixed: master.fixed ?? true,
    owner: master.owner || "공용",
    ...master,
  };
}

function translateExportValue(value) {
  return window.EnglishDemo?.translate(value) ?? value;
}

function toCsv(rows) {
  const headers = Object.keys(rows[0] || {});
  const values = rows.map((row) => headers.map((header) => quoteCsv(translateExportValue(row[header]))).join(","));
  return ["\ufeff" + headers.map(header => quoteCsv(translateExportValue(header))).join(","), ...values].join("\n");
}

function quoteCsv(value) {
  const text = String(value ?? "");
  return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function toExcelHtml(rows) {
  const headers = Object.keys(rows[0] || {});
  const head = headers.map((header) => `<th>${escapeHtml(translateExportValue(header))}</th>`).join("");
  const body = rows
    .map((row) => `<tr>${headers.map((header) => `<td>${escapeHtml(translateExportValue(row[header]))}</td>`).join("")}</tr>`)
    .join("");
  return `\ufeff<html><head><meta charset="utf-8" /></head><body><table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table></body></html>`;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function renderInterpretation() {
  const target = document.querySelector("#interpretation");
  if (!target) return;
  const parsed = parseReviewAnswer(document.querySelector("#correction-text").value.trim(), workspace.selectedReviewItem);
  if (!parsed.rawText) {
    target.hidden = true;
    target.textContent = "";
    return;
  }
  target.hidden = false;
  target.innerHTML = `<b>해석 결과</b><span>자사상품코드 ${parsed.productCode} · 반영 수량 ${parsed.quantity || "확인 필요"}개</span>`;
}

function renderSelectedReviewItem() {
  const selected = workspace.selectedReviewItem || getReviewSummary(workspace.reviewItems || defaultReviewItems).items[0];
  const title = document.querySelector("#selected-review-title");
  const detail = document.querySelector("#selected-review-detail");
  if (!title || !detail || !selected) return;
  title.textContent = `${selected.orderNo} 정답 입력`;
  detail.textContent = `주문사 ${selected.orderProduct} ${selected.orderQuantity}개 · 자사매핑 ${selected.mappedProduct} ${selected.mappedQuantity}개 · 정확도 ${selected.accuracy}%`;
}

function renderReviewItems() {
  const body = document.querySelector("#review-items-body");
  if (!body) return;
  const summary = getReviewSummary(workspace.reviewItems || defaultReviewItems, workspace.learningHistory);
  body.innerHTML = summary.items.length
    ? summary.items
    .map(
      (item) =>
        `<tr class="${workspace.selectedReviewItem?.id === item.id ? "selected-row" : ""}" data-review-id="${escapeHtml(item.id)}">
          <td>${escapeHtml(item.orderNo)}</td>
          <td><strong>${escapeHtml(item.orderProduct)}</strong><small>${escapeHtml(item.orderQuantity)}개</small></td>
          <td><strong>${escapeHtml(item.mappedProduct)}</strong><small>${escapeHtml(item.productCode || "")} · ${escapeHtml(item.mappedQuantity)}개</small></td>
          <td>
            <span class="${item.accuracy < item.threshold ? "accuracy-bad" : "accuracy-good"}">${escapeHtml(item.accuracy)}%</span>
            <small>기준 ${escapeHtml(item.threshold)}%</small><br/>
            <small style="color:#c73c35; font-weight:bold; margin-top:4px;">${item.mismatches.map(escapeHtml).join("<br />")}</small>
          </td>
          <td class="correction-inputs" style="vertical-align: middle;">
            <input type="text" class="correction-product" value="${item.mappedProduct === '매핑 필요' ? '' : item.mappedProduct}" placeholder="정확한 상품명" style="width:100%; border:1px solid #dedfe1; border-radius:4px; padding:6px; font-size:12px; margin-bottom:4px;" />
            <input type="number" class="correction-qty" value="${item.mappedQuantity || item.orderQuantity}" style="width:60px; border:1px solid #dedfe1; border-radius:4px; padding:6px; font-size:12px;" />
          </td>
          <td style="vertical-align: middle;">
            <button type="button" style="border:1px solid #f47c00;background:#fff;color:#c65b00;border-radius:6px;padding:6px 10px;font-size:12px;font-weight:700;cursor:pointer;width:100%;" data-apply-review="${escapeHtml(item.id)}">수정 반영</button>
          </td>
        </tr>`,
    )
    .join("")
    : `<tr><td colspan="6" style="text-align:center; padding:20px;">정확도 기준 미달이나 상품·수량 차이가 있는 검토 필요 항목이 없습니다.</td></tr>`;
  body.querySelectorAll("[data-apply-review]").forEach(button => {
    button.addEventListener("click", () => window.applyRowCorrection(button.dataset.applyReview, button));
  });
  body.querySelectorAll("tr").forEach((row) => row.addEventListener("click", (event) => {
    if (window.TableControls?.isInteractiveTableTarget(event.target)) return;
    selectReviewItem(row.dataset.reviewId);
  }));
}

window.applyRowCorrection = function(reviewId, btn) {
  const tr = btn.closest('tr');
  const prodInput = tr.querySelector('.correction-product');
  const qtyInput = tr.querySelector('.correction-qty');
  if (!prodInput || !qtyInput) return;
  const mappedProduct = prodInput.value.trim();
  const quantity = Number(qtyInput.value);
  if (!mappedProduct) {
    alert("정확한 상품명을 입력해주세요.");
    return;
  }
  if (!qtyInput.value.trim() || !Number.isSafeInteger(quantity) || quantity <= 0) {
    alert("수량은 1 이상의 정수로 입력해주세요.");
    return;
  }
  const reviewItem = workspace.reviewItems.find(i => i.id === reviewId);
  if (!reviewItem) return;

  workspace.learningHistory = workspace.learningHistory || [];
  workspace.learningHistory = workspace.learningHistory.filter((item) => item.reviewItemId !== reviewItem.id);
  workspace.learningHistory.unshift({
    ...reviewItem,
    id: `learning-${Date.now()}`,
    reviewItemId: reviewItem.id,
    mappedProduct,
    quantity,
    mappedQuantity: quantity,
    rawText: `${mappedProduct} / ${quantity}개`,
    correctionReason: (reviewItem.mismatches || []).join(" | "),
    timestamp: Date.now(),
    savedAt: new Date().toISOString(),
  });

  const correction = {
    mappedProduct, mappedQuantity: quantity, expectedQuantity: quantity,
    accuracy: 100, finalStatus: "정상", mismatches: [],
    minimumDecision: "수동 검토 완료", productDecision: "수동 검토 완료",
    quantityDecision: "수동 검토 완료", componentDecision: "수동 검토 완료",
    correctionAnswer: `${mappedProduct} / ${quantity}개`, decisionText: "수동 검토 완료",
  };
  if (workspace.mappingPreviewRows) {
    const sameOrder = workspace.mappingPreviewRows.filter(row => row.주문번호 === reviewItem.orderNo);
    const previewRow = sameOrder.find(row => row.reviewId === reviewId)
      || (sameOrder.length === 1 && !sameOrder[0].reviewId ? sameOrder[0] : null)
      || sameOrder.find(row => !row.reviewId && row.주문내용 === reviewItem.orderProduct);
    if (previewRow) Object.assign(previewRow, {
      자사상품명: mappedProduct, 수량: quantity, 매핑수량: quantity,
      비고: "수동 검토 완료", 판정내용: "수동 검토 완료", 최종판정: "정상", 작업상태: "완료",
    });
  }
  workspace.mappingDecisions = (workspace.mappingDecisions || []).map(decision =>
    decision.reviewId === reviewId ? { ...decision, ...correction } : decision);
  workspace.jobs = (workspace.jobs || []).map(job => {
    if (!(job.resultRows || []).some(decision => decision.reviewId === reviewId)) return job;
    const resultRows = job.resultRows.map(decision => decision.reviewId === reviewId ? { ...decision, ...correction } : decision);
    return { ...job, resultRows, status: resultRows.some(needsMappingReview) ? "검토 필요" : "완료" };
  });

  saveWorkspace();
  render();
};

function renderDrafts() {
  const target = document.querySelector("#draft-list");
  if (!target) return;
  const drafts = workspace.reviewDrafts || [];
  target.innerHTML = drafts.length
    ? drafts.map((draft, index) => `<div><b>${index + 1}. ${draft.orderNo}</b><span>${draft.productCode} · ${draft.quantity}개 · ${draft.rawText}</span></div>`).join("")
    : "<span>임시저장한 검토 정답이 없습니다.</span>";
}

function renderProcessedResults() {
  const target = document.querySelector("#processed-list");
  if (!target) return;
  const records = workspace.learningHistory || [];
  target.innerHTML = records.length
    ? records
        .map(
          (record) =>
            `<div class="processed-item"><div><b>${escapeHtml(record.orderNo || record.reviewItemId || "학습기록")}</b><span>${escapeHtml(record.sourceText || record.orderProduct)} → ${escapeHtml(record.mappedProduct || record.productCode)} · ${escapeHtml(record.quantity ?? record.mappedQuantity ?? "-")}개</span></div><div class="processed-actions"><button type="button" data-export="googleSheets" data-review-id="${escapeHtml(record.reviewItemId)}">구글시트 추가용</button><button type="button" data-export="excel" data-review-id="${escapeHtml(record.reviewItemId)}">엑셀 다운로드</button></div></div>`,
        )
        .join("")
    : "<span>승인 후 반영된 처리 결과가 없습니다.</span>";
  target.querySelectorAll("button").forEach((button) => {
    button.addEventListener("click", () => downloadProcessedResult(button.dataset.export, button.dataset.reviewId));
  });
}

function renderMappingPreviewRows() {
  const body = document.querySelector("#mapping-preview-body");
  if (!body) return;
  body.innerHTML = getMappingPreviewRows()
    .map(
      (row) => {
        const failed = /확인\s*필요|불일치|오류/.test(row.최종판정);
        const rowStyle = failed ? 'style="color:#c73c35; font-weight:700;"' : "";
        return `<tr ${rowStyle}><td>${escapeHtml(row.주문번호)}</td><td><strong>${escapeHtml(row.주문내용)}</strong><small>${escapeHtml(row.옵션1 || "옵션 없음")}</small></td><td>${escapeHtml(row.자사상품명)}</td><td>${escapeHtml(row.주문수량 ?? row.수량 ?? "-")}</td><td>${escapeHtml(row.매핑수량 ?? row.수량 ?? "-")}</td><td><span class="tag ${failed ? "red" : "green"}">${escapeHtml(row.최종판정)}</span></td><td style="white-space:pre-line;line-height:1.55">${escapeHtml(row.판정내용)}</td></tr>`;
      }
    )
    .join("");
}

function renderMasterFiles() {
  const body = document.querySelector("#master-files-body");
  if (!body) return;
  const masters = workspace.masterHistory || [];
  body.innerHTML = masters.length
    ? masters
        .map(
          (master) =>
            `<tr><td><input type="checkbox" data-master-check value="${escapeHtml(master.id)}" /></td><td><strong>${escapeHtml(master.name)}</strong><small>${escapeHtml(master.id)}</small></td><td>${escapeHtml(master.fixedAt || "-")}</td><td><span class="tag ${master.fixed === false ? "orange" : "green"}">${master.fixed === false ? "고정 해제" : "고정"}</span></td><td>${workspace.fixedMaster?.id === master.id ? "현재 기준" : "이력"}</td></tr>`,
        )
        .join("")
    : `<tr><td colspan="5">등록된 자사상품 마스터가 없습니다.</td></tr>`;
}

function renderLearningHistory() {
  const tbody = document.querySelector("#learning-history-body");
  const countEl = document.querySelector("#learning-total-count");
  if (!tbody || !countEl) return;

  const learningHistory = workspace.learningHistory || [];
  countEl.textContent = `${learningHistory.length}건`;

  if (!learningHistory.length) {
    tbody.innerHTML = `<tr><td colspan="5">학습된 데이터가 없습니다.</td></tr>`;
    return;
  }

  tbody.innerHTML = learningHistory.map(item => `
    <tr>
      <td>${new Date(item.timestamp).toLocaleDateString("en-US")}</td>
      <td><strong>${escapeHtml(item.sourceText)}</strong></td>
      <td>${escapeHtml(item.option1 || '-')} / ${escapeHtml(item.option2 || '-')}</td>
      <td><span class="tag orange">${escapeHtml(item.mappedProduct)}</span></td>
      <td>${item.mappedQuantity}개</td>
    </tr>
  `).join("");
}

function getInventoryDetailKey(item) {
  return [item?.barcode, item?.productName, item?.latestInboundDateLabel].map((value) => String(value || "")).join("|");
}

function formatInventoryQuantity(value, suffix = "개") {
  return Number.isFinite(value) ? `${value.toLocaleString("en-US", { maximumFractionDigits: 1 })}${suffix}` : "-";
}

function closeInventoryDetail() {
  activeInventoryDetailKey = "";
  const panel = document.querySelector("#inventory-detail-panel");
  if (panel) {
    panel.hidden = true;
    panel.replaceChildren();
  }
  document.querySelectorAll(".inventory-product-button[aria-expanded='true']")
    .forEach((button) => button.setAttribute("aria-expanded", "false"));
}

function renderInventoryProductButton(item) {
  const itemKey = getInventoryDetailKey(item);
  return `<button type="button" class="inventory-product-button" data-inventory-key="${escapeHtml(itemKey)}" aria-expanded="${activeInventoryDetailKey === itemKey}">${escapeHtml(item.productName)}</button><small>${escapeHtml(item.barcode || "바코드 없음")}</small>`;
}

function showInventoryDetail(item, itemKey) {
  const panel = document.querySelector("#inventory-detail-panel");
  if (!panel) return;
  if (activeInventoryDetailKey === itemKey && !panel.hidden) {
    closeInventoryDetail();
    return;
  }
  activeInventoryDetailKey = itemKey;
  const row = item.row || item.sourceRow || item || {};
  const confirmedRemark = String(row["비고(확정일)"] || "").trim();
  const hasDepletionBasis = Boolean(item.latestInboundDate && item.latestInboundQuantity !== null);
  const averageText = hasDepletionBasis ? formatInventoryQuantity(item.averageDailyDepletion, "개/일") : "계산 자료 없음";
  const latestInboundText = item.latestInboundDate
    ? `${item.latestInboundDateLabel} · ${formatInventoryQuantity(item.latestInboundQuantity)}`
    : "최근 입고일 없음";
  const formulaText = hasDepletionBasis
    ? `소진수량 max(0, ${formatInventoryQuantity(item.latestInboundQuantity)} - ${formatInventoryQuantity(item.stock)}) = ${formatInventoryQuantity(item.depletedQuantity)} · ${formatInventoryQuantity(item.depletedQuantity)} ÷ ${item.depletionPeriodDays}일 = ${averageText}`
    : "최근 입고일 또는 최근 입고수량이 없어 일평균 소진량을 계산하지 않았습니다.";
  const badges = [
    item.isDepletionPressure ? `<span class="tag red">소진 임박</span>` : "",
    item.isDeadStock ? `<span class="tag">출고저조</span>` : "",
    item.isArrivalRisk ? `<span class="tag orange">입고 지연 위험</span>` : "",
  ].filter(Boolean).join("");
  const history = window.InboundTableEngine?.buildRecentInboundHistory(row) || [];
  const historyRows = history.length
    ? history.map((record) => `<tr><td>${escapeHtml(record.date || "-")}</td><td><span class="inbound-history-type">${escapeHtml(record.type || "-")}</span></td><td>${escapeHtml(typeof maskVendorName==="function"?maskVendorName(record.vendor):(record.vendor||"-"))}</td><td class="inbound-history-quantity">${escapeHtml(record.quantity || "-")}</td><td>${escapeHtml(record.note || "-")}</td></tr>`).join("")
    : `<tr><td colspan="5" class="inbound-history-empty">최근 입고 및 입고예정 내역이 없습니다.</td></tr>`;
  panel.innerHTML = `<div class="inventory-detail-heading"><div><p class="eyebrow">INVENTORY DETAIL</p><h3>${escapeHtml(item.productName)}</h3><p>${escapeHtml(item.barcode || "바코드 없음")} · ${badges || '<span class="tag">일반</span>'}</p></div><button type="button" class="inventory-detail-close" aria-label="상품 상세 닫기">×</button></div>${renderSharedProductSummary(row)}<div class="inventory-detail-metrics"><article><span>일평균 소진량</span><b>${escapeHtml(averageText)}</b></article><article><span>소진 예상일</span><b>${escapeHtml(item.stockoutDateLabel)}</b></article><article><span>다음 입고예정일</span><b>${escapeHtml(item.nextInboundDateLabel)}</b></article><article><span>최근 입고</span><b>${escapeHtml(latestInboundText)}</b></article><article><span>비고 확정일</span><b>${escapeHtml(confirmedRemark || "-")}</b></article></div><div class="inventory-detail-evidence"><article class="inventory-calculation-note"><p class="eyebrow">DAILY DEPLETION BASIS</p><h4>일평균 소진량 산정 기준</h4><dl><div><dt>산정 기간</dt><dd>${escapeHtml(item.depletionPeriodLabel)}</dd></div><div><dt>분석 기준일</dt><dd>${escapeHtml(item.analysisDateLabel)}</dd></div><div><dt>계산식</dt><dd>${escapeHtml(formulaText)}</dd></div></dl><small>실제 출고량이 아닌 최근 입고수량과 현재고 차이를 사용한 추정치입니다.</small></article><article class="inventory-confirmed-remark"><p class="eyebrow">CONFIRMED REMARK</p><h4>비고(확정일)</h4><p>${escapeHtml(confirmedRemark || "등록된 확정일 비고가 없습니다.")}</p><p class="confirm-memo-line">${escapeHtml(getConfirmMemoValue(row) || "")}</p></article></div><div class="inventory-detail-history"><div><p class="eyebrow">INBOUND HISTORY</p><h4>최근 입고·입고예정 내역</h4></div><div class="inbound-history-table-wrap"><table class="inbound-history-table"><thead><tr><th>날짜</th><th>구분</th><th>업체</th><th>수량</th><th>참고</th></tr></thead><tbody>${historyRows}</tbody></table></div></div>${renderProductCoordHistoryHtml(item.barcode || row.바코드, item.productName || row.상품명)}${renderProductExpiryLotsHtml(item.barcode || row.바코드, item.productName || row.상품명)}`;
  panel.hidden = false;
  document.querySelectorAll(".inventory-product-button").forEach((button) => {
    button.setAttribute("aria-expanded", String(button.dataset.inventoryKey === itemKey));
  });
  bindProductDetailEditors(panel, item.barcode || row.바코드, item.productName || row.상품명);
  panel.querySelector(".inventory-detail-close")?.addEventListener("click", closeInventoryDetail);
  panel.scrollIntoView?.({ behavior: "smooth", block: "start" });
}

function formatInventoryItemCount(value) {
  return window.InventoryDashboardEngine?.formatInventoryItemCount(value)
    || `${Math.max(0, Math.floor(Number(value) || 0)).toLocaleString("en-US")}품목`;
}

function renderInventoryCategoryButtons(group, counts, { compact = false } = {}) {
  const categories = window.InventoryDashboardEngine?.INVENTORY_FILTER_CATEGORIES || ["전체", "간식", "의류", "하네스", "리테일A", "리테일B", "리테일C"];
  const state = inventoryDashboardStates[group];
  return categories
    .filter((category) => !compact || category !== "전체")
    .map((category) => {
      const count = counts?.[category] || 0;
      const active = state.category === category;
      return compact
        ? `<button type="button" class="inventory-card-category" data-inventory-category-group="${group}" data-inventory-category="${escapeHtml(category)}" data-inventory-category-source="card" aria-pressed="${active}"><span>${escapeHtml(category)}</span><strong>${formatInventoryItemCount(count)}</strong></button>`
        : `<button type="button" class="inventory-category-filter" data-inventory-category-group="${group}" data-inventory-category="${escapeHtml(category)}" data-inventory-category-source="panel" aria-pressed="${active}">${escapeHtml(category)} ${formatInventoryItemCount(count)}</button>`;
    })
    .join("");
}


function clearInventoryMainSearch() {
  inventoryMainSearchQuery = "";
  const panel = document.querySelector("#inventory-main-search-panel");
  const body = document.querySelector("#inventory-main-search-body");
  const count = document.querySelector("#inventory-main-search-count");
  const title = document.querySelector("#inventory-main-search-title");
  const input = document.querySelector("#inventory-main-search-input");
  if (panel) panel.hidden = true;
  if (body) body.innerHTML = `<tr><td colspan="5" class="inventory-empty">상품명 또는 바코드로 검색해주세요.</td></tr>`;
  if (count) count.textContent = "0품목";
  if (title) title.textContent = "상품 검색 결과";
  if (input && document.activeElement !== input) input.value = "";
}

function renderInventoryMainSearchResult(result) {
  const panel = document.querySelector("#inventory-main-search-panel");
  const body = document.querySelector("#inventory-main-search-body");
  const count = document.querySelector("#inventory-main-search-count");
  const title = document.querySelector("#inventory-main-search-title");
  if (!panel || !body) return;
  inventoryMainSearchQuery = result?.query || "";
  const items = result?.items || [];
  if (!inventoryMainSearchQuery) {
    clearInventoryMainSearch();
    return;
  }
  panel.hidden = false;
  if (title) title.textContent = `"${inventoryMainSearchQuery}" 검색 결과`;
  if (count) count.textContent = formatInventoryItemCount(items.length);
  if (!items.length) {
    body.innerHTML = `<tr><td colspan="5" class="inventory-empty">검색 결과가 없습니다.</td></tr>`;
    return;
  }
  body.innerHTML = items.map((item) => {
    const productName = item.productName || item.상품명 || "-";
    const barcode = item.barcode || item.바코드 || "";
    const stock = item.currentStockLabel || item.현재고 || "-";
    const avg = item.averageDailyDepletionLabel || "-";
    const next = item.nextInboundDateLabel || item.confirmedDateLabel || "-";
    const status = item.soldOutStatus || item.confirmedDateLabel || "-";
    const itemKey = getInventoryDetailKey({
      barcode,
      productName,
      latestInboundDateLabel: next,
    });
    currentInventoryItemsByKey.set(itemKey, {
      ...item,
      productName,
      barcode,
      stockoutDateLabel: item.stockoutDateLabel || "-",
      nextInboundDateLabel: next,
      averageDailyDepletionLabel: avg,
      sourceRow: item.sourceRow || item.row || item,
      row: item.sourceRow || item.row || item,
    });
    return `<tr>
      <td>${renderInventoryProductButton({ productName, barcode, latestInboundDateLabel: next })}</td>
      <td>${escapeHtml(String(stock))}</td>
      <td>${escapeHtml(String(avg))}</td>
      <td>${escapeHtml(String(next))}</td>
      <td>${escapeHtml(String(status))}</td>
    </tr>`;
  }).join("");
}

function renderInventoryDashboardRows(group, items) {
  if (!items.length) {
    const empty = inventoryDashboardGroups[group]?.empty || "표시할 품목이 없습니다.";
    return `<tr><td colspan="5" class="inventory-empty">${empty}</td></tr>`;
  }
  return items.map((item) => {
    const itemKey = getInventoryDetailKey({
      barcode: item.barcode,
      productName: item.productName,
      latestInboundDateLabel: item.confirmedDateLabel || item.nextInboundDateLabel,
    });
    currentInventoryItemsByKey.set(itemKey, {
      ...item,
      productName: item.productName,
      barcode: item.barcode,
      stockoutDateLabel: item.stockoutDateLabel,
      nextInboundDateLabel: item.nextInboundDateLabel,
      averageDailyDepletion: null,
      averageDailyDepletionLabel: item.averageDailyDepletionLabel,
    });
    if (group === "arrival") {
      return `<tr>
        <td>${renderInventoryProductButton({ productName: item.productName, barcode: item.barcode, latestInboundDateLabel: item.confirmedDateLabel || item.nextInboundDateLabel })}</td>
        <td>${escapeHtml(item.soldOutStatus || "-")}</td>
        <td>${escapeHtml(item.confirmedDateLabel || "미확정")}</td>
        <td>${escapeHtml(item.memo || "-")}</td>
        <td>${escapeHtml(item.nextInboundDateLabel || "-")}</td>
      </tr>`;
    }
    return `<tr>
      <td>${renderInventoryProductButton({ productName: item.productName, barcode: item.barcode, latestInboundDateLabel: item.confirmedDateLabel || item.nextInboundDateLabel })}</td>
      <td>${escapeHtml(item.currentStockLabel || "-")}</td>
      <td>${escapeHtml(item.seasonLabel || "-")}</td>
      <td>${escapeHtml(item.soldOutStatus || "-")}</td>
      <td><strong>${escapeHtml(item.confirmedDateLabel || "미정")}</strong></td>
      <td>${escapeHtml(item.nextInboundDateLabel || "-")}</td>
    </tr>`;
  }).join("");
}

function renderInventoryDashboardGroup(group) {
  const engine = window.InventoryDashboardEngine;
  const meta = inventoryDashboardGroups[group];
  if (!meta || !currentInventoryDashboardSummary) return;
  const state = inventoryDashboardStates[group];
  const sourceItems = currentInventoryDashboardSummary[meta.itemsKey] || [];
  const cardCount = document.querySelector(`#${meta.cardCountId}`);
  const cardCategories = document.querySelector(`#${meta.cardCategoriesId}`);
  const categoryFilters = document.querySelector(`#${meta.filterId}`);
  const listCount = document.querySelector(`#${meta.listCountId}`);
  const body = document.querySelector(`#${meta.bodyId}`);
  const panel = document.querySelector(`#${meta.panelId}`);
  if (panel) panel.hidden = false;
  if (group === "deadstock") {
    document.querySelector("#dashboard-deadstock-development")?.setAttribute("hidden", "");
  }
  const filterFn = engine?.filterInventoryItems
    ? (items, opts) => engine.filterInventoryItems(items, opts)
    : (items) => (items || []).filter((item) => {
        const disc = item?.isDiscontinued || /단종/.test(String(item?.productName || ""));
        if (state.category === "단종") return disc;
        return !disc;
      });
  const searchedItems = filterFn(sourceItems, { query: state.query, category: "전체" });
  const visibleItems = filterFn(searchedItems, { query: state.query, category: state.category });
  const fullCounts = engine?.summarizeInventoryCategories
    ? engine.summarizeInventoryCategories(sourceItems)
    : [];
  const searchedCounts = engine?.summarizeInventoryCategories
    ? engine.summarizeInventoryCategories(searchedItems)
    : [];
  // 카드 숫자는 단종 제외(단종 칩에서만 단종 확인)
  const activeCountItems = filterFn(sourceItems, { category: "전체" });
  if (cardCount) cardCount.textContent = formatInventoryItemCount(activeCountItems.length);
  if (cardCategories) cardCategories.innerHTML = renderInventoryCategoryButtons(group, fullCounts, { compact: true });
  if (categoryFilters) categoryFilters.innerHTML = renderInventoryCategoryButtons(group, searchedCounts);
  if (state.category !== "의류") state.season = "";
  let tableItems = visibleItems;
  if (state.category === "의류" && categoryFilters) {
    const labels = [...new Set(visibleItems.map((item) => item.seasonLabel || "미분류"))]
      .sort((a, b) => String(a).localeCompare(String(b), "ko"));
    if (state.season && !labels.includes(state.season)) state.season = "";
    if (state.season) {
      tableItems = visibleItems.filter((item) => (item.seasonLabel || "미분류") === state.season);
    }
    categoryFilters.insertAdjacentHTML("beforeend", `<label class="clothing-season-filter">시즌(예상)
      <select data-inventory-season="${escapeHtml(group)}">
        <option value="">전체</option>
        ${labels.map((label) => `<option value="${escapeHtml(label)}"${label === state.season ? " selected" : ""}>${escapeHtml(label)}</option>`).join("")}
      </select>
    </label>`);
  }
  if (listCount) {
    const isFiltered = Boolean(state.query || state.category !== "전체" || state.season);
    const baseCount = state.category === "단종"
      ? sourceItems.filter((item) => item?.isDiscontinued || /단종/.test(String(item?.productName || ""))).length
      : activeCountItems.length;
    listCount.textContent = `${isFiltered ? `${formatInventoryItemCount(tableItems.length)} / ` : ""}${formatInventoryItemCount(baseCount)} · ${meta.qualifier}`;
  }
  if (body) body.innerHTML = renderInventoryDashboardRows(group, tableItems);
}

function renderAllInventoryDashboardGroups() {
  Object.keys(inventoryDashboardGroups).forEach(renderInventoryDashboardGroup);
}

function setupInventoryDashboardInteractions() {
  const dashboard = document.querySelector("#dashboard");
  if (!dashboard || dashboard.dataset.inventoryInteractionsReady === "true") return;
  dashboard.dataset.inventoryInteractionsReady = "true";
  dashboard.querySelectorAll("[data-inventory-group]").forEach((card) => {
    card.addEventListener("click", () => {
      const targetId = window.InventoryDashboardEngine?.getDashboardSectionId(card.dataset.inventoryGroup);
      const target = targetId ? document.querySelector(`#${targetId}`) : null;
      if (!target) return;
      target.classList.remove("inventory-panel-flash");
      void target.offsetWidth;
      target.classList.add("inventory-panel-flash");
      target.scrollIntoView?.({ behavior: "smooth", block: "start" });
      target.focus?.({ preventScroll: true });
      setTimeout(() => target.classList.remove("inventory-panel-flash"), 1600);
    });
  });
  dashboard.addEventListener("submit", (event) => {
    const mainForm = event.target.closest?.("[data-inventory-main-search]");
    if (mainForm) {
      event.preventDefault();
      const engine = window.InventoryDashboardEngine;
      inventoryMainSearchQuery = mainForm.querySelector("input")?.value.trim() || "";
      if (!engine || !currentInventoryDashboardSummary) return;
      const result = engine.runInventoryMainSearch(
        currentInventoryDashboardSummary.allItems || [],
        inventoryMainSearchQuery,
        inventoryDashboardStates,
      );
      closeInventoryDetail();
      renderInventoryMainSearchResult(result);
      if (result.query) {
        const panel = document.querySelector("#inventory-main-search-panel");
        panel?.scrollIntoView?.({ behavior: "smooth", block: "nearest" });
        panel?.focus?.({ preventScroll: true });
      }
      return;
    }
    const form = event.target.closest?.("[data-inventory-search-form]");
    if (!form) return;
    event.preventDefault();
    const group = form.dataset.inventorySearchForm;
    if (!inventoryDashboardStates[group]) return;
    inventoryDashboardStates[group].query = form.querySelector("input")?.value || "";
    closeInventoryDetail();
    renderInventoryDashboardGroup(group);
  });
  dashboard.addEventListener("change", (event) => {
    const select = event.target.closest?.("[data-inventory-season]");
    if (!select) return;
    const group = select.dataset.inventorySeason;
    if (!inventoryDashboardStates[group]) return;
    inventoryDashboardStates[group].season = select.value || "";
    closeInventoryDetail();
    renderInventoryDashboardGroup(group);
  });
  dashboard.addEventListener("click", (event) => {
    const clearMainSearch = event.target.closest?.("[data-inventory-main-search-clear]");
    if (clearMainSearch) {
      closeInventoryDetail();
      clearInventoryMainSearch();
      document.querySelector("#inventory-main-search-input")?.focus();
      return;
    }
    const categoryButton = event.target.closest?.("[data-inventory-category-group]");
    if (categoryButton) {
      const group = categoryButton.dataset.inventoryCategoryGroup;
      if (!inventoryDashboardStates[group]) return;
      const category = categoryButton.dataset.inventoryCategory || "전체";
      const source = categoryButton.dataset.inventoryCategorySource;
      inventoryDashboardStates[group].category = category;
      if (category !== "의류") inventoryDashboardStates[group].season = "";
      if (source === "card") {
        inventoryDashboardStates[group].query = "";
        const input = document.querySelector(`[data-inventory-search-form="${group}"] input`);
        if (input) input.value = "";
      }
      closeInventoryDetail();
      renderInventoryDashboardGroup(group);
      if (source === "card") {
        const target = document.querySelector(`#${inventoryDashboardGroups[group].panelId}`);
        target?.scrollIntoView?.({ behavior: "smooth", block: "start" });
        target?.focus?.({ preventScroll: true });
      } else {
        [...document.querySelectorAll(`[data-inventory-category-group="${group}"][data-inventory-category-source="panel"]`)]
          .find((button) => button.dataset.inventoryCategory === category)
          ?.focus();
      }
      return;
    }
    const button = event.target.closest?.(".inventory-product-button");
    if (!button) return;
    const item = currentInventoryItemsByKey.get(button.dataset.inventoryKey);
    if (item) showInventoryDetail(item, button.dataset.inventoryKey);
  });
}


function resolveProductCodeForRow(row) {
  const direct = String(row?.상품코드 || row?.자사상품코드 || row?.productCode || "").trim();
  if (direct) return direct;
  const barcode = String(row?.바코드 || row?.barcode || "").replace(/\.0$/, "").trim();
  if (!barcode) return "";
  const catalog = workspace.productCatalog || [];
  const hit = catalog.find((item) => String(item.barcode || "").replace(/\.0$/, "").trim() === barcode);
  return hit?.productCode || hit?.상품코드 || "";
}

function enrichRowWithSeason(row) {
  const productCode = resolveProductCodeForRow(row);
  const enriched = productCode && !row.상품코드 ? { ...row, 상품코드: productCode } : { ...row };
  if (productCode) enriched.상품코드 = productCode;
  const meta = window.InboundTableEngine?.parseProductCodeMeta?.(productCode);
  const isClothing = window.InboundTableEngine?.isClothingRow?.(enriched);
  const isDisc = window.InboundTableEngine?.isDiscontinuedRow?.(enriched);
  if (isClothing && !isDisc && meta) {
    enriched.시즌예상 = meta.seasonLabel;
    enriched.시즌연도 = meta.yearCode;
    enriched.시즌코드 = meta.seasonCode;
  } else {
    enriched.시즌예상 = isDisc ? "단종" : "";
  }
  return enriched;
}

function buildSoldOutInboundDashboardSummary(scheduleRows) {
  const threshold = typeof soldOutStockThreshold === "number" ? soldOutStockThreshold : 0;
  const soldOut = getSoldOutItems(scheduleRows, threshold) || [];
  const toDashboardItem = (item) => {
    const enriched = enrichRowWithSeason(item);
    const barcode = String(enriched.바코드 || "").replace(/\.0$/, "").trim();
    const confirmed = getConfirmDateValue(enriched) || String(enriched["비고(확정일)"] || "").match(/(20\d{2}-\d{2}-\d{2})/)?.[0] || "";
    const memo = getConfirmMemoValue(enriched);
    const stock = Number(String(enriched.현재고 ?? "").replace(/,/g, ""));
    const productName = enriched.상품명 || enriched.제품명 || "-";
    const isDiscontinued = window.InboundTableEngine?.isDiscontinuedRow?.(enriched)
      || /단종/.test(productName)
      || /단종/.test(String(enriched.대분류 || ""));
    return {
      productName,
      barcode,
      category: enriched.대분류 || enriched.분류 || "기타",
      currentStock: Number.isFinite(stock) ? stock : 0,
      currentStockLabel: Number.isFinite(stock) ? `${stock.toLocaleString("en-US")}개` : String(enriched.현재고 || "-"),
      confirmedDate: confirmed,
      confirmedDateLabel: confirmed || "미정",
      memo: memo || "",
      nextInboundDateLabel: enriched.다음입고내용 || window.InboundTableEngine?.resolveInboundSchedule(enriched)?.effectiveDate || enriched.다음입고 || enriched.입고예정일 || "-",
      soldOutStatus: isDiscontinued ? "단종" : (enriched.품절상태표시 || enriched.품절상태 || "-"),
      averageDailyDepletionLabel: enriched.일평균소진량표시 || "-",
      stockoutDateLabel: enriched.품절일 || "-",
      isDiscontinued: Boolean(isDiscontinued),
      seasonLabel: enriched.시즌예상 || "",
      seasonCode: enriched.시즌코드 || "",
      yearCode: enriched.시즌연도 || "",
      productCode: enriched.상품코드 || "",
      sourceRow: enriched,
      row: enriched,
    };
  };
  const searchKey = row => String(row.바코드 || "").replace(/\.0$/, "").trim() || String(row.상품명 || row.제품명 || "").trim();
  const soldOutByKey = new Map(soldOut.map(row => [searchKey(row), row]));
  const searchable = new Map();
  scheduleRows.forEach(row => {
    const key = searchKey(row);
    if (key && !searchable.has(key)) searchable.set(key, toDashboardItem(soldOutByKey.get(key) || row));
  });
  const confirmed = [];
  const unconfirmed = [];
  soldOut.forEach((item) => {
    const row = toDashboardItem(item);
    if (row.confirmedDate) confirmed.push(row);
    else unconfirmed.push(row);
  });
  confirmed.sort((a, b) => String(a.confirmedDate).localeCompare(String(b.confirmedDate)));
  unconfirmed.sort((a, b) => String(a.productName).localeCompare(String(b.productName), "ko"));

  let coordinationOpen = [];
  if (window.InboundCoordinationEngine?.getAllLogs) {
    const logs = window.InboundCoordinationEngine.getAllLogs() || [];
    const byBarcode = new Map();
    logs.forEach((log) => {
      const st = log.status || "진행중";
      if (st === "완료" || st === "입고완료") return;
      const code = String(log.barcode || "").replace(/\.0$/, "").trim();
      if (!code) return;
      const prev = byBarcode.get(code);
      if (!prev || String(log.updatedAt || "") > String(prev.updatedAt || "")) byBarcode.set(code, log);
    });
    coordinationOpen = [...byBarcode.values()].map((log) => ({
      productName: log.productName || "-",
      barcode: log.barcode,
      category: "협의",
      currentStock: 0,
      currentStockLabel: "-",
      confirmedDate: log.confirmedDate || "",
      confirmedDateLabel: log.confirmedDate || "미확정",
      memo: log.memo || log.reqContent || "",
      nextInboundDateLabel: log.originalPlannedDate || "-",
      soldOutStatus: log.status || "진행중",
      averageDailyDepletionLabel: log.type || "-",
      stockoutDateLabel: log.reqDate || "-",
      sourceRow: log,
    }));
  }

  const countByCategory = (items) => {
    const map = {};
    items.forEach((item) => {
      const key = item.category || "기타";
      map[key] = (map[key] || 0) + 1;
    });
    return Object.entries(map).map(([name, count]) => ({ name, count }));
  };

  return {
    allItems: [...searchable.values()],
    soldoutConfirmed: confirmed,
    soldoutUnconfirmed: unconfirmed,
    coordinationOpen,
    categoryStats: {
      soldoutConfirmed: countByCategory(confirmed),
      soldoutUnconfirmed: countByCategory(unconfirmed),
      coordinationOpen: countByCategory(coordinationOpen),
    },
  };
}


function escapeDashHtml(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function dashCoordStatusBadge(st) {
  const s = st || "회신대기";
  if (s === "입고완료") return '<span class="tag green">입고완료</span>';
  if (s === "업체조율확정" || s === "완료") return '<span class="tag orange">업체조율확정</span>';
  return '<span class="tag">회신대기</span>';
}

let dashCoordFilter = "all";

function renderDashboardCoordinationList() {
  const body = document.querySelector("#dash-coord-list-body");
  const countEl = document.querySelector("#dash-coord-list-count");
  if (!body) return { waiting: 0, confirmed: 0, done: 0 };

  let logs = [];
  try {
    logs = window.InboundCoordinationEngine?.loadLogs?.() || [];
  } catch (_) {
    logs = [];
  }

  // 상태 정규화
  const norm = (st) => {
    const s = String(st || "회신대기");
    if (s === "진행중") return "회신대기";
    if (s === "완료") return "업체조율확정";
    return s;
  };

  let waiting = 0, confirmed = 0, done = 0;
  logs.forEach((r) => {
    const st = norm(r.status);
    if (st === "입고완료") done += 1;
    else if (st === "업체조율확정") confirmed += 1;
    else waiting += 1;
  });

  // 현황: 회신대기·조율확정 우선, 입고완료는 뒤로
  const sorted = [...logs].sort((a, b) => {
    const rank = (st) => {
      const s = norm(st);
      if (s === "회신대기") return 0;
      if (s === "업체조율확정") return 1;
      return 2;
    };
    return rank(a.status) - rank(b.status) || String(b.reqDate || "").localeCompare(String(a.reqDate || ""));
  });

  let view = sorted;
  if (dashCoordFilter && dashCoordFilter !== "all") {
    view = sorted.filter((r) => norm(r.status) === dashCoordFilter);
  }

  if (countEl) countEl.textContent = `${view.length}건`;

  body.innerHTML = view.length
    ? view
        .map((r) => {
          const st = norm(r.status);
          return (
            `<tr data-dash-coord-id="${escapeDashHtml(r.id)}">` +
            `<td>${escapeDashHtml(r.reqDate || "-")}</td>` +
            `<td><strong>${escapeDashHtml(r.productName || "(상품명 없음)")}</strong><br><small>${escapeDashHtml(r.barcode || "")}</small></td>` +
            `<td>${escapeDashHtml(r.vendor || "-")}</td>` +
            `<td style="max-width:180px;white-space:normal;font-size:12px">${escapeDashHtml(r.reqContent || "-")}</td>` +
            `<td style="max-width:140px;white-space:normal;font-size:12px">${escapeDashHtml(r.reply || "회신 대기")}</td>` +
            `<td>${r.confirmedDate ? `<strong style="color:#047857">${escapeDashHtml(r.confirmedDate)}</strong>` : '<span style="color:#94a3b8">미확정</span>'}</td>` +
            `<td>${dashCoordStatusBadge(st)}</td>` +
            `</tr>`
          );
        })
        .join("")
    : `<tr><td colspan="7" class="inventory-empty">협의 내역이 없습니다. 협의보드에서 등록해 주세요.</td></tr>`;

  return { waiting, confirmed, done };
}

async function refreshDashboardSideSummaries(summary) {
  let waiting = 0, confirmed = 0, done = 0;
  try {
    const counts = renderDashboardCoordinationList();
    waiting = counts.waiting;
    confirmed = counts.confirmed;
    done = counts.done;
  } catch (e) {
    console.warn("[dashboard] coord list", e);
    waiting = summary?.coordinationOpen?.length || 0;
  }
  const set = (id, v) => {
    const el = document.querySelector(id);
    if (el) el.textContent = `${v}`;
  };
  set("#dash-coord-waiting", waiting);
  set("#dash-coord-confirmed", confirmed);
  set("#dash-coord-done", done);

  try {
    await renderDashboardOpsList();
  } catch (e) {
    console.warn("[dashboard] ops summary", e);
  }
}

function dashOpsMoveLabel(status) {
  if (window.OpsDashboardEngine?.movementLabel) {
    const m = window.OpsDashboardEngine.movementLabel(status);
    return `${m.emoji} ${m.text}`;
  }
  return status || "이동 없음";
}

let dashOpsListFilter = "all";
let dashOpsLastRows = [];
let dashOpsSortKey = "stockTotal";
let dashOpsSortDir = "desc";
let dashOpsMinusOnly = false;

function getDashOpsShortfall(row) {
  return Math.max(0, Number(row.demand || 0) - Number(row.stockMain || 0));
}

function filterDashOpsRows(rows, filter) {
  let list = rows || [];
  if (filter === "risk") list = list.filter((r) => getDashOpsShortfall(r) > 0);
  if (filter === "pending") list = list.filter((r) => Number(r.demand || 0) > 0);
  if (filter === "inbound") list = list.filter((r) => Number(r.inboundQty || 0) > 0);
  if (filter === "retailDone") list = list.filter((r) => Number(r.retailDoneQty || 0) > 0);
  if (filter === "ship") list = list.filter((r) => r.action === "ship");
  if (filter === "transfer") list = list.filter((r) => r.action === "transfer");
  if (dashOpsMinusOnly) {
    list = list.filter((r) => {
      const after = r.afterShip != null ? r.afterShip : Number(r.stockTotal || 0) - Number(r.demand || 0);
      return after < 0;
    });
  }
  return list;
}

function sortDashOpsRows(rows) {
  const key = dashOpsSortKey || "productName";
  const dir = dashOpsSortDir === "desc" ? -1 : 1;
  const list = [...(rows || [])];
  list.sort((a, b) => {
    let av = a[key];
    let bv = b[key];
    if (key === "stockOther") {
      av = a.stockOther != null ? a.stockOther : Number(a.stockTplIcn || 0) + Number(a.stockHqB || 0) + Number(a.stockEcW || 0);
      bv = b.stockOther != null ? b.stockOther : Number(b.stockTplIcn || 0) + Number(b.stockHqB || 0) + Number(b.stockEcW || 0);
    }
    if (key === "afterShip") {
      av = a.afterShip != null ? a.afterShip : Number(a.stockTotal || 0) - Number(a.demand || 0);
      bv = b.afterShip != null ? b.afterShip : Number(b.stockTotal || 0) - Number(b.demand || 0);
    }
    if (key === "shortfall") {
      av = getDashOpsShortfall(a);
      bv = getDashOpsShortfall(b);
    }
    if (typeof av === "string" || typeof bv === "string") {
      return String(av || "").localeCompare(String(bv || ""), "ko") * dir;
    }
    return (Number(av) - Number(bv)) * dir;
  });
  return list;
}

function paintDashOpsList(rows) {
  const body = document.querySelector("#dash-ops-list-body");
  const countEl = document.querySelector("#dash-ops-list-count");
  if (!body) return;
  const filtered = sortDashOpsRows(filterDashOpsRows(rows, dashOpsListFilter));
  if (countEl) {
    const label =
      dashOpsListFilter === "risk"
        ? "부족"
        : dashOpsListFilter === "pending"
          ? "출고대기"
          : dashOpsListFilter === "inbound"
            ? "입고예정"
            : dashOpsListFilter === "retailDone"
              ? "택배완료"
              : "전체";
    countEl.textContent = `${filtered.length}건 · ${label}${dashOpsMinusOnly ? " · 마이너스" : ""}`;
  }
  const fmt = (n) => Number(n || 0).toLocaleString();
  body.innerHTML = filtered.length
    ? filtered
        .map((r) => {
          const other = r.stockOther != null ? r.stockOther : (Number(r.stockTplIcn || 0) + Number(r.stockHqB || 0) + Number(r.stockEcW || 0));
          const after = r.afterShip != null ? r.afterShip : Number(r.stockTotal || 0) - Number(r.demand || 0);
          const afterRisk = after < 0;
          const mainRisk = Boolean(r.isRisk);
          const rowCls = afterRisk || mainRisk ? ' class="ops-row-risk"' : "";
          const mainCls = mainRisk ? ' class="ops-stock-risk"' : "";
          const afterCls = afterRisk ? ' class="ops-stock-risk"' : "";
          return (
            `<tr data-dash-ops-sku="${escapeDashHtml(r.sku)}"${rowCls}>` +
            `<td><button type="button" class="ops-product-link" data-ops-product="${escapeDashHtml(r.sku)}">${escapeDashHtml(r.productName)} ›</button><br><small>${escapeDashHtml(r.sku)}</small></td>` +
            `<td><strong>${fmt(r.demand)}</strong>${r.channels ? `<br><small style="color:#64748b">${escapeDashHtml(r.channels)}</small>` : ""}</td>` +
            `<td><strong>${fmt(r.retailDoneQty || 0)}</strong>${Number(r.retailPendingQty||0) ? `<br><small style="color:#64748b">대기 ${fmt(r.retailPendingQty)}</small>` : ""}</td>` +
            `<td><strong>${fmt(r.stockTotal)}</strong></td>` +
            `<td${mainCls}><strong>${fmt(r.stockMain)}</strong></td>` +
            `<td>${fmt(other)}</td>` +
            `<td${afterCls}><strong>${fmt(after)}</strong></td>` +
            `<td>${r.inboundDate ? escapeDashHtml(r.inboundDate) : "—"}</td>` +
            `<td>${r.inboundQty ? fmt(r.inboundQty) : "—"}</td>` +
            `</tr>`
          );
        })
        .join("")
    : `<tr><td colspan="9" class="inventory-empty">해당 상태의 SKU가 없습니다.</td></tr>`;
}

function setDashOpsFilter(filter) {
  dashOpsListFilter = filter || "all";
  dashOpsMinusOnly = false;
  const minusCheckbox = document.querySelector("#dash-ops-minus-only");
  if (minusCheckbox) minusCheckbox.checked = false;
  dashOpsSortKey = { risk: "shortfall", pending: "demand", inbound: "inboundQty", retailDone: "retailDoneQty" }[dashOpsListFilter] || "stockTotal";
  dashOpsSortDir = "desc";
  document.querySelectorAll("[data-ops-filter]").forEach((btn) => {
    const on = btn.getAttribute("data-ops-filter") === dashOpsListFilter;
    btn.classList.toggle("is-active", on);
    btn.setAttribute("aria-pressed", on ? "true" : "false");
  });
  syncDashOpsSortButtons();
  paintDashOpsList(dashOpsLastRows);
}

function setDashOpsSort(key) {
  if (!key) return;
  if (dashOpsSortKey === key) {
    dashOpsSortDir = dashOpsSortDir === "asc" ? "desc" : "asc";
  } else {
    dashOpsSortKey = key;
    dashOpsSortDir = "asc";
  }
  syncDashOpsSortButtons();
  paintDashOpsList(dashOpsLastRows);
}

function syncDashOpsSortButtons() {
  document.querySelectorAll("[data-ops-sort]").forEach((btn) => {
    btn.classList.remove("is-asc", "is-desc");
    if (btn.getAttribute("data-ops-sort") === dashOpsSortKey) {
      btn.classList.add(dashOpsSortDir === "asc" ? "is-asc" : "is-desc");
    }
  });
}

async function renderDashboardOpsList() {
  const body = document.querySelector("#dash-ops-list-body");
  const setOps = (id, v) => {
    const el = document.querySelector(id);
    if (el) el.textContent = v;
  };

  if (!window.OpsDashboardEngine?.loadSnapshot) {
    if (body) body.innerHTML = `<tr><td colspan="9" class="inventory-empty">재고현황 엔진이 없습니다.</td></tr>`;
    return;
  }

  const snap = await window.OpsDashboardEngine.loadSnapshot();
  const s = snap.summary || {};
  const rows = snap.grid || [];
  const totalStock = rows.reduce((a, r) => a + Number(r.stockTotal || 0), 0);
  const shortQty = rows.reduce((sum, row) => sum + getDashOpsShortfall(row), 0);
  const pendingQty = rows.reduce((a, r) => a + Number(r.demand || 0), 0);
  const inboundQty = rows.reduce((a, r) => a + Number(r.inboundQty || 0), 0);
  const retailDoneQty = rows.reduce((a, r) => a + Number(r.retailDoneQty || 0), 0);
  setOps("#dash-ops-sku", Number(totalStock).toLocaleString());
  setOps("#dash-ops-risk", Number(shortQty).toLocaleString());
  setOps("#dash-ops-pending", Number(pendingQty).toLocaleString());
  setOps("#dash-ops-retail-done", Number(retailDoneQty).toLocaleString());
  const sub = document.querySelector("#dash-ops-sku-sub");
  if (sub) sub.textContent = `${s.skuCount ?? rows.length}SKU`;

  dashOpsLastRows = rows;
  syncDashOpsSortButtons();
  document.querySelectorAll("[data-ops-filter]").forEach((btn) => {
    const on = btn.getAttribute("data-ops-filter") === dashOpsListFilter;
    btn.classList.toggle("is-active", on);
    btn.setAttribute("aria-pressed", on ? "true" : "false");
  });
  paintDashOpsList(dashOpsLastRows);
}

async function renderInventoryDashboard() {
  const status = document.querySelector("#inventory-dashboard-status");
  if (!status) return;
  try { closeInventoryDetail(); } catch (_) {}
  currentInventoryItemsByKey = new Map();
  currentInventoryDashboardSummary = null;
  status.textContent = "대시보드 데모 데이터를 불러오는 중…";
  document.querySelector("#dashboard-deadstock-development")?.setAttribute("hidden", "");

  // 핵심 패널은 항상 갱신 (협의보드 · 재고현황)
  try { renderDashboardCoordinationList(); } catch (e) { console.warn("[dashboard] coord", e); }
  try { await renderDashboardOpsList(); } catch (e) { console.warn("[dashboard] ops", e); }

  try {
    const rows = await loadStockScheduleRows();
    const summary = buildSoldOutInboundDashboardSummary(rows);
    currentInventoryDashboardSummary = summary;
    const coordN = summary?.coordinationOpen?.length ?? 0;
    status.textContent = `데모 데이터 · 스케줄 ${rows.length}건 · 협의대기 ${coordN}건 · 재고현황 SKU 표시`;
    try {
      refreshDashboardSideSummaries(summary);
    } catch (e) {
      console.warn("[dashboard] side summaries", e);
    }
    // 제거된 패널용 그룹 렌더는 안전하게만 시도
    try { renderAllInventoryDashboardGroups(); } catch (_) {}
    try {
      if (inventoryMainSearchQuery && window.InventoryDashboardEngine) {
        renderInventoryMainSearchResult(window.InventoryDashboardEngine.runInventoryMainSearch(
          summary.allItems || [],
          inventoryMainSearchQuery,
          inventoryDashboardStates,
        ));
      }
    } catch (_) {}
  } catch (error) {
    console.error("[dashboard]", error);
    currentInventoryDashboardSummary = null;
    status.textContent = `대시보드 일부 오류: ${error.message} (협의·재고현황은 데모로 표시)`;
    try { renderDashboardCoordinationList(); } catch (_) {}
    try { await renderDashboardOpsList(); } catch (_) {}
  }
}

let weeklyInboundRenderRequestId = 0;

async function renderWeeklyInbound(syncDateInputs = false) {
  const body = document.querySelector("#weekly-inbound-body");
  if (!body) return;
  const requestId = ++weeklyInboundRenderRequestId;
  const count = document.querySelector("#inbound-count");
  const weekLabel = document.querySelector("#inbound-week-label");
  const sourceStatus = document.querySelector("#inbound-source-status");
  const eyebrow = document.querySelector("#inbound-period-eyebrow");

  const today = new Date();
  let start, end;

  if (windowInboundFilterMode === "next-week") {
    const nextWeek = new Date(today);
    nextWeek.setDate(nextWeek.getDate() + 7);
    const range = getWeekRange(nextWeek);
    start = range.start; end = range.end;
    if (eyebrow) eyebrow.textContent = "NEXT WEEK";
    if (weekLabel) weekLabel.textContent = `다음 주 스케줄 (${formatDate(start)} ~ ${formatDate(end)})`;
  } else if (windowInboundFilterMode === "custom") {
    start = windowInboundCustomStart;
    end = windowInboundCustomEnd;
    if (eyebrow) eyebrow.textContent = "CUSTOM RANGE";
    if (weekLabel) weekLabel.textContent = `지정 기간 (${formatDate(start)} ~ ${formatDate(end)})`;
  } else {
    const range = getWeekRange(today);
    start = range.start; end = range.end;
    if (eyebrow) eyebrow.textContent = "THIS WEEK";
    if (weekLabel) weekLabel.textContent = `이번 주 스케줄 (${formatDate(start)} ~ ${formatDate(end)})`;
  }

  const dateFrom = document.querySelector("#inbound-date-from");
  const dateTo = document.querySelector("#inbound-date-to");
  if (dateFrom && dateTo && (syncDateInputs || (!dateFrom.value && !dateTo.value))) {
    dateFrom.value = formatDate(start);
    dateTo.value = formatDate(end);
  }

  if (sourceStatus) sourceStatus.textContent = "데이터를 불러오는 중입니다.";
  body.innerHTML = `<tr><td colspan="14">입고예정 데이터를 불러오는 중입니다.</td></tr>`;
  try {
    const rows = await loadStockScheduleRows();
    if (requestId !== weeklyInboundRenderRequestId) return;
    const metricRows = window.InventoryDashboardEngine?.enrichRowsWithDepletionMetrics(rows, new Date()) || rows;
    const sourceItems = getWeeklyInboundItems(metricRows, start, end).map((item) => ({
      ...item,
      메모표시: item.국내스케줄입고메모사항 || item.예정참고품목 || item.완료참고품목 || "",
    }));
    syncListSeasonFilter("inbound", sourceItems);
    const items = prepareInboundListItems(sourceItems, "inbound");
    currentInboundItemsByKey = new Map();
    if (count) count.textContent = `${items.length}건`;
    const containerCount = (workspace.containerInboundRecords || []).length;
    if (sourceStatus) sourceStatus.textContent = `참조 데이터: 입고스케줄(자동)${containerCount ? ` + 컨테이너 파일 ${containerCount}건` : ""} · 전체 ${rows.length}건 기준`;
    body.innerHTML = items.length
      ? items
          .map((item) => {
            const itemKey = [item.바코드, item.상품명, item.입고예정정렬일, item.입고파일명].map((value) => String(value || "")).join("|");
            currentInboundItemsByKey.set(itemKey, item);
            const hasDateChange = Boolean(window.InboundTableEngine?.hasInboundDateMismatch(item));
            const originalDate = hasDateChange && item.입고예정원본일
              ? `<small>기존 예정일 ${escapeHtml(item.입고예정원본일)}</small>`
              : "";
            const isAdminMode = localStorage.getItem(ADMIN_MODE_STORAGE) === "true";
            const discontinueBtn = isAdminMode
              ? `<button type="button" class="row-discontinue-btn${item.수동단종 ? " active" : ""}" data-edit-key="${escapeHtml(item._editKey || "")}" data-barcode="${escapeHtml(item.바코드 || "")}" data-name="${escapeHtml(item.상품명 || "")}" data-discontinued="${item.수동단종 ? "1" : "0"}">${item.수동단종 ? "단종해제" : "없는상품 단종"}</button>`
              : "";
            return `<tr${hasDateChange ? ' class="inbound-date-mismatch"' : ""}><td class="inbound-date">${escapeHtml(item.입고예정일)}${originalDate}</td><td>${escapeHtml(item.바코드 || "-")}</td><td><button type="button" class="inbound-product-button" data-inbound-key="${escapeHtml(itemKey)}" aria-expanded="${activeInboundHistoryKey === itemKey}">${escapeHtml(item.상품명 || "-")}</button><small>${escapeHtml(item.대분류 || "-")}</small>${discontinueBtn}</td><td>${escapeHtml(item.현재고 || "-")}</td><td class="depletion-metric-cell">${renderDepletionMetric(item)}</td><td>${escapeHtml(item.최근입고수량표시 === "" ? "-" : item.최근입고수량표시)}</td><td>${escapeHtml(item.다음입고예정수량표시 || "-")}</td><td>${escapeHtml(item.입고구분표시 || "-")}</td><td><input class="container-edit-input" data-edit-key="${escapeHtml(item._editKey || "")}" value="${escapeHtml(item.컨테이너표시 || "")}" placeholder="컨테이너명" title="컨테이너명 수정" /></td><td class="inbound-lot-date">${escapeHtml(item.제조일자 || "-")}</td><td class="inbound-expiry-date">${escapeHtml(item.유통기한 || "-")}</td><td class="inbound-source-file">${escapeHtml(item.입고파일명 || "-")}</td><td>${escapeHtml(item.메모표시 || "-")}</td><td class="confirm-date-cell"><div class="confirm-edit-wrap"><input type="date" class="confirm-date-input" data-barcode="${escapeHtml(item.바코드 || "")}" data-name="${escapeHtml(item.상품명 || "")}" data-planned="${escapeHtml(item.입고예정원본일 || item.입고예정일 || "")}" value="${escapeHtml(getConfirmDateValue(item))}" title="발주확정일" /><input type="text" class="confirm-memo-input" data-barcode="${escapeHtml(item.바코드 || "")}" data-name="${escapeHtml(item.상품명 || "")}" data-planned="${escapeHtml(item.입고예정원본일 || item.입고예정일 || "")}" value="${escapeHtml(getConfirmMemoValue(item))}" placeholder="메모" title="확정 메모" /></div></td></tr>`;
          })
          .join("")
        : `<tr class="inbound-empty"><td colspan="14">${sourceItems.length ? "검색 결과가 없습니다." : "해당 기간에 입고예정 품목이 없습니다."}</td></tr>`;
    if (activeInboundHistoryKey && !currentInboundItemsByKey.has(activeInboundHistoryKey)) closeInboundHistory();
    window.tableControllers?.inbound?.resetPage();
  } catch (error) {
    if (requestId !== weeklyInboundRenderRequestId) return;
    if (count) count.textContent = "오류";
    if (sourceStatus) sourceStatus.textContent = "데이터를 불러오지 못했습니다.";
    body.innerHTML = `<tr><td colspan="14">오류내용: ${escapeHtml(error.message)}</td></tr>`;
  }
}

async function renderSoldOutItems() {
  const body = document.querySelector("#soldout-body");
  if (!body) return;
  const requestId = ++soldOutRenderRequestId;
  const threshold = soldOutStockThreshold;
  const count = document.querySelector("#soldout-count");
  const label = document.querySelector("#soldout-label");
  const sourceStatus = document.querySelector("#soldout-source-status");
  label.textContent = threshold > 0
    ? `품절: 현재고 0 이하 · 품절임박: 현재고 1~${threshold.toLocaleString("en-US")}개`
    : "품절일 기록 또는 현재고 0 이하 품목";
  sourceStatus.textContent = "데모 데이터를 불러오는 중입니다.";
  body.innerHTML = `<tr><td colspan="11">품절 데이터를 불러오는 중입니다.</td></tr>`;
  try {
    const rows = await loadStockScheduleRows();
    if (requestId !== soldOutRenderRequestId) return;
    const metricRows = window.InventoryDashboardEngine?.enrichRowsWithDepletionMetrics(rows, new Date()) || rows;
    const sourceItems = getSoldOutItems(metricRows, threshold);
    const fields = inboundListColumns.soldout.map(([key]) => key);
    const queriedItems = window.InboundTableEngine?.filterRows(sourceItems, inboundListStates.soldout.query, fields) || sourceItems;
    syncSoldOutColumnFilterOptions(queriedItems);
    syncListSeasonFilter("soldout", sourceItems);
    const items = prepareInboundListItems(sourceItems, "soldout");
    currentSoldOutItemsByKey = new Map();
    count.textContent = `${items.length}건`;
    sourceStatus.textContent = `참조 데이터: 입고스케줄(자동) · 전체 ${rows.length}건 기준`;
    body.innerHTML = items.length
      ? items
          .map((item) => {
            const itemKey = [item.바코드, item.상품명, item.품절일].map((value) => String(value || "")).join("|");
            currentSoldOutItemsByKey.set(itemKey, item);
            const statusClass = item.품절상태 === "smartstore" ? "blue" : (item.품절상태 === "near" ? "orange" : "red");
            const overridden = applyRowOverride(item);
            const isDisc = Boolean(overridden.수동단종);
            const editKey = overridden._editKey || rowOverrideKey(item);
            const discBtn = `<button type="button" class="row-discontinue-btn${isDisc ? " active" : ""}" data-edit-key="${escapeHtml(editKey)}" data-barcode="${escapeHtml(item.바코드 || "")}" data-name="${escapeHtml(item.상품명 || "")}" data-discontinued="${isDisc ? "1" : "0"}" title="단종 처리">${isDisc ? "단종해제" : "단종"}</button>`;
            return `<tr><td>${escapeHtml(item.바코드 || "-")}</td><td><button type="button" class="soldout-product-button" data-soldout-key="${escapeHtml(itemKey)}" aria-expanded="${activeSoldOutHistoryKey === itemKey}">${escapeHtml(item.상품명 || "-")}</button><small>${escapeHtml(item.대분류 || "-")}</small>${isDisc ? ' <span class="tag red">단종</span>' : ""}</td><td>${escapeHtml(item.현재고 || "-")}</td><td class="depletion-metric-cell">${renderDepletionMetric(item)}</td><td class="soldout-status-cell"><span class="tag ${statusClass}">${escapeHtml(item.품절상태표시)}</span><small>${escapeHtml(item.품절일 || "-")}</small></td><td>${escapeHtml(item.최근입고내용 || "-")}</td><td>${escapeHtml(item.최근입고수량표시 === "" ? "-" : item.최근입고수량표시)}</td><td>${escapeHtml(item.다음입고내용 || "-")}</td><td>${escapeHtml(item.다음입고예정수량표시 || "-")}</td><td class="confirm-date-cell"><div class="confirm-edit-wrap"><input type="date" class="confirm-date-input" data-barcode="${escapeHtml(item.바코드 || "")}" data-name="${escapeHtml(item.상품명 || "")}" data-planned="${escapeHtml(item.입고예정원본일 || item.다음입고내용 || item.입고예정일 || "")}" value="${escapeHtml(getConfirmDateValue(item))}" title="발주확정일" /><input type="text" class="confirm-memo-input" data-barcode="${escapeHtml(item.바코드 || "")}" data-name="${escapeHtml(item.상품명 || "")}" data-planned="${escapeHtml(item.입고예정원본일 || item.다음입고내용 || item.입고예정일 || "")}" value="${escapeHtml(getConfirmMemoValue(item))}" placeholder="메모" title="확정 메모" /></div></td><td class="soldout-disc-cell">${discBtn}</td></tr>`;
          })
          .join("")
      : `<tr class="inbound-empty"><td colspan="10">${sourceItems.length ? "검색 결과가 없습니다." : "선택한 품절 기준에 해당하는 품목이 없습니다."}</td></tr>`;
    if (activeSoldOutHistoryKey && !currentSoldOutItemsByKey.has(activeSoldOutHistoryKey)) closeSoldOutHistory();
    const autoOpenItem = window.InboundTableEngine?.pickAutoOpenHistoryItem(inboundListStates.soldout.query, items);
    if (autoOpenItem) {
      const itemKey = [autoOpenItem.바코드, autoOpenItem.상품명, autoOpenItem.품절일].map((value) => String(value || "")).join("|");
      if (activeSoldOutHistoryKey !== itemKey || document.querySelector("#soldout-history-panel")?.hidden) showSoldOutHistory(autoOpenItem, itemKey);
    }
    window.tableControllers?.soldout?.resetPage();
  } catch (error) {
    if (requestId !== soldOutRenderRequestId) return;
    count.textContent = "오류";
    sourceStatus.textContent = "데모 데이터를 불러오지 못했습니다.";
    body.innerHTML = `<tr><td colspan="11">오류내용: ${escapeHtml(error.message)}</td></tr>`;
  }
}

function render() {
  document.querySelectorAll(".fixed-master-name, [id='fixed-master-name']").forEach((element) => {
    element.textContent = workspace.fixedMaster?.name || "고정된 마스터 없음";
  });
  document.querySelectorAll(".fixed-master-date, [id='fixed-master-date']").forEach((element) => {
    element.textContent = workspace.fixedMaster ? `${workspace.fixedMaster.fixedAt || "-"} · ${workspace.fixedMaster.owner || "공용"} ${workspace.fixedMaster.fixed === false ? "고정 해제" : "고정"}` : "마스터 파일을 등록하세요";
  });
  const masterVersionCount = document.querySelector("#master-version-count");
  if (masterVersionCount) masterVersionCount.textContent = `${workspace.masterHistory.length}개 버전`;
  const jobCount = document.querySelector("#job-count");
  if (jobCount) jobCount.textContent = String(workspace.jobs.length);
  const reviewSummary = getReviewSummary(workspace.reviewItems || defaultReviewItems, workspace.learningHistory);
  const reviewCardCount = document.querySelector(".cards article:nth-child(3) b");
  if (reviewCardCount) reviewCardCount.textContent = String(reviewSummary.reviewRequiredCount);
  const reviewBadge = document.querySelector("#review-result .section-title .tag");
  if (reviewBadge) reviewBadge.textContent = `${reviewSummary.reviewRequiredCount}건`;
  const learningCount = document.querySelector("#learning-count");
  if (learningCount) learningCount.textContent = `${workspace.learningHistory.length}건`;
  const history = document.querySelector("#job-history");
  const jobRows = getJobHistoryRows()
    .map((job) => `<tr><td><input type="checkbox" data-job-check value="${escapeHtml(job.id)}" /></td><td>${escapeHtml(job.작업파일)}</td><td>${escapeHtml(job.적용마스터)}</td><td><span class="tag orange">${escapeHtml(job.상태)}</span></td><td>${escapeHtml(job.실행시각)}</td></tr>`)
    .join("");
  history.innerHTML = jobRows;
  renderReviewItems();
  renderSelectedReviewItem();
  renderDrafts();
  renderProcessedResults();
  renderMappingPreviewRows();
  renderMasterFiles();
}

function openPage(page) {
  if (!page) return;
  // 페이지 전환
  document.querySelectorAll("main .page, .page").forEach((element) => {
    const on = element.id === page;
    element.classList.toggle("active", on);
    if (on) element.hidden = false;
    else element.hidden = true;
  });
  document.querySelectorAll(".nav-item").forEach((element) => {
    const isPage = element.dataset.page === page;
    element.classList.toggle("active", isPage);
  });
  document.body.classList.toggle("inbound-page-active", page === "inbound");
  document.body.classList.toggle("soldout-page-active", page === "soldout");
  try {
    if (page === "dashboard") {
      renderInventoryDashboard();
      try { renderDashboardCoordinationList(); } catch (_) {}
    }
    if (page === "inbound") renderWeeklyInbound();
    if (page === "soldout") renderSoldOutItems();
    if (page === "learning") renderLearningHistory();
    if (page === "mapping" || page === "review" || page === "history" || page === "master") {
      try { if (typeof render === "function") render(); } catch (_) {}
    }
    if (page === "coordination" && window.InboundCoordinationUI) window.InboundCoordinationUI.renderAll();
    if (page === "ops" && window.OpsDashboardUI) window.OpsDashboardUI.render();
  } catch (e) {
    console.warn("[openPage] render", page, e);
  }
}

window.openPage = openPage;

function ensureDemoCoordinationLogs() {
  const Eng = window.InboundCoordinationEngine;
  if (!Eng || localStorage.getItem("thezoos-english-portfolio-coordination-seeded-v2")) return;
  window.PortfolioData.coordination().forEach(entry => Eng.addLog(entry));
  localStorage.setItem("thezoos-english-portfolio-coordination-seeded-v2", "true");
  renderInventoryDashboard();
}
setTimeout(ensureDemoCoordinationLogs, 300);
setTimeout(ensureDemoCoordinationLogs, 1200);

window.renderDashboardCoordinationList = renderDashboardCoordinationList;
window.refreshDashboardSideSummaries = refreshDashboardSideSummaries;

document.querySelectorAll("[data-portfolio-schedule]").forEach(link => link.addEventListener("click", event => { event.preventDefault(); openPage("inbound"); }));

document.querySelectorAll(".nav-item[data-page]").forEach((item) => item.addEventListener("click", () => openPage(item.dataset.page)));
// nav-delegate-fix: 캡처 단계에서도 페이지 이동 보장
document.addEventListener("click", (event) => {
  const nav = event.target?.closest?.(".nav-item[data-page]");
  if (!nav) return;
  // 단종 버튼 등과 충돌 없음
  const page = nav.dataset.page;
  if (page) {
    openPage(page);
  }
}, true);

// 대시보드 좌측 하위 메뉴 → 해당 섹션으로 스크롤
function jumpDashboardSection(sectionKey) {
  openPage("dashboard");
  document.querySelectorAll("[data-dash-jump]").forEach((btn) => {
    btn.classList.toggle("dash-active", btn.dataset.dashJump === sectionKey);
    btn.classList.toggle("active", btn.dataset.dashJump === sectionKey);
  });
  // parent 대시보드 메뉴 active
  document.querySelectorAll(".nav-item").forEach((el) => {
    if (el.dataset.page === "dashboard") el.classList.add("active");
  });
  requestAnimationFrame(() => {
    const el = document.querySelector(`#dash-sec-${sectionKey}`) || document.querySelector(`[data-dash-section="${sectionKey}"]`);
    if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
  });
}

document.querySelectorAll("[data-dash-jump]").forEach((item) => {
  item.addEventListener("click", () => jumpDashboardSection(item.dataset.dashJump));
});

// 스크롤 시 좌측 메뉴 순차 강조
let dashScrollSpyBound = false;
function bindDashboardScrollSpy() {
  if (dashScrollSpyBound) return;
  const main = document.querySelector("main");
  if (!main) return;
  dashScrollSpyBound = true;
  const onScroll = () => {
    if (!document.querySelector("#dashboard.page.active")) return;
    const sections = ["coordination", "ops"];
    let current = sections[0];
    const offset = 120;
    for (const key of sections) {
      const el = document.querySelector(`#dash-sec-${key}`);
      if (!el) continue;
      const top = el.getBoundingClientRect().top;
      if (top <= offset) current = key;
    }
    document.querySelectorAll("[data-dash-jump]").forEach((btn) => {
      const on = btn.dataset.dashJump === current;
      btn.classList.toggle("dash-active", on);
      btn.classList.toggle("active", on);
    });
  };
  main.addEventListener("scroll", onScroll, { passive: true });
  window.addEventListener("scroll", onScroll, { passive: true });
}
bindDashboardScrollSpy();
document.addEventListener("change", (event) => {
  if (event.target?.id === "dash-ops-minus-only") {
    dashOpsMinusOnly = Boolean(event.target.checked);
    paintDashOpsList(dashOpsLastRows);
  }
});


document.addEventListener("click", (event) => {
  if (event.target?.id === "dash-coord-refresh") {
    try { renderDashboardCoordinationList(); refreshDashboardSideSummaries(currentInventoryDashboardSummary); } catch (_) {}
    if (typeof showToast === "function") showToast("협의보드 현황을 새로고침했습니다.");
    return;
  }
  if (event.target?.id === "dash-ops-refresh") {
    try { renderDashboardOpsList(); } catch (_) {}
    if (typeof showToast === "function") showToast("재고현황을 새로고침했습니다.");
    return;
  }
  if (event.target?.closest?.("#dash-ops-open")) {
    openPage("ops");
    return;
  }
  const coordFilterCard = event.target?.closest?.("[data-coord-filter]");
  if (coordFilterCard && document.querySelector("#dashboard.page.active")) {
    dashCoordFilter = coordFilterCard.getAttribute("data-coord-filter") || "all";
    // toggle again if same = all
    document.querySelectorAll("[data-coord-filter]").forEach((btn) => {
      const on = btn.getAttribute("data-coord-filter") === dashCoordFilter;
      btn.classList.toggle("is-active", on);
    });
    renderDashboardCoordinationList();
    return;
  }
  const opsFilterCard = event.target?.closest?.("[data-ops-filter]");
  if (opsFilterCard && document.querySelector("#dashboard.page.active")) {
    setDashOpsFilter(opsFilterCard.getAttribute("data-ops-filter") || "all");
    return;
  }
  const sortBtn = event.target?.closest?.("[data-ops-sort]");
  if (sortBtn && document.querySelector("#dashboard.page.active")) {
    setDashOpsSort(sortBtn.getAttribute("data-ops-sort"));
    return;
  }
  const coordRow = event.target?.closest?.("tr[data-dash-coord-id]");
  if (coordRow && document.querySelector("#dashboard.page.active")) {
    const logId = coordRow.dataset.dashCoordId;
    const log = window.InboundCoordinationEngine?.getAllLogs().find((entry) => entry.id === logId);
    openPage("coordination");
    if (log) window.InboundCoordinationUI?.openCoordForm(log);
    return;
  }
  const prodBtn = event.target?.closest?.("[data-ops-product]");
  if (prodBtn) {
    const sku = prodBtn.getAttribute("data-ops-product");
    if (window.OpsDashboardUI?.openProductModal) {
      window.OpsDashboardUI.openProductModal(sku);
      return;
    }
  }
  const opsRow = event.target?.closest?.("tr[data-dash-ops-sku]");
  if (opsRow && document.querySelector("#dashboard.page.active") && !event.target?.closest?.("[data-ops-product]")) {
    openPage("ops");
  }
});


// 레거시 data-dashboard-target 호환
document.querySelectorAll("[data-dashboard-target]").forEach((item) => item.addEventListener("click", () => {
  const target = item.dataset.dashboardTarget;
  if (target === "pressure" || target === "arrival" || target === "deadstock") {
    jumpDashboardSection(target === "deadstock" ? "arrival" : target);
  } else {
    openPage("dashboard");
  }
}));
document.querySelector(".brand")?.addEventListener("click", () => openPage("dashboard"));
document.querySelector("#refresh-inbound")?.addEventListener("click", () => {
  stockScheduleCache = null;
  renderWeeklyInbound();
});
document.querySelector("#refresh-soldout")?.addEventListener("click", () => {
  stockScheduleCache = null;
  renderSoldOutItems();
});
const soldOutThresholdSelect = document.querySelector("#soldout-stock-threshold");
if (soldOutThresholdSelect) {
  soldOutThresholdSelect.value = String(soldOutStockThreshold);
  const applySoldOutThreshold = () => {
    const nextThreshold = Number(soldOutThresholdSelect.value) || 0;
    if (nextThreshold === soldOutStockThreshold) return;
    soldOutStockThreshold = nextThreshold;
    try { localStorage.setItem(SOLDOUT_THRESHOLD_STORAGE, String(soldOutStockThreshold)); } catch (_) {}
    closeSoldOutHistory();
    renderSoldOutItems();
  };
  soldOutThresholdSelect.addEventListener("input", applySoldOutThreshold);
  soldOutThresholdSelect.addEventListener("change", applySoldOutThreshold);
}

document.querySelector("#master-file").addEventListener("change", () => {
  document.querySelector("#master-file-name").textContent = fileNames("#master-file");
});

document.querySelector("#clear-learning-btn")?.addEventListener("click", () => {
  if (confirm("학습된 모든 매핑 규칙을 삭제하시겠습니까?")) {
    workspace.learningHistory = [];
    saveWorkspace();
    renderLearningHistory();
    showToast("학습 데이터가 초기화되었습니다.");
  }
});

// --- Additional Event Listeners ---
document.querySelector("#inbound-this-week")?.addEventListener("click", (e) => {
  document.querySelectorAll(".inbound-period-btn").forEach(btn => btn.classList.remove("active"));
  e.currentTarget.classList.add("active");
  windowInboundFilterMode = "this-week";
  renderWeeklyInbound(true);
});

document.querySelector("#inbound-next-week")?.addEventListener("click", (e) => {
  document.querySelectorAll(".inbound-period-btn").forEach(btn => btn.classList.remove("active"));
  e.currentTarget.classList.add("active");
  windowInboundFilterMode = "next-week";
  renderWeeklyInbound(true);
});

document.querySelector("#inbound-custom-range")?.addEventListener("click", () => {
  const fromStr = document.querySelector("#inbound-date-from").value;
  const toStr = document.querySelector("#inbound-date-to").value;
  if (!fromStr || !toStr) {
    return showToast("조회할 시작일과 종료일을 모두 선택하세요.");
  }
  const start = parseInboundDate(fromStr);
  const end = parseInboundDate(toStr);
  if (!start || !end || start > end) {
    return showToast("종료일은 시작일과 같거나 이후여야 합니다.");
  }
  end.setHours(23, 59, 59, 999);
  document.querySelectorAll(".inbound-period-btn").forEach(btn => btn.classList.remove("active"));
  windowInboundFilterMode = "custom";
  windowInboundCustomStart = start;
  windowInboundCustomEnd = end;
  renderWeeklyInbound();
});

const inboundPasteButton = document.querySelector("#paste-inbound-data");
if (inboundPasteButton) inboundPasteButton.textContent = "데이터 붙여넣기/파일첨부";
const soldoutRefreshButton = document.querySelector("#refresh-soldout");
if (soldoutRefreshButton && !document.querySelector("#paste-soldout-data")) {
  const button = document.createElement("button");
  button.className = "secondary";
  button.id = "paste-soldout-data";
  button.type = "button";
  button.textContent = "데이터 붙여넣기/파일첨부";
  soldoutRefreshButton.before(button);
}

function openInboundUpdateModal() {
  document.querySelector("#paste-data-modal").hidden = false;
}

inboundPasteButton?.addEventListener("click", openInboundUpdateModal);
document.querySelector("#paste-soldout-data")?.addEventListener("click", openInboundUpdateModal);
document.querySelector("#close-paste-modal")?.addEventListener("click", () => {
  document.querySelector("#paste-data-modal").hidden = true;
});

const inboundUpdateFileInput = document.querySelector("#inbound-update-file");
const inboundUpdateDropzone = document.querySelector('[data-file-dropzone="inbound-update"]');
const inboundUpdateFileStore = window.FileDropEngine?.createSelectionStore?.();

function clearInboundUpdateFile() {
  inboundUpdateFileStore?.clear();
  if (inboundUpdateFileInput) inboundUpdateFileInput.value = "";
  const fileName = document.querySelector("#inbound-update-file-name");
  if (fileName) fileName.textContent = "파일을 선택하세요";
  inboundUpdateDropzone?.classList.remove("is-dragover");
}

function selectInboundUpdateFile(files) {
  const result = window.FileDropEngine?.validateFiles?.(files);
  if (!result?.ok) {
    showToast(result?.message || "첨부할 파일을 확인해주세요.");
    return false;
  }
  inboundUpdateFileStore?.set(result.file);
  const fileName = document.querySelector("#inbound-update-file-name");
  if (fileName) fileName.textContent = result.file.name;
  return true;
}

inboundUpdateFileInput?.addEventListener("change", (event) => {
  if (!selectInboundUpdateFile(event.target.files)) clearInboundUpdateFile();
});

if (inboundUpdateDropzone) {
  ["dragenter", "dragover"].forEach((eventName) => inboundUpdateDropzone.addEventListener(eventName, (event) => {
    event.preventDefault();
    event.stopPropagation();
    inboundUpdateDropzone.classList.add("is-dragover");
  }));
  ["dragleave", "drop"].forEach((eventName) => inboundUpdateDropzone.addEventListener(eventName, (event) => {
    event.preventDefault();
    event.stopPropagation();
    inboundUpdateDropzone.classList.remove("is-dragover");
  }));
  inboundUpdateDropzone.addEventListener("drop", (event) => {
    selectInboundUpdateFile(event.dataTransfer?.files);
  });
}

async function readInboundUpdateRowsFromFile(file) {
  if (!window.XLSX) throw new Error("엑셀 해석 라이브러리를 불러오지 못했습니다.");
  const workbook = window.XLSX.read(await file.arrayBuffer(), { type: "array", cellDates: false });
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  return window.XLSX.utils.sheet_to_json(sheet, { header: 1, raw: false, defval: "" });
}

document.querySelector("#apply-paste-data")?.addEventListener("click", async () => {
  const text = document.querySelector("#paste-data-textarea").value;
  const file = inboundUpdateFileStore?.get() || inboundUpdateFileInput?.files?.[0];
  if (!text.trim() && !file) return showToast("데이터를 붙여넣거나 엑셀 파일을 첨부해주세요.");
  try {
    const rows = file
      ? await readInboundUpdateRowsFromFile(file)
      : String(text).split(/\r?\n/).map(line => line.split("\t"));
    const validRows = rows.filter(row => row.some(cell => String(cell).trim()));
    if (validRows.length < 2) return showToast("유효한 데이터가 부족합니다.");
    const containerEngine = window.ContainerInboundEngine;
    if (file && containerEngine?.isContainerInboundRows(validRows)) {
      const records = containerEngine.parseContainerInboundRows(validRows, {
        fileName: file.name,
        importedAt: new Date(),
      });
      if (!records.length) return showToast("컨테이너 파일의 바코드·상품명·제조일자를 확인해주세요.");
      workspace.containerInboundRecords = containerEngine.replaceContainerFileRecords(
        workspace.containerInboundRecords || [],
        file.name,
        records,
      );
      stockScheduleCache = null;
      if (!saveWorkspace()) return;
      document.querySelector("#paste-data-modal").hidden = true;
      document.querySelector("#paste-data-textarea").value = "";
      clearInboundUpdateFile();
      showToast(`${records.length}개 컨테이너 품목의 제조일자·유통기한·파일명을 입고 리스트에 반영했습니다.`);
      renderWeeklyInbound();
      return;
    }
    const updates = window.InboundUpdateEngine.parseInboundUpdateRows(validRows, new Date().getFullYear());
    if (!updates.length) return showToast("바코드/제품명/입고예정일 헤더와 데이터를 확인해주세요.");
    const scheduleRows = await loadStockScheduleRows();
    const applied = window.InboundUpdateEngine.applyInboundUpdates(
      scheduleRows.filter((row) => row.입고원본구분 !== "컨테이너파일"),
      updates,
    );
    stockScheduleCache = applied.rows;
    workspace.inboundUpdates = updates;
    if (!saveWorkspace()) return;
    // 붙여넣은 확정일을 협의보드에도 반영
    if (window.InboundCoordinationEngine) {
      updates.forEach((u) => {
        const date = normalizeConfirmDateValue(u.rawValue || u.remark);
        if (!date) return;
        syncConfirmedDateToCoordination(u.barcode, u.productName, "", date);
      });
    }
    document.querySelector("#paste-data-modal").hidden = true;
    clearInboundUpdateFile();
    showToast(`${updates.length}개 입력 중 바코드가 일치한 ${applied.matchedCount}개 품목의 비고를 반영했습니다.`);
    renderWeeklyInbound();
    renderSoldOutItems();
  } catch (error) {
    console.error(error);
    showToast(`데이터 처리 오류: ${error.message}`);
  }
});

document.querySelector("#fix-master").addEventListener("click", async () => {
  const files = [...(document.querySelector("#master-file").files || [])];
  if (!files.length) return showToast("고정할 자사상품 파일을 선택하세요.");
  try {
    const masters = await Promise.all(files.map(fileToStoredMaster));
    for (const master of masters) workspace = replaceFixedMaster(workspace, master);
    saveWorkspace();
    render();
    showToast(`${files.length}개 마스터를 등록했습니다. ${masters.at(-1).parseMessage}`);
  } catch (error) {
    showToast(`마스터 등록 실패: ${error.message}`);
  }
});

function calculateMatchScore(sourceText, targetText) {
  if (!sourceText || !targetText || targetText === "매핑 필요") return 0;
  const source = sourceText.toLowerCase().replace(/\s+/g, '');

  const cleanTarget = targetText.replace(/^[\d\s\(\)a-zA-Z]+/, '');
  const targetTokens = cleanTarget.toLowerCase().replace(/[^a-z0-9가-힣\s]/g, ' ').split(/\s+/).filter(t => t.length > 0);
  if (targetTokens.length === 0) return 0;

  let matchCount = 0;
  for (let token of targetTokens) {
    if (source.includes(token)) {
      matchCount++;
    }
  }
  return Math.round((matchCount / targetTokens.length) * 100);
}

document.querySelector("#order-file").addEventListener("change", () => {
  const input = document.querySelector("#order-file");
  document.querySelector("#order-file-name").textContent = input.files?.length
    ? fileNames("#order-file")
    : window.PortfolioData.demoOrderFile().name;
});

document.querySelector("#start-mapping-legacy-disabled")?.addEventListener("click", async () => {
  const files = [...(document.querySelector("#order-file").files || [])];
  if (!files.length) return showToast("주문정보 파일을 선택하세요.");

  try {
    const file = files[0];
    const data = await file.arrayBuffer();
    const workbook = XLSX.read(data);
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    const rawRows = XLSX.utils.sheet_to_json(sheet);

    window.customMappingPreviewRows = rawRows.map((r, i) => {
      const keys = Object.keys(r);

      const findVal = (keywords) => {
        for (let key of keys) {
          const lowerKey = key.toLowerCase();
          if (keywords.some(kw => lowerKey.includes(kw))) return r[key];
        }
        return undefined;
      };

      let orderInfo = findVal(['주문내용', '상품명', '주문상품', '품목', '품명', '상품', '판매상품 정보', '판매상품정보']);
      let opt1 = findVal(['옵션1', '옵션정보', '옵션']);
      let opt2 = findVal(['옵션2']);
      let orderNoStr = findVal(['주문번호', '발주번호', '주문코드', '번호', 'no']);

      if (!orderNoStr && orderInfo) {
        const match = orderInfo.match(/([a-zA-Z]+\d+_\d+|\d{8,})/);
        if (match) orderNoStr = match[1];
      }

      let qtyVal = findVal(['수량', '주문수량', '수', '수량(개)', '연결 상품수량', '연결상품수량']);

      let combinedRaw = Object.values(r).join(" ");
      let combined = combinedRaw.replace(/\s+/g, "").toLowerCase();

      if (!orderInfo) {
        // Fallback: use the longest string value in the row for product name
        let longest = "";
        for (let val of Object.values(r)) {
          if (typeof val === 'string' && val.length > longest.length) {
            longest = val;
          }
        }
        orderInfo = longest || combinedRaw.substring(0, 30);
      }

      let mapped = "매핑 필요";
      let note = "수동 확인";

      let existingMapped = findVal(['자사상품명', '자사상품', '매핑상품', '매핑된상품', '매핑결과', '매핑', '정답', '연결된 상품명', '연결된상품명']);
      if (existingMapped && existingMapped !== "매핑 필요" && String(existingMapped).trim() !== "") {
        mapped = String(existingMapped).trim();
        // 키워드 기반 판정: 자사상품명에서 핵심 키워드 추출 → 주문내용에 있는지 확인
        const productClean = mapped.replace(/^[\d\s\(\)a-zA-Z]+/, ''); // 앞의 코드/브랜드 제거
        const productKeywords = productClean.match(/[가-힣]{2,}|\d+[gGkK개입팩]+/g) || [];
        const orderCheck = combined; // 이미 공백제거+소문자 처리된 주문내용

        if (productKeywords.length === 0) {
          note = "정상";
        } else {
          const missingKeywords = productKeywords.filter(kw => !orderCheck.includes(kw.toLowerCase()));
          if (missingKeywords.length === 0) {
            note = "정상";
          } else if (missingKeywords.length <= Math.ceil(productKeywords.length * 0.3)) {
            note = "정상";
          } else {
            note = "상품 확인 필요: " + missingKeywords.join(", ") + " 불일치";
          }
        }
      }

      const learning = workspace.learningHistory || [];
      let matchedLearning = false;

      if (mapped === "매핑 필요") {
        for (let learned of learning) {
          if (learned.sourceText) {
            const learnedClean = learned.sourceText.replace(/\s+/g, "").toLowerCase();
            const orderClean = (orderInfo || "").replace(/\s+/g, "").toLowerCase();
            const strip = s => s.replace(/^(job-\d+)?(o\d+)?[\d\-_]+/, '').replace(/^[\d\-_]+/, '');

            if (
              combined.includes(learnedClean) ||
              (orderClean && learnedClean.includes(orderClean)) ||
              (orderClean && orderClean.includes(learnedClean)) ||
              (orderClean && strip(learnedClean) === strip(orderClean)) ||
              (orderClean && strip(orderClean).length > 10 && strip(learnedClean).startsWith(strip(orderClean))) ||
              (orderClean && strip(learnedClean).length > 10 && strip(orderClean).startsWith(strip(learnedClean)))
            ) {
              mapped = learned.mappedProduct || findProductNameByCode(learned.productCode) || learned.productCode;
              note = "학습 데이터 자동 매칭";
              matchedLearning = true;
              break;
            }
          }
        }

        if (!matchedLearning) {
          const catalog = workspace.productCatalog?.length ? workspace.productCatalog : defaultProductCatalog;
          for (let product of catalog) {
              let catName = product.productName.replace(/\s+/g, "").toLowerCase();
              if (combined.includes(catName)) {
                  mapped = product.productName;
                  note = "카탈로그 자동 매칭";
                  break;
              }
          }
        }
      }

      if (mapped === "매핑 필요") {
        if (combinedRaw.includes("열빙어")) {
          mapped = "더주스 바다보양식 열빙어 70g";
          note = "열빙어 키워드 매칭";
        } else if (combinedRaw.includes("장어뼈")) {
          mapped = "더주스 바다보양식 장어뼈 120g";
          note = "장어뼈 키워드 매칭";
        } else if (combinedRaw.includes("터키츄") || combinedRaw.includes("칠면조")) {
          mapped = "터키츄 칠면조와소고기힘줄 S 낱개";
          note = "터키츄 키워드 매칭";
        } else if (combinedRaw.includes("황태채")) {
          mapped = "더주스 바다보양식 황태채 80g";
          note = "황태채 키워드 매칭";
        }
      }

      // 수량 추출
      let qty = qtyVal || 1;
      if (typeof qty !== 'number') {
         qty = parseInt(String(qty).replace(/[^0-9]/g, "")) || 1;
      }

      return {
        주문번호: orderNoStr || `O${1000+i}`,
        주문내용: orderInfo,
        옵션1: opt1 || '',
        옵션2: opt2 || '',
        자사상품명: mapped,
        수량: qty,
        비고: note
      };
    });
  } catch (e) {
    console.error(e);
    showToast("엑셀 파일 파싱 중 오류가 발생했습니다. 기본 데이터로 진행합니다.");
  }

  workspace = startMappingJobs(workspace, files);

  const rows = window.customMappingPreviewRows || defaultMappingPreviewRows;
  const totalCount = rows.length;
  const reviewNeeded = rows.filter(r => r.자사상품명 === "매핑 필요" || (r.비고 && (r.비고.includes("수동 확인") || r.비고.includes("검토 필요") || r.비고.includes("상품 확인 필요"))));
  const normalCount = totalCount - reviewNeeded.length;

  if (reviewNeeded.length > 0) {
    workspace.reviewItems = reviewNeeded.map((row, idx) => ({
      id: `review-new-${Date.now()}-${idx}`,
      orderNo: row.주문번호,
      sourceText: row.주문내용,
      orderProduct: row.주문내용,
      option1: row.옵션1,
      option2: row.옵션2,
      orderQuantity: row.수량,
      productCode: "",
      mappedProduct: row.자사상품명,
      mappedQuantity: row.수량,
      expectedQuantity: row.수량,
      accuracy: calculateMatchScore(row.주문내용, row.자사상품명),
      threshold: 95,
    }));
  } else {
    workspace.reviewItems = [];
  }

  saveWorkspace();
  render();
  document.querySelector("#mapping-result").hidden = false;

  if (reviewNeeded.length > 0) {
    const countEl = document.querySelector("#low-accuracy-count");
    if (countEl) countEl.textContent = reviewNeeded.length;
    const totalEl = document.querySelector("#total-parsed-count-low");
    if (totalEl) totalEl.textContent = totalCount;
    const normalEl = document.querySelector("#normal-count-low");
    if (normalEl) normalEl.textContent = normalCount;
    const modal = document.querySelector("#low-accuracy-modal");
    if (modal) modal.hidden = false;
  } else {
    const totalElComplete = document.querySelector("#total-parsed-count-complete");
    if (totalElComplete) totalElComplete.textContent = totalCount;
    const modal = document.querySelector("#mapping-complete-modal");
    if (modal) modal.hidden = false;
  }

  showToast(`${files.length}개 매핑 작업을 만들었습니다. 고정 마스터 기준으로 검토합니다.`);
});

function decisionToPreviewRow(decision) {
  return {
    주문번호: decision.orderNo,
    주문내용: decision.productText,
    옵션1: decision.optionText,
    옵션2: "",
    자사상품명: decision.mappedProduct || "매핑 필요",
    주문수량: decision.orderQuantity,
    매핑수량: decision.mappedQuantity,
    수량: decision.mappedQuantity,
    최종판정: decision.finalStatus,
    판정내용: decision.decisionText,
    비고: decision.decisionText,
    reviewId: decision.reviewId,
  };
}

function decisionToReviewItem(decision, index) {
  const reviewId = decision.reviewId || `review-${Date.now()}-${index}`;
  decision.reviewId = reviewId;
  return {
    id: reviewId,
    orderNo: decision.orderNo,
    sourceText: decision.sourceText,
    orderProduct: decision.productText,
    option1: decision.optionText,
    option2: "",
    orderQuantity: decision.orderQuantity,
    productCode: decision.productCode,
    mappedProduct: decision.mappedProduct || "매핑 필요",
    mappedQuantity: decision.mappedQuantity,
    expectedQuantity: decision.expectedQuantity ?? decision.orderQuantity,
    accuracy: calculateMatchScore(decision.sourceText, decision.mappedProduct),
    threshold: 95,
    mismatches: decision.mismatches,
    decisionText: decision.decisionText,
    finalStatus: decision.finalStatus,
    minimumDecision: decision.minimumDecision,
    productDecision: decision.productDecision,
    quantityDecision: decision.quantityDecision,
    componentDecision: decision.componentDecision,
  };
}

document.querySelector("#download-demo-order")?.addEventListener("click", () => {
  const { name, matrix: [headers, ...rows] } = window.PortfolioData.demoOrderFile();
  downloadStoredFile({
    fileName: name,
    mimeType: "text/csv;charset=utf-8",
    content: toCsv(rows.map(row => Object.fromEntries(headers.map((header, index) => [header, row[index]])))),
  });
});

document.querySelector("#start-mapping").addEventListener("click", async () => {
  const uploads = [...(document.querySelector("#order-file").files || [])];
  if (!workspace.fixedMaster || workspace.fixedMaster.fixed === false) return showToast("자사상품 마스터를 먼저 고정해주세요.");
  if (!window.MappingEngine) return showToast("매핑 판정 모듈을 불러오지 못했습니다.");

  try {
    if (uploads.length && !window.XLSX) await loadScript("https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js");
    const files = uploads.length ? uploads : [window.PortfolioData.demoOrderFile()];
    const resultsByFile = [];
    for (const file of files) {
      try {
        let matrix = file.matrix;
        if (!matrix) {
          const data = await file.arrayBuffer();
          const workbook = XLSX.read(data, { type: "array" });
          const sheet = workbook.Sheets[workbook.SheetNames[0]];
          if (!sheet) throw new Error("분석할 주문 행이 없습니다.");
          matrix = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: false, defval: "" });
        }
        const normalized = MappingEngine.normalizeRows(matrix);
        if (!normalized.length) throw new Error("분석할 주문 행이 없습니다.");
        resultsByFile.push(MappingEngine.judgeMappings(normalized, workspace.learningHistory || []));
      } catch (error) {
        throw new Error(`${file.name}: ${error.message}`);
      }
    }

    const decisions = resultsByFile.flat();
    decisions.forEach((decision, index) => {
      if (!decision.reviewId) decision.reviewId = `review-${Date.now()}-${index}`;
    });
    const reviewNeeded = decisions.filter(needsMappingReview);
    workspace = startMappingJobs(workspace, files, resultsByFile);
    workspace.mappingDecisions = decisions;
    workspace.mappingPreviewRows = decisions.map(decisionToPreviewRow);
    window.customMappingPreviewRows = workspace.mappingPreviewRows;
    workspace.reviewItems = reviewNeeded.map(decisionToReviewItem);
    workspace.selectedReviewItem = workspace.reviewItems[0] || null;
    saveWorkspace();
    render();
    document.querySelector("#mapping-result").hidden = false;

    const totalCount = decisions.length;
    const normalCount = totalCount - reviewNeeded.length;
    if (reviewNeeded.length) {
      document.querySelector("#low-accuracy-count").textContent = reviewNeeded.length;
      document.querySelector("#total-parsed-count-low").textContent = totalCount;
      document.querySelector("#normal-count-low").textContent = normalCount;
      document.querySelector("#low-accuracy-modal").hidden = false;
    } else {
      document.querySelector("#total-parsed-count-complete").textContent = totalCount;
      const modal = document.querySelector("#mapping-complete-modal");
      modal.dataset.jobIds = JSON.stringify(workspace.jobs.slice(0, files.length).map(job => job.id));
      modal.hidden = false;
    }
    showToast(`${files.length}개 파일 · ${totalCount}건 판정 완료 · 수정 필요 ${reviewNeeded.length}건`);
  } catch (error) {
    console.error(error);
    showToast(error?.message || "엑셀 파일 분석 중 오류가 발생했습니다.");
  }
});

// Modal button listeners
document.querySelector("#go-to-review-btn")?.addEventListener("click", (e) => {
  const modal = e.target.closest('.modal-overlay');
  if (modal) modal.hidden = true;
  document.querySelector('[data-page="review"]')?.click();
});

document.querySelector("#go-to-history-btn")?.addEventListener("click", (e) => {
  const modal = e.target.closest('.modal-overlay');
  if (modal) modal.hidden = true;
  document.querySelector('[data-page="history"]')?.click();
});

document.querySelector("#download-excel-now-btn")?.addEventListener("click", (e) => {
  const modal = e.target.closest('.modal-overlay');
  if (modal) modal.hidden = true;
  downloadJobHistory("excel", JSON.parse(modal?.dataset.jobIds || "[]"));
});

document.querySelector("#manual-file")?.addEventListener("change", () => {
  document.querySelector("#manual-file-name").textContent = fileNames("#manual-file");
});

document.querySelector("#start-review")?.addEventListener("click", () => {
  const files = [...(document.querySelector("#manual-file").files || [])];
  if (!files.length) return showToast("수동 매핑 파일을 선택하세요.");
  document.querySelector("#review-result").hidden = false;
  renderReviewItems();
  renderSelectedReviewItem();
  showToast(`${files.length}개 수동 매핑 파일 검토를 준비했습니다.`);
});

document.querySelectorAll("[data-history-export]").forEach((button) => {
  button.addEventListener("click", () => downloadJobHistory(button.dataset.historyExport));
});

document.querySelectorAll("[data-master-export]").forEach((button) => {
  button.addEventListener("click", () => downloadMaster(button.dataset.masterExport));
});

document.querySelector("#release-master").addEventListener("click", () => {
  workspace = releaseFixedMaster(workspace);
  saveWorkspace();
  render();
  showToast("현재 고정 마스터를 고정 해제했습니다.");
});

document.querySelector("#delete-masters").addEventListener("click", () => {
  const masterIds = getCheckedValues("[data-master-check]:checked");
  if (!masterIds.length) return showToast("삭제할 마스터 파일을 체크하세요.");
  workspace = deleteMasters(workspace, masterIds);
  saveWorkspace();
  render();
  showToast("선택한 마스터 파일을 목록에서 삭제했습니다.");
});

document.querySelector("#save-gemini-key").addEventListener("click", saveGeminiSettings);
document.querySelector("#ask-gemini").addEventListener("click", askGemini);
document.querySelector("#admin-access-toggle").addEventListener("click", toggleAdminAccessPanel);
document.querySelector("#admin-mode-toggle").addEventListener("click", toggleAdminLogin);
document.querySelector("#admin-login-button").addEventListener("click", submitAdminPassword);
document.querySelector("#admin-password").addEventListener("keydown", (event) => {
  if (event.key === "Enter") submitAdminPassword();
});
document.querySelector("#request-password-change-code").addEventListener("click", requestPasswordChangeCode);
document.querySelector("#change-admin-password").addEventListener("click", changeAdminPassword);
document.querySelector("#forgot-admin-password").addEventListener("click", requestPasswordRecovery);
document.querySelector("#verify-recovery-code").addEventListener("click", verifyPasswordRecovery);
document.querySelector("#bot-toggle").addEventListener("click", openBotDrawer);
document.querySelector("#bot-close").addEventListener("click", closeBotDrawer);
document.querySelectorAll("[data-bot-prompt]").forEach((button) => {
  button.addEventListener("click", () => {
    document.querySelector("#bot-question").value = button.dataset.botPrompt;
    askGemini();
  });
});
document.querySelector("#bot-question").addEventListener("keydown", (event) => {
  if (event.ctrlKey && event.key === "Enter") askGemini();
});

window.addEventListener("storage", (event) => {
  if (event.key !== STORAGE_KEY || !event.newValue) return;
  try {
    workspace = JSON.parse(event.newValue);
    render();
    renderReviewItems();
    renderSelectedReviewItem();
    renderDrafts();
    renderProcessedResults();
    const answer = document.querySelector("#bot-answer");
    if (answer) answer.textContent = `고정 자사상품 마스터가 변경되어 ${workspace.productCatalog?.length || 0}개 상품 기준으로 다시 반영했습니다.`;
  } catch (error) {
    showToast(`공용 작업공간 변경 반영 실패: ${error.message}`);
  }
});

addFileModeControls();
addDashboardReviewShortcut();
addDashboardJobShortcut();
addCorrectionPanel();
loadGeminiSettings();
renderAdminMode();
saveWorkspace();
setupInboundListControls("inbound", "#weekly-inbound-body", "inbound-search", renderWeeklyInbound);
setupInboundListControls("soldout", "#soldout-body", "soldout-search", renderSoldOutItems);
setupInventoryDashboardInteractions();
render();
renderInventoryDashboard();



document.querySelector("#send-ai-request")?.addEventListener("click", () => {
  const text = document.querySelector("#ai-request-text").value;
  if (!text) return showToast("요청 사항을 입력하세요.");
  showToast("개선 요청이 전송되었습니다. (시뮬레이션)");
  document.querySelector("#ai-request-text").value = "";
});

const tableControllerTargets = {
  mapping: "#mapping-preview-body",
  review: "#review-items-body",
  master: "#master-files-body",
  inbound: "#weekly-inbound-body",
  soldout: "#soldout-body",
  history: "#job-history",
  learning: "#learning-history-body",
};
window.tableControllers = Object.fromEntries(
  Object.entries(tableControllerTargets).map(([tableKey, tbodySelector]) => {
    const table = document.querySelector(tbodySelector)?.closest("table");
    return [tableKey, window.TableControls?.createTableController({ table, tableKey, storage: window.localStorage }) || null];
  }),
);




/* ===== 발주확정일 + 메모 → 전체 메뉴 연동 ===== */
function normalizeConfirmDateValue(value) {
  const text = String(value || "").trim();
  const full = text.match(/(20\d{2})-(\d{2})-(\d{2})/);
  if (full) return `${full[1]}-${full[2]}-${full[3]}`;
  return "";
}

function getConfirmDateValue(item) {
  const raw = String(item?.["비고(확정일)"] || "").trim();
  const m = raw.match(/(20\d{2})-(\d{2})-(\d{2})/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  const code = String(item?.바코드 || "").replace(/\.0$/, "").trim();
  if (code && window.InboundCoordinationEngine) {
    const latest = window.InboundCoordinationEngine.getLatestByBarcode(code);
    if (latest?.confirmedDate) return latest.confirmedDate;
  }
  return "";
}

function getConfirmMemoValue(item) {
  const code = String(item?.바코드 || "").replace(/\.0$/, "").trim();
  if (!code) return "";
  if (window.InboundCoordinationEngine) {
    const latest = window.InboundCoordinationEngine.getLatestByBarcode(code);
    if (latest?.memo) return latest.memo;
  }
  const memos = Array.isArray(workspace.productMemos) ? workspace.productMemos : [];
  const hit = memos.find((m) => String(m.barcode || "").replace(/\.0$/, "").trim() === code);
  return hit?.memo || "";
}

function upsertInboundUpdateRecord(barcode, productName, confirmedDate) {
  const code = String(barcode || "").replace(/\.0$/, "").trim();
  if (!code) return;
  const list = Array.isArray(workspace.inboundUpdates) ? [...workspace.inboundUpdates] : [];
  const idx = list.findIndex((item) => String(item.barcode || "").replace(/\.0$/, "").trim() === code);
  const remark = window.InboundUpdateEngine?.formatInboundRemark?.(confirmedDate, new Date().getFullYear()) || confirmedDate;
  const row = {
    barcode: code,
    productName: String(productName || ""),
    remark: confirmedDate ? remark : "",
    rawValue: confirmedDate || "",
  };
  if (idx >= 0) list[idx] = { ...list[idx], ...row };
  else list.push(row);
  workspace.inboundUpdates = list.filter((item) => item.rawValue || item.remark);
}

function applyConfirmedDateToCache(barcode, confirmedDate) {
  const code = String(barcode || "").replace(/\.0$/, "").trim();
  if (!Array.isArray(stockScheduleCache)) return;
  const header = window.InboundUpdateEngine?.REMARK_HEADER || "비고(확정일)";
  const remark = confirmedDate
    ? (window.InboundUpdateEngine?.formatInboundRemark?.(confirmedDate, new Date().getFullYear()) || confirmedDate)
    : "";
  stockScheduleCache = stockScheduleCache.map((row) => {
    const bc = String(row.바코드 || row.barcode || "").replace(/\.0$/, "").trim();
    if (bc !== code) return row;
    return { ...row, [header]: remark, "비고(확정일)": remark };
  });
}

function upsertProductMemo(barcode, productName, memo, confirmedDate) {
  const code = String(barcode || "").replace(/\.0$/, "").trim();
  if (!code) return;
  if (!Array.isArray(workspace.productMemos)) workspace.productMemos = [];
  const list = [...workspace.productMemos];
  const idx = list.findIndex((m) => String(m.barcode || "").replace(/\.0$/, "").trim() === code);
  const row = {
    barcode: code,
    productName: String(productName || ""),
    memo: String(memo || "").trim(),
    confirmedDate: confirmedDate || "",
    updatedAt: new Date().toISOString().slice(0, 19).replace("T", " "),
  };
  if (idx >= 0) list[idx] = { ...list[idx], ...row };
  else list.unshift(row);
  workspace.productMemos = list.filter((m) => m.memo || m.confirmedDate);
}

function syncConfirmedDateToCoordination(barcode, productName, plannedDate, confirmedDate, memo) {
  if (!window.InboundCoordinationEngine) return;
  const Eng = window.InboundCoordinationEngine;
  const code = String(barcode || "").replace(/\.0$/, "").trim();
  if (!code) return;
  const existing = Eng.getLatestByBarcode(code);
  const payload = {
    barcode: code,
    productName: productName || existing?.productName || "",
    vendor: existing?.vendor || "",
    reqContent: existing?.reqContent || (confirmedDate ? "발주확정일 지정" : "확정일/메모 수정"),
    originalPlannedDate: plannedDate || existing?.originalPlannedDate || "",
    confirmedDate: confirmedDate != null ? confirmedDate : (existing?.confirmedDate || ""),
    memo: memo != null ? String(memo).trim() : (existing?.memo || ""),
    type: "",
    requester: existing?.requester || "입고리스트",
    channel: existing?.channel || "시스템",
  };
  if (!payload.confirmedDate && !payload.memo && existing?.id) {
    // 둘 다 비면 최신 기록만 메모/확정 비우기
    Eng.updateLog(existing.id, { confirmedDate: "", memo: "" });
  } else if (existing?.id) {
    Eng.updateLog(existing.id, payload);
  } else if (payload.confirmedDate || payload.memo) {
    Eng.addLog(payload);
  }
  if (window.InboundCoordinationUI?.renderAll) {
    try { window.InboundCoordinationUI.renderAll(); } catch (_) {}
  }
}


function normalizeProductBarcode(value) {
  if (window.ExpiryLotEngine?.normalizeBarcode) return window.ExpiryLotEngine.normalizeBarcode(value);
  return String(value || "").replace(/\.0$/, "").replace(/\s+/g, "").trim();
}

function getStockByBarcodeMap() {
  const map = {};
  const rows = Array.isArray(stockScheduleCache) ? stockScheduleCache : [];
  rows.forEach((row) => {
    const code = normalizeProductBarcode(row?.바코드 || row?.barcode || row?.상품코드);
    if (!code) return;
    const raw = String(row?.현재고 ?? "").trim().replace(/,/g, "");
    const stock = raw ? Number(raw) : NaN;
    if (!Number.isFinite(stock) || map[code] !== undefined) return;
    const reservedConsumption = window.SmartstoreInventoryEngine?.getConsumedQuantity?.(workspace.smartstoreReservations || [], row) || 0;
    map[code] = Math.max(0, stock - reservedConsumption);
  });
  return map;
}

function getExpiryLotsByBarcode(barcode) {
  const code = normalizeProductBarcode(barcode);
  if (!code || !window.ExpiryLotEngine) return [];
  const stockMap = getStockByBarcodeMap();
  const allocation = window.ExpiryLotEngine.summarizeStockAllocation(workspace.expiryLots || [], stockMap);
  const remaining = (allocation.remainingLots || []).filter(
    (lot) => normalizeProductBarcode(lot?.barcode) === code,
  );
  // remainingLots 에 없으면(재고 0 등으로 소진) 원본 로트는 수량 0으로 참고 표시하지 않음
  return remaining
    .slice()
    .sort((a, b) => String(a.expiryDate || "9999").localeCompare(String(b.expiryDate || "9999")));
}

function renderProductExpiryLotsHtml(barcode, productName = "") {
  const code = normalizeProductBarcode(barcode);
  const lots = getExpiryLotsByBarcode(code);
  const name = productName || "";
  const lotRows = lots.length
    ? lots.map((lot) => {
        const qty = Number(lot.remainingQuantity);
        const inboundQty = Number(lot.quantity);
        const qtyText = Number.isFinite(qty) ? qty.toLocaleString("en-US") : "-";
        const inboundText = Number.isFinite(inboundQty) ? inboundQty.toLocaleString("en-US") : "-";
        return `<tr>
          <td>${escapeHtml(lot.inboundDate || "-")}</td>
          <td>${escapeHtml(lot.manufacturedDate || "-")}</td>
          <td><strong>${escapeHtml(lot.expiryDate || "-")}</strong></td>
          <td>입고 ${escapeHtml(inboundText)} / 잔여 ${escapeHtml(qtyText)}</td>
          <td>${escapeHtml(lot.note || "-")}</td>
          <td>${escapeHtml(lot.sourceFile || "상세입력")}</td>
        </tr>`;
      }).join("")
    : `<tr><td colspan="6" class="inbound-history-empty">등록된 유통기한 로트가 없습니다.</td></tr>`;
  const nearest = lots.find((lot) => lot.expiryDate) || lots[0];
  const summary = lots.length
    ? `잔여 반영 ${lots.reduce((s, l) => s + (Number(l.remainingQuantity) || 0), 0).toLocaleString("en-US")}개 · 가까운 유통기한 <b>${escapeHtml(nearest?.expiryDate || "-")}</b>`
    : "아래에서 제조일·유통기한·입고수량을 등록하면 유통기한 관리·상품 상세에 함께 반영됩니다.";
  return `<div class="product-expiry-block" data-product-barcode="${escapeHtml(code)}">
    <div class="inbound-history-heading compact">
      <div>
        <p class="eyebrow">EXPIRY LOTS</p>
        <h4>유통기한 로트</h4>
        <p>${summary}</p>
      </div>
    </div>
    <div class="inbound-history-table-wrap">
      <table class="inbound-history-table">
        <thead><tr><th>입고일</th><th>제조일자</th><th>유통기한</th><th>수량</th><th>비고</th><th>출처</th></tr></thead>
        <tbody>${lotRows}</tbody>
      </table>
    </div>
    <form class="product-inline-form" data-expiry-form="${escapeHtml(code)}">
      <div class="product-inline-grid">
        <label>입고일<input type="date" name="inboundDate" value="${escapeHtml(new Date().toISOString().slice(0, 10))}" required /></label>
        <label>입고수량<input type="number" name="quantity" min="1" step="1" placeholder="예: 1000" required /></label>
        <label>제조일자<input type="date" name="manufacturedDate" /></label>
        <label>유통기한<input type="date" name="expiryDate" /></label>
        <label class="wide">비고<input type="text" name="note" placeholder="선택 입력" /></label>
      </div>
      <div class="product-inline-actions">
        <button type="submit" class="primary compact-button">유통기한 로트 저장</button>
      </div>
      <p class="form-help">제조일만 넣으면 18개월-1일 규칙으로 유통기한을 자동 계산합니다. 저장 시 유통기한 관리 메뉴에도 반영됩니다.</p>
    </form>
  </div>`;
}

function renderProductCoordHistoryHtml(barcode, productName = "") {
  const code = normalizeProductBarcode(barcode);
  const history = getProductHistoryByBarcode(code);
  const confirmed = getConfirmDateValue({ 바코드: code, "비고(확정일)": "" });
  const memo = getConfirmMemoValue({ 바코드: code });
  const rows = history.length
    ? history.map((h) => `<tr><td>${escapeHtml(h.at || "-")}</td><td>${escapeHtml(h.type)}</td><td>${escapeHtml(h.date || "-")}</td><td>${escapeHtml(h.memo || "-")}</td><td>${escapeHtml(h.source || "-")}</td></tr>`).join("")
    : `<tr><td colspan="5" class="inbound-history-empty">등록된 조정·메모 이력이 없습니다.</td></tr>`;
  return `<div class="product-coord-history-block" data-product-barcode="${escapeHtml(code)}">
    <div class="inbound-history-heading compact">
      <div>
        <p class="eyebrow">ITEM ADJUSTMENT</p>
        <h4>발주확정·메모 이력</h4>
        <p>${confirmed ? `확정일 <b>${escapeHtml(confirmed)}</b>` : "확정일 없음"}${memo ? ` · ${escapeHtml(memo)}` : ""}</p>
      </div>
    </div>
    <div class="inbound-history-table-wrap">
      <table class="inbound-history-table">
        <thead><tr><th>일시</th><th>구분</th><th>확정일</th><th>메모/내용</th><th>출처</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
    <form class="product-inline-form" data-confirm-form="${escapeHtml(code)}" data-product-name="${escapeHtml(productName || "")}">
      <div class="product-inline-grid">
        <label>발주확정일<input type="date" name="confirmedDate" value="${escapeHtml(confirmed || "")}" /></label>
        <label class="wide">메모<input type="text" name="memo" value="${escapeHtml(memo || "")}" placeholder="발주/입고 관련 메모" /></label>
      </div>
      <div class="product-inline-actions">
        <button type="submit" class="primary compact-button">확정일·메모 저장</button>
      </div>
      <p class="form-help">저장 시 입고예정·품절리스트 확정일, 입고조정 협의보드, 상품 상세 이력에 함께 반영됩니다.</p>
    </form>
  </div>`;
}

function bindProductDetailEditors(panel, barcode, productName = "") {
  if (!panel) return;
  const code = normalizeProductBarcode(barcode);
  const name = productName || "";

  panel.querySelectorAll("form[data-expiry-form]").forEach((form) => {
    const mfg = form.querySelector('[name="manufacturedDate"]');
    const exp = form.querySelector('[name="expiryDate"]');
    mfg?.addEventListener("change", () => {
      if (mfg.value && !exp.value && window.ExpiryLotEngine?.expiryFromManufactured) {
        exp.value = window.ExpiryLotEngine.expiryFromManufactured(mfg.value);
      }
    });
    exp?.addEventListener("change", () => {
      if (exp.value && !mfg.value && window.ExpiryLotEngine?.manufacturedFromExpiry) {
        mfg.value = window.ExpiryLotEngine.manufacturedFromExpiry(exp.value);
      }
    });
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      const data = Object.fromEntries(new FormData(form).entries());
      const quantity = Number(String(data.quantity || "").replace(/,/g, ""));
      if (!window.ExpiryLotEngine) return showToast("유통기한 엔진을 불러오지 못했습니다.");
      const result = window.ExpiryLotEngine.normalizeManualLot({
        inboundDate: data.inboundDate,
        barcode: code,
        quantity,
        manufacturedDate: data.manufacturedDate,
        expiryDate: data.expiryDate,
        note: data.note,
      }, { sequence: Date.now() });
      if (!result.ok) return showToast(result.error);
      result.lot.productName = name;
      result.lot.sourceType = result.lot.sourceType || "manual";
      result.lot.sourceFile = result.lot.sourceFile || "상품상세";
      if (!Array.isArray(workspace.expiryLots)) workspace.expiryLots = [];
      workspace.expiryLots.push(result.lot);
      if (!saveWorkspace()) return;
      showToast("유통기한 로트를 저장했습니다. 유통기한 관리에도 반영됩니다.");
      refreshOpenProductPanels(code, name);
      if (typeof window.renderExpiry === "function") window.renderExpiry();
    });
  });

  panel.querySelectorAll("form[data-confirm-form]").forEach((form) => {
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      const data = Object.fromEntries(new FormData(form).entries());
      const confirmedDate = normalizeConfirmDateValue(data.confirmedDate);
      const memo = String(data.memo || "").trim();
      const planned = "";
      upsertInboundUpdateRecord(code, name, confirmedDate);
      applyConfirmedDateToCache(code, confirmedDate);
      upsertProductMemo(code, name, memo, confirmedDate);
      syncConfirmedDateToCoordination(code, name, planned, confirmedDate, memo);
      if (!saveWorkspace()) return;
      showToast(confirmedDate || memo ? "발주확정·메모를 저장했습니다." : "확정일·메모를 비웠습니다.");
      refreshOpenProductPanels(code, name);
      if (document.querySelector("#inbound.page.active")) renderWeeklyInbound();
      if (document.querySelector("#soldout.page.active")) renderSoldOutItems();
      if (window.InboundCoordinationUI?.renderAll) window.InboundCoordinationUI.renderAll();
    });
  });
}

function refreshOpenProductPanels(barcode, productName = "") {
  const code = normalizeProductBarcode(barcode);
  // Re-open active panels if matching barcode
  if (activeInboundHistoryKey) {
    const item = currentInboundItemsByKey?.get?.(activeInboundHistoryKey);
    if (item && normalizeProductBarcode(item.바코드) === code) {
      const key = activeInboundHistoryKey;
      activeInboundHistoryKey = "";
      showInboundHistory(item, key);
    }
  }
  if (activeSoldOutHistoryKey) {
    const item = currentSoldOutItemsByKey?.get?.(activeSoldOutHistoryKey);
    if (item && normalizeProductBarcode(item.바코드) === code) {
      const key = activeSoldOutHistoryKey;
      activeSoldOutHistoryKey = "";
      showSoldOutHistory(item, key);
    }
  }
  if (activeInventoryDetailKey) {
    const item = currentInventoryItemsByKey?.get?.(activeInventoryDetailKey);
    if (item && normalizeProductBarcode(item.barcode) === code) {
      const key = activeInventoryDetailKey;
      activeInventoryDetailKey = "";
      showInventoryDetail(item, key);
    }
  }
}

function getProductHistoryByBarcode(barcode) {
  const code = String(barcode || "").replace(/\.0$/, "").trim();
  if (!code) return [];
  const rows = [];
  if (window.InboundCoordinationEngine) {
    window.InboundCoordinationEngine.getLogsByBarcode(code).forEach((log) => {
      rows.push({
        at: log.updatedAt || log.createdAt || log.reqDate || "",
        type: "입고조정",
        date: log.confirmedDate || log.reqDate || "",
        memo: log.memo || log.reqContent || log.reply || "",
        source: log.requester || log.vendor || "협의",
      });
    });
  }
  (workspace.productMemos || []).filter((m) => String(m.barcode || "").replace(/\.0$/, "").trim() === code).forEach((m) => {
    rows.push({
      at: m.updatedAt || "",
      type: "메모",
      date: m.confirmedDate || "",
      memo: m.memo || "",
      source: "품목메모",
    });
  });
  rows.sort((a, b) => String(b.at).localeCompare(String(a.at)));
  return rows;
}

function saveConfirmedInboundDateFromInput(input) {
  const wrap = input.closest(".confirm-edit-wrap") || input.parentElement;
  const dateInput = wrap?.querySelector?.(".confirm-date-input") || (input.classList.contains("confirm-date-input") ? input : null);
  const memoInput = wrap?.querySelector?.(".confirm-memo-input");
  const barcode = (dateInput || input).dataset.barcode || input.dataset.barcode || "";
  const productName = (dateInput || input).dataset.name || input.dataset.name || "";
  const plannedDate = (dateInput || input).dataset.planned || input.dataset.planned || "";
  const confirmedDate = normalizeConfirmDateValue(dateInput?.value || "");
  const memo = String(memoInput?.value || "").trim();
  upsertInboundUpdateRecord(barcode, productName, confirmedDate);
  applyConfirmedDateToCache(barcode, confirmedDate);
  upsertProductMemo(barcode, productName, memo, confirmedDate);
  syncConfirmedDateToCoordination(barcode, productName, plannedDate, confirmedDate, memo);
  if (!saveWorkspace()) return;
  showToast(
    confirmedDate
      ? `${barcode} 확정일 ${confirmedDate}${memo ? " · 메모 저장" : ""}`
      : (memo ? `${barcode} 메모 저장` : `${barcode} 확정일/메모 삭제`)
  );
  if (document.querySelector("#inbound.page.active")) renderWeeklyInbound();
  if (document.querySelector("#soldout.page.active")) renderSoldOutItems();
}

function handleDiscontinueButtonClick(button, event) {
  if (!button) return false;
  if (event) {
    event.preventDefault();
    event.stopPropagation();
  }

  const turnOn = (button.getAttribute("data-discontinued") || button.dataset.discontinued || "0") !== "1";
  const productLabel = button.getAttribute("data-name") || button.dataset.name || "이 상품";

  if (turnOn) {
    const ok = window.confirm(
      "[" + productLabel + "] 상품을 단종 처리하시겠습니까?\n\n" +
      "단종하면 '단종' 분류로만 표시됩니다.\n" +
      "계속하려면 확인을 누른 뒤 관리자 비밀번호를 입력하세요."
    );
    if (!ok) return true;
    // 반드시 비밀번호 입력 알림
    window.alert("단종할 거면 관리자 비밀번호를 입력해 주세요.");
    const password = window.prompt("관리자 비밀번호 입력:");
    if (password === null || String(password).trim() === "") {
      showToast("비밀번호 입력이 취소되어 단종 처리를 하지 않았습니다.");
      return true;
    }
    if (!verifyAdminPassword(password)) {
      window.alert("관리자 비밀번호가 맞지 않습니다.\n단종 처리를 취소했습니다.");
      showToast("관리자 비밀번호가 맞지 않습니다.");
      return true;
    }
  } else {
    const ok = window.confirm("[" + productLabel + "] 단종 처리를 해제하시겠습니까?");
    if (!ok) return true;
    window.alert("단종 해제를 위해 관리자 비밀번호를 입력해 주세요.");
    const password = window.prompt("관리자 비밀번호 입력:");
    if (password === null || String(password).trim() === "") {
      showToast("비밀번호 입력이 취소되었습니다.");
      return true;
    }
    if (!verifyAdminPassword(password)) {
      window.alert("관리자 비밀번호가 맞지 않습니다.");
      return true;
    }
  }

  let key = button.getAttribute("data-edit-key") || button.dataset.editKey || "";
  if (!key) {
    const barcode = button.getAttribute("data-barcode") || button.dataset.barcode || "";
    const name = button.getAttribute("data-name") || button.dataset.name || "";
    key = [String(name).replace(/^\(단종\)\s*/, "").trim(), String(barcode).replace(/\.0$/, "").trim(), "", ""].join("|");
  }
  if (!key || key === "|||") {
    showToast("상품 키를 확인할 수 없습니다.");
    return true;
  }

  upsertRowOverride(key, { discontinued: turnOn });
  showToast(turnOn ? "단종 처리되었습니다." : "단종 처리를 해제했습니다.");
  if (document.querySelector("#inbound.page.active")) renderWeeklyInbound();
  if (document.querySelector("#soldout.page.active")) renderSoldOutItems();
  if (document.querySelector("#dashboard.page.active")) renderInventoryDashboard();
  return true;
}

document.addEventListener("click", (event) => {
  const button = event.target?.closest?.(".row-discontinue-btn");
  if (!button) return;
  handleDiscontinueButtonClick(button, event);
}, true);

document.addEventListener("change", (event) => {
  const input = event.target?.closest?.(".container-edit-input");
  if (!input) return;
  upsertRowOverride(input.dataset.editKey || "", { containerName: input.value.trim() });
  showToast("컨테이너명을 저장했습니다.");
});

document.addEventListener("change", (event) => {
  if (event.target?.closest?.(".confirm-date-input") || event.target?.closest?.(".confirm-memo-input")) {
    const input = event.target.closest(".confirm-date-input, .confirm-memo-input");
    if (input) saveConfirmedInboundDateFromInput(input);
  }
});

// 메모는 blur 시에도 저장 (텍스트 입력 편의)
document.addEventListener("focusout", (event) => {
  if (event.target?.classList?.contains("confirm-memo-input")) {
    saveConfirmedInboundDateFromInput(event.target);
  }
});

/* ===== 입고조정 협의 연동 훅 ===== */
window.getInboundScheduleRows = function getInboundScheduleRows() {
  return stockScheduleCache || [];
};

window.refreshInboundSchedule = function refreshInboundSchedule(rows) {
  if (Array.isArray(rows)) stockScheduleCache = rows;
  try {
    if (typeof renderWeeklyInbound === "function") renderWeeklyInbound();
    if (typeof renderSoldOutItems === "function") renderSoldOutItems();
  } catch (e) {
    console.warn("[coord] schedule refresh", e);
  }
};

// 스케줄 로드 후 협의 확정일 자동 반영
(function hookCoordinationAfterSchedule() {
  const original = window.loadStockScheduleRows;
  if (typeof original !== "function") return;
  window.loadStockScheduleRows = async function () {
    const rows = await original.apply(this, arguments);
    try {
      if (window.InboundCoordinationEngine && Array.isArray(rows) && rows.length) {
        const applied = window.InboundCoordinationEngine.applyConfirmedToSchedule(rows);
        stockScheduleCache = applied.rows;
        return applied.rows;
      }
    } catch (e) {
      console.warn("[coord] applyConfirmed", e);
    }
    return rows;
  };
})();
