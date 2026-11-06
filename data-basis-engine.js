(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.DataBasisEngine = api;
})(typeof window !== "undefined" ? window : globalThis, function () {
  const SOURCE_KEYS = ["domestic", "import", "stock"];

  function text(value) {
    return String(value ?? "").trim();
  }

  function readField(row, names) {
    for (const name of names) {
      if (Object.prototype.hasOwnProperty.call(row || {}, name)) return text(row[name]);
    }
    return "";
  }

  function selectFields(row, source) {
    const selected = {
      바코드: readField(row, ["바코드", "barcode"]),
      상품명: readField(row, ["상품명", "제품명", "productName"]),
    };
    const patterns = {
      stock: [/현재고/, /^stock$/i],
      domestic: [/국내/, /담당자/, /확정일/],
      import: [/수입/, /선적/, /입항/, /입고예상일/, /입고예정일/, /다음입고/, /예정참고/, /^BL$/i, /컨테이너/],
    };
    Object.keys(row || {}).sort().forEach((key) => {
      if (patterns[source].some((pattern) => pattern.test(key))) selected[key] = text(row[key]);
    });
    return selected;
  }

  function hashString(value) {
    let hash = 2166136261;
    for (let index = 0; index < value.length; index += 1) {
      hash ^= value.charCodeAt(index);
      hash = Math.imul(hash, 16777619);
    }
    return (hash >>> 0).toString(16).padStart(8, "0");
  }

  function createSourceSignature(rows, source) {
    const normalized = (rows || [])
      .map((row) => JSON.stringify(selectFields(row, source)))
      .sort();
    return `${normalized.length}:${hashString(normalized.join("\n"))}`;
  }

  function updateBasisState(previous, rows, observedAt = new Date().toISOString()) {
    const priorSources = previous?.sources || {};
    const sources = {};
    SOURCE_KEYS.forEach((source) => {
      const signature = createSourceSignature(rows, source);
      const prior = priorSources[source] || {};
      sources[source] = {
        signature,
        updatedAt: prior.signature === signature && prior.updatedAt ? prior.updatedAt : observedAt,
      };
    });
    return { version: 1, sources };
  }

  function markSourceUpdated(previous, source, updatedAt = new Date().toISOString()) {
    if (!SOURCE_KEYS.includes(source)) return previous;
    const sources = { ...(previous?.sources || {}) };
    sources[source] = { ...(sources[source] || {}), updatedAt };
    return { version: 1, sources };
  }

  function formatBasisTime(value) {
    if (!value) return "확인 불가";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "확인 불가";
    const parts = Object.fromEntries(
      new Intl.DateTimeFormat("en-US", {
        timeZone: "Asia/Seoul",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        hourCycle: "h23",
      }).formatToParts(date).map((part) => [part.type, part.value]),
    );
    return `${parts.year}.${parts.month}.${parts.day} ${parts.hour}:${parts.minute}`;
  }

  function renderBasisTimes(documentRef, state) {
    SOURCE_KEYS.forEach((source) => {
      const element = documentRef?.querySelector?.(`[data-basis-time="${source}"]`);
      if (element) element.textContent = formatBasisTime(state?.sources?.[source]?.updatedAt);
    });
  }

  return {
    SOURCE_KEYS,
    createSourceSignature,
    updateBasisState,
    markSourceUpdated,
    formatBasisTime,
    renderBasisTimes,
  };
});
