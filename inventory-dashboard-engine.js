(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.InventoryDashboardEngine = api;
})(typeof window !== "undefined" ? window : globalThis, function () {
  function parseNumber(value) {
    const cleaned = String(value ?? "").replace(/,/g, "").replace(/[^\d.-]/g, "");
    if (!/\d/.test(cleaned)) return null;
    const numeric = Number(cleaned);
    return Number.isFinite(numeric) ? numeric : null;
  }

  function parseDate(value) {
    const match = String(value ?? "").match(/(20\d{2})[-./년]\s*(\d{1,2})[-./월]\s*(\d{1,2})/);
    if (!match) return null;
    const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
    return Number.isNaN(date.getTime()) ? null : date;
  }

  function formatDate(date) {
    if (!date) return "-";
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
  }

  function firstNonBlank(...values) {
    return values.find((value) => value !== null && value !== undefined && String(value).trim() !== "");
  }

  function isDiscontinuedValue(value) {
    return ["true", "1", "y", "yes", "단종"].includes(String(value ?? "").trim().toLowerCase());
  }

  const INVENTORY_FILTER_CATEGORIES = ["전체", "간식", "의류", "하네스", "장난감", "리테일A", "리테일B", "리테일C", "단종"];
  const INVENTORY_CLOTHING_KEYWORDS = ["의류", "옷", "티셔츠", "셔츠", "후드", "맨투맨", "원피스", "패딩", "조끼", "자켓", "재킷", "니트", "올인원", "레인코트"];
  const INVENTORY_SNACK_MAJOR_CATEGORIES = new Set(["간식", "애견사료", "애견간식", "애묘간식", "애묘사료"]);

  function normalizeInventoryText(value) {
    return String(value ?? "").replace(/\s+/g, "").toLowerCase();
  }

  function getInventoryItemCategories(item) {
    const row = item?.row || item?.sourceRow || item || {};
    const productName = normalizeInventoryText(item?.productName || row?.상품명 || row?.제품명);
    const majorCategory = normalizeInventoryText(row?.대분류);
    const categories = [];
    const nameRaw = String(item?.productName || row?.상품명 || row?.제품명 || "");
    const majorRaw = String(row?.대분류 || row?.분류 || "");
    const statusRaw = String(row?.품절 || row?.단종 || "");
    if (/단종/.test(nameRaw) || /단종/.test(majorRaw) || /단종/.test(statusRaw) || item?.isDiscontinued) {
      categories.push("단종");
      return categories;
    }
    if (INVENTORY_SNACK_MAJOR_CATEGORIES.has(majorCategory)) categories.push("간식");
    const isClothing = /의류/.test(majorRaw)
      || INVENTORY_CLOTHING_KEYWORDS.some((keyword) => productName.includes(normalizeInventoryText(keyword)));
    if (isClothing) {
      categories.push("의류");
      if (item?.yearCode) categories.push(item.yearCode);
      if (item?.seasonCode) categories.push(item.seasonCode);
      const code = String(row?.상품코드 || row?.자사상품코드 || item?.productCode || "");
      const ym = code.match(/^PD(\d{2})(\d{2})\d{2}/i);
      if (ym) {
        categories.push(`PD${ym[1]}`);
        const mm = Number(ym[2]);
        if (mm >= 1 && mm <= 12) categories.push(`${ym[1]}${mm <= 6 ? "SS" : "FW"}`);
      }
    }
    if (majorCategory === "하네스" || productName.includes("하네스")) categories.push("하네스");
    if (["장난감", "토이", "toy"].some((k) => productName.includes(normalizeInventoryText(k)))) categories.push("장난감");
    ["리테일A", "리테일B", "리테일C"].forEach((retailer) => {
      if (productName.includes(retailer)) categories.push(retailer);
    });
    return categories;
  }

  function filterInventoryItems(items, { query = "", category = "전체", includeDiscontinued = false } = {}) {
    const needle = normalizeInventoryText(query);
    return (items || []).filter((item) => {
      const row = item?.row || item?.sourceRow || item || {};
      const cats = getInventoryItemCategories(item);
      const isDisc = cats.includes("단종") || item?.isDiscontinued;
      const searchable = [item?.productName, item?.barcode, row?.상품명, row?.제품명, row?.바코드]
        .map(normalizeInventoryText)
        .join(" ");
      const matchesQuery = !needle || searchable.includes(needle);
      if (category === "단종") return matchesQuery && isDisc;
      // 전체 및 일반 분류에서는 단종 제외
      if (isDisc && !includeDiscontinued) return false;
      const matchesCategory = !category || category === "전체" || cats.includes(category);
      return matchesQuery && matchesCategory;
    });
  }

  function runInventoryMainSearch(items, query, groupStates = {}) {
    const normalizedQuery = String(query ?? "").trim();
    return {
      query: normalizedQuery,
      items: normalizedQuery ? filterInventoryItems(items, { query: normalizedQuery, includeDiscontinued: true }) : [],
      groupStates: Object.fromEntries(
        Object.keys(groupStates || {}).map((group) => [group, { query: "", category: "전체" }]),
      ),
    };
  }

  function summarizeInventoryCategories(items) {
    const counts = Object.fromEntries(INVENTORY_FILTER_CATEGORIES.map((category) => [category, 0]));
    counts.전체 = (items || []).length;
    (items || []).forEach((item) => {
      getInventoryItemCategories(item).forEach((category) => { counts[category] += 1; });
    });
    return counts;
  }

  function formatInventoryItemCount(count) {
    const numeric = Math.max(0, Math.floor(Number(count) || 0));
    return `${numeric.toLocaleString("ko-KR")}품목`;
  }

  function latestInbound(row) {
    return [
      {
        date: parseDate(row?.국내최근입고일),
        quantity: parseNumber(firstNonBlank(row?.최근수량, row?.국내최근입고수량)),
      },
      {
        date: parseDate(firstNonBlank(row?.입고일, row?.수입입고일)),
        quantity: parseNumber(firstNonBlank(row?.완료수량, row?.수입최근입고수량, row?.수입입고수량)),
      },
      {
        date: parseDate(row?.최근입고),
        quantity: parseNumber(row?.최근입고수량),
      },
    ].filter((record) => record.date).sort((left, right) => right.date - left.date)[0] || null;
  }

  function nextInboundDate(row, today) {
    const confirmedDate = parseDate(row?.["비고(확정일)"]);
    if (confirmedDate && confirmedDate >= today) return confirmedDate;
    return [row?.국내다음계획일, row?.국내다음입고일, row?.입고예상일, row?.예정입항일, row?.다음입고]
      .map(parseDate)
      .filter((date) => date && date >= today)
      .sort((left, right) => left - right)[0] || null;
  }

  function estimateInventoryHealth(row, today = new Date()) {
    const baseDate = new Date(today.getFullYear(), today.getMonth(), today.getDate());
    const parsedStock = parseNumber(row?.현재고);
    const hasStockBasis = parsedStock !== null;
    const stock = Math.max(0, parsedStock ?? 0);
    const inbound = latestInbound(row);
    const elapsedDays = inbound ? Math.max(1, Math.floor((baseDate - inbound.date) / 86400000)) : 0;
    const inboundQuantity = inbound?.quantity ?? null;
    const depletedQuantity = inboundQuantity === null ? null : Math.max(0, inboundQuantity - stock);
    const averageDailyDepletion = elapsedDays && depletedQuantity !== null ? depletedQuantity / elapsedDays : 0;
    const daysRemaining = averageDailyDepletion > 0 ? Math.max(0, Math.ceil(stock / averageDailyDepletion)) : null;
    const stockoutDate = daysRemaining === null ? null : new Date(baseDate.getFullYear(), baseDate.getMonth(), baseDate.getDate() + daysRemaining);
    const nextDate = nextInboundDate(row, baseDate);
    const depletionRate = inboundQuantity > 0 ? Math.max(0, Math.min(100, ((inboundQuantity - stock) / inboundQuantity) * 100)) : null;

    return {
      row,
      productName: String(row?.상품명 || row?.제품명 || "-").trim(),
      barcode: String(row?.바코드 || "").trim(),
      stock,
      hasStockBasis,
      latestInboundDate: inbound?.date || null,
      latestInboundDateLabel: formatDate(inbound?.date),
      latestInboundQuantity: inboundQuantity,
      analysisDate: baseDate,
      analysisDateLabel: formatDate(baseDate),
      depletionPeriodDays: elapsedDays,
      depletionPeriodLabel: inbound ? `${formatDate(inbound.date)} ~ ${formatDate(baseDate)} (${elapsedDays}일)` : "최근 입고일 없음",
      depletedQuantity,
      averageDailyDepletion,
      daysRemaining,
      stockoutDate,
      stockoutDateLabel: formatDate(stockoutDate),
      nextInboundDate: nextDate,
      nextInboundDateLabel: formatDate(nextDate),
      depletionRate,
      isDepletionPressure: daysRemaining !== null && daysRemaining <= 7,
      isDeadStock: elapsedDays >= 30 && depletionRate === 0,
      isArrivalRisk: Boolean(stockoutDate && nextDate && stockoutDate < nextDate),
    };
  }

  function enrichRowsWithDepletionMetrics(rows, today = new Date()) {
    return (rows || []).map((row) => {
      const inventoryHealth = estimateInventoryHealth(row, today);
      const hasBasis = Boolean(inventoryHealth.hasStockBasis && inventoryHealth.latestInboundDate && inventoryHealth.latestInboundQuantity !== null);
      return {
        ...row,
        일평균소진량: hasBasis ? inventoryHealth.averageDailyDepletion : null,
        소진량산정기간: inventoryHealth.depletionPeriodLabel,
        소진량계산가능: hasBasis,
        inventoryHealth,
      };
    });
  }

  function summarizeInventoryHealth(rows, today = new Date()) {
    const allItems = (rows || [])
      .filter((row) => String(row?.상품명 || row?.제품명 || "").trim())
      .map((row) => estimateInventoryHealth(row, today));
    const items = allItems.filter((item) => {
      const row = item.row || {};
      const discontinued = isDiscontinuedValue(row?.단종) || /\(?단종\)?/.test(item.productName);
      return item.hasStockBasis && item.stock > 0 && !discontinued;
    });
    const pressure = items.filter((item) => item.isDepletionPressure);
    const deadStock = items.filter((item) => item.isDeadStock);
    const arrivalRisk = items.filter((item) => item.isArrivalRisk);
    const byUrgency = (left, right) => left.daysRemaining - right.daysRemaining || left.stock - right.stock || left.productName.localeCompare(right.productName, "ko");
    const sortedPressure = [...pressure].sort(byUrgency);
    const sortedDeadStock = [...deadStock].sort((left, right) => right.depletionPeriodDays - left.depletionPeriodDays || left.productName.localeCompare(right.productName, "ko"));
    const sortedArrivalRisk = [...arrivalRisk].sort(byUrgency);
    return {
      allItems,
      items,
      depletionPressureCount: pressure.length,
      deadStockCount: deadStock.length,
      arrivalRiskCount: arrivalRisk.length,
      depletionPressure: sortedPressure,
      deadStock: sortedDeadStock,
      arrivalRisks: sortedArrivalRisk,
      riskTop5: sortedPressure.slice(0, 5),
    };
  }

  function getDashboardSectionId(group) {
    return {
      pressure: "dashboard-pressure-panel",
      deadstock: "dashboard-deadstock-panel",
      arrival: "dashboard-arrival-panel",
    }[group] || "";
  }

  return {
    INVENTORY_FILTER_CATEGORIES,
    parseNumber,
    parseDate,
    estimateInventoryHealth,
    enrichRowsWithDepletionMetrics,
    getInventoryItemCategories,
    filterInventoryItems,
    runInventoryMainSearch,
    summarizeInventoryCategories,
    formatInventoryItemCount,
    summarizeInventoryHealth,
    getDashboardSectionId,
  };
});
