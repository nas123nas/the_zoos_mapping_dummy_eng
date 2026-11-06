(function attachStockRowVisibility(root) {
  const productNameKeys = ["상품명", "제품명", "productName", "name"];
  const barcodeKeys = ["바코드", "상품코드", "productCode", "barcode"];

  function hasIdentifierValue(value) {
    const normalized = String(value ?? "").trim();
    return Boolean(normalized && normalized !== "-" && normalized !== "—");
  }

  function hasAnyValue(row, keys) {
    return keys.some((key) => hasIdentifierValue(row?.[key]));
  }

  function isVisibleProductRow(row) {
    return hasAnyValue(row, productNameKeys) || hasAnyValue(row, barcodeKeys);
  }

  function filterVisibleProductRows(rows) {
    return Array.isArray(rows) ? rows.filter(isVisibleProductRow) : [];
  }

  root.StockRowVisibility = { isVisibleProductRow, filterVisibleProductRows };
})(typeof window !== "undefined" ? window : globalThis);
