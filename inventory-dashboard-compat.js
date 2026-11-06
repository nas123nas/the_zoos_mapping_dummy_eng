(function attachInventoryDashboardCompat(root, factory) {
  root.InventoryDashboardCompat = factory();
})(typeof globalThis !== "undefined" ? globalThis : window, function createInventoryDashboardCompat() {
  "use strict";

  function resolveOutflowPresentation(engine, actualOutflowAnalysis) {
    if (typeof engine?.resolveOutflowPresentation === "function") {
      return engine.resolveOutflowPresentation(actualOutflowAnalysis);
    }
    if (!actualOutflowAnalysis || !Array.isArray(actualOutflowAnalysis.items)) {
      return { isConnected: false, count: 0, items: [] };
    }
    return {
      isConnected: true,
      count: Number.isFinite(actualOutflowAnalysis.count) ? actualOutflowAnalysis.count : actualOutflowAnalysis.items.length,
      items: actualOutflowAnalysis.items,
    };
  }

  return { resolveOutflowPresentation };
});
