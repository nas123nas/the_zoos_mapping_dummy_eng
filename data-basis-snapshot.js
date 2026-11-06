(function attachDataBasisSnapshot(root, factory) {
  root.DataBasisSnapshot = factory();
})(typeof globalThis !== "undefined" ? globalThis : window, function createDataBasisSnapshot() {
  "use strict";

  const UPDATED_AT = globalThis.PortfolioData.day() + "T00:00:00.000Z";
  const STORAGE_KEY = "thezoos-english-portfolio-manual-data-basis-v1";
  const SOURCE_KEYS = ["domestic", "import", "stock"];

  function createState(values = {}) {
    const sources = {};
    SOURCE_KEYS.forEach((source) => {
      sources[source] = { updatedAt: values[source] || UPDATED_AT };
    });
    return {
      version: 1,
      sources,
    };
  }

  function isValidState(state) {
    return SOURCE_KEYS.every((source) => !Number.isNaN(new Date(state?.sources?.[source]?.updatedAt).getTime()));
  }

  function loadState(storage) {
    try {
      const state = JSON.parse(storage?.getItem?.(STORAGE_KEY) || "null");
      return isValidState(state) ? state : createState();
    } catch (_) {
      return createState();
    }
  }

  function saveState(storage, state) {
    if (!isValidState(state)) return false;
    storage?.setItem?.(STORAGE_KEY, JSON.stringify(state));
    return true;
  }

  function resetState(storage) {
    storage?.removeItem?.(STORAGE_KEY);
    return createState();
  }

  function fromInputValue(value) {
    const raw = String(value || "").trim();
    // datetime-local: YYYY-MM-DDTHH:mm or with seconds
    const m = raw.match(/^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})(?::\d{2})?/);
    if (!m) return "";
    const date = new Date(`${m[1]}T${m[2]}:00+09:00`);
    return Number.isNaN(date.getTime()) ? "" : date.toISOString();
  }

  function toInputValue(value) {
    const date = value instanceof Date ? value : new Date(value || Date.now());
    if (Number.isNaN(date.getTime())) return "";
    // Asia/Seoul wall time for datetime-local
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Seoul",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).formatToParts(date);
    const get = (t) => parts.find((p) => p.type === t)?.value || "00";
    return `${get("year")}-${get("month")}-${get("day")}T${get("hour")}:${get("minute")}`;
  }

  function readSheetMetadata(dataBasisEngine, rows) {
    return typeof dataBasisEngine?.readSheetBasisMetadata === "function"
      ? dataBasisEngine.readSheetBasisMetadata(rows)
      : { rows: rows || [], sources: {} };
  }

  return { UPDATED_AT, STORAGE_KEY, createState, loadState, saveState, resetState, fromInputValue, toInputValue, readSheetMetadata };
});
