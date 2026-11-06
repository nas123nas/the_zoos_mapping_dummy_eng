(function initializeInventoryTools() {
  "use strict";

  workspace.expiryLots = Array.isArray(workspace.expiryLots) ? workspace.expiryLots : [];
  workspace.smartstoreReservations = Array.isArray(workspace.smartstoreReservations) ? workspace.smartstoreReservations : [];
  let cachedProducts = [];

  function safe(value) {
    return escapeHtml(value === null || value === undefined ? "" : String(value));
  }

  function quantity(value) {
    const text = String(value ?? "").trim().replace(/,/g, "");
    const number = text ? Number(text) : NaN;
    return Number.isSafeInteger(number) && number >= 0 ? number : null;
  }

  const reservationEngine = window.SmartstoreInventoryEngine;
  const lotEngine = window.ExpiryLotEngine;
  const numberLabel = (value) => value.toLocaleString("ko-KR");
  const barcodeFor = (row) => reservationEngine.normalizeCode(row?.바코드 || row?.barcode || reservationEngine.productCode(row));

  async function products() {
    try {
      const rows = await loadStockScheduleRows();
      const deduped = new Map();
      for (const row of rows || []) {
        const barcode = barcodeFor(row);
        if (!barcode) continue;
        const previous = deduped.get(barcode);
        if (!previous || (quantity(previous.현재고 ?? previous.stock) === null && quantity(row.현재고 ?? row.stock) !== null)) {
          deduped.set(barcode, row);
        }
      }
      cachedProducts = [...deduped.values()];
    } catch (_) {
      cachedProducts = cachedProducts.length ? cachedProducts : (workspace.containerInboundRecords || []);
    }
    return cachedProducts;
  }

  function findProduct(code, rows = cachedProducts) {
    const target = reservationEngine.normalizeCode(code);
    return (rows || []).find((row) => reservationEngine.productCode(row) === target || barcodeFor(row) === target) || null;
  }

  function stockForReservations(rows) {
    const consumed = lotEngine?.consumedStockByBarcode(workspace.expiryLots);
    return rows.map((row) => ({
      ...row,
      현재고: Math.max(0, (quantity(row.현재고 ?? row.stock) || 0) - (consumed?.[barcodeFor(row)] || 0)),
    }));
  }

  function stockForLots(rows) {
    const stock = Object.create(null);
    for (const row of rows) {
      const barcode = barcodeFor(row);
      const actual = quantity(row.현재고 ?? row.stock);
      if (barcode && actual !== null) {
        stock[barcode] = Math.max(0, actual - reservationEngine.getConsumedQuantity(workspace.smartstoreReservations, row));
      }
    }
    return stock;
  }

  function consumptionControl(kind, maximum) {
    if (maximum < 1) return "—";
    return `<input type="number" min="1" max="${maximum}" step="1" data-${kind}-quantity aria-label="차감수량" placeholder="수량" style="width:80px" />
      <button type="button" class="secondary compact-button" data-${kind}-consume>차감</button>`;
  }

  async function renderSmartstore() {
    const body = document.querySelector("#smartstore-body");
    if (!body) return;
    const rows = stockForReservations(await products());
    const reservations = workspace.smartstoreReservations || [];
    const vendors = [...new Set(reservations.map((item) => reservationEngine.vendorName(item.vendor)))].sort((a, b) => a.localeCompare(b, "ko-KR"));
    const filter = document.querySelector("#smartstore-vendor-filter");
    const selected = vendors.includes(filter?.value) ? filter.value : "";
    const options = vendors.map((vendor) => `<option value="${safe(vendor)}">${safe(vendor)}</option>`).join("");
    if (filter) {
      filter.innerHTML = '<option value="">전체 거래처</option>' + options;
      filter.value = selected;
    }
    const suggestions = document.querySelector("#smartstore-vendor-options");
    if (suggestions) suggestions.innerHTML = options;
    const displayed = selected ? reservations.filter((item) => reservationEngine.vendorName(item.vendor) === selected) : reservations;
    document.querySelector("#smartstore-count").textContent = `${displayed.length}건`;
    body.innerHTML = displayed.length ? displayed.map((reservation) => {
      const product = findProduct(reservation.productCode, rows) || { 상품코드: reservation.productCode, 현재고: 0 };
      const availability = reservationEngine.summarizeAvailability(product, reservations);
      const balance = reservationEngine.reservationBalance(reservation);
      const vendor = reservationEngine.vendorName(reservation.vendor);
      const maximum = Math.min(balance.remaining, availability.totalStock);
      const status = !balance.remaining ? "차감 완료" : !maximum ? "현재고 부족" : balance.consumed ? "일부 차감" : "사용 가능";
      return `<tr data-product-code="${safe(reservation.productCode)}" data-vendor="${safe(vendor)}"><td>${safe(reservation.productCode)}</td><td>${safe(product.상품명 || product.제품명 || "-")}</td><td>${safe(vendor)}</td><td>${numberLabel(availability.totalStock)}</td><td>${numberLabel(availability.regularAvailable)}</td><td>${numberLabel(balance.registered)}</td><td>${numberLabel(balance.consumed)}</td><td><b>${numberLabel(balance.remaining)}</b></td><td><span class="tag blue">${status}</span></td><td>${consumptionControl("smartstore", maximum)}</td></tr>`;
    }).join("") : `<tr><td colspan="10">등록된 전용 재고가 없습니다.</td></tr>`;
  }

  async function renderExpiry() {
    const body = document.querySelector("#expiry-body");
    if (!body) return;
    if (!document.querySelector("#expiry-allocation-summary")) {
      body.closest(".panel")?.insertAdjacentHTML("beforebegin", `<section id="expiry-allocation-summary" class="panel product-detail-summary"><article><span>등록 품목 전체 현재고</span><b id="expiry-current-stock">0개</b></article><article><span>유통기한 지정 수량</span><b id="expiry-assigned-stock">0개</b></article><article><span>유통기한 미지정 수량</span><b id="expiry-unassigned-stock">0개</b></article><p class="form-help">업로드 수량은 현재고를 추가하지 않고, 기존 현재고 안에서 유통기한이 지정된 수량으로만 반영됩니다.</p></section>`);
    }
    const rows = await products();
    const stockByBarcode = stockForLots(rows);
    const names = new Map(rows.map((row) => [barcodeFor(row), row.상품명 || row.제품명 || ""]));
    const allocation = lotEngine.summarizeStockAllocation(workspace.expiryLots, stockByBarcode);
    const remaining = allocation.remainingLots;
    const registeredBarcodes = new Set((workspace.expiryLots || []).map((lot) => window.ExpiryLotEngine.normalizeBarcode(lot?.barcode)).filter(Boolean));
    const totals = [...registeredBarcodes].reduce((summary, barcode) => {
      const item = allocation.byBarcode[barcode] || { currentStock: 0, expiryAssigned: 0, expiryUnassigned: 0 };
      summary.currentStock += item.currentStock;
      summary.expiryAssigned += item.expiryAssigned;
      summary.expiryUnassigned += item.expiryUnassigned;
      return summary;
    }, { currentStock: 0, expiryAssigned: 0, expiryUnassigned: 0 });
    const currentStockNode = document.querySelector("#expiry-current-stock");
    const assignedNode = document.querySelector("#expiry-assigned-stock");
    const unassignedNode = document.querySelector("#expiry-unassigned-stock");
    if (currentStockNode) currentStockNode.textContent = `${totals.currentStock.toLocaleString("ko-KR")}개`;
    if (assignedNode) assignedNode.textContent = `${totals.expiryAssigned.toLocaleString("ko-KR")}개`;
    if (unassignedNode) unassignedNode.textContent = `${totals.expiryUnassigned.toLocaleString("ko-KR")}개`;
    const visible = new Map(remaining.map((lot) => [String(lot.id), lot]));
    for (const lot of workspace.expiryLots) {
      if (!visible.has(String(lot.id)) && lotEngine.lotConsumedQuantity(lot)) {
        visible.set(String(lot.id), { ...lot, remainingQuantity: 0 });
      }
    }
    const filter = document.querySelector("#expiry-filter")?.value || "all";
    const today = new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Seoul" }).format(new Date());
    const displayed = [...visible.values()].filter((lot) => filter === "all" ||
      (lot.remainingQuantity > 0 && lotEngine.expiryStatus(lot.expiryDate, today) === filter));
    document.querySelector("#expiry-count").textContent = `${displayed.length}건`;
    body.innerHTML = displayed.length ? displayed.map((lot) => {
      const inboundQty = Number(lot.quantity);
      const remainQty = lot.remainingQuantity;
      const consumed = lotEngine.lotConsumedQuantity(lot);
      const timing = lotEngine.expiryStatus(lot.expiryDate, today);
      const status = !remainQty ? "잔량 없음" : timing === "near" ? "임박" : timing === "expired" ? "기한 경과" : consumed ? "일부 차감" : "보유";
      return `<tr data-lot-id="${safe(lot.id)}"><td>${safe(lot.inboundDate)}</td><td>${safe(lot.barcode)}</td><td>${safe(lot.productName || names.get(lot.barcode) || "-")}</td><td><input type="number" class="expiry-lot-qty" data-lot-id="${safe(lot.id)}" data-field="quantity" min="${Math.max(1, consumed)}" step="1" value="${Number.isFinite(inboundQty) ? inboundQty : ""}" title="입고 수량" /><small class="expiry-remain-hint">차감 ${numberLabel(consumed)} · 잔량 ${numberLabel(remainQty)} · ${status}</small></td><td><input type="date" class="expiry-lot-date" data-lot-id="${safe(lot.id)}" data-field="manufacturedDate" value="${safe(lot.manufacturedDate || "")}" title="제조일자" /></td><td><input type="date" class="expiry-lot-date" data-lot-id="${safe(lot.id)}" data-field="expiryDate" value="${safe(lot.expiryDate || "")}" title="유통기한" /></td><td>${safe(lot.note)}</td><td>${safe(lot.sourceFile)}</td><td>${consumptionControl("expiry", remainQty)}</td></tr>`;
    }).join("") : `<tr><td colspan="9">표시할 유통기한 로트가 없습니다.</td></tr>`;
  }

  document.querySelector("#smartstore-form")?.insertAdjacentHTML?.("afterbegin",
    '<label>거래처<input id="smartstore-vendor" list="smartstore-vendor-options" value="스마트스토어" maxlength="80" placeholder="거래처명" /></label><datalist id="smartstore-vendor-options"></datalist>');
  const vendorHeaders = document.querySelector("#smartstore thead tr");
  if (vendorHeaders) vendorHeaders.innerHTML = "<th>상품코드</th><th>상품명</th><th>거래처</th><th>전체 현재고</th><th>일반 판매 가능</th><th>등록 수량</th><th>차감 수량</th><th>전용 잔량</th><th>상태</th><th>관리</th>";
  const vendorTitle = document.querySelector("#smartstore .page-heading h2");
  if (vendorTitle) vendorTitle.textContent = "거래처별 전용 재고";
  const vendorDescription = document.querySelector("#smartstore .page-heading p:last-child");
  if (vendorDescription) vendorDescription.textContent = "같은 상품을 여러 거래처에 배정하고, 출고하거나 사용한 수량을 차감할 수 있습니다.";
  const vendorListTitle = document.querySelector("#smartstore .section-title h3");
  if (vendorListTitle) vendorListTitle.textContent = "거래처별 전용 재고 목록";
  document.querySelector("#smartstore .section-title")?.insertAdjacentHTML?.("beforeend",
    '<label>거래처 <select id="smartstore-vendor-filter"><option value="">전체 거래처</option></select></label>');
  document.querySelector("#smartstore-vendor-filter")?.addEventListener("change", renderSmartstore);
  const fileHelp = document.querySelector("#smartstore-file-status");
  if (fileHelp) fileHelp.textContent = "엑셀 머리글은 바코드, 전용수량, 거래처(선택)입니다. 거래처가 비어 있으면 스마트스토어로 등록합니다.";
  const expiryTitle = document.querySelector("#expiry .section-title");
  expiryTitle?.insertAdjacentHTML?.("beforeend",
    '<label>유통기한 <select id="expiry-filter"><option value="all">전체</option><option value="near">임박 · 오늘부터 30일 이내</option><option value="expired">기한 경과</option></select></label>');
  document.querySelector("#expiry-filter")?.addEventListener("change", renderExpiry);

  document.querySelector("#download-smartstore-template")?.addEventListener("click", () => {
    const sheet = XLSX.utils.aoa_to_sheet([["Barcode", "Reserved Quantity", "Customer"], ["8809911001001", 1, ""]]);
    sheet["!cols"] = [{ wch: 18 }, { wch: 12 }, { wch: 20 }];
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, sheet, "Reserved Stock");
    XLSX.writeFile(workbook, "reserved-stock-template.xlsx");
  });

  document.querySelector("#smartstore-file")?.addEventListener("change", async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    const status = document.querySelector("#smartstore-file-status");
    try {
      const workbook = XLSX.read(await file.arrayBuffer(), { type: "array", cellDates: false });
      const sheet = workbook.Sheets[workbook.SheetNames[0]];
      const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: false, defval: "" });
      const productRows = stockForReservations(await products());
      const parsed = reservationEngine.parseReservationRows(rows, productRows);
      const result = parsed.ok
        ? reservationEngine.mergeReservations(workspace.smartstoreReservations, parsed.reservations, productRows)
        : parsed;
      if (!result.ok) {
        alert(`${result.error}\n파일 전체를 반영하지 않았습니다.`);
        status.textContent = `${file.name} · 반영 실패`;
        return;
      }
      workspace.smartstoreReservations = result.reservations;
      saveWorkspace();
      status.textContent = `${file.name} · ${parsed.reservations.length}건 반영 완료`;
      showToast(`거래처 전용 재고 ${parsed.reservations.length}건을 반영했습니다.`);
      await renderSmartstore();
    } catch (error) {
      alert(`파일을 읽지 못했습니다. 다시 첨부해주세요.\n${error.message}`);
      status.textContent = `${file.name} · 파일 읽기 실패`;
    } finally {
      event.target.value = "";
    }
  });

  document.querySelector("#smartstore-form")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const code = document.querySelector("#smartstore-product-code").value;
    const vendor = document.querySelector("#smartstore-vendor")?.value;
    const requestedQuantity = document.querySelector("#smartstore-quantity").value;
    const rows = stockForReservations(await products());
    const product = findProduct(code, rows);
    const result = reservationEngine.mergeReservations(workspace.smartstoreReservations, [{
      productCode: reservationEngine.productCode(product),
      vendor,
      quantity: requestedQuantity,
    }], rows);
    if (!result.ok) return showToast(result.error);
    workspace.smartstoreReservations = result.reservations;
    saveWorkspace();
    form.reset();
    showToast("거래처 전용 재고를 등록했습니다.");
    await renderSmartstore();
  });

  document.querySelector("#smartstore-body")?.addEventListener("click", async (event) => {
    const button = event.target.closest("[data-smartstore-consume]");
    if (!button || button.disabled) return;
    const row = button.closest("tr");
    const value = row.querySelector("[data-smartstore-quantity]").value;
    const { productCode, vendor } = row.dataset;
    button.disabled = true;
    try {
      const product = findProduct(productCode, stockForReservations(await products())) || { 상품코드: productCode, 현재고: 0 };
      const result = reservationEngine.consumeReservation(workspace.smartstoreReservations, productCode, vendor, value, product);
      if (!result.ok) return showToast(result.error);
      workspace.smartstoreReservations = result.reservations;
      saveWorkspace();
      showToast("전용 재고를 차감했습니다.");
      await renderSmartstore();
    } finally {
      button.disabled = false;
    }
  });

  const manufacturedInput = document.querySelector("#expiry-manufactured-date");
  const expiryInput = document.querySelector("#expiry-date");
  manufacturedInput?.addEventListener("change", () => {
    if (manufacturedInput.value && !expiryInput.value) expiryInput.value = window.ExpiryLotEngine.expiryFromManufactured(manufacturedInput.value);
  });
  expiryInput?.addEventListener("change", () => {
    if (expiryInput.value && !manufacturedInput.value) manufacturedInput.value = window.ExpiryLotEngine.manufacturedFromExpiry(expiryInput.value);
  });

  document.querySelector("#expiry-manual-form")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const result = window.ExpiryLotEngine.normalizeManualLot({
      inboundDate: document.querySelector("#expiry-inbound-date").value,
      barcode: document.querySelector("#expiry-barcode").value,
      quantity: Number(document.querySelector("#expiry-quantity").value),
      manufacturedDate: manufacturedInput.value,
      expiryDate: expiryInput.value,
      note: document.querySelector("#expiry-note").value,
    }, { sequence: Date.now() });
    if (!result.ok) return showToast(result.error);
    const row = findProduct(result.lot.barcode);
    result.lot.productName = row?.상품명 || row?.제품명 || "";
    workspace.expiryLots.push(result.lot);
    saveWorkspace();
    form.reset();
    showToast("유통기한 입고 로트를 등록했습니다.");
    await renderExpiry();
  });

  function openExpiryBatchDateModal(lots, meta) {
    return new Promise((resolve) => {
      const overlay = document.createElement("div");
      overlay.style.cssText = "position:fixed;inset:0;background:rgba(15,23,42,.5);z-index:90;display:flex;align-items:center;justify-content:center;padding:16px";
      const missing = (lots || []).filter((l) => !l.manufacturedDate && !l.expiryDate).length;
      overlay.innerHTML = `
        <div style="background:#fff;border-radius:12px;width:min(440px,100%);padding:20px;box-shadow:0 16px 40px rgba(0,0,0,.18)">
          <h3 style="margin:0 0 8px;font-size:18px">제조일·유통기한 일괄 반영</h3>
          <p style="margin:0 0 14px;font-size:13px;color:#64748b;line-height:1.5">
            <b>${safe(meta.fileName || "파일")}</b> · ${lots.length}개 품목 · 합계 ${(meta.actualTotal || 0).toLocaleString("ko-KR")}개<br>
            ${missing ? `날짜 없는 품목 <b style="color:#c75600">${missing}건</b>에 적용됩니다.` : "파일의 날짜를 유지합니다."}<br>
            제조일만 넣으면 <b>18개월-1일</b> 규칙으로 유통기한을 자동 계산합니다.
          </p>
          <label style="display:block;font-size:12px;font-weight:700;color:#64748b;margin-bottom:10px">제조일자
            <input type="date" id="batch-mfg" style="display:block;width:100%;margin-top:4px;padding:8px;border:1px solid #e5e7eb;border-radius:8px" />
          </label>
          <label style="display:block;font-size:12px;font-weight:700;color:#64748b;margin-bottom:10px">유통기한 (선택)
            <input type="date" id="batch-exp" style="display:block;width:100%;margin-top:4px;padding:8px;border:1px solid #e5e7eb;border-radius:8px" />
          </label>
          <label style="display:block;font-size:12px;font-weight:700;color:#64748b;margin-bottom:14px">입고일 (선택)
            <input type="date" id="batch-inbound" value="${new Date().toISOString().slice(0,10)}" style="display:block;width:100%;margin-top:4px;padding:8px;border:1px solid #e5e7eb;border-radius:8px" />
          </label>
          <div style="display:flex;gap:8px;justify-content:flex-end;flex-wrap:wrap">
            <button type="button" class="secondary" data-act="skip">날짜 없이 등록</button>
            <button type="button" class="secondary" data-act="cancel">취소</button>
            <button type="button" class="primary" data-act="apply">반영 후 등록</button>
          </div>
        </div>`;
      document.body.appendChild(overlay);
      const mfg = overlay.querySelector("#batch-mfg");
      const exp = overlay.querySelector("#batch-exp");
      mfg.addEventListener("change", () => {
        if (mfg.value && !exp.value && window.ExpiryLotEngine?.expiryFromManufactured) {
          exp.value = window.ExpiryLotEngine.expiryFromManufactured(mfg.value);
        }
      });
      exp.addEventListener("change", () => {
        if (exp.value && !mfg.value && window.ExpiryLotEngine?.manufacturedFromExpiry) {
          mfg.value = window.ExpiryLotEngine.manufacturedFromExpiry(exp.value);
        }
      });
      overlay.addEventListener("click", (e) => {
        const act = e.target?.dataset?.act;
        if (!act && e.target !== overlay) return;
        if (act === "cancel" || e.target === overlay) {
          overlay.remove();
          resolve(null);
          return;
        }
        if (act === "skip") {
          overlay.remove();
          resolve({ lots, skipped: true });
          return;
        }
        if (act === "apply") {
          const dates = lotEngine.resolveDates(mfg.value, exp.value);
          if (!dates.ok) return showToast(dates.error);
          let next = window.ExpiryLotEngine.applyBatchDatesToLots(lots, mfg.value, exp.value);
          const inbound = overlay.querySelector("#batch-inbound")?.value;
          if (inbound) next = next.map((l) => ({ ...l, inboundDate: inbound }));
          overlay.remove();
          resolve({ lots: next, skipped: false });
        }
      });
    });
  }

  document.querySelector("#expiry-file")?.addEventListener("change", async (event) => {
    const file = event.target.files?.[0];
    document.querySelector("#expiry-file-name").textContent = file?.name || "파일을 선택하세요";
    if (!file) return;
    try {
      const workbook = XLSX.read(await file.arrayBuffer(), { type: "array", cellDates: true });
      const sheet = workbook.Sheets[workbook.SheetNames[0]];
      const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: false, defval: "" });
      const result = window.ExpiryLotEngine.parseContainerLots(rows, { fileName: file.name, importedAt: new Date() });
      if (!result.ok) {
        alert(result.error);
        event.target.value = "";
        document.querySelector("#expiry-file-name").textContent = "파일을 다시 선택해주세요";
        return;
      }
      const decided = await openExpiryBatchDateModal(result.lots, {
        fileName: file.name,
        actualTotal: result.actualTotal,
      });
      if (!decided) {
        event.target.value = "";
        document.querySelector("#expiry-file-name").textContent = "파일을 선택하세요";
        return;
      }
      workspace.expiryLots = window.ExpiryLotEngine.replaceFileLots(workspace.expiryLots || [], file.name, decided.lots);
      saveWorkspace();
      showToast(`${decided.lots.length}개 로트를 반영했습니다. 합계 ${result.actualTotal.toLocaleString("ko-KR")}개`);
      await renderExpiry();
    } catch (error) {
      alert(`파일을 읽지 못했습니다. 다시 첨부해주세요.\n${error.message}`);
    }
  });

  document.querySelector("#expiry-body")?.addEventListener("click", async (event) => {
    const button = event.target.closest("[data-expiry-consume]");
    if (!button || button.disabled) return;
    const row = button.closest("tr");
    const value = row.querySelector("[data-expiry-quantity]").value;
    button.disabled = true;
    try {
      const stocks = stockForLots(await products());
      const result = lotEngine.consumeLot(workspace.expiryLots, stocks, row.dataset.lotId, value);
      if (!result.ok) return showToast(result.error);
      workspace.expiryLots = result.lots;
      saveWorkspace();
      showToast("로트 재고를 차감했습니다.");
      await renderExpiry();
    } finally {
      button.disabled = false;
    }
  });

  document.querySelector("#expiry-body")?.addEventListener("change", async (event) => {
    const input = event.target.closest(".expiry-lot-date, .expiry-lot-qty");
    if (!input) return;
    const lotId = input.dataset.lotId;
    const field = input.dataset.field;
    const lots = workspace.expiryLots || [];
    const idx = lots.findIndex((lot) => String(lot.id) === String(lotId));
    if (idx < 0) return;
    const next = { ...lots[idx] };
    if (field === "quantity") {
      const qty = quantity(input.value);
      if (!qty || qty < lotEngine.lotConsumedQuantity(next)) {
        input.value = next.quantity;
        showToast("입고수량은 1 이상이며 이미 차감한 수량 이상이어야 합니다.");
        return;
      }
      next.quantity = qty;
    } else {
      const value = input.value || "";
      next[field] = value;
      if (field === "manufacturedDate" && value && window.ExpiryLotEngine?.expiryFromManufactured) {
        next.expiryDate = window.ExpiryLotEngine.expiryFromManufactured(value);
      }
      if (field === "expiryDate" && value && !next.manufacturedDate && window.ExpiryLotEngine?.manufacturedFromExpiry) {
        next.manufacturedDate = window.ExpiryLotEngine.manufacturedFromExpiry(value);
      }
      if (value && next.manufacturedDate && next.expiryDate) {
        const check = window.ExpiryLotEngine.resolveDates?.(next.manufacturedDate, next.expiryDate);
        if (check && check.ok === false) {
          showToast(check.error);
          return;
        }
      }
    }
    lots[idx] = next;
    workspace.expiryLots = lots;
    saveWorkspace();
    showToast(field === "quantity" ? "입고 수량을 저장했습니다." : "로트 날짜를 저장했습니다.");
    await renderExpiry();
  });

  document.querySelectorAll('[data-page="smartstore"]').forEach((button) => button.addEventListener("click", renderSmartstore));
  document.querySelectorAll('[data-page="expiry"]').forEach((button) => button.addEventListener("click", renderExpiry));
  document.querySelector("#expiry-inbound-date").value = new Date().toISOString().slice(0, 10);
})();
