(function attachInboundUpdateEngine(root, factory) {
  const api = factory();
  root.InboundUpdateEngine = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof globalThis !== "undefined" ? globalThis : window, function createInboundUpdateEngine() {
  "use strict";

  const REMARK_HEADER = "비고(확정일)";

  function clean(value) {
    return value === null || value === undefined ? "" : String(value).trim();
  }

  function barcode(value) {
    return clean(value).replace(/\.0$/, "").replace(/\s+/g, "");
  }

  function formatInboundRemark(value, defaultYear = new Date().getFullYear()) {
    const source = clean(value);
    if (!source) return "";
    const match = source.match(/^(?:(20\d{2})[-./])?(\d{1,2})[-./](\d{1,2})$/);
    if (!match) return source;
    const year = Number(match[1] || defaultYear);
    const month = Number(match[2]);
    const day = Number(match[3]);
    const date = new Date(year, month - 1, day);
    if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) return source;
    const weekdays = ["일", "월", "화", "수", "목", "금", "토"];
    return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")} (${weekdays[date.getDay()]})`;
  }

  function parseInboundUpdateRows(rows, defaultYear = new Date().getFullYear()) {
    if (!Array.isArray(rows)) return [];
    const headerIndex = rows.findIndex((row) => row.map(clean).includes("바코드") && row.map(clean).includes("입고예정일"));
    if (headerIndex < 0) return [];
    const headers = rows[headerIndex].map(clean);
    const barcodeIndex = headers.indexOf("바코드");
    const productIndex = Math.max(headers.indexOf("제품명"), headers.indexOf("상품명"));
    const dateIndex = headers.indexOf("입고예정일");
    return rows.slice(headerIndex + 1).map((row) => {
      const code = barcode(row[barcodeIndex]);
      const rawValue = clean(row[dateIndex]);
      if (!code || !rawValue) return null;
      return {
        barcode: code,
        productName: productIndex >= 0 ? clean(row[productIndex]) : "",
        remark: formatInboundRemark(rawValue, defaultYear),
        rawValue,
      };
    }).filter(Boolean);
  }

  function applyInboundUpdates(scheduleRows, updates) {
    const updateMap = new Map((updates || []).map((item) => [barcode(item.barcode), item]));
    let matchedCount = 0;
    const rows = (scheduleRows || []).map((row) => {
      const update = updateMap.get(barcode(row.바코드));
      if (!update) return { ...row };
      matchedCount += 1;
      return { ...row, [REMARK_HEADER]: update.remark };
    });
    return { rows, matchedCount, unmatchedCount: Math.max(0, updateMap.size - matchedCount) };
  }

  return { REMARK_HEADER, formatInboundRemark, parseInboundUpdateRows, applyInboundUpdates };
});
