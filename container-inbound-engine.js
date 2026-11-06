(function attachContainerInboundEngine(root, factory) {
  const api = factory();
  root.ContainerInboundEngine = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof globalThis !== "undefined" ? globalThis : window, function createContainerInboundEngine() {
  "use strict";

  const REQUIRED_HEADERS = ["바코드", "상품명", "박스수량", "낱개수량", "입수", "제조일자"];

  function clean(value) {
    return value === null || value === undefined ? "" : String(value).trim();
  }

  function formatDateParts(year, month, day) {
    return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  }

  function validDate(year, month, day) {
    const date = new Date(Date.UTC(year, month - 1, day));
    return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
  }

  function parseDateText(value) {
    if (value instanceof Date && !Number.isNaN(value.getTime())) {
      return formatDateParts(value.getFullYear(), value.getMonth() + 1, value.getDate());
    }
    const source = clean(value);
    const separated = source.match(/(?:^|\D)(20\d{2})[-./](\d{1,2})[-./](\d{1,2})(?!\d)/);
    const compact = separated ? null : source.match(/(?:^|\D)(20\d{2})(\d{2})(\d{2})(?:\D|$)/);
    const parts = separated || compact;
    if (!parts) return "";
    const year = Number(parts[1]);
    const month = Number(parts[2]);
    const day = Number(parts[3]);
    return validDate(year, month, day) ? formatDateParts(year, month, day) : "";
  }

  function addMonthsToDate(value, monthCount = 18) {
    const normalized = parseDateText(value);
    if (!normalized) return "";
    const [year, month, day] = normalized.split("-").map(Number);
    const totalMonths = year * 12 + month - 1 + Math.trunc(Number(monthCount) || 0);
    const targetYear = Math.floor(totalMonths / 12);
    const targetMonthIndex = ((totalMonths % 12) + 12) % 12;
    const lastDay = new Date(Date.UTC(targetYear, targetMonthIndex + 1, 0)).getUTCDate();
    return formatDateParts(targetYear, targetMonthIndex + 1, Math.min(day, lastDay));
  }

  function findHeaderIndex(rows) {
    return (rows || []).findIndex((row) => {
      const headers = (row || []).map(clean);
      return REQUIRED_HEADERS.every((header) => headers.includes(header));
    });
  }

  function isContainerInboundRows(rows) {
    return Array.isArray(rows) && findHeaderIndex(rows) >= 0;
  }

  function parseNumber(value) {
    if (typeof value === "number") return Number.isFinite(value) ? value : "";
    const source = clean(value);
    if (!source) return "";
    const normalized = source.replace(/,/g, "");
    if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/.test(normalized)) return "";
    const parsed = Number(normalized);
    return Number.isFinite(parsed) ? parsed : "";
  }

  function parseFileMetadata(fileName, importedAt) {
    const name = clean(fileName);
    const stem = name.replace(/\.[^.]+$/, "").replace(/\s+\(\d+\)$/, "");
    const inboundDate = parseDateText(stem) || parseDateText(importedAt);
    const withoutDate = stem.replace(/^\s*20\d{6}\s*/, "");
    const parts = withoutDate.split("_").map((part) => part.trim()).filter(Boolean);
    const vendor = parts[0] || "";
    const container = parts.find((part) => /^(?=.*[A-Z])(?=.*\d)[A-Z0-9-]{8,}$/.test(part)) || "";
    return { inboundDate, vendor, container };
  }

  function parseContainerInboundRows(rows, options = {}) {
    const headerIndex = findHeaderIndex(rows);
    if (headerIndex < 0) return [];
    const headers = rows[headerIndex].map(clean);
    const column = Object.fromEntries(headers.map((header, index) => [header, index]));
    const fileName = clean(options.fileName);
    const metadata = parseFileMetadata(fileName, options.importedAt || new Date());

    return rows.slice(headerIndex + 1).map((row) => {
      const code = clean(row[column.바코드]).replace(/\.0$/, "").replace(/\s+/g, "");
      const productName = clean(row[column.상품명]);
      const manufacturingDate = parseDateText(row[column.제조일자]);
      if (!code || code === "합계" || !productName || !manufacturingDate) return null;
      const pieceQuantity = parseNumber(row[column.낱개수량]);
      if (!Number.isSafeInteger(pieceQuantity) || pieceQuantity <= 0) return null;
      const expiry = addMonthsToDate(manufacturingDate, 18).split("-").map(Number);
      const expiryDate = new Date(Date.UTC(expiry[0], expiry[1] - 1, expiry[2] - 1));
      return {
        입고원본구분: "컨테이너파일",
        바코드: code,
        상품명: productName,
        박스수량: parseNumber(row[column.박스수량]),
        낱개수량: pieceQuantity,
        입수: parseNumber(row[column.입수]),
        제조일자: manufacturingDate,
        유통기한: formatDateParts(expiryDate.getUTCFullYear(), expiryDate.getUTCMonth() + 1, expiryDate.getUTCDate()),
        입고파일명: fileName,
        입고예정일: metadata.inboundDate,
        입고예상일: metadata.inboundDate,
        다음입고예정수량: pieceQuantity,
        "국내/수입": "수입",
        BL: metadata.container,
        수입예정업체: metadata.vendor,
        예정참고품목: fileName,
        현재고: "",
      };
    }).filter(Boolean);
  }

  function replaceContainerFileRecords(existing, fileName, incoming) {
    const normalizedName = clean(fileName);
    const retained = (existing || []).filter((record) => clean(record?.입고파일명) !== normalizedName);
    return [...retained, ...(incoming || [])];
  }

  return {
    parseDateText,
    addMonthsToDate,
    isContainerInboundRows,
    parseContainerInboundRows,
    replaceContainerFileRecords,
  };
});
