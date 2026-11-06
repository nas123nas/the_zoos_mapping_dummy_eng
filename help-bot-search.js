(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.HelpBotSearch = api;
})(typeof window !== "undefined" ? window : globalThis, function () {
  function normalize(value) {
    return String(value || "").replace(/\s+/g, "").toLowerCase();
  }

  function findCatalogMatches(question, catalog) {
    const query = normalize(question);
    if (!query) return [];
    return (catalog || []).filter((item) => {
      const name = normalize(item.productName);
      return name && (name.includes(query) || query.includes(name));
    });
  }

  function findScheduleNameMatches(question, rows) {
    const tokens = String(question || "")
      .toLowerCase()
      .replace(/최근입고|다음입고|입고예정일|알려줘|찾아줘|상품명|바코드|입고|재고|품절|목록|리스트/g, " ")
      .split(/[^\da-z가-힣]+/i)
      .filter((token) => token.length >= 2);
    if (!tokens.length) return [];
    return (rows || []).filter((row) => {
      const name = normalize(row.상품명 || row.제품명);
      return name && tokens.every((token) => name.includes(normalize(token)));
    });
  }

  function formatConfirmedRemark(row) {
    const remark = String(row?.["비고(확정일)"] || "").trim();
    return remark ? `비고(확정일): ${remark}` : "";
  }

  return { findCatalogMatches, findScheduleNameMatches, formatConfirmedRemark };
});
