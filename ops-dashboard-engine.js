/**
 * 재고현황 엔진 — SKU 그리드 + 창고존 / 도매출고 / 택배 / 실출고
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.OpsDashboardEngine = api;
})(typeof window !== "undefined" ? window : globalThis, function () {
  "use strict";
  const _vMask = new Map();
  function maskVendorName(name) {
    const key = String(name || "").trim();
    if (!key || key === "-") return "-";
    if (/^\d{2}업체$/.test(key)) return key;
    if (/스마트스토어|쿠팡|자사몰|더조스몰/.test(key)) return key;
    if (!_vMask.has(key)) _vMask.set(key, String(_vMask.size + 1).padStart(2, "0") + "업체");
    return _vMask.get(key);
  }


  const STORAGE_KEY = "thezoos-english-portfolio-ops-api-config-v1";
  const MOVEMENT_STORAGE = "thezoos-english-portfolio-ops-movements-v1";

  const MOVEMENT_STATUS = {
    NEED_REQUEST: "need_request",
    ORDERED: "ordered",
    IN_TRANSIT: "in_transit",
    RECEIVED: "received",
    NONE: "none",
  };

  function clean(v) {
    return v == null ? "" : String(v).trim();
  }
  function num(v) {
    const n = Number(String(v ?? "").replace(/,/g, "").replace(/[^\d.-]/g, ""));
    return Number.isFinite(n) ? n : 0;
  }

  function defaultConfig() {
    return {
      ecount: { enabled: false, zone: "", comCode: "", userId: "", apiCertKey: "", proxyUrl: "" },
      courier: { enabled: false, provider: "", apiKey: "", apiUrl: "" },
      tpl: { enabled: false, provider: "", apiKey: "", apiUrl: "" },
      useDemo: true,
      lastSyncAt: null,
    };
  }

  function loadConfig() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return defaultConfig();
      return { ...defaultConfig(), ...JSON.parse(raw) };
    } catch (_) {
      return defaultConfig();
    }
  }

  function saveConfig(cfg) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(cfg));
    } catch (e) {
      console.warn("[OpsDashboard] config save failed", e);
    }
  }

  function hasAnyLiveKey(cfg) {
    const c = cfg || loadConfig();
    return Boolean(
      (c.ecount && c.ecount.enabled && c.ecount.apiCertKey) ||
        (c.courier && c.courier.enabled && c.courier.apiKey) ||
        (c.tpl && c.tpl.enabled && c.tpl.apiKey)
    );
  }

  function loadLocalMovements() {
    try {
      const raw = localStorage.getItem(MOVEMENT_STORAGE);
      if (!raw) return {};
      const parsed = JSON.parse(raw);
      return parsed && typeof parsed === "object" ? parsed : {};
    } catch (_) {
      return {};
    }
  }

  function saveLocalMovements(map) {
    try {
      localStorage.setItem(MOVEMENT_STORAGE, JSON.stringify(map || {}));
    } catch (_) {}
  }

  function demoCatalog() { return globalThis.PortfolioData.ops().catalog; }

  function demoZoneStock() { return globalThis.PortfolioData.ops().zoneStock; }

  function demoWholesalePending() { return globalThis.PortfolioData.ops().wholesalePending; }

  function demoWholesaleDone() { return globalThis.PortfolioData.ops().wholesaleDone; }

  function demoRetailShipments() { return globalThis.PortfolioData.ops().retailAll; }

  function demoDemandFromPending(wholesale, retail) {
    const map = {};
    function add(sku, productName, qty, channel) {
      if (!map[sku]) map[sku] = { sku, productName, demand: 0, channels: [] };
      map[sku].demand += num(qty);
      if (channel) map[sku].channels.push(channel);
    }
    (wholesale || []).forEach((r) => {
      if (r.status === "출고완료") return;
      add(r.sku, r.productName, r.qty, maskVendorName(r.vendor) + " " + r.qty);
    });
    (retail || []).forEach((r) => {
      if (r.status === "배송완료" || r.status === "출고완료") return;
      if (r.status === "출고대기" || r.status === "배송중") {
        add(r.sku, r.productName, r.qty, r.channel + " " + r.qty);
      }
    });
    Object.keys(map).forEach((sku) => {
      map[sku].channels = map[sku].channels.join(" · ");
    });
    return map;
  }


  /** 출고대기 전표 단위 (이카운트 + 택배) */
  function demoPendingSlips() { return globalThis.PortfolioData.ops().pendingSlips; }

  function demoInboundLines() { return globalThis.PortfolioData.ops().inboundLines; }

  function demoMovementBySku() { return globalThis.PortfolioData.ops().movement; }

  function movementLabel(status) {
    switch (status) {
      case MOVEMENT_STATUS.NEED_REQUEST:
        return { text: "보충요청 필요", emoji: "🔴", cls: "mov-need" };
      case MOVEMENT_STATUS.ORDERED:
        return { text: "이동 지시됨", emoji: "🟡", cls: "mov-ordered" };
      case MOVEMENT_STATUS.IN_TRANSIT:
        return { text: "택배/화물 이동중", emoji: "🔵", cls: "mov-transit" };
      case MOVEMENT_STATUS.RECEIVED:
        return { text: "입고(적치) 완료", emoji: "🟢", cls: "mov-done" };
      default:
        return { text: "이동 없음", emoji: "⚪", cls: "mov-none" };
    }
  }

  function buildGrid(catalog, zoneStock, demandMap, movementMap, localMovements, retailDoneBySku, retailPendingBySku) {
    const zones = zoneStock.zones || [];
    const bySku = zoneStock.bySku || {};
    const inboundDemo = Object.fromEntries(globalThis.PortfolioData.ops().inboundLines.map(line => [line.sku, { date: line.date, qty: line.qty }]));

    const rows = catalog.map((item) => {
      const sku = item.sku;
      const stock = bySku[sku] || {};
      const main = num(stock.MAIN);
      const tplIcn = num(stock.TPL_ICN);
      const hqB = num(stock.HQ_B);
      const ecW = num(stock.EC_W);
      const total = main + tplIcn + hqB + ecW;
      const d = demandMap[sku] || { demand: 0, channels: "" };
      const demand = num(d.demand);
      const shortfall = main - demand;
      let m = localMovements[sku] || movementMap[sku] || { qty: 0, status: MOVEMENT_STATUS.NONE, eta: "", from: "", to: "" };
      let status = m.status || MOVEMENT_STATUS.NONE;
      const availableOther = tplIcn + hqB + ecW;
      if (shortfall < 0 && (!m.qty || status === MOVEMENT_STATUS.NONE || status === MOVEMENT_STATUS.RECEIVED)) {
        if (availableOther > 0) status = MOVEMENT_STATUS.NEED_REQUEST;
      }
      let action = "none";
      if (main >= demand && demand > 0) action = "ship";
      else if (shortfall < 0 && (status === MOVEMENT_STATUS.NEED_REQUEST || status === MOVEMENT_STATUS.NONE) && availableOther > 0) action = "transfer";
      else if (status === MOVEMENT_STATUS.ORDERED || status === MOVEMENT_STATUS.IN_TRANSIT) action = "wait";

      const other = tplIcn + hqB + ecW;
      // 데모 입고예정 (SKU별) — 실연동 시 스케줄 API로 대체
      const inbound = inboundDemo[sku] || { date: "", qty: 0 };
      const afterShip = total - demand; // 전체 현재고 - 출고대기

      return {
        sku,
        productName: item.productName,
        category: item.category,
        demand,
        channels: d.channels || "",
        stockMain: main,
        stockTplIcn: tplIcn,
        stockHqB: hqB,
        stockEcW: ecW,
        stockOther: other,
        stockTotal: total,
        stockByZone: stock,
        afterShip,
        inboundDate: inbound.date || "",
        inboundQty: num(inbound.qty),
        shortfall,
        isRisk: shortfall < 0 || afterShip < 0,
        moveQty: num(m.qty),
        moveStatus: status,
        moveEta: clean(m.eta),
        moveFrom: clean(m.from),
        moveTo: clean(m.to) || "메인창고",
        action,
        retailDoneQty: num((retailDoneBySku || {})[sku]),
        retailPendingQty: num((retailPendingBySku || {})[sku]),
        retailShipQty: num((retailDoneBySku || {})[sku]) + num((retailPendingBySku || {})[sku]),
      };
    });

    rows.sort((a, b) => {
      if (a.isRisk !== b.isRisk) return a.isRisk ? -1 : 1;
      return b.demand - a.demand;
    });
    return { rows, zones };
  }

  function buildDemoSnapshot() {
    const catalog = demoCatalog();
    const zoneStock = demoZoneStock();
    const wholesalePending = demoWholesalePending();
    const pendingSlips = demoPendingSlips();
    const inboundLines = demoInboundLines();
    const wholesaleDone = demoWholesaleDone();
    const retail = demoRetailShipments();
    const demandMap = demoDemandFromPending(wholesalePending, retail);
    const movement = demoMovementBySku();
    const local = loadLocalMovements();

    const retailPending = retail.filter((r) => r.status === "출고대기" || r.status === "배송중");
    const retailDone = retail.filter((r) => r.status === "배송완료" || r.status === "출고완료");
    const retailDoneBySku = {};
    retailDone.forEach((r) => {
      if (!/스마트스토어/i.test(String(r.channel || ""))) return;
      retailDoneBySku[r.sku] = (retailDoneBySku[r.sku] || 0) + num(r.qty);
    });
    const retailPendingBySku = {};
    retailPending.forEach((r) => {
      if (!/스마트스토어/i.test(String(r.channel || ""))) return;
      retailPendingBySku[r.sku] = (retailPendingBySku[r.sku] || 0) + num(r.qty);
    });
    const { rows, zones } = buildGrid(catalog, zoneStock, demandMap, movement, local, retailDoneBySku, retailPendingBySku);

    // 품목×창고 플랫 테이블
    const zoneRows = [];
    catalog.forEach((item) => {
      const stock = zoneStock.bySku[item.sku] || {};
      (zones || zoneStock.zones || []).forEach((z) => {
        zoneRows.push({
          sku: item.sku,
          productName: item.productName,
          zoneCode: z.code,
          zoneName: z.name,
          qty: num(stock[z.code]),
        });
      });
    });

    return {
      source: "demo",
      generatedAt: new Date().toISOString().slice(0, 19).replace("T", " "),
      grid: rows,
      zones,
      zoneRows,
      wholesalePending,
      pendingSlips,
      inboundLines,
      wholesaleDone,
      retailPending,
      retailDone,
      retailAll: retail,
      summary: {
        skuCount: rows.length,
        riskCount: rows.filter((r) => r.isRisk).length,
        shipReady: rows.filter((r) => r.action === "ship").length,
        needTransfer: rows.filter((r) => r.action === "transfer").length,
        inTransit: rows.filter((r) => r.moveStatus === MOVEMENT_STATUS.IN_TRANSIT || r.moveStatus === MOVEMENT_STATUS.ORDERED).length,
        totalDemand: rows.reduce((s, r) => s + r.demand, 0),
        totalStock: rows.reduce((s, r) => s + r.stockTotal, 0),
        wholesalePendingCount: wholesalePending.length,
        wholesalePendingQty: wholesalePending.reduce((s, r) => s + num(r.qty), 0),
        retailPendingCount: retailPending.length,
        retailDoneCount: retailDone.length,
        retailDoneQty: retailDone.filter((r) => /스마트스토어/i.test(String(r.channel || ""))).reduce((s, r) => s + num(r.qty), 0),
        retailDoneSmartstoreCount: retailDone.filter((r) => /스마트스토어/i.test(String(r.channel || "")) && (r.status === "배송완료" || r.status === "출고완료")).length,
      },
    };
  }

  async function tryLiveFetch(cfg) {
    // 프록시 연동 스텁 (데모와 동일 스키마 기대)
    const results = { partial: false, errors: [] };
    async function postProxy(url, body) {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error("HTTP " + res.status);
      return res.json();
    }
    if (cfg.ecount?.enabled && cfg.ecount.apiCertKey && cfg.ecount.proxyUrl) {
      try {
        const data = await postProxy(cfg.ecount.proxyUrl, { type: "inventory_ops_bundle", config: cfg.ecount });
        Object.assign(results, data, { partial: true });
      } catch (e) {
        results.errors.push("이카운트: " + (e.message || e));
      }
    }
    if (!results.partial) return null;
    return results;
  }

  async function loadSnapshot(options = {}) {
    // 전체 데모 모드: 항상 데모 스냅샷
    const snap = buildDemoSnapshot();
    snap.source = "demo";
    snap.note = "전체 데모 데이터";
    return snap;
  }

  function nextBusinessEta() {
    const d = new Date();
    d.setDate(d.getDate() + 1);
    d.setHours(14, 0, 0, 0);
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return y + "-" + m + "-" + day + " 14:00";
  }

  function getTransferProposal(row) {
    const sources = [
      { from: "3PL-가상센터", stock: num(row.stockTplIcn) },
      { from: "보조창고", stock: num(row.stockHqB) },
      { from: "이카운트도매", stock: num(row.stockEcW) },
    ].sort((a, b) => b.stock - a.stock);
    const source = sources[0];
    return { from: source.from, qty: Math.max(0, Math.floor(Math.min(Math.abs(row.shortfall), source.stock))) };
  }

  function requestTransfer(sku, qty, fromWarehouse) {
    const quantity = Number(qty);
    const codes = { "3PL-가상센터": "TPL_ICN", "보조창고": "HQ_B", "이카운트도매": "EC_W" };
    const sourceStock = demoZoneStock().bySku?.[sku]?.[codes[fromWarehouse]];
    if (!Number.isFinite(quantity) || !Number.isInteger(quantity) || quantity <= 0 || !Number.isFinite(sourceStock) || quantity > sourceStock) {
      throw new Error("이동 수량은 출발 창고 재고 이내의 양의 정수여야 합니다.");
    }
    const map = loadLocalMovements();
    map[sku] = {
      qty: quantity,
      status: MOVEMENT_STATUS.ORDERED,
      eta: nextBusinessEta(),
      from: fromWarehouse || "타창고",
      to: "메인창고",
      updatedAt: new Date().toISOString(),
    };
    saveLocalMovements(map);
    return map[sku];
  }

  function requestShip(sku, qty) {
    return {
      ok: true,
      sku,
      qty: num(qty),
      message: "출고 지시가 접수되었습니다. (데모 — API 연동 시 송장 발행)",
      at: new Date().toISOString().slice(0, 19).replace("T", " "),
    };
  }

  async function getProductDetail(sku) {
    const snap = await loadSnapshot();
    const row = (snap.grid || []).find((r) => r.sku === sku);
    if (!row) return null;
    const slips = (snap.pendingSlips || []).filter((s) => s.sku === sku);
    const inbound = (snap.inboundLines || []).filter((s) => s.sku === sku);
    const zoneRows = (snap.zoneRows || []).filter((z) => z.sku === sku);
    return { row, slips, inbound, zoneRows, snap };
  }

  return {
    STORAGE_KEY,
    MOVEMENT_STATUS,
    getProductDetail,
    loadConfig,
    saveConfig,
    defaultConfig,
    hasAnyLiveKey,
    loadSnapshot,
    buildDemoSnapshot,
    movementLabel,
    requestTransfer,
    getTransferProposal,
    requestShip,
    loadLocalMovements,
    saveLocalMovements,
  };
});
