(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.InboundTableEngine = api;
})(typeof window !== "undefined" ? window : globalThis, function () {
  function normalizeSearchText(value) {
    return String(value ?? "").replace(/\s+/g, "").toLowerCase();
  }

  function filterRows(rows, query, fields) {
    const needle = normalizeSearchText(query);
    if (!needle) return [...rows];
    return rows.filter((row) => fields.some((field) => normalizeSearchText(row[field]).includes(needle)));
  }

  function filterRowsBySelectedValues(rows, filters = {}) {
    const activeFilters = Object.entries(filters || {})
      .filter(([, values]) => Array.isArray(values))
      .map(([key, values]) => [key, [...new Set(values)].map((value) => String(value))]);
    if (!activeFilters.length) return [...(rows || [])];
    return (rows || []).filter((row) => activeFilters.every(([key, values]) => values.includes(String(row?.[key] ?? ""))));
  }

  function getUniqueColumnValues(rows, key) {
    const seen = new Set();
    return (rows || []).reduce((values, row) => {
      const value = String(row?.[key] ?? "").trim();
      if (!value || seen.has(value)) return values;
      seen.add(value);
      values.push(value);
      return values;
    }, []);
  }

  const INBOUND_RETAILER_CATEGORIES = ["리테일A", "리테일B", "리테일C"];
  const CLOTHING_YEAR_CATEGORIES = ["PD24", "PD25", "PD26", "PD27", "PD28"];
  const CLOTHING_SEASON_CATEGORIES = ["24SS", "24FW", "25SS", "25FW", "26SS", "26FW", "27SS", "27FW"];
  const INBOUND_FILTER_CATEGORIES = new Set(["의류", "하네스", "간식", "장난감", ...INBOUND_RETAILER_CATEGORIES, ...CLOTHING_YEAR_CATEGORIES, ...CLOTHING_SEASON_CATEGORIES]);
  const INBOUND_CLOTHING_KEYWORDS = ["의류", "옷", "티셔츠", "셔츠", "후드", "맨투맨", "원피스", "패딩", "조끼", "자켓", "재킷", "니트", "올인원", "레인코트"];
  const INBOUND_SNACK_MAJOR_CATEGORIES = new Set(["간식", "애견사료", "애견간식", "애묘간식", "애묘사료"].map(normalizeSearchText));

  function toggleSingleCategory(selectedCategories, category) {
    const current = (selectedCategories || [])[0];
    return current === category ? [] : [category];
  }

  function parseStockNumber(value) {
    const n = Number(String(value ?? "").replace(/,/g, "").replace(/[^\d.-]/g, ""));
    return Number.isFinite(n) ? n : null;
  }

  function isMissingBarcode(row) {
    const code = String(row?.바코드 || row?.barcode || "").replace(/\.0$/, "").trim();
    return !code || code === "-" || code === "없음" || code.toLowerCase() === "null";
  }

  function isDiscontinuedRow(row) {
    // 자사상품 시트: C상품명 · D대분류 · K품절(단종/판매) 기준
    if (row?.수동단종 === true || row?.수동단종 === "true") return true;
    const name = String(row?.상품명 || row?.제품명 || "");
    const major = String(row?.대분류 || row?.분류 || "");
    const status = String(row?.품절 || row?.단종 || row?.판매상태 || row?.상태 || "");
    if (/단종/.test(name) || /단종/.test(major) || /#\s*단종/.test(major)) return true;
    if (/단종/.test(status)) return true;
    if (isMissingBarcode(row) && /단종/.test(`${name}${major}${status}`)) return true;
    // 바코드 없고 상품명에 단종 표기
    if (isMissingBarcode(row) && /\(단종\)|단종/.test(name)) return true;
    return false;
  }

  function getProductCode(row) {
    return String(row?.상품코드 || row?.자사상품코드 || row?.코드 || row?.productCode || "").trim();
  }

  /** PD + YYMMDD + 순번 → 연도·시즌 */
  function parseProductCodeMeta(code) {
    const source = String(code || "").trim();
    const match = source.match(/^PD(\d{2})(\d{2})(\d{2})/i);
    if (!match) return null;
    const yy = match[1];
    const mm = Number(match[2]);
    const dd = match[3];
    if (mm < 1 || mm > 12) return null;
    const seasonHalf = mm <= 6 ? "SS" : "FW";
    return {
      productCode: source,
      yearCode: `PD${yy}`,
      seasonCode: `${yy}${seasonHalf}`,
      seasonLabel: `${yy}${seasonHalf}`,
      year: yy,
      month: mm,
      day: dd,
    };
  }

  function getClothingYearCategory(row) {
    return parseProductCodeMeta(getProductCode(row))?.yearCode || "";
  }

  function getClothingSeasonMeta(row) {
    if (!isClothingRow(row) || isDiscontinuedRow(row)) return null;
    return parseProductCodeMeta(getProductCode(row));
  }


  function isClothingRow(row) {
    const major = String(row?.대분류 || row?.분류 || "");
    const productName = normalizeSearchText(row?.상품명 || row?.제품명 || "");
    if (/의류/.test(major)) return true;
    if (INBOUND_CLOTHING_KEYWORDS.some((keyword) => productName.includes(normalizeSearchText(keyword)))) return true;
    return false;
  }

  function isZeroStockRow(row) {
    const stock = parseStockNumber(row?.현재고);
    return stock === 0;
  }

  function isNegativeStockRow(row) {
    const stock = parseStockNumber(row?.현재고);
    return stock !== null && stock < 0;
  }

  function getOriginCategory(row) {
    const blob = [
      row?.["국내/수입"], row?.입고구분표시, row?.입고구분, row?.다음입고, row?.다음입고내용,
      row?.컨테이너표시, row?.BL, row?.수입예정업체,
    ].map((v) => String(v ?? "")).join(" ");
    if (/국내/.test(blob) && !/수입/.test(blob)) return "국내";
    if (/수입|컨테이너|BL|해외/.test(blob)) return "수입";
    if (/국내/.test(blob)) return "국내";
    return "";
  }

  function getInboundKeywordCategories(row) {
    const productName = normalizeSearchText(row?.상품명 || row?.제품명 || "");
    const majorCategory = normalizeSearchText(row?.대분류 || "");
    const categories = [];
    if (isDiscontinuedRow(row)) {
      categories.push("단종");
      return categories; // 단종은 다른 분류와 섞지 않음
    }
    if (isZeroStockRow(row)) categories.push("현재고0");
    if (isNegativeStockRow(row)) categories.push("현재고마이너스");
    const origin = getOriginCategory(row);
    if (origin) categories.push(origin);
    // 의류: 대분류 의류 또는 키워드 — 연도 세분화 PD26 등
    if (isClothingRow(row)) {
      categories.push("의류");
      const seasonMeta = parseProductCodeMeta(getProductCode(row));
      if (seasonMeta?.yearCode) categories.push(seasonMeta.yearCode);
      if (seasonMeta?.seasonCode) categories.push(seasonMeta.seasonCode);
    }
    if (majorCategory === "하네스" || productName.includes(normalizeSearchText("하네스"))) categories.push("하네스");
    if (INBOUND_SNACK_MAJOR_CATEGORIES.has(majorCategory)) categories.push("간식");
    const toyKeywords = ["장난감", "토이", "toy", "공놀이", "로프", "츄잉", "삑삑", "노즈워크", "터그"];
    if (toyKeywords.some((k) => productName.includes(normalizeSearchText(k)))
      || /장난감/.test(String(row?.대분류 || ""))
      || /장난감/.test(String(row?.중분류 || ""))
      || /장난감/.test(String(row?.소분류 || ""))) {
      categories.push("장난감");
    }
    INBOUND_RETAILER_CATEGORIES.forEach((retailer) => {
      if (productName.includes(normalizeSearchText(retailer))) categories.push(retailer);
    });
    return categories;
  }

  const SPECIAL_LIST_CATEGORIES = new Set(["단종", "현재고0", "현재고마이너스", "국내", "수입"]);
  const INBOUND_ALL_FILTER_CATEGORIES = new Set([
    ...INBOUND_FILTER_CATEGORIES,
    ...SPECIAL_LIST_CATEGORIES,
    ...CLOTHING_YEAR_CATEGORIES,
    ...CLOTHING_SEASON_CATEGORIES,
  ]);

  function filterRowsByCategories(rows, selectedCategories, options = {}) {
    const selected = [...new Set(selectedCategories || [])].filter((category) =>
      INBOUND_ALL_FILTER_CATEGORIES.has(category) || INBOUND_FILTER_CATEGORIES.has(category)
    );
    const mode = options.mode || "inbound"; // inbound | soldout
    if (mode === "soldout" && !selected.length) return [...(rows || [])];
    return (rows || []).filter((row) => {
      const cats = getInboundKeywordCategories(row);
      const isDisc = cats.includes("단종");
      const isZero = cats.includes("현재고0");
      const isNeg = cats.includes("현재고마이너스");

      // 특수 카테고리 단일 선택 시 해당 건만
      if (selected.includes("단종")) return isDisc;
      if (selected.includes("현재고0")) return isZero && !isDisc;
      if (selected.includes("현재고마이너스")) return isNeg && !isDisc;

      // 기본 목록: 단종·현재고0 숨김
      if (isDisc || isZero) return false;

      if (!selected.length) return true;

      // 국내/수입 + 키워드 필터
      const keywordSelected = selected.filter((c) => !SPECIAL_LIST_CATEGORIES.has(c) || c === "국내" || c === "수입");
      if (!keywordSelected.length) return true;
      return keywordSelected.some((category) => cats.includes(category));
    });
  }

  function parseDateValue(value) {
    const match = String(value ?? "").match(/(20\d{2})[-./년]\s*(\d{1,2})[-./월]\s*(\d{1,2})/);
    if (!match) return null;
    const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
    return Number.isNaN(date.getTime()) ? null : date;
  }

  function firstNonBlank(...values) {
    return values.find((value) => value !== null && value !== undefined && String(value).trim() !== "") ?? "";
  }

  function normalizedDateLabel(value) {
    const date = parseDateValue(value);
    if (!date) return "";
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
  }

  function getConfirmedInboundRecord(row, defaultYear = new Date().getFullYear()) {
    const note = String(row?.["비고(확정일)"] || "").trim();
    if (!note) return null;
    const fullDate = normalizedDateLabel(note);
    const shortMatch = note.match(/(?:^|\D)(\d{1,2})[.-](\d{1,2})(?:\D|$)/);
    const date = fullDate || (shortMatch
      ? `${Number(defaultYear)}-${String(Number(shortMatch[1])).padStart(2, "0")}-${String(Number(shortMatch[2])).padStart(2, "0")}`
      : "");
    if (!date || !parseDateValue(date)) return null;
    return { date, type: "입고예정", vendor: "확정", quantity: "-", note };
  }

  function resolveInboundSchedule(row, plannedValue) {
    const plannedSource = arguments.length >= 2
      ? plannedValue
      : firstNonBlank(
          row?.입고예정원본일,
          row?.다음입고,
          row?.국내다음계획일,
          row?.국내다음입고일,
          row?.입고예상일,
          row?.예정입항일,
          row?.입고예정일,
        );
    const plannedDate = normalizedDateLabel(plannedSource);
    const confirmedRemark = String(row?.["비고(확정일)"] || "").trim();
    const confirmedDate = plannedDate ? normalizedDateLabel(confirmedRemark) : "";
    return {
      plannedDate,
      confirmedDate,
      effectiveDate: confirmedDate || plannedDate,
      changed: Boolean(plannedDate && confirmedDate && plannedDate !== confirmedDate),
      confirmedRemark,
    };
  }

  function buildConfirmedScheduleNote(note, schedule) {
    const parts = [];
    const baseNote = String(note || "").trim();
    if (baseNote) parts.push(baseNote);
    if (schedule.confirmedRemark) parts.push(`확정일 ${schedule.confirmedRemark}`);
    if (schedule.changed) parts.push(`기존 예정일 ${schedule.plannedDate}`);
    return parts.join(" · ");
  }

  function filterRowsByDateRange(rows, start, end, { key = "입고예정정렬일", ignoreRange = false } = {}) {
    const startTime = start instanceof Date ? start.getTime() : parseDateValue(start)?.getTime();
    const endTime = end instanceof Date ? end.getTime() : parseDateValue(end)?.getTime();
    return (rows || []).filter((row) => {
      const date = parseDateValue(row?.[key]);
      if (!date) return false;
      if (ignoreRange) return true;
      return Number.isFinite(startTime) && Number.isFinite(endTime)
        && date.getTime() >= startTime
        && date.getTime() <= endTime;
    });
  }

  function pickAutoOpenHistoryItem(query, items) {
    return normalizeSearchText(query) && (items || []).length === 1 ? items[0] : null;
  }

  function comparableValue(value, type) {
    if (value === null || value === undefined || String(value).trim() === "") return null;
    if (type === "date") return parseDateValue(value)?.getTime() ?? null;
    if (type === "number") {
      const numeric = Number(String(value ?? "").replace(/[^\d.-]/g, ""));
      return Number.isFinite(numeric) ? numeric : null;
    }
    const text = String(value ?? "").trim();
    return text ? text : null;
  }

  function sortRows(rows, { key, direction = "asc", type = "text" } = {}) {
    if (!key) return [...rows];
    const multiplier = direction === "desc" ? -1 : 1;
    return rows.map((row, index) => ({ row, index })).sort((left, right) => {
      const leftValue = comparableValue(left.row[key], type);
      const rightValue = comparableValue(right.row[key], type);
      if (leftValue === null && rightValue === null) return left.index - right.index;
      if (leftValue === null) return 1;
      if (rightValue === null) return -1;
      if (type === "text") {
        const compared = String(leftValue).localeCompare(String(rightValue), "ko", { numeric: true, sensitivity: "base" });
        return compared ? compared * multiplier : left.index - right.index;
      }
      const compared = leftValue - rightValue;
      return compared ? compared * multiplier : left.index - right.index;
    }).map(({ row }) => row);
  }

  function normalizedHeader(value) {
    return String(value ?? "").replace(/\s+/g, "");
  }

  function getRecentInboundQuantity(row) {
    const domestic = ["국내최근입고수량", "국내 최근입고 수량", "최근수량"];
    const imported = ["수입최근입고수량", "수입입고수량", "완료수량"];
    const domesticDate = parseDateValue(row?.국내최근입고일);
    const importDate = parseDateValue(firstNonBlank(row?.입고일, row?.수입입고일));
    const origin = importDate && (!domesticDate || importDate > domesticDate)
      ? "수입" : domesticDate ? "국내" : getOriginCategory(row);
    const candidates = origin === "수입"
      ? [...imported, "최근입고수량", ...domestic]
      : origin === "국내"
        ? [...domestic, "최근입고수량", ...imported]
        : ["최근입고수량", ...domestic, ...imported];
    const entries = Object.entries(row || {});
    for (const candidate of candidates) {
      const entry = entries.find(([key]) => normalizedHeader(key) === normalizedHeader(candidate));
      if (entry && entry[1] !== "" && entry[1] !== null && entry[1] !== undefined) return String(entry[1]).trim();
    }
    return "";
  }

  function hasInboundDateMismatch(row) {
    return resolveInboundSchedule(row).changed;
  }

  function enrichMissingBarcodes(rows, catalog) {
    const catalogByName = new Map();
    const canonicalName = (value) => normalizeSearchText(value).replace(/^\d{3,6}/, "");
    (catalog || []).forEach((product) => {
      const name = canonicalName(product.productName);
      const barcode = String(product.barcode || "").trim();
      if (!name || !barcode) return;
      const matches = catalogByName.get(name) || [];
      matches.push(barcode);
      catalogByName.set(name, matches);
    });
    return (rows || []).map((row) => {
      if (String(row.바코드 || "").trim()) return row;
      const matches = [...new Set(catalogByName.get(canonicalName(row.상품명 || row.제품명)) || [])];
      return matches.length === 1 ? { ...row, 바코드: matches[0], 바코드보완: true } : row;
    });
  }

  function getSoldOutStatus(row, stockThreshold = 0) {
    if (String(row?.품절일자 || "").trim()) return "soldout";
    const stockText = String(row?.현재고 ?? "").trim();
    if (!stockText || stockText === "-") return "";
    const stock = Number(stockText.replace(/,/g, "").replace(/[^\d.-]/g, ""));
    const threshold = Math.max(0, Number(stockThreshold) || 0);
    if (!Number.isFinite(stock)) return "";
    if (stock <= 0) return "soldout";
    return threshold > 0 && stock <= threshold ? "near" : "";
  }

  function isSoldOutRow(row, stockThreshold = 0) {
    return Boolean(getSoldOutStatus(row, stockThreshold));
  }

  function buildRecentInboundHistory(row, defaultYear = new Date().getFullYear()) {
    const records = [];
    const addRecord = (record) => {
      if (!String(record.date || "").trim()) return;
      const normalized = Object.fromEntries(Object.entries(record).map(([key, value]) => [key, String(value ?? "").trim()]));
      const signature = [normalized.date, normalized.type, normalized.vendor, normalized.quantity, normalized.note].join("|");
      if (!records.some((item) => item.signature === signature)) records.push({ ...normalized, signature });
    };

    addRecord({
      date: row?.국내최근입고일,
      type: "국내",
      vendor: row?.국내업체,
      quantity: firstNonBlank(row?.최근수량, row?.국내최근입고수량),
      note: row?.국내스케줄입고메모사항,
    });
    addRecord({
      date: firstNonBlank(row?.입고일, row?.수입입고일),
      type: "수입",
      vendor: row?.수입업체,
      quantity: firstNonBlank(row?.완료수량, row?.수입최근입고수량, row?.수입입고수량),
      note: row?.완료참고품목,
    });
    const domesticSchedule = resolveInboundSchedule(row, firstNonBlank(row?.국내다음계획일, row?.국내다음입고일));
    addRecord({
      date: domesticSchedule.effectiveDate,
      type: "입고예정",
      vendor: row?.국내업체,
      quantity: row?.국내다음입고예정수량,
      note: buildConfirmedScheduleNote(row?.국내스케줄입고메모사항, domesticSchedule),
    });
    const importSchedule = resolveInboundSchedule(row, firstNonBlank(row?.입고예상일, row?.예정입항일));
    addRecord({
      date: importSchedule.effectiveDate,
      type: "입고예정",
      vendor: firstNonBlank(row?.수입예정업체, row?.수입업체),
      quantity: firstNonBlank(row?.다음입고예정수량, row?.수입예정입고수량),
      note: buildConfirmedScheduleNote(row?.예정참고품목, importSchedule),
    });
    const confirmedRecord = getConfirmedInboundRecord(row, defaultYear);
    if (confirmedRecord) addRecord(confirmedRecord);

    return records
      .sort((left, right) => (parseDateValue(right.date)?.getTime() ?? 0) - (parseDateValue(left.date)?.getTime() ?? 0))
      .slice(0, 10)
      .map(({ signature, ...record }) => record);
  }

  function getConfirmedRemark(row) {
    return String(row?.["비고(확정일)"] || "").trim() || "-";
  }

  function withDisplayedConfirmedRemark(row, displayedValue) {
    return {
      ...(row || {}),
      "비고(확정일)": String(displayedValue ?? "").trim(),
    };
  }

  return {
    normalizeSearchText,
    filterRows,
    filterRowsBySelectedValues,
    getUniqueColumnValues,
    sortRows,
    getRecentInboundQuantity,
    resolveInboundSchedule,
    hasInboundDateMismatch,
    enrichMissingBarcodes,
    isSoldOutRow,
    getSoldOutStatus,
    getInboundKeywordCategories,
    toggleSingleCategory,
    filterRowsByCategories,
    getInboundKeywordCategories,
    isDiscontinuedRow,
    getProductCode,
    isClothingRow,
    getClothingYearCategory,
    getClothingSeasonMeta,
    parseProductCodeMeta,
    isZeroStockRow,
    isNegativeStockRow,
    getOriginCategory,
    buildRecentInboundHistory,
    filterRowsByDateRange,
    pickAutoOpenHistoryItem,
    getConfirmedRemark,
    withDisplayedConfirmedRemark,
    getConfirmedInboundRecord,
  };
});
