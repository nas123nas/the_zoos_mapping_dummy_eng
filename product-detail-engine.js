(function attachProductDetailEngine(root, factory) {
  root.ProductDetailEngine = factory(root.InboundTableEngine, root.SmartstoreInventoryEngine);
})(typeof globalThis !== "undefined" ? globalThis : window, function createProductDetailEngine(inboundEngine, smartstoreEngine) {
  "use strict";

  function clean(value) {
    return value === null || value === undefined ? "" : String(value).trim();
  }

  function numberOrZero(value) {
    const number = Number(clean(value).replace(/,/g, "").replace(/[^\d.-]/g, ""));
    return Number.isFinite(number) ? number : 0;
  }

  function historyQuantity(value) {
    const source = clean(value);
    return source && source !== "-" ? numberOrZero(source) : null;
  }

  function buildProductDetail(row, options = {}) {
    const history = inboundEngine?.buildRecentInboundHistory?.(row, options.defaultYear) || [];
    const latest = history.find((record) => clean(record.type) !== "입고예정");
    const next = history.find((record) => clean(record.type) === "입고예정");
    const availability = smartstoreEngine?.summarizeAvailability?.(row, options.reservations || []) || {
      totalStock: numberOrZero(row?.현재고),
      regularAvailable: numberOrZero(row?.현재고),
      smartstoreReserved: 0,
      status: numberOrZero(row?.현재고) <= 0 ? "soldout" : "available",
    };
    return {
      productName: clean(row?.상품명 || row?.제품명 || row?.productName),
      barcode: clean(row?.바코드 || row?.상품코드 || row?.barcode),
      ...availability,
      latestInbound: {
        date: clean(latest?.date),
        quantity: historyQuantity(latest?.quantity),
        vendor: clean(latest?.vendor),
        note: clean(latest?.note),
      },
      nextInbound: {
        date: clean(next?.date),
        quantity: historyQuantity(next?.quantity),
        vendor: clean(next?.vendor),
        note: clean(next?.note),
      },
      confirmedRemark: inboundEngine?.getConfirmedRemark?.(row) || "-",
      history,
    };
  }

  return { buildProductDetail };
});
