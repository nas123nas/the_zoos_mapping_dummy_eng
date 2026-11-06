(function attachHistoryPanelPlacement(root) {
  function restoreOutsideTable(panel, page, inlineRows = []) {
    if (!panel || !page) return false;
    page.appendChild(panel);
    [...inlineRows].forEach((row) => row.remove());
    return true;
  }

  root.HistoryPanelPlacement = { restoreOutsideTable };
})(typeof window !== "undefined" ? window : globalThis);
