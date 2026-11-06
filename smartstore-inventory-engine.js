(function attachSmartstoreInventoryEngine(root, factory) {
  root.SmartstoreInventoryEngine = factory();
})(typeof globalThis !== "undefined" ? globalThis : window, function createSmartstoreInventoryEngine() {
  "use strict";

  function clean(value) {
    return value === null || value === undefined ? "" : String(value).trim();
  }

  function productCode(product) {
    return normalizeCode(product?.상품코드 || product?.상품번호 || product?.바코드 || product?.productCode || product?.barcode);
  }

  function normalizeCode(value) {
    return clean(value).replace(/\.0$/, "").replace(/\s+/g, "");
  }

  const DEFAULT_VENDOR = "스마트스토어";
  const vendorName = (value) => clean(value).replace(/\s+/g, " ") || DEFAULT_VENDOR;
  const keyFor = (code, vendor) => JSON.stringify([normalizeCode(code), vendorName(vendor)]);

  function wholeQuantity(value) {
    const source = clean(value);
    if (!/^(?:\d+|\d{1,3}(?:,\d{3})+)(?:\.0+)?$/.test(source)) return NaN;
    const parsed = Number(source.replace(/,/g, ""));
    return Number.isSafeInteger(parsed) ? parsed : NaN;
  }

  function reservationBalance(reservation) {
    const registered = wholeQuantity(reservation?.quantity) || 0;
    const consumed = Math.min(registered, wholeQuantity(reservation?.consumedQuantity) || 0);
    return { registered, consumed, remaining: registered - consumed };
  }

  function stockNumber(value) {
    const number = Number(clean(value).replace(/,/g, ""));
    return Number.isFinite(number) ? Math.max(0, number) : 0;
  }

  function validateReservation(input, product) {
    const code = normalizeCode(input?.productCode);
    const quantity = wholeQuantity(input?.quantity);
    if (!product || !code || productCode(product) !== code) return { ok: false, error: "상품코드를 확인해주세요." };
    if (!Number.isSafeInteger(quantity) || quantity < 1) return { ok: false, error: "전용수량은 1 이상의 정수로 입력해주세요." };
    if (quantity > stockNumber(product?.현재고 ?? product?.stock)) return { ok: false, error: "전용수량은 현재고를 초과할 수 없습니다." };
    return { ok: true, reservation: { productCode: code, quantity, vendor: vendorName(input?.vendor) } };
  }

  function sumBalances(reservations, product, field, vendor) {
    const code = productCode(product);
    if (!code) return 0;
    return (reservations || []).reduce((sum, reservation) => {
      if (normalizeCode(reservation?.productCode) !== code) return sum;
      if (vendor !== undefined && vendorName(reservation?.vendor) !== vendorName(vendor)) return sum;
      return sum + reservationBalance(reservation)[field];
    }, 0);
  }

  function getReservedQuantity(reservations, product, vendor) {
    return sumBalances(reservations, product, "remaining", vendor);
  }

  function getConsumedQuantity(reservations, product) {
    return sumBalances(reservations, product, "consumed");
  }

  function summarizeAvailability(product, reservations) {
    const sourceStock = stockNumber(product?.현재고 ?? product?.stock);
    const consumedQuantity = getConsumedQuantity(reservations, product);
    const totalStock = Math.max(0, sourceStock - consumedQuantity);
    const smartstoreReserved = getReservedQuantity(reservations, product);
    const regularAvailable = Math.max(0, totalStock - smartstoreReserved);
    const status = regularAvailable <= 0
      ? (totalStock > 0 && smartstoreReserved > 0 ? "smartstore-available" : "soldout")
      : "available";
    return { totalStock, regularAvailable, smartstoreReserved, status, sourceStock, consumedQuantity };
  }

  function mergeReservations(existing, incoming, products) {
    const merged = new Map((existing || []).map((item) => [keyFor(item.productCode, item.vendor), item]));
    const productMap = new Map((products || []).map((product) => [productCode(product), product]));
    const affected = new Set();
    for (const item of incoming || []) {
      const code = normalizeCode(item.productCode);
      const result = validateReservation(item, productMap.get(code));
      if (!result.ok) return result;
      const reservation = result.reservation;
      const key = keyFor(code, reservation.vendor);
      const consumedQuantity = reservationBalance(merged.get(key)).consumed;
      const quantity = reservation.quantity + consumedQuantity;
      if (!Number.isSafeInteger(quantity)) return { ok: false, error: "전용수량이 허용 범위를 초과합니다." };
      merged.set(key, { ...reservation, quantity, consumedQuantity });
      affected.add(code);
    }
    const reservations = [...merged.values()];
    for (const code of affected) {
      const availability = summarizeAvailability(productMap.get(code), reservations);
      if (availability.smartstoreReserved > availability.totalStock) {
        return { ok: false, error: `${code}: 거래처별 전용수량의 합계가 현재고를 초과합니다.` };
      }
    }
    return { ok: true, reservations };
  }

  function consumeReservation(reservations, code, vendor, value, product) {
    const key = keyFor(code, vendor);
    const target = (reservations || []).find((item) => keyFor(item.productCode, item.vendor) === key);
    const balance = reservationBalance(target);
    const quantity = wholeQuantity(value);
    if (!quantity || quantity > balance.remaining) return { ok: false, error: "차감수량은 1 이상이고 전용 잔량 이하여야 합니다." };
    if (product && quantity > summarizeAvailability(product, reservations).totalStock) {
      return { ok: false, error: "차감수량은 현재고를 초과할 수 없습니다." };
    }
    return { ok: true, reservations: reservations.map((item) => item === target ? { ...item, consumedQuantity: balance.consumed + quantity } : item) };
  }

  function parseReservationRows(rows, products) {
    const aliases = new Map([["barcode", "바코드"], ["reservedquantity", "전용수량"], ["customer", "거래처"]]);
    const normalizedHeader = (value) => {
      const key = clean(value).replace(/\s+/g, "");
      return aliases.get(key.toLowerCase()) || key;
    };
    const headerIndex = (rows || []).findIndex((row) => {
      const headers = (row || []).map(normalizedHeader);
      return headers.includes("바코드") && headers.includes("전용수량");
    });
    if (headerIndex < 0) return { ok: false, reservations: [], error: "바코드와 전용수량 머리글을 확인해주세요." };
    const headers = rows[headerIndex].map(normalizedHeader);
    const barcodeIndex = headers.indexOf("바코드");
    const quantityIndex = headers.indexOf("전용수량");
    const vendorIndex = headers.indexOf("거래처");
    const productMap = new Map();
    for (const product of products || []) {
      productMap.set(productCode(product), product);
      const barcode = normalizeCode(product.바코드 || product.barcode);
      if (barcode) productMap.set(barcode, product);
    }
    const result = new Map();
    for (let index = headerIndex + 1; index < rows.length; index += 1) {
      const row = rows[index] || [];
      const code = normalizeCode(row[barcodeIndex]);
      const rawQuantity = clean(row[quantityIndex]);
      const vendor = clean(row[vendorIndex]);
      if (!code && !rawQuantity && !vendor) continue;
      const product = productMap.get(code);
      const validation = validateReservation({ productCode: productCode(product), quantity: rawQuantity, vendor }, product);
      if (!validation.ok) return { ok: false, reservations: [], error: `${index + 1}행: ${validation.error}` };
      const key = keyFor(validation.reservation.productCode, vendor);
      if (result.has(key)) return { ok: false, reservations: [], error: `${index + 1}행: 같은 상품과 거래처가 중복되었습니다.` };
      result.set(key, validation.reservation);
    }
    if (!result.size) return { ok: false, reservations: [], error: "등록할 바코드와 전용수량이 없습니다." };
    return { ok: true, reservations: [...result.values()] };
  }

  return { DEFAULT_VENDOR, vendorName, normalizeCode, productCode, validateReservation, reservationBalance, getReservedQuantity, getConsumedQuantity, summarizeAvailability, mergeReservations, consumeReservation, parseReservationRows };
});
