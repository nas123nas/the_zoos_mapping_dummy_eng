/**
 * 재고현황 UI — 탭: 통합그리드 | 창고존별 | 도매출고 | 택배출고
 */
(function (root) {
  "use strict";
  function maskVendorName(name) {
    const key = String(name || "").trim();
    if (!key || key === "-") return "-";
    if (/^\d{2}업체$/.test(key)) return key;
    if (/스마트스토어|쿠팡|자사몰|더조스몰/.test(key)) return key;
    // engine already masks; pass-through map
    if (!window.__opsVendorMask) window.__opsVendorMask = new Map();
    const m = window.__opsVendorMask;
    if (!m.has(key)) m.set(key, String(m.size + 1).padStart(2, "0") + "업체");
    return m.get(key);
  }


  if (!root.OpsDashboardEngine) {
    console.error("[OpsDashboardUI] OpsDashboardEngine required");
    return;
  }

  const Eng = root.OpsDashboardEngine;
  let lastSnap = null;
  let activeTab = "grid";
  let pageFilter = "all";
  let pageSortKey = "afterShip";
  let pageSortDir = "asc";
  let pageMinusOnly = false;

  function $(sel, parent) {
    return (parent || document).querySelector(sel);
  }
  function esc(s) {
    return String(s ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }
  function toast(msg) {
    if (typeof root.showToast === "function") root.showToast(msg);
  }
  function isAdminMode() {
    return localStorage.getItem("order-mapping-english-portfolio-admin-mode") === "true";
  }
  function fmt(n) {
    return Number(n || 0).toLocaleString();
  }

  function statusPill(status) {
    const s = String(status || "");
    let cls = "ops-pill";
    if (/완료|배송완료/.test(s)) cls += " ok";
    else if (/대기|패킹/.test(s)) cls += " wait";
    else if (/배송중|이동/.test(s)) cls += " move";
    else if (/부족|위험/.test(s)) cls += " risk";
    return '<span class="' + cls + '">' + esc(s) + "</span>";
  }

  function renderMoveBadge(status) {
    const meta = Eng.movementLabel(status);
    return '<span class="ops-move-badge ' + meta.cls + '">' + meta.emoji + " " + esc(meta.text) + "</span>";
  }

  function setSummary(snap) {
    const rows = snap.grid || [];
    const set = (id, v) => {
      const el = $(id);
      if (el) el.textContent = v;
    };
    const totalStock = rows.reduce((a, r) => a + Number(r.stockTotal || 0), 0);
    const shortQty = rows.reduce((a, r) => {
      const after = r.afterShip != null ? r.afterShip : Number(r.stockTotal || 0) - Number(r.demand || 0);
      return a + (after < 0 ? Math.abs(after) : 0);
    }, 0);
    const pendingQty = rows.reduce((a, r) => a + Number(r.demand || 0), 0);
    const inboundQty = rows.reduce((a, r) => a + Number(r.inboundQty || 0), 0);
    set("#ops-sum-stock", fmt(totalStock) + " 개");
    set("#ops-sum-sku", (snap.summary?.skuCount ?? rows.length) + "SKU");
    set("#ops-sum-risk", fmt(shortQty) + " 개");
    set("#ops-sum-wpend", fmt(pendingQty) + " 개");
    const retailDoneQty = rows.reduce((a, r) => a + Number(r.retailDoneQty || 0), 0);
    set("#ops-sum-retail", fmt(retailDoneQty) + " 개");
  }

  function processGridRows(rows) {
    let list = [...(rows || [])];
    if (pageFilter === "risk") {
      list = list.filter((r) => {
        const after = r.afterShip != null ? r.afterShip : Number(r.stockTotal || 0) - Number(r.demand || 0);
        return r.isRisk || after < 0;
      });
    } else if (pageFilter === "pending") {
      list = list.filter((r) => Number(r.demand || 0) > 0);
    } else if (pageFilter === "inbound") {
      list = list.filter((r) => Number(r.inboundQty || 0) > 0);
    } else if (pageFilter === "retailDone") {
      list = list.filter((r) => Number(r.retailDoneQty || 0) > 0);
    }
    if (pageMinusOnly) {
      list = list.filter((r) => {
        const after = r.afterShip != null ? r.afterShip : Number(r.stockTotal || 0) - Number(r.demand || 0);
        return after < 0;
      });
    }
    const key = pageSortKey || "productName";
    const dir = pageSortDir === "desc" ? -1 : 1;
    list.sort((a, b) => {
      let av = a[key];
      let bv = b[key];
      if (key === "stockOther") {
        av = a.stockOther != null ? a.stockOther : Number(a.stockTplIcn || 0) + Number(a.stockHqB || 0) + Number(a.stockEcW || 0);
        bv = b.stockOther != null ? b.stockOther : Number(b.stockTplIcn || 0) + Number(b.stockHqB || 0) + Number(b.stockEcW || 0);
      }
      if (key === "afterShip") {
        av = a.afterShip != null ? a.afterShip : Number(a.stockTotal || 0) - Number(a.demand || 0);
        bv = b.afterShip != null ? b.afterShip : Number(b.stockTotal || 0) - Number(b.demand || 0);
      }
      if (typeof av === "string" || typeof bv === "string") {
        return String(av || "").localeCompare(String(bv || ""), "ko") * dir;
      }
      return (Number(av) - Number(bv)) * dir;
    });
    return list;
  }

  function filterQuery() {
    return ($("#ops-sku-search")?.value || "").trim().toLowerCase();
  }

  function matchQ(row, q) {
    if (!q) return true;
    return (
      String(row.sku || "").toLowerCase().includes(q) ||
      String(row.productName || "").toLowerCase().includes(q) ||
      String(row.vendor || "").toLowerCase().includes(q) ||
      String(row.channel || "").toLowerCase().includes(q)
    );
  }

  function renderGridTab(snap) {
    const body = $("#ops-sku-grid-body");
    if (!body) return;
    const q = filterQuery();
    const rows = processGridRows(snap.grid || []).filter((r) => matchQ(r, q));
    const fmt = (n) => Number(n || 0).toLocaleString();
    body.innerHTML = rows.length
      ? rows
          .map(function (r) {
            const after = r.afterShip != null ? r.afterShip : num(r.stockTotal) - num(r.demand);
            const afterRisk = after < 0;
            const mainRisk = r.isRisk;
            const rowCls = afterRisk || mainRisk ? ' class="ops-row-risk"' : "";
            let actionHtml = '<span class="ops-action-idle">—</span>';
            if (r.action === "ship") {
              actionHtml =
                '<button type="button" class="primary ops-action-btn" data-ops-ship="' +
                esc(r.sku) +
                '" data-qty="' +
                esc(r.demand) +
                '">출고 지시</button>';
            } else if (r.action === "transfer") {
              const { from, qty } = Eng.getTransferProposal(r);
              actionHtml =
                '<button type="button" class="secondary ops-action-btn" data-ops-transfer="' +
                esc(r.sku) +
                '" data-qty="' +
                qty +
                '" data-from="' +
                esc(from) +
                '">재고 이동 요청</button>';
            } else if (r.action === "wait") {
              actionHtml = '<span class="tag orange">이동 대기</span>';
            }
            return (
              "<tr" +
              rowCls +
              ">" +
              "<td><button type=\"button\" class=\"ops-product-link\" data-ops-product=\"" +
              esc(r.sku) +
              "\">" +
              esc(r.productName) +
              " ›</button><br><small>" +
              esc(r.sku) +
              "</small></td>" +
              "<td><strong>" +
              fmt(r.demand) +
              "</strong>" +
              (r.channels ? '<br><small class="ops-muted">' + esc(r.channels) + "</small>" : "") +
              "</td>" +
              "<td><strong>" +
              fmt(r.retailDoneQty || 0) +
              "</strong>" +
              (num(r.retailPendingQty) ? '<br><small class="ops-muted">대기 ' + fmt(r.retailPendingQty) + "</small>" : "") +
              "</td>" +
              "<td><strong>" +
              fmt(r.stockTotal) +
              "</strong></td>" +
              "<td" +
              (mainRisk ? ' class="ops-stock-risk"' : "") +
              "><strong>" +
              fmt(r.stockMain) +
              "</strong></td>" +
              "<td>" +
              fmt(r.stockOther != null ? r.stockOther : num(r.stockTplIcn) + num(r.stockHqB) + num(r.stockEcW)) +
              "</td>" +
              "<td" +
              (afterRisk ? ' class="ops-stock-risk"' : "") +
              "><strong>" +
              fmt(after) +
              "</strong></td>" +
              "<td>" +
              (r.inboundDate ? esc(r.inboundDate) : "—") +
              "</td>" +
              "<td>" +
              (r.inboundQty ? fmt(r.inboundQty) : "—") +
              "</td>" +
              '<td class="ops-action-cell">' +
              actionHtml +
              "</td>" +
              "</tr>"
            );
          })
          .join("")
      : '<tr><td colspan="10" class="inventory-empty">표시할 SKU가 없습니다.</td></tr>';
  }

  function num(v) {
    const n = Number(String(v ?? "").replace(/,/g, "").replace(/[^\d.-]/g, ""));
    return Number.isFinite(n) ? n : 0;
  }

  /** 품목별 창고존 재고 — 가로로 존 컬럼 */
  function renderZoneTab(snap) {
    const head = $("#ops-zone-head");
    const body = $("#ops-zone-body");
    if (!body) return;
    const zones = snap.zones || [];
    const q = filterQuery();
    if (head) {
      head.innerHTML =
        "<tr><th>상품 (SKU)</th>" +
        zones.map((z) => "<th>" + esc(z.name) + "</th>").join("") +
        "<th>합계</th><th>요구량</th><th>여유(메인-요구)</th></tr>";
    }
    const rows = (snap.grid || []).filter((r) => matchQ(r, q));
    body.innerHTML = rows.length
      ? rows
          .map(function (r) {
            const cells = zones
              .map(function (z) {
                const v = numStock(r, z.code);
                const risk = z.code === "MAIN" && r.isRisk;
                return "<td" + (risk ? ' class="ops-stock-risk"' : "") + ">" + fmt(v) + "</td>";
              })
              .join("");
            const gap = r.stockMain - r.demand;
            return (
              "<tr" +
              (r.isRisk ? ' class="ops-row-risk"' : "") +
              "><td><strong>" +
              esc(r.productName) +
              "</strong><br><small>" +
              esc(r.sku) +
              "</small></td>" +
              cells +
              "<td><strong>" +
              fmt(r.stockTotal) +
              "</strong></td><td>" +
              fmt(r.demand) +
              "</td><td" +
              (gap < 0 ? ' class="ops-stock-risk"' : "") +
              ">" +
              fmt(gap) +
              "</td></tr>"
            );
          })
          .join("")
      : '<tr><td colspan="10" class="inventory-empty">데이터 없음</td></tr>';
  }

  function numStock(row, code) {
    if (code === "MAIN") return row.stockMain;
    if (code === "TPL_ICN") return row.stockTplIcn;
    if (code === "HQ_B") return row.stockHqB;
    if (code === "EC_W") return row.stockEcW;
    return (row.stockByZone && row.stockByZone[code]) || 0;
  }

  function renderWholesaleTab(snap) {
    const body = $("#ops-wholesale-body");
    if (!body) return;
    const q = filterQuery();
    const rows = (snap.wholesalePending || []).filter((r) => matchQ(r, q));
    body.innerHTML = rows.length
      ? rows
          .map(function (r) {
            return (
              "<tr><td>" +
              esc(r.orderNo) +
              "</td><td><strong>" +
              esc(r.productName) +
              "</strong><br><small>" +
              esc(r.sku) +
              "</small></td><td><strong>" +
              esc(maskVendorName(r.vendor)) +
              "</strong></td><td>" +
              fmt(r.qty) +
              "</td><td>" +
              esc(r.warehouse) +
              "</td><td>" +
              statusPill(r.status) +
              "</td><td>" +
              esc(r.requestedAt) +
              "</td></tr>"
            );
          })
          .join("")
      : '<tr><td colspan="7" class="inventory-empty">도매 출고대기 건이 없습니다.</td></tr>';

    const doneBody = $("#ops-wholesale-done-body");
    if (doneBody) {
      const done = (snap.wholesaleDone || []).filter((r) => matchQ(r, q));
      doneBody.innerHTML = done.length
        ? done
            .map(function (r) {
              return (
                "<tr><td>" +
                esc(r.orderNo) +
                "</td><td><strong>" +
                esc(r.productName) +
                "</strong><br><small>" +
                esc(r.sku) +
                "</small></td><td>" +
                esc(maskVendorName(r.vendor)) +
                "</td><td>" +
                fmt(r.qty) +
                "</td><td>" +
                esc(r.warehouse) +
                "</td><td>" +
                statusPill(r.status) +
                "</td><td>" +
                esc(r.shippedAt) +
                "</td></tr>"
              );
            })
            .join("")
        : '<tr><td colspan="7" class="inventory-empty">최근 도매 출고완료 내역이 없습니다.</td></tr>';
    }
  }

  function renderRetailTab(snap) {
    const body = $("#ops-retail-body");
    if (!body) return;
    const q = filterQuery();
    const rows = (snap.retailAll || []).filter((r) => matchQ(r, q));
    body.innerHTML = rows.length
      ? rows
          .map(function (r) {
            return (
              "<tr><td>" +
              esc(r.orderNo) +
              "</td><td><strong>" +
              esc(r.productName) +
              "</strong><br><small>" +
              esc(r.sku) +
              "</small></td><td>" +
              fmt(r.qty) +
              "</td><td>" +
              esc(r.channel) +
              "</td><td>" +
              esc(r.courier) +
              "<br><small class=\"ops-muted\">" +
              esc(r.trackingNo) +
              "</small></td><td>" +
              statusPill(r.status) +
              "</td><td>" +
              esc(r.shippedAt) +
              "</td></tr>"
            );
          })
          .join("")
      : '<tr><td colspan="7" class="inventory-empty">택배 출고 내역이 없습니다.</td></tr>';
  }

  function showTab(tab) {
    activeTab = tab || "grid";
    document.querySelectorAll("[data-ops-tab]").forEach((btn) => {
      btn.classList.toggle("ops-tab-active", btn.getAttribute("data-ops-tab") === activeTab);
    });
    document.querySelectorAll("[data-ops-panel]").forEach((panel) => {
      panel.hidden = panel.getAttribute("data-ops-panel") !== activeTab;
    });
    if (lastSnap) renderActiveTab(lastSnap);
  }

  function renderActiveTab(snap) {
    if (activeTab === "grid") renderGridTab(snap);
    else if (activeTab === "zone") renderZoneTab(snap);
    else if (activeTab === "wholesale") renderWholesaleTab(snap);
    else if (activeTab === "retail") renderRetailTab(snap);
  }

  async function renderOpsDashboard() {
    const rootEl = $("#ops");
    if (!rootEl) return;
    const statusEl = $("#ops-status");
    if (statusEl) statusEl.textContent = "데이터를 취합하는 중…";

    let snap;
    try {
      snap = await Eng.loadSnapshot();
    } catch (e) {
      if (statusEl) statusEl.textContent = "로드 실패: " + (e.message || e);
      return;
    }
    lastSnap = snap;

    const src =
      snap.source === "live" ? "실연동" : snap.source === "live+demo" ? "실연동+데모" : "데모 데이터";
    if (statusEl) {
      statusEl.textContent =
        src +
        " · 갱신 " +
        (snap.generatedAt || "-") +
        " · 품목×창고 / 도매출고 / 택배 취합" +
        (snap.note ? " · " + snap.note : "");
    }

    setSummary(snap);
    showTab(activeTab);

    const adminPanel = $("#ops-admin-api-panel");
    if (adminPanel) adminPanel.hidden = !isAdminMode();
    fillAdminForm();
  }

  function fillAdminForm() {
    const cfg = Eng.loadConfig();
    const set = (id, v) => {
      const el = $(id);
      if (el && el.value !== undefined) el.value = v || "";
    };
    const setChk = (id, v) => {
      const el = $(id);
      if (el) el.checked = Boolean(v);
    };
    setChk("#ops-ecount-enabled", cfg.ecount && cfg.ecount.enabled);
    set("#ops-ecount-zone", cfg.ecount && cfg.ecount.zone);
    set("#ops-ecount-com", cfg.ecount && cfg.ecount.comCode);
    set("#ops-ecount-user", cfg.ecount && cfg.ecount.userId);
    set("#ops-ecount-key", cfg.ecount && cfg.ecount.apiCertKey);
    set("#ops-ecount-proxy", cfg.ecount && cfg.ecount.proxyUrl);
    setChk("#ops-courier-enabled", cfg.courier && cfg.courier.enabled);
    set("#ops-courier-provider", cfg.courier && cfg.courier.provider);
    set("#ops-courier-key", cfg.courier && cfg.courier.apiKey);
    set("#ops-courier-proxy", cfg.courier && cfg.courier.apiUrl);
    setChk("#ops-tpl-enabled", cfg.tpl && cfg.tpl.enabled);
    set("#ops-tpl-provider", cfg.tpl && cfg.tpl.provider);
    set("#ops-tpl-key", cfg.tpl && cfg.tpl.apiKey);
    set("#ops-tpl-proxy", cfg.tpl && cfg.tpl.apiUrl);
    setChk("#ops-use-demo", cfg.useDemo !== false);
  }

  function saveAdminForm() {
    if (!isAdminMode()) {
      toast("관리자 모드에서만 API 설정을 저장할 수 있습니다.");
      return;
    }
    const cfg = Eng.loadConfig();
    cfg.ecount = {
      ...cfg.ecount,
      enabled: Boolean($("#ops-ecount-enabled")?.checked),
      zone: $("#ops-ecount-zone")?.value?.trim() || "",
      comCode: $("#ops-ecount-com")?.value?.trim() || "",
      userId: $("#ops-ecount-user")?.value?.trim() || "",
      apiCertKey: $("#ops-ecount-key")?.value?.trim() || "",
      proxyUrl: $("#ops-ecount-proxy")?.value?.trim() || "",
    };
    cfg.courier = {
      ...cfg.courier,
      enabled: Boolean($("#ops-courier-enabled")?.checked),
      provider: $("#ops-courier-provider")?.value?.trim() || "",
      apiKey: $("#ops-courier-key")?.value?.trim() || "",
      apiUrl: $("#ops-courier-proxy")?.value?.trim() || "",
    };
    cfg.tpl = {
      ...cfg.tpl,
      enabled: Boolean($("#ops-tpl-enabled")?.checked),
      provider: $("#ops-tpl-provider")?.value?.trim() || "",
      apiKey: $("#ops-tpl-key")?.value?.trim() || "",
      apiUrl: $("#ops-tpl-proxy")?.value?.trim() || "",
    };
    cfg.useDemo = Boolean($("#ops-use-demo")?.checked);
    cfg.lastSyncAt = new Date().toISOString();
    Eng.saveConfig(cfg);
    toast("API 설정을 저장했습니다.");
    renderOpsDashboard();
  }

  function bindEvents() {
    document.addEventListener("click", function (e) {
      const t = e.target;
      if (!t) return;
      if (t.closest && t.closest("[data-ops-modal-close]")) {
        closeProductModal();
        return;
      }
      const modalTab = t.closest && t.closest(".ops-modal-tab");
      if (modalTab) {
        const key = modalTab.getAttribute("data-ops-modal-tab");
        document.querySelectorAll(".ops-modal-tab").forEach(function (btn) {
          btn.classList.toggle("is-active", btn === modalTab);
        });
        document.querySelectorAll("[data-ops-modal-panel]").forEach(function (p) {
          p.hidden = p.getAttribute("data-ops-modal-panel") !== key;
        });
        return;
      }
      const prod = t.closest && t.closest("[data-ops-product]");
      if (prod) {
        openProductModal(prod.getAttribute("data-ops-product"));
        return;
      }
      if (t.id === "ops-refresh-btn") return void renderOpsDashboard();
      if (t.id === "ops-save-api-btn") return void saveAdminForm();
      if (t.id === "ops-force-demo-btn") {
        const cfg = Eng.loadConfig();
        cfg.useDemo = true;
        Eng.saveConfig(cfg);
        toast("데모 데이터 표시");
        return void renderOpsDashboard();
      }
      const tab = t.getAttribute && t.getAttribute("data-ops-tab");
      if (tab) return void showTab(tab);

      const pageFilterBtn = t.closest && t.closest("[data-ops-page-filter]");
      if (pageFilterBtn) {
        pageFilter = pageFilterBtn.getAttribute("data-ops-page-filter") || "all";
        document.querySelectorAll("[data-ops-page-filter]").forEach(function (btn) {
          btn.classList.toggle("is-active", btn === pageFilterBtn);
        });
        if (lastSnap) renderActiveTab(lastSnap);
        return;
      }
      const pageSortBtn = t.closest && t.closest("[data-ops-page-sort]");
      if (pageSortBtn) {
        const key = pageSortBtn.getAttribute("data-ops-page-sort");
        if (pageSortKey === key) pageSortDir = pageSortDir === "asc" ? "desc" : "asc";
        else {
          pageSortKey = key;
          pageSortDir = "asc";
        }
        document.querySelectorAll("[data-ops-page-sort]").forEach(function (btn) {
          btn.classList.remove("is-asc", "is-desc");
          if (btn.getAttribute("data-ops-page-sort") === pageSortKey) {
            btn.classList.add(pageSortDir === "asc" ? "is-asc" : "is-desc");
          }
        });
        if (lastSnap) renderActiveTab(lastSnap);
        return;
      }

      const shipSku = t.getAttribute && t.getAttribute("data-ops-ship");
      if (shipSku) {
        const qty = t.getAttribute("data-qty") || 0;
        if (!confirm("SKU " + shipSku + "\n출고 지시 " + qty + "개 (데모)")) return;
        toast(Eng.requestShip(shipSku, qty).message);
        return;
      }
      const trSku = t.getAttribute && t.getAttribute("data-ops-transfer");
      if (trSku) {
        const qty = t.getAttribute("data-qty") || 0;
        const from = t.getAttribute("data-from") || "타창고";
        if (!confirm(from + " → 메인창고 이동 요청 " + qty + "개")) return;
        try {
          Eng.requestTransfer(trSku, qty, from);
          toast("재고 이동 요청 완료");
          renderOpsDashboard();
        } catch (error) {
          toast(error.message || "재고 이동 요청 실패");
        }
      }
    });

    let searchTimer;
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape") closeProductModal();
    });

    document.addEventListener("change", function (e) {
      if (e.target && e.target.id === "ops-minus-only") {
        pageMinusOnly = Boolean(e.target.checked);
        if (lastSnap) renderActiveTab(lastSnap);
      }
    });

    document.addEventListener("input", function (e) {
      if (e.target && e.target.id === "ops-sku-search") {
        clearTimeout(searchTimer);
        searchTimer = setTimeout(() => {
          if (lastSnap) renderActiveTab(lastSnap);
        }, 120);
      }
    });
  }


  function openProductModal(sku) {
    if (!Eng.getProductDetail) return;
    Eng.getProductDetail(sku).then(function (detail) {
      if (!detail || !detail.row) {
        toast("상품 상세를 찾을 수 없습니다.");
        return;
      }
      const row = detail.row;
      const modal = $("#ops-product-modal");
      if (!modal) return;
      const fmt = (n) => Number(n || 0).toLocaleString();
      const other = row.stockOther != null ? row.stockOther : num(row.stockTplIcn) + num(row.stockHqB) + num(row.stockEcW);
      const after = row.afterShip != null ? row.afterShip : num(row.stockTotal) - num(row.demand);

      $("#ops-modal-title").textContent = row.productName || sku;
      $("#ops-modal-meta").textContent = "SKU: " + (row.sku || "") + (row.category ? " · " + row.category : "");

      const stats = $("#ops-modal-stats");
      stats.innerHTML =
        '<div class="ops-modal-stat"><span>전체 현재고</span><b>' + fmt(row.stockTotal) + ' 개</b></div>' +
        '<div class="ops-modal-stat"><span>메인창고 재고</span><b>' + fmt(row.stockMain) + ' 개</b></div>' +
        '<div class="ops-modal-stat"><span>기타창고 재고</span><b>' + fmt(other) + ' 개</b></div>' +
        '<div class="ops-modal-stat risk"><span>출고대기 수량</span><b>' + fmt(row.demand) + ' 개</b></div>' +
        '<div class="ops-modal-stat"><span>출고 후 예상재고</span><b' + (after < 0 ? ' style="color:#c73c35"' : '') + '>' + fmt(after) + ' 개</b></div>' +
        '<div class="ops-modal-stat"><span>입고예정일</span><b>' + esc(row.inboundDate || "—") + '</b></div>' +
        '<div class="ops-modal-stat"><span>입고예정 수량</span><b>' + (row.inboundQty ? fmt(row.inboundQty) + " 개" : "—") + '</b></div>';

      const slips = detail.slips || [];
      const slipsBody = $("#ops-modal-slips-body");
      let sum = 0;
      slipsBody.innerHTML = slips.length
        ? slips.map(function (s) {
            sum += num(s.qty);
            return (
              "<tr><td>" + esc(s.account) + "</td><td>" + esc(s.slipNo) + "</td><td>" +
              esc(maskVendorName(s.vendor)) + "</td><td><strong>" + fmt(s.qty) + "</strong></td></tr>"
            );
          }).join("")
        : '<tr><td colspan="4" class="inventory-empty">출고대기 전표가 없습니다.</td></tr>';
      const sumEl = $("#ops-modal-slips-sum");
      if (sumEl) sumEl.innerHTML = "<strong style='color:#c73c35'>" + fmt(sum) + " 개</strong>";

      const stockBody = $("#ops-modal-stock-body");
      const zones = [
        ["메인창고", row.stockMain],
        ["3PL-가상센터", row.stockTplIcn],
        ["보조창고", row.stockHqB],
        ["이카운트도매", row.stockEcW],
      ];
      stockBody.innerHTML = zones
        .map(function (z) {
          return "<tr><td>" + esc(z[0]) + "</td><td><strong>" + fmt(z[1]) + "</strong></td></tr>";
        })
        .join("");

      const inboundBody = $("#ops-modal-inbound-body");
      const inbound = detail.inbound || [];
      inboundBody.innerHTML = inbound.length
        ? inbound
            .map(function (line) {
              return (
                "<tr><td>" +
                esc(line.date || "—") +
                "</td><td><strong>" +
                fmt(line.qty) +
                "</strong></td><td>" +
                esc(line.source || "—") +
                "</td><td>" +
                esc(line.note || "") +
                "</td></tr>"
              );
            })
            .join("")
        : '<tr><td colspan="4" class="inventory-empty">입고예정 내역이 없습니다.</td></tr>';

      // reset tab
      document.querySelectorAll(".ops-modal-tab").forEach(function (t) {
        t.classList.toggle("is-active", t.getAttribute("data-ops-modal-tab") === "slips");
      });
      document.querySelectorAll("[data-ops-modal-panel]").forEach(function (p) {
        p.hidden = p.getAttribute("data-ops-modal-panel") !== "slips";
      });

      modal.hidden = false;
      document.body.style.overflow = "hidden";
    });
  }

  function closeProductModal() {
    const modal = $("#ops-product-modal");
    if (modal) modal.hidden = true;
    document.body.style.overflow = "";
  }

  function num(v) {
    const n = Number(String(v ?? "").replace(/,/g, "").replace(/[^\d.-]/g, ""));
    return Number.isFinite(n) ? n : 0;
  }


  root.OpsDashboardUI = {
    render: renderOpsDashboard,
    init: bindEvents,
    openProductModal: openProductModal,
    closeProductModal: closeProductModal,
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", bindEvents);
  } else {
    bindEvents();
  }
})(typeof window !== "undefined" ? window : globalThis);
