(function attachTableControls(root, factory) {
  const api = factory();
  root.TableControls = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof globalThis !== "undefined" ? globalThis : window, function createTableControls() {
  "use strict";

  const PAGE_SIZES = [10, 30, 50, 100, 200, 300, "all"];
  const REQUIRED_TABLE_KEYS = ["mapping", "review", "master", "inbound", "soldout", "history", "learning"];

  function normalizePageSize(value) {
    if (value === "all") return "all";
    const numeric = Number(value);
    return PAGE_SIZES.includes(numeric) ? numeric : 10;
  }

  function clampColumnWidth(width) {
    return Math.max(60, Math.round(Number(width) || 60));
  }

  function calculateAutoFitWidth(measuredWidths, padding = 28) {
    const widest = Math.max(0, ...(measuredWidths || []).map((width) => Number(width) || 0));
    return clampColumnWidth(widest + Math.max(0, Number(padding) || 0));
  }

  function normalizeColumnWeights(weights, count = (weights || []).length, minimumPercent = 4) {
    const columnCount = Math.max(0, Math.floor(Number(count) || 0));
    if (!columnCount) return [];
    const minimum = Math.min(100 / columnCount, Math.max(0, Number(minimumPercent) || 0));
    const raw = Array.from({ length: columnCount }, (_, index) => Math.max(0, Number(weights?.[index]) || 0));
    const total = raw.reduce((sum, value) => sum + value, 0);
    const weighted = total ? raw : raw.map(() => 1);
    const weightedTotal = weighted.reduce((sum, value) => sum + value, 0);
    const available = Math.max(0, 100 - minimum * columnCount);
    return weighted.map((value) => minimum + (available * value / weightedTotal));
  }

  function resizeFittedColumnPair(widths, index, deltaPercent, minimumPercent = 4) {
    const next = [...(widths || [])].map((value) => Number(value) || 0);
    if (index < 0 || index >= next.length - 1) return next;
    const minimum = Math.max(0, Number(minimumPercent) || 0);
    const requested = Number(deltaPercent) || 0;
    const applied = requested >= 0
      ? Math.min(requested, Math.max(0, next[index + 1] - minimum))
      : Math.max(requested, -Math.max(0, next[index] - minimum));
    next[index] += applied;
    next[index + 1] -= applied;
    return next;
  }

  function isValidFittedColumnWidths(widths, count = (widths || []).length, minimumPercent = 4) {
    if (!Array.isArray(widths) || widths.length !== Number(count)) return false;
    const minimum = Math.max(0, Number(minimumPercent) || 0);
    const numeric = widths.map(Number);
    if (numeric.some((value) => !Number.isFinite(value) || value < minimum)) return false;
    return Math.abs(numeric.reduce((sum, value) => sum + value, 0) - 100) < 0.01;
  }

  function resolveFittedColumnWidths(savedWidths, configuredWeights, count, minimumPercent = 4) {
    return isValidFittedColumnWidths(savedWidths, count, minimumPercent)
      ? [...savedWidths]
      : normalizeColumnWeights(configuredWeights, count, minimumPercent);
  }

  function shouldAddColumnResizeHandle(fitViewport, index, columnCount) {
    return !fitViewport || index < Math.max(0, Number(columnCount) - 1);
  }

  function calculateOverlayPosition(triggerRect, menuSize, viewportSize, margin = 12) {
    const safeMargin = Math.max(0, Number(margin) || 0);
    const width = Math.max(0, Number(menuSize?.width) || 0);
    const height = Math.max(0, Number(menuSize?.height) || 0);
    const viewportWidth = Math.max(0, Number(viewportSize?.width) || 0);
    const viewportHeight = Math.max(0, Number(viewportSize?.height) || 0);
    const maxHeight = Math.max(0, viewportHeight - safeMargin * 2);
    const effectiveHeight = Math.min(height, maxHeight);
    const maximumLeft = Math.max(safeMargin, viewportWidth - width - safeMargin);
    const left = Math.min(
      maximumLeft,
      Math.max(safeMargin, (Number(triggerRect?.right) || 0) - width),
    );
    const below = (Number(triggerRect?.bottom) || 0) + 4;
    const above = (Number(triggerRect?.top) || 0) - effectiveHeight - 4;
    const top = below + effectiveHeight <= viewportHeight - safeMargin ? below : Math.max(safeMargin, above);
    return { left, top, maxHeight };
  }

  function createDeferredSearchState(initial = "") {
    let draft = String(initial || "");
    let applied = draft;
    return {
      setDraft(value) { draft = String(value || ""); },
      submit() { applied = draft; return applied; },
      getState() { return { draft, applied }; },
    };
  }

  function isInteractiveTableTarget(target) {
    return Boolean(target?.closest?.("input, button, select, textarea, a, label"));
  }

  function paginate(items, pageSize, requestedPage) {
    const size = normalizePageSize(pageSize);
    const total = items.length;
    const pageCount = size === "all" ? 1 : Math.max(1, Math.ceil(total / size));
    const page = Math.min(pageCount, Math.max(1, Number(requestedPage) || 1));
    const startIndex = size === "all" ? 0 : (page - 1) * size;
    const pageItems = size === "all" ? items : items.slice(startIndex, startIndex + size);
    return { items: pageItems, page, pageCount, total, start: total ? startIndex + 1 : 0, end: startIndex + pageItems.length };
  }

  function defaultSettings() { return { pageSize: 10, widths: [], fittedWidths: [] }; }

  function loadTableSettings(storage, tableKey) {
    try {
      const parsed = JSON.parse(storage?.getItem(`english-portfolio-table-controls:${tableKey}`) || "null");
      if (!parsed || typeof parsed !== "object") return defaultSettings();
      return {
        pageSize: normalizePageSize(parsed.pageSize),
        widths: Array.isArray(parsed.widths) ? parsed.widths.map(clampColumnWidth) : [],
        fittedWidths: Array.isArray(parsed.fittedWidths)
          ? parsed.fittedWidths.map((value) => Math.max(0, Number(value) || 0))
          : [],
      };
    } catch (_) { return defaultSettings(); }
  }

  function saveTableSettings(storage, tableKey, settings) {
    try { storage?.setItem(`english-portfolio-table-controls:${tableKey}`, JSON.stringify(settings)); } catch (_) {}
  }

  function createStateController(initial = {}) {
    let state = { pageSize: normalizePageSize(initial.pageSize), page: Math.max(1, Number(initial.page) || 1) };
    return {
      setPageSize(value) { state = { pageSize: normalizePageSize(value), page: 1 }; },
      setPage(value) { state.page = Math.max(1, Number(value) || 1); },
      getState() { return { ...state }; },
    };
  }

  function visiblePages(pageCount, currentPage) {
    const count = Math.max(1, Number(pageCount) || 1);
    const current = Math.min(count, Math.max(1, Number(currentPage) || 1));
    return [...new Set([1, current - 2, current - 1, current, current + 1, current + 2, count])]
      .filter((page) => page >= 1 && page <= count)
      .sort((a, b) => a - b);
  }

  function createElement(documentRef, tag, className, text) {
    const element = documentRef.createElement(tag);
    if (className) element.className = className;
    if (text !== undefined) element.textContent = text;
    return element;
  }

  function createTableController({ table, tableKey, storage, onPageChange } = {}) {
    if (!table) return null;
    const documentRef = table.ownerDocument;
    const saved = loadTableSettings(storage, tableKey);
    const state = createStateController({ pageSize: saved.pageSize, page: 1 });
    let widths = [...saved.widths];
    const fitViewport = table.dataset.fitViewport === "true";
    let fittedWidths = [...saved.fittedWidths];
    let applying = false;

    const shell = createElement(documentRef, "div", "table-scroll-shell");
    table.parentNode.insertBefore(shell, table);
    shell.appendChild(table);
    table.dataset.tableKey = tableKey;

    const bar = createElement(documentRef, "div", "table-controls-bar");
    const left = createElement(documentRef, "div", "table-controls-left");
    const label = createElement(documentRef, "label", "table-page-size-label", "표시 개수 ");
    const select = createElement(documentRef, "select", "table-page-size");
    PAGE_SIZES.forEach((size) => {
      const option = createElement(documentRef, "option", "", size === "all" ? "전체보기" : `${size}개`);
      option.value = String(size);
      option.selected = saved.pageSize === size;
      select.appendChild(option);
    });
    label.appendChild(select);
    const range = createElement(documentRef, "span", "table-range-label");
    left.append(label, range);
    const navigation = createElement(documentRef, "div", "table-pagination");
    bar.append(left, navigation);
    shell.parentNode.insertBefore(bar, shell);

    function dataRows() {
      const rows = [...(table.tBodies[0]?.rows || [])];
      return rows.length === 1 && rows[0].cells.length === 1 && rows[0].cells[0].hasAttribute("colspan") ? [] : rows;
    }

    function persist() {
      saveTableSettings(storage, tableKey, {
        pageSize: state.getState().pageSize,
        widths: fitViewport ? [] : widths,
        fittedWidths: fitViewport ? fittedWidths : [],
      });
    }

    function button(text, page, disabled, active = false) {
      const item = createElement(documentRef, "button", `table-page-button${active ? " active" : ""}`, text);
      item.type = "button";
      item.disabled = disabled;
      item.addEventListener("click", () => { state.setPage(page); apply(); onPageChange?.(state.getState()); });
      return item;
    }

    function apply() {
      if (applying) return;
      applying = true;
      const rows = dataRows();
      const result = paginate(rows, state.getState().pageSize, state.getState().page);
      state.setPage(result.page);
      rows.forEach((row, index) => { row.hidden = index < result.start - 1 || index >= result.end; });
      range.textContent = `${result.start}–${result.end} / 총 ${result.total}건`;
      navigation.replaceChildren();
      navigation.appendChild(button("이전", result.page - 1, result.page <= 1));
      let previous = 0;
      visiblePages(result.pageCount, result.page).forEach((page) => {
        if (previous && page - previous > 1) navigation.appendChild(createElement(documentRef, "span", "table-page-gap", "…"));
        navigation.appendChild(button(String(page), page, false, page === result.page));
        previous = page;
      });
      navigation.appendChild(button("다음", result.page + 1, result.page >= result.pageCount));
      bar.classList.toggle("is-empty", result.total === 0);
      applying = false;
      return result;
    }

    const applySelectedPageSize = () => {
      const nextSize = normalizePageSize(select.value);
      if (state.getState().pageSize === nextSize) return;
      state.setPageSize(nextSize);
      persist();
      apply();
      onPageChange?.(state.getState());
    };
    select.addEventListener("input", applySelectedPageSize);
    select.addEventListener("change", applySelectedPageSize);

    function setupColumns() {
      const headers = [...(table.tHead?.rows[0]?.cells || [])];
      if (!headers.length) return;
      let colgroup = table.querySelector("colgroup[data-resizable]");
      if (!colgroup) {
        colgroup = documentRef.createElement("colgroup");
        colgroup.dataset.resizable = "true";
        headers.forEach(() => colgroup.appendChild(documentRef.createElement("col")));
        table.insertBefore(colgroup, table.firstChild);
      }
      const cols = [...colgroup.children];
      const configuredWeights = String(table.dataset.fitWeights || "")
        .split(",")
        .map((value) => Number(value.trim()))
        .filter(Number.isFinite);
      if (fitViewport) {
        fittedWidths = resolveFittedColumnWidths(fittedWidths, configuredWeights, headers.length, 4);
      }
      const applyFittedWidths = () => {
        fittedWidths.forEach((width, index) => { cols[index].style.width = `${width}%`; });
        table.style.width = "100%";
        table.style.tableLayout = "fixed";
      };
      const setTableWidth = () => {
        if (fitViewport) {
          applyFittedWidths();
          return;
        }
        table.style.width = `${cols.reduce((sum, col) => sum + clampColumnWidth(parseFloat(col.style.width)), 0)}px`;
      };
      const autoFitAllColumns = () => {
        const bodyRows = [...(table.tBodies[0]?.rows || [])];
        const measuredWidths = [];
        headers.forEach((header, index) => {
          const cells = [header, ...bodyRows.map((row) => row.cells[index]).filter(Boolean)];
          const measurements = cells.map((cell) => {
            const previousWhiteSpace = cell.style.whiteSpace;
            cell.style.whiteSpace = "nowrap";
            const measured = Math.max(cell.scrollWidth || 0, cell.getBoundingClientRect?.().width || 0);
            cell.style.whiteSpace = previousWhiteSpace;
            return measured;
          });
          const next = calculateAutoFitWidth(measurements, 20);
          measuredWidths[index] = next;
          if (!fitViewport) {
            cols[index].style.width = `${next}px`;
            widths[index] = next;
          }
        });
        if (fitViewport) fittedWidths = normalizeColumnWeights(measuredWidths, headers.length, 4);
        setTableWidth();
        persist();
      };
      headers.forEach((header, index) => {
        const initial = fitViewport
          ? fittedWidths[index]
          : widths[index] || clampColumnWidth(header.getBoundingClientRect?.().width || 120);
        cols[index].style.width = `${initial}${fitViewport ? "%" : "px"}`;
        if (!shouldAddColumnResizeHandle(fitViewport, index, headers.length)) return;
        if (header.querySelector(".column-resize-handle")) return;
        const handle = createElement(documentRef, "span", "column-resize-handle");
        handle.title = "더블클릭하면 전체 열 너비를 내용에 맞춥니다.";
        header.appendChild(handle);
        handle.addEventListener("dblclick", (event) => {
          event.preventDefault();
          event.stopPropagation();
          autoFitAllColumns();
        });
        handle.addEventListener("pointerdown", (event) => {
          event.preventDefault();
          const startX = event.clientX;
          const startWidth = fitViewport ? fittedWidths[index] : clampColumnWidth(cols[index].getBoundingClientRect?.().width || initial);
          const startFittedWidths = [...fittedWidths];
          const tableWidth = Math.max(1, table.getBoundingClientRect?.().width || 1);
          const move = (moveEvent) => {
            if (fitViewport) {
              fittedWidths = resizeFittedColumnPair(startFittedWidths, index, (moveEvent.clientX - startX) / tableWidth * 100, 4);
              applyFittedWidths();
              return;
            }
            const next = clampColumnWidth(startWidth + moveEvent.clientX - startX);
            cols[index].style.width = `${next}px`;
            widths[index] = next;
            setTableWidth();
          };
          const up = () => {
            documentRef.removeEventListener("pointermove", move);
            documentRef.removeEventListener("pointerup", up);
            persist();
          };
          documentRef.addEventListener("pointermove", move);
          documentRef.addEventListener("pointerup", up);
        });
      });
      if (fitViewport || widths.length) setTableWidth();
    }

    function enhance() { setupColumns(); return apply(); }
    const observer = typeof MutationObserver !== "undefined" ? new MutationObserver(() => enhance()) : null;
    observer?.observe(table.tBodies[0], { childList: true });
    enhance();
    return {
      paginateRows(items) { return paginate(items, state.getState().pageSize, state.getState().page); },
      enhance,
      resetPage() { state.setPage(1); return apply(); },
      getState: state.getState,
      destroy() { observer?.disconnect(); bar.remove(); shell.replaceWith(table); },
    };
  }

  return {
    PAGE_SIZES, REQUIRED_TABLE_KEYS, normalizePageSize, paginate, clampColumnWidth, calculateAutoFitWidth,
    loadTableSettings, saveTableSettings, createStateController, visiblePages, createTableController,
    isInteractiveTableTarget, createDeferredSearchState, normalizeColumnWeights, resizeFittedColumnPair,
    calculateOverlayPosition, isValidFittedColumnWidths, resolveFittedColumnWidths,
    shouldAddColumnResizeHandle,
  };
});
