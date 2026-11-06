(function attachMappingEngine(root, factory) {
  const api = factory();
  root.MappingEngine = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof globalThis !== "undefined" ? globalThis : window, function createMappingEngine() {
  "use strict";

  const HEADER_ALIASES = {
    groupNo: ["no", "groupnumber"],
    salesInfo: ["판매상품정보", "salesproductinformation", "salesinfo"],
    sequence: ["순번", "sequence"],
    productCode: ["연결된상품코드", "자사상품코드", "상품코드", "mappedproductcode", "productcode", "sku"],
    mappedProduct: ["연결된상품명", "연결된자사상품명", "자사상품명", "자사상품", "매핑상품", "mappedproductname", "mappedproduct"],
    mappedQuantity: ["연결상품수량", "매핑수량", "mappedquantity"],
    orderNo: ["주문번호", "발주번호", "주문코드", "ordernumber", "orderno", "orderid"],
    productText: ["상품명", "주문상품", "주문내용", "주문상품내용", "품목", "품명", "productname", "orderproduct", "orderdetails"],
    option1: ["옵션1", "옵션정보", "옵션", "option1", "option"],
    option2: ["옵션2", "option2"],
    orderQuantity: ["주문수량", "수량", "orderquantity", "quantity", "qty"],
  };

  const OPTION_LABELS = /^(색상|컬러|크기|사이즈|용량|맛|타입|형|선택|제품\s*선택|옵션\s*\d*|수량)\s*[:：]/i;
  const STOP_TOKENS = new Set([
    "상품", "제품", "선택", "옵션", "구매", "가능", "무료배송", "업체별도", "골라담기",
    "강아지", "고양이", "애견", "애묘", "국내산", "간식", "기타", "색상", "크기", "용량", "타입",
  ]);

  function text(value) {
    if (value === null || value === undefined) return "";
    return String(value).trim();
  }

  function number(value, fallback = 0) {
    if (typeof value === "number" && Number.isFinite(value)) return value;
    const parsed = Number(text(value).replace(/,/g, "").match(/-?\d+(?:\.\d+)?/)?.[0]);
    return Number.isFinite(parsed) ? parsed : fallback;
  }

  function canonicalHeader(value) {
    return text(value).toLowerCase().replace(/[\s_\-\/()]/g, "");
  }

  function headerIndex(headers) {
    const result = {};
    headers.forEach((header, index) => {
      const canonical = canonicalHeader(header);
      for (const [field, aliases] of Object.entries(HEADER_ALIASES)) {
        if (result[field] === undefined && aliases.includes(canonical)) result[field] = index;
      }
    });
    return result;
  }

  function detectFormat(headers) {
    const index = headerIndex(headers || []);
    if (index.salesInfo !== undefined && index.mappedProduct !== undefined) return "new";
    if (index.orderNo !== undefined && index.productText !== undefined) return "legacy";
    return null;
  }

  function parseSalesInfo(value) {
    const lines = text(value).split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
    if (!lines.length) return { seller: "", orderNo: "", productText: "", optionText: "" };
    const seller = lines[0] || "";
    const orderNo = lines[1] || "";
    const body = lines.slice(2);
    const optionStart = body.findIndex((line) => OPTION_LABELS.test(line));
    let productLines = optionStart >= 0 ? body.slice(0, optionStart) : body.slice(0, 1);
    let optionLines = optionStart >= 0 ? body.slice(optionStart) : [];
    if (!productLines.length && body.length) productLines = [body[0]];
    return {
      seller,
      orderNo,
      productText: productLines.join(" ").trim(),
      optionText: optionLines.join(" | ").trim(),
    };
  }

  function cell(row, index) {
    return index === undefined ? "" : row[index];
  }

  function explicitOrderQuantity(sourceText) {
    const source = text(sourceText);
    const patterns = [
      /(?:주문수량|구매수량|수량)\s*[:：]?\s*(\d+)\s*(?:개|세트|박스)?/i,
      /(?:^|[\s(])(?:x|×|\*)\s*(\d+)\s*(?:개|세트|박스)?(?:$|[\s)])/i,
    ];
    for (const pattern of patterns) {
      const match = source.match(pattern);
      if (match) return number(match[1], 1);
    }
    return 0;
  }

  function normalizeRows(rows) {
    if (!Array.isArray(rows) || !rows.length) throw new Error("엑셀에 분석할 행이 없습니다.");
    const headers = rows[0].map(text);
    const format = detectFormat(headers);
    if (!format) throw new Error("지원하지 않는 양식입니다. 주문번호/상품명 또는 판매상품 정보/연결된 상품명 헤더가 필요합니다.");
    const index = headerIndex(headers);
    const normalized = [];
    let lastGroupNo = "";
    let lastSalesInfo = "";

    rows.slice(1).forEach((row, offset) => {
      if (!Array.isArray(row) || !row.some((value) => text(value))) return;
      if (format === "new") {
        const rawGroupNo = text(cell(row, index.groupNo));
        const rawSalesInfo = text(cell(row, index.salesInfo));
        if (rawGroupNo && rawGroupNo !== lastGroupNo) lastSalesInfo = "";
        if (rawGroupNo) lastGroupNo = rawGroupNo;
        if (rawSalesInfo) lastSalesInfo = rawSalesInfo;
        const parsed = parseSalesInfo(rawSalesInfo || lastSalesInfo);
        const sourceText = rawSalesInfo || lastSalesInfo;
        normalized.push({
          sourceRow: offset + 2,
          format,
          groupNo: rawGroupNo || lastGroupNo || String(offset + 1),
          sequence: text(cell(row, index.sequence)) || "1",
          seller: "",
          orderNo: parsed.orderNo,
          productText: sourceText,
          optionText: "",
          sourceText,
          orderQuantity: explicitOrderQuantity(sourceText) || 1,
          productCode: text(cell(row, index.productCode)),
          mappedProduct: text(cell(row, index.mappedProduct)),
          mappedQuantity: number(cell(row, index.mappedQuantity), 0),
        });
      } else {
        const productText = text(cell(row, index.productText));
        const optionText = [text(cell(row, index.option1)), text(cell(row, index.option2))].filter(Boolean).join(" | ");
        normalized.push({
          sourceRow: offset + 2,
          format,
          groupNo: text(cell(row, index.groupNo)) || String(offset + 1),
          sequence: text(cell(row, index.sequence)) || "1",
          seller: "",
          orderNo: text(cell(row, index.orderNo)),
          productText,
          optionText,
          sourceText: [productText, optionText].filter(Boolean).join(" | "),
          orderQuantity: number(cell(row, index.orderQuantity), 1),
          productCode: text(cell(row, index.productCode)),
          mappedProduct: text(cell(row, index.mappedProduct)),
          mappedQuantity: number(cell(row, index.mappedQuantity), 0),
        });
      }
    });
    return normalized;
  }

  function compact(value) {
    return text(value).toLowerCase().replace(/[^0-9a-z가-힣]+/g, "");
  }

  function tokens(value) {
    return text(value)
      .toLowerCase()
      .replace(/[\[\]]/g, " ")
      .replace(/[^0-9a-z가-힣]+/g, " ")
      .split(/\s+/)
      .filter((token) => token.length >= 2 && !STOP_TOKENS.has(token) && !/^\d+$/.test(token));
  }

  function minimumQuantity(value) {
    const source = text(value);
    const match = source.match(/(\d+)\s*개\s*이상\s*구매|최소\s*(\d+)\s*개/i);
    return match ? number(match[1] || match[2], 0) : 0;
  }

  function baseOrderContentKey(value) {
    const lines = text(value).split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
    const contentLines = lines.filter((line, index) => {
      if (lines.length >= 3 && index === 0) return false;
      if (/^\d{6,}$/.test(line)) return false;
      if (/^(?:선택|제품\s*선택|옵션\s*\d*)\s*[:：]/i.test(line)) return false;
      return true;
    });
    return compact(contentLines.join(" ")
      .replace(/\([^)]*(?:개\s*이상\s*구매|최소\s*\d+|업체별도\s*무료배송|배송)[^)]*\)/gi, " "));
  }

  function familyKey(row) {
    return baseOrderContentKey(row.productText) || compact(row.productText).slice(0, 60);
  }

  function optionValues(value) {
    const ignored = new Set(["선택", "옵션", "색상", "컬러", "크기", "사이즈", "용량", "맛", "타입", "제품", "세트", "구매", "가능"]);
    return text(value)
      .replace(/수량\s*[:：]?\s*\d+\s*박스(?:\([^)]*\))*/gi, " ")
      .replace(/(?:색상|컬러|크기|사이즈|용량|맛|타입|형|선택|제품\s*선택|옵션\s*\d*)\s*[:：]/gi, " ")
      .split(/[\s,\/+|]+/)
      .map((token) => token.trim())
      .filter((token) => {
        if (!token || ignored.has(token)) return false;
        if (/^\d+$/.test(token)) return false;
        // 용량·규격 토큰 유지 (320g, 180g, 12개입 등)
        if (/\d+(?:g|kg|ml|l|입|p)$/i.test(token)) return true;
        return token.length > 1;
      });
  }

  function labeledOptionText(value) {
    return text(value).split(/\r?\n/).filter((line) => OPTION_LABELS.test(line) && !/^수량\s*[:：]/i.test(line)).join(" | ");
  }

  function splitOrderComponents(sourceText) {
    const source = text(sourceText);
    if (!source) return [];
    // 선택1/선택2, 옵션1/옵션2, 줄바꿈, + 로 구성품 분리
    const parts = source
      .split(/(?:(?:^|[\/|\s])선택\s*\d+\s*[:：]\s*|(?:^|[\/|\s])옵션\s*\d+\s*[:：]\s*|\r?\n|\s*\+\s*)/i)
      .map((part) => part.trim())
      .filter(Boolean);
    if (parts.length > 1) return parts;
    // 슬래시로만 나뉜 경우
    const slashParts = source.split(/\s*\/\s*/).map((part) => part.trim()).filter((part) => part.length > 4);
    if (slashParts.length > 1) return slashParts;
    return [source];
  }

  function quantityFromComponent(componentText, allowBoxFallback = true) {
    const source = text(componentText);
    if (!source) return 0;
    // x 12개, ×12개, *12개
    const xMatch = source.match(/[x×*]\s*(\d+)\s*개(?!입)/i);
    if (xMatch) return number(xMatch[1], 0);
    // 12개 (개입 제외) — 마지막 값
    const pcs = [...source.replace(/(?:\d+\s*개\s*이상\s*구매|최소\s*\d+\s*개)/gi, " ").matchAll(/(\d+)\s*개(?!입)/gi)]
      .map((m) => number(m[1], 0))
      .filter((n) => n > 0);
    if (pcs.length) return pcs[pcs.length - 1];
    // 박스 환산
    const boxCount = number(source.match(/(\d+)\s*박스/i)?.[1], 0);
    const perBox = number(source.match(/\((\d+)\s*개입\)/i)?.[1], 0) || packSizeFromText(source);
    if (boxCount && perBox) return boxCount * perBox;
    if (boxCount && allowBoxFallback) return boxCount;
    return 0;
  }

  function matchingOrderComponent(row) {
    const components = splitOrderComponents(row.sourceText || row.optionText);
    const mappedTokens = tokens(row.mappedProduct);
    const mappedCompact = compact(row.mappedProduct);
    let bestComponent = "";
    let bestScore = -1;
    components.forEach((component) => {
      const compactComponent = compact(component);
      let score = mappedTokens.reduce((total, token) => {
        const compactToken = compact(token);
        if (!compactToken || compactToken.length < 2) return total;
        return total + (compactComponent.includes(compactToken) ? Math.min(compactToken.length, 12) : 0);
      }, 0);
      // 연결상품 전체가 구성 문구에 포함되면 가산
      if (mappedCompact.length >= 4 && compactComponent.includes(mappedCompact.slice(0, Math.min(12, mappedCompact.length)))) {
        score += 20;
      }
      // 수량 패턴이 있는 구성 우선(동점 시)
      if (quantityFromComponent(component) > 0) score += 1;
      if (score > bestScore) {
        bestComponent = component;
        bestScore = score;
      }
    });
    return bestComponent || text(row.sourceText);
  }

  function packSizeFromText(value) {
    const source = text(value);
    if (!source) return 0;
    const patterns = [
      /\((\d+)\s*개입\)/i,
      /(\d+)\s*개입/i,
      /(\d+)\s*p(?:\b|(?=\s|\(|\[|$))/i,
      /\[\s*(\d+)\s*\]/,
      /박스당\s*입수\s*[:：]?\s*(\d+)/i,
      /입수\s*[:：]?\s*(\d+)/i,
    ];
    for (const pattern of patterns) {
      const match = source.match(pattern);
      if (match) {
        const n = number(match[1], 0);
        // g/kg 와 혼동되는 과도한 값 방지: 개입/입수는 보통 500 이하
        if (n > 0 && n <= 500) return n;
      }
    }
    return 0;
  }

  function expectedMappedQuantity(row) {
    const component = matchingOrderComponent(row);
    const fromComponent = quantityFromComponent(component, false);
    if (fromComponent > 0) return fromComponent;

    const fullText = text(row.sourceText);
    const optionText = text(row.optionText || labeledOptionText(fullText));
    const quantityLine = fullText.split(/\r?\n/).find((line) => /^수량\s*[:：]/i.test(line.trim())) || "";
    const boxSource = [component, quantityLine, optionText].filter(Boolean).join(" ");
    const boxCount =
      number(boxSource.match(/(\d+)\s*박스/i)?.[1], 0) ||
      number(boxSource.match(/박스\s*[:：]?\s*(\d+)/i)?.[1], 0);
    const piecesPerBox =
      number(boxSource.match(/\((\d+)\s*개입\)/i)?.[1], 0) ||
      packSizeFromText(boxSource) ||
      packSizeFromText(row.mappedProduct);
    if (boxCount && piecesPerBox) return boxCount * piecesPerBox;
    if (boxCount && /터키츄/i.test(`${boxSource} ${row.mappedProduct || ""}`)) return boxCount * 40;

    const lineQuantity = explicitOrderQuantity(quantityLine) || explicitOrderQuantity(optionText) || quantityFromComponent(boxSource);
    if (lineQuantity) return lineQuantity;

    // 구성품 수량이 없고 매핑수량·주문수량이 같으면 주문수량 신뢰
    const orderQty = number(row.orderQuantity, 0);
    const mappedQty = number(row.mappedQuantity, 0);
    if (orderQty > 0 && mappedQty > 0 && orderQty === mappedQty) return orderQty;
    return orderQty || mappedQty || 1;
  }

  function needsQuantityCorrection(decision) {
    return number(decision?.expectedQuantity, 0) !== number(decision?.mappedQuantity, 0);
  }

  function productMatch(row, groupRows = [row]) {
    if (!row.mappedProduct) return { pass: false, reason: "상품 불일치: 연결된 상품명이 비어 있음" };
    if (![row.sourceText, row.productText, row.optionText].some((value) => text(value))) {
      return { pass: false, reason: "상품 불일치: 비교할 주문내용이 비어 있음" };
    }
    const mapped = compact(row.mappedProduct);
    const mappedProduct = text(row.mappedProduct);
    const component = matchingOrderComponent(row);
    const componentCompact = compact(component);
    // 연결상품이 해당 선택/구성 문구와 직접 맞으면 우선 일치
    const mappedTokens = tokens(mappedProduct);
    const directHits = mappedTokens.filter((token) => componentCompact.includes(compact(token)));
    const options = optionValues(row.optionText || labeledOptionText(row.sourceText));
    // 다른 구성품에만 있는 옵션 토큰은 제외 (현재 매핑 상품 구성 기준)
    const relevantOptions = options.filter((token) => {
      const c = compact(token);
      if (!c) return false;
      if (componentCompact.includes(c)) return true;
      // 전체 주문 텍스트에만 있고 현재 구성에 없으면 타 구성 옵션으로 간주
      return false;
    });
    const missingOptions = relevantOptions.filter((token) => !mapped.includes(compact(token)));
    const productTokens = tokens(row.productText);
    const matchedTokens = productTokens.filter((token) => mapped.includes(compact(token)));
    const enoughProduct = !productTokens.length || matchedTokens.length >= Math.min(2, productTokens.length);
    if (missingOptions.length) {
      return { pass: false, reason: `상품 불일치: 주문 옵션 ${missingOptions.join(", ")}이(가) 연결상품 '${row.mappedProduct}'과 다름` };
    }
    if (mappedTokens.length && directHits.length >= Math.min(2, mappedTokens.length)) {
      return { pass: true, reason: `상품 일치: 구성 '${component}' ↔ 연결상품 '${mappedProduct}'` };
    }
    if (!enoughProduct && directHits.length === 0) {
      return { pass: false, reason: `상품 불일치: 주문 '${row.sourceText}'과 연결상품 '${row.mappedProduct}'의 핵심 상품명이 다름` };
    }
    const mappedLabel = groupRows.length > 1 ? groupRows.map((item) => item.mappedProduct).join(" + ") : row.mappedProduct;
    return { pass: true, reason: `상품 일치: 주문 ↔ 연결상품 '${mappedLabel}'` };
  }

  function learnedSignature(value) {
    return new Set(tokens(value));
  }

  function findLearnedCorrection(row, learningHistory) {
    const sourceTokens = learnedSignature(row.sourceText);
    const currentOptions = optionValues(row.optionText);
    for (const learned of learningHistory || []) {
      const learnedSource = text(learned.sourceText || learned.orderProduct || learned.주문내용);
      const learnedTokens = learnedSignature(learnedSource);
      const overlap = [...sourceTokens].filter((token) => learnedTokens.has(token));
      const learnedOptions = optionValues(learnedSource);
      const hasOptionConflict = currentOptions.length && learnedOptions.length &&
        currentOptions.every((token) => !learnedOptions.includes(token));
      if (overlap.length >= 2 && !hasOptionConflict) {
        return {
          productName: text(learned.mappedProduct || learned.productName || learned.correctProduct),
          productCode: text(learned.productCode),
          quantity: number(learned.quantity ?? learned.mappedQuantity ?? learned.correctQuantity, 1),
          recordId: text(learned.id) || "학습기록",
        };
      }
    }
    return null;
  }

  function uniqueGroupQuantity(rows) {
    const byGroup = new Map();
    rows.forEach((row) => {
      const key = `${row.orderNo}::${row.groupNo}::${familyKey(row)}`;
      if (!byGroup.has(key)) byGroup.set(key, row.orderQuantity || 1);
    });
    return [...byGroup.values()].reduce((sum, qty) => sum + qty, 0);
  }

  function minimumOrderBundle(rows, rowIndex) {
    const targetFamily = familyKey(rows[rowIndex]);
    const exactOrderRows = rows.filter((candidate) => candidate.orderNo === rows[rowIndex].orderNo && familyKey(candidate) === targetFamily);
    if (exactOrderRows.length > 1) return exactOrderRows;
    const isAdjacentFamilyOrder = (left, right) => {
      if (!left || !right || familyKey(left) !== targetFamily || familyKey(right) !== targetFamily) return false;
      const leftNumber = Number(text(left.orderNo));
      const rightNumber = Number(text(right.orderNo));
      return Number.isFinite(leftNumber) && Number.isFinite(rightNumber) && rightNumber - leftNumber === 1;
    };
    let start = rowIndex;
    let end = rowIndex;
    while (start > 0 && isAdjacentFamilyOrder(rows[start - 1], rows[start])) start -= 1;
    while (end < rows.length - 1 && isAdjacentFamilyOrder(rows[end], rows[end + 1])) end += 1;
    return rows.slice(start, end + 1);
  }

  function judgeMappings(inputRows, learningHistory = []) {
    const rows = inputRows.map((row) => ({ ...row }));
    rows.forEach((row) => {
      if (row.mappedProduct) {
        row.learningApplied = false;
        return;
      }
      const learned = findLearnedCorrection(row, learningHistory);
      if (learned?.productName) {
        row.mappedProduct = learned.productName;
        if (learned.productCode) row.productCode = learned.productCode;
        if (learned.quantity) row.mappedQuantity = learned.quantity;
        row.learningApplied = true;
        row.learningRecordId = learned.recordId;
      } else {
        row.learningApplied = false;
      }
    });

    return rows.map((row, rowIndex) => {
      const sameOrderFamily = minimumOrderBundle(rows, rowIndex);
      const minimum = minimumQuantity(row.sourceText);
      const familyQuantity = uniqueGroupQuantity(sameOrderFamily);
      const minimumPass = !minimum || familyQuantity >= minimum;
      const minimumDecision = !minimum
        ? "최소수량 해당 없음"
        : `최소수량 ${minimumPass ? "충족" : "미충족"}: 같은 주문내용 그룹 총 ${familyQuantity}개 / 기준 ${minimum}개`;
      const groupRows = rows.filter((candidate) => candidate.orderNo === row.orderNo && candidate.groupNo === row.groupNo);
      const product = productMatch(row, groupRows);
      const expectedQuantity = expectedMappedQuantity(row);
      const quantityPass = expectedQuantity === row.mappedQuantity;
      const quantityDecision = quantityPass
        ? `수량 일치: 환산 주문수량 ${expectedQuantity}개 ↔ 매핑수량 ${row.mappedQuantity}개`
        : `수량 불일치: 환산 주문수량 ${expectedQuantity}개 ↔ 매핑수량 ${row.mappedQuantity}개`;
      const missingComponents = groupRows.filter((candidate) => !candidate.mappedProduct);
      const componentPass = missingComponents.length === 0;
      const componentDecision = componentPass
        ? `구성품 일치: NO ${row.groupNo} 내 ${groupRows.length}개 연결상품 확인`
        : `구성품 불일치: NO ${row.groupNo} 내 연결상품명 누락 ${missingComponents.length}개`;
      const mismatches = [];
      if (!minimumPass) mismatches.push(minimumDecision);
      if (!product.pass) mismatches.push(product.reason);
      if (!quantityPass) mismatches.push(quantityDecision);
      if (!componentPass) mismatches.push(componentDecision);
      const finalStatus = mismatches.length ? "확인 필요" : "정상";
      const learningDecision = row.learningApplied ? `학습 적용: ${row.learningRecordId}` : "학습 적용 없음";
      return {
        ...row,
        expectedQuantity,
        quantityPass,
        minimumDecision,
        productDecision: product.reason,
        quantityDecision,
        componentDecision,
        finalStatus,
        mismatches,
        learningApplied: row.learningApplied,
        decisionText: [minimumDecision, product.reason, quantityDecision, componentDecision, learningDecision, `최종판정: ${finalStatus}`].join("\n"),
      };
    });
  }

  function toHistoryRow(decision) {
    return {
      주문번호: text(decision.orderNo),
      주문상품과옵션: [text(decision.productText), text(decision.optionText)].filter(Boolean).join(" | "),
      연결상품: text(decision.mappedProduct),
      주문수량: number(decision.orderQuantity, 0),
      매핑수량: number(decision.mappedQuantity, 0),
      최소수량판정: text(decision.minimumDecision),
      상품판정: text(decision.productDecision),
      수량판정: text(decision.quantityDecision),
      구성품판정: text(decision.componentDecision),
      최종판정: text(decision.finalStatus),
      상세판정내용: text(decision.decisionText),
      사용자수정정답: text(decision.correctionAnswer),
      학습적용여부: decision.learningApplied ? "적용" : "미적용",
    };
  }

  return {
    detectFormat,
    parseSalesInfo,
    normalizeRows,
    judgeMappings,
    findLearnedCorrection,
    needsQuantityCorrection,
    baseOrderContentKey,
    toHistoryRow,
  };
});
