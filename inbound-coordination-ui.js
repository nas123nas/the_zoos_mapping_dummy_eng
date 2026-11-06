/**
 * THE ZOOS 입고조정 협의 UI
 * - index.html 에 정적 메뉴/페이지 있음 (data-page="coordination")
 * - 앞당겨진 품목은 협의보드 페이지 하단에 함께 표시
 * - 데모 데이터 없음
 */
(function (root) {
  "use strict";

  if (!root.InboundCoordinationEngine) {
    console.error("[InboundCoordinationUI] InboundCoordinationEngine 이 먼저 로드되어야 합니다.");
    return;
  }

  const Eng = root.InboundCoordinationEngine;
  const InboundTable = root.InboundTableEngine || null;

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
  function notifyDashboardCoordRefresh() {
    try {
      if (typeof root.renderDashboardCoordinationList === "function") {
        root.renderDashboardCoordinationList();
      }
      if (typeof root.refreshDashboardSideSummaries === "function") {
        root.refreshDashboardSideSummaries(root.currentInventoryDashboardSummary || null);
      }
    } catch (e) {
      console.warn("[coord] dashboard refresh", e);
    }
  }

  function toast(msg) {
    if (typeof root.showToast === "function") {
      root.showToast(msg);
      return;
    }
    const el = document.createElement("div");
    el.className = "coord-toast";
    el.textContent = msg;
    el.style.cssText =
      "position:fixed;right:20px;bottom:20px;z-index:100;background:#111;color:#fff;padding:12px 16px;border-radius:10px;font-size:13px";
    document.body.appendChild(el);
    setTimeout(() => el.remove(), 2600);
  }
  function cleanSearch(v) {
    return String(v || "").trim();
  }


  function ensureStatusFilter() {
    if ($("#coord-status-filter")) return;
    const host = $("#coord-pending-only") && $("#coord-pending-only").closest("label");
    if (!host || !host.parentElement) return;
    const wrap = document.createElement("label");
    wrap.style.cssText = "font-size:12px;display:flex;align-items:center;gap:6px;margin-left:12px";
    wrap.innerHTML = '상태 <select id="coord-status-filter" style="padding:5px 8px;border:1px solid #e5e7eb;border-radius:7px;font:inherit;font-size:12px"><option value="all">전체</option><option value="open">회신대기만</option><option value="done">업체조율확정·입고완료</option><option value="업체조율확정">업체조율확정</option><option value="입고완료">입고완료</option></select>';
    host.parentElement.appendChild(wrap);
  }

  function ensureNavIfMissing() {
    if ($('[data-page="coordination"]')) return;
    const soldout = $('[data-page="soldout"]');
    if (!soldout) return;
    const btn = document.createElement("button");
    btn.className = "nav-item nav-child";
    btn.type = "button";
    btn.dataset.page = "coordination";
    btn.textContent = "입고조정 협의보드";
    soldout.insertAdjacentElement("afterend", btn);
    btn.addEventListener("click", () => {
      if (typeof root.openPage === "function") root.openPage("coordination");
      else openPageFallback("coordination");
      renderAll();
    });
  }

  function openPageFallback(page) {
    document.querySelectorAll(".page").forEach((el) => el.classList.toggle("active", el.id === page));
    document.querySelectorAll(".nav-item").forEach((el) => el.classList.toggle("active", el.dataset.page === page));
  }

  function getScheduleRowsFromApp() {
    if (typeof root.getInboundScheduleRows === "function") return root.getInboundScheduleRows() || [];
    if (root.stockScheduleCache && Array.isArray(root.stockScheduleCache)) return root.stockScheduleCache;
    return [];
  }

  function renderCoordinationBoard() {
    const body = $("#coord-body");
    const countEl = $("#coord-count");
    if (!body) return;

    const q = cleanSearch($("#coord-search")?.value);
    const pendingOnly = $("#coord-pending-only")?.checked;
    const statusFilter = ($("#coord-status-filter")?.value || "all");
    let logs = Eng.getAllLogs();
    if (q) {
      const nq = q.replace(/\s+/g, "").toLowerCase();
      logs = logs.filter((r) => {
        const blob = [r.barcode, r.productName, r.vendor, r.reqContent, r.reply, r.requester, r.memo, r.status]
          .join("")
          .replace(/\s+/g, "")
          .toLowerCase();
        return blob.includes(nq);
      });
    }
    if (pendingOnly) logs = logs.filter((r) => !r.confirmedDate || !r.reply);
    if (statusFilter === "open") logs = logs.filter((r) => (r.status || "회신대기") === "회신대기");
    if (statusFilter === "done") logs = logs.filter((r) => r.status === "업체조율확정" || r.status === "입고완료");
    if (statusFilter === "업체조율확정") logs = logs.filter((r) => r.status === "업체조율확정");
    if (statusFilter === "입고완료") logs = logs.filter((r) => r.status === "입고완료");

    if (countEl) countEl.textContent = logs.length + "건";
    if (!logs.length) {
      body.innerHTML = '<tr><td colspan="11" class="inventory-empty">조건에 맞는 협의 내역이 없습니다.</td></tr>';
      return;
    }

    body.innerHTML = logs
      .map(function (r) {
        const st = r.status || "회신대기";
        const typeBadge =
          r.type === "앞당김"
            ? '<span class="tag green">앞당김</span>'
            : r.type === "지연"
            ? '<span class="tag red">지연</span>'
            : '<span class="tag orange">' + esc(r.type || "기타") + "</span>";
        const conf = r.confirmedDate
          ? '<strong style="color:#047857">' + esc(r.confirmedDate) + "</strong>"
          : '<span style="color:#94a3b8">미확정</span>';
        const statusBadge =
          st === "입고완료"
            ? '<span class="tag green">입고완료</span>'
            : st === "업체조율확정"
            ? '<span class="tag orange">업체조율확정</span>'
            : '<span class="tag">회신대기</span>';
        const rowClass = st === "입고완료" || st === "업체조율확정" ? ' class="coord-row-done"' : "";
        return (
          "<tr data-coord-id=\"" + esc(r.id) + "\"" + rowClass + ">" +
          "<td>" + esc(r.reqDate || "-") + "</td>" +
          "<td><strong>" + esc(r.productName || "(상품명 없음)") + "</strong><br><small>" + esc(r.barcode) + "</small></td>" +
          "<td>" + esc(r.vendor || "-") + "</td>" +
          '<td style="max-width:220px;white-space:normal;font-size:12.5px">' + esc(r.reqContent || "-") + "</td>" +
          '<td style="max-width:180px;white-space:normal;font-size:12.5px">' + esc(r.reply || "회신 대기") + "</td>" +
          "<td>" + conf + "</td>" +
          "<td>" + typeBadge + "</td>" +
          '<td style="max-width:160px;white-space:normal;font-size:12.5px">' + esc(r.memo || "-") + "</td>" +
          "<td>" + statusBadge + "</td>" +
          "<td>" + esc(r.requester || "-") + "</td>" +
          '<td class="coord-actions">' +
          '<button type="button" class="secondary" style="padding:4px 8px;font-size:11px" data-coord-edit="' + esc(r.id) + '">수정</button> ' +
          (st !== "업체조율확정" ? '<button type="button" class="secondary" style="padding:4px 8px;font-size:11px" data-coord-status="' + esc(r.id) + '" data-status="업체조율확정">업체조율확정</button> ' : "") +
          (st !== "입고완료" ? '<button type="button" class="primary" style="padding:4px 8px;font-size:11px" data-coord-status="' + esc(r.id) + '" data-status="입고완료">입고완료</button> ' : "") +
          (st !== "회신대기" ? '<button type="button" class="secondary" style="padding:4px 8px;font-size:11px" data-coord-status="' + esc(r.id) + '" data-status="회신대기">회신대기</button> ' : "") +
          '<button type="button" class="secondary" style="padding:4px 8px;font-size:11px;color:#c73c35" data-coord-del="' + esc(r.id) + '">삭제</button>' +
          "</td></tr>"
        );
      })
      .join("");

    ensureCoordTableControls();
  }

  function renderAdvancedList() {
    const body = $("#advanced-body");
    const countEl = $("#advanced-count");
    if (!body) return;

    const scheduleRows = getScheduleRowsFromApp();
    let items = Eng.getAdvancedInboundItems(scheduleRows, InboundTable);
    const q = cleanSearch($("#advanced-search")?.value);
    if (q) {
      const nq = q.replace(/\s+/g, "").toLowerCase();
      items = items.filter(function (r) {
        const name = String(r.상품명 || r.제품명 || "").toLowerCase();
        const bc = String(r.바코드 || r.barcode || "").toLowerCase();
        return name.includes(nq) || bc.includes(nq);
      });
    }
    if (countEl) countEl.textContent = items.length + "건";
    if (!items.length) {
      body.innerHTML =
        '<tr><td colspan="8" class="inventory-empty">앞당겨진 입고 내역이 없습니다. (확정일 &lt; 원본 예정일)</td></tr>';
      return;
    }
    body.innerHTML = items
      .map(function (r) {
        const name = esc(r.상품명 || r.제품명 || "-");
        const bc = esc(r.바코드 || r.barcode || "");
        const diff = r._diffDays != null ? r._diffDays + "일" : "-";
        const status =
          r._latestLog && r._latestLog.confirmedDate
            ? '<span class="tag green">앞당김 확정</span>'
            : '<span class="tag orange">협의중</span>';
        return (
          "<tr><td><strong>" +
          name +
          "</strong></td><td>" +
          bc +
          "</td><td>" +
          esc(r._plannedDate || "-") +
          '</td><td><strong style="color:#047857">' +
          esc(r._confirmedDate || "-") +
          '</strong></td><td><span class="tag green">' +
          esc(diff) +
          "</span></td><td>" +
          esc(r._vendor || "-") +
          '</td><td style="max-width:240px;white-space:normal;font-size:12.5px">' +
          esc(r._replySummary || "-") +
          "</td><td>" +
          status +
          "</td></tr>"
        );
      })
      .join("");
  }


  var coordTableController = null;
  function ensureCoordTableControls() {
    const table = $("#coord-body") && $("#coord-body").closest("table");
    if (!table || !root.TableControls || !root.TableControls.createTableController) return;
    if (table.dataset.coordControls === "1") return;
    table.dataset.coordControls = "1";
    try {
      coordTableController = root.TableControls.createTableController({
        table: table,
        tableKey: "coordination",
        storage: root.localStorage,
      });
    } catch (e) {
      console.warn("[coord] table controls", e);
    }
  }

  function renderAll() {
    renderCoordinationBoard();
    renderAdvancedList();
    notifyDashboardCoordRefresh();
  }

  function openCoordForm(existing) {
    const isEdit = Boolean(existing && existing.id);
    const overlay = document.createElement("div");
    overlay.style.cssText =
      "position:fixed;inset:0;background:rgba(15,23,42,.5);z-index:80;display:flex;align-items:center;justify-content:center;padding:16px";
    overlay.innerHTML =
      '<div style="background:#fff;border-radius:12px;width:min(560px,100%);max-height:90vh;overflow:auto;padding:20px">' +
      '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px">' +
      "<h3 style=\"margin:0;font-size:18px\">" +
      (isEdit ? "협의 기록 수정" : "협의 기록 추가") +
      '</h3><button type="button" data-close style="border:0;background:#f3f4f6;width:32px;height:32px;border-radius:50%;font-size:18px;cursor:pointer">×</button></div>' +
      '<form id="coord-form" style="display:grid;gap:10px">' +
      '<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">' +
      '<label style="font-size:12px;font-weight:700;color:#64748b">바코드 *<input name="barcode" required value="' +
      esc(existing && existing.barcode ? existing.barcode : "") +
      '" style="display:block;width:100%;margin-top:4px;padding:8px;border:1px solid #e5e7eb;border-radius:8px" /></label>' +
      '<label style="font-size:12px;font-weight:700;color:#64748b">상품명<input name="productName" value="' +
      esc(existing && existing.productName ? existing.productName : "") +
      '" style="display:block;width:100%;margin-top:4px;padding:8px;border:1px solid #e5e7eb;border-radius:8px" /></label></div>' +
      '<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">' +
      '<label style="font-size:12px;font-weight:700;color:#64748b">업체<input name="vendor" value="' +
      esc(existing && existing.vendor ? existing.vendor : "") +
      '" style="display:block;width:100%;margin-top:4px;padding:8px;border:1px solid #e5e7eb;border-radius:8px" /></label>' +
      '<label style="font-size:12px;font-weight:700;color:#64748b">요청자<input name="requester" value="' +
      esc(existing && existing.requester ? existing.requester : "") +
      '" style="display:block;width:100%;margin-top:4px;padding:8px;border:1px solid #e5e7eb;border-radius:8px" /></label></div>' +
      '<label style="font-size:12px;font-weight:700;color:#64748b">요청내용 *<textarea name="reqContent" required rows="2" style="display:block;width:100%;margin-top:4px;padding:8px;border:1px solid #e5e7eb;border-radius:8px;font:inherit">' +
      esc(existing && existing.reqContent ? existing.reqContent : "") +
      "</textarea></label>" +
      '<div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:10px">' +
      '<label style="font-size:12px;font-weight:700;color:#64748b">요청일<input name="reqDate" type="date" value="' +
      esc(existing && existing.reqDate ? existing.reqDate : "") +
      '" style="display:block;width:100%;margin-top:4px;padding:8px;border:1px solid #e5e7eb;border-radius:8px" /></label>' +
      '<label style="font-size:12px;font-weight:700;color:#64748b">요청기한<input name="dueDate" type="date" value="' +
      esc(existing && existing.dueDate ? existing.dueDate : "") +
      '" style="display:block;width:100%;margin-top:4px;padding:8px;border:1px solid #e5e7eb;border-radius:8px" /></label>' +
      '<label style="font-size:12px;font-weight:700;color:#64748b">소통방식<input name="channel" placeholder="메일/전화/카톡" value="' +
      esc(existing && existing.channel ? existing.channel : "") +
      '" style="display:block;width:100%;margin-top:4px;padding:8px;border:1px solid #e5e7eb;border-radius:8px" /></label></div>' +
      '<label style="font-size:12px;font-weight:700;color:#64748b">업체 회신<textarea name="reply" rows="2" style="display:block;width:100%;margin-top:4px;padding:8px;border:1px solid #e5e7eb;border-radius:8px;font:inherit">' +
      esc(existing && existing.reply ? existing.reply : "") +
      "</textarea></label>" +
      '<div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:10px">' +
      '<label style="font-size:12px;font-weight:700;color:#64748b">회신일<input name="replyDate" type="date" value="' +
      esc(existing && existing.replyDate ? existing.replyDate : "") +
      '" style="display:block;width:100%;margin-top:4px;padding:8px;border:1px solid #e5e7eb;border-radius:8px" /></label>' +
      '<label style="font-size:12px;font-weight:700;color:#64748b">원본 예정일<input name="originalPlannedDate" type="date" value="' +
      esc(existing && existing.originalPlannedDate ? existing.originalPlannedDate : "") +
      '" style="display:block;width:100%;margin-top:4px;padding:8px;border:1px solid #e5e7eb;border-radius:8px" /></label>' +
      '<label style="font-size:12px;font-weight:700;color:#64748b">확정입고일<input name="confirmedDate" type="date" value="' +
      esc(existing && existing.confirmedDate ? existing.confirmedDate : "") +
      '" style="display:block;width:100%;margin-top:4px;padding:8px;border:1px solid #e5e7eb;border-radius:8px" /></label></div>' +
      '<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">' +
      '<label style="font-size:12px;font-weight:700;color:#64748b">상태<select name="status" style="display:block;width:100%;margin-top:4px;padding:8px;border:1px solid #e5e7eb;border-radius:8px"><option value="회신대기">회신대기</option><option value="업체조율확정">업체조율확정</option><option value="입고완료">입고완료</option></select></label><label style="font-size:12px;font-weight:700;color:#64748b">조정 유형<select name="type" style="display:block;width:100%;margin-top:4px;padding:8px;border:1px solid #e5e7eb;border-radius:8px"><option value="">자동 판별</option><option value="앞당김">앞당김</option><option value="지연">지연</option><option value="수량변경">수량변경</option><option value="기타">기타</option></select></label>' +
      '<label style="font-size:12px;font-weight:700;color:#64748b">메모<input name="memo" value="' +
      esc(existing && existing.memo ? existing.memo : "") +
      '" style="display:block;width:100%;margin-top:4px;padding:8px;border:1px solid #e5e7eb;border-radius:8px" /></label></div>' +
      '<div style="display:flex;gap:8px;justify-content:flex-end;margin-top:8px"><button type="button" class="secondary" data-close>취소</button><button type="submit" class="primary">' +
      (isEdit ? "저장" : "등록") +
      "</button></div></form></div>";
    document.body.appendChild(overlay);
    // 수정 시 현재 상태 선택
    const statusSelect = overlay.querySelector('select[name="status"]');
    if (statusSelect) {
      const cur = (existing && existing.status) || "회신대기";
      const normalized =
        cur === "진행중" ? "회신대기" : cur === "완료" ? "업체조율확정" : cur;
      if ([...statusSelect.options].some((o) => o.value === normalized)) {
        statusSelect.value = normalized;
      }
    }
    const close = function () {
      overlay.remove();
    };
    overlay.addEventListener("click", function (e) {
      if (e.target === overlay || e.target.closest("[data-close]")) close();
    });
    $("#coord-form", overlay).addEventListener("submit", function (e) {
      e.preventDefault();
      const data = Object.fromEntries(new FormData(e.target).entries());
      try {
        if (isEdit) Eng.updateLog(existing.id, data);
        else Eng.addLog(data);
        applyToLiveSchedule();
        close();
        renderAll();
        toast(isEdit ? "수정되었습니다." : "등록되었습니다.");
      } catch (err) {
        toast(err.message || "저장 실패");
      }
    });
  }

  function applyToLiveSchedule() {
    if (typeof root.refreshInboundSchedule === "function") {
      const schedule = getScheduleRowsFromApp();
      const applied = Eng.applyConfirmedToSchedule(schedule);
      root.refreshInboundSchedule(applied.rows);
      if (applied.appliedCount) toast("입고예정 비고(확정일) " + applied.appliedCount + "건 반영");
    }
  }

  function exportToClipboardOrXlsx() {
    const rows = Eng.exportForSheet();
    if (typeof XLSX !== "undefined") {
      const ws = XLSX.utils.aoa_to_sheet(rows);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, "입고조정협의");
      XLSX.writeFile(wb, "입고조정_협의_" + new Date().toISOString().slice(0, 10) + ".xlsx");
      toast("엑셀 파일을 내려받았습니다.");
    } else {
      const csv = rows.map(function (r) {
        return r.map(function (c) {
          return '"' + String(c).replace(/"/g, '""') + '"';
        }).join(",");
      }).join("\n");
      if (navigator.clipboard) navigator.clipboard.writeText(csv).then(function () {
        toast("클립보드에 CSV를 복사했습니다.");
      });
    }
  }

  function importExcel(file) {
    if (typeof XLSX === "undefined") {
      toast("XLSX 라이브러리가 필요합니다.");
      return;
    }
    const reader = new FileReader();
    reader.onload = function (ev) {
      try {
        const wb = XLSX.read(new Uint8Array(ev.target.result), { type: "array" });
        const sheet = wb.Sheets[wb.SheetNames[0]];
        const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: "" });
        const result = Eng.importFromRows(rows);
        toast(result.imported + "건 가져왔습니다.");
        renderAll();
        notifyDashboardCoordRefresh();
        applyToLiveSchedule();
      } catch (err) {
        console.error(err);
        toast("파일을 읽는 중 오류가 발생했습니다.");
      }
    };
    reader.readAsArrayBuffer(file);
  }

  function bindEvents() {
    document.addEventListener("click", function (e) {
      const t = e.target;
      if (t.id === "coord-add-btn" || (t.closest && t.closest("#coord-add-btn"))) openCoordForm(null);
      if (t.dataset && t.dataset.coordEdit) {
        const log = Eng.getAllLogs().find(function (r) {
          return r.id === t.dataset.coordEdit;
        });
        if (log) openCoordForm(log);
      }
      if (t.dataset && t.dataset.coordDel) {
        if (confirm("이 협의 기록을 삭제할까요?")) {
          Eng.removeLog(t.dataset.coordDel);
          applyToLiveSchedule();
          renderAll();
          toast("삭제되었습니다.");
        }
      }
      if (t.dataset && t.dataset.coordStatus) {
        const id = t.dataset.coordStatus;
        const status = t.dataset.status || "회신대기";
        Eng.updateLog(id, { status: status });
        renderAll();
        toast(
          status === "입고완료"
            ? "입고완료 처리했습니다."
            : status === "업체조율확정"
            ? "업체조율확정 처리했습니다."
            : "회신대기로 되돌렸습니다."
        );
      }
      if (t.id === "coord-export-btn") exportToClipboardOrXlsx();
      if (t.id === "coord-import-btn") {
        const input = $("#coord-file-input");
        if (input) input.click();
      }
      if (t.closest && t.closest('[data-page="coordination"]')) setTimeout(renderAll, 40);
    });

    document.addEventListener("submit", function (e) {
      if (e.target.id === "coord-search-form") {
        e.preventDefault();
        renderCoordinationBoard();
      }
      if (e.target.id === "advanced-search-form") {
        e.preventDefault();
        renderAdvancedList();
      }
    });

    document.addEventListener("change", function (e) {
      if (e.target.id === "coord-pending-only" || e.target.id === "coord-status-filter") renderCoordinationBoard();
      if (e.target.id === "coord-file-input" && e.target.files && e.target.files[0]) {
        importExcel(e.target.files[0]);
        e.target.value = "";
      }
    });
  }

  function patchOpenPage() {
    const original = root.openPage;
    if (typeof original !== "function") return;
    if (original.__coordPatched) return;
    function wrapped(page) {
      original(page);
      if (page === "coordination") renderAll();
    }
    wrapped.__coordPatched = true;
    root.openPage = wrapped;
  }

  function boot() {
    ensureNavIfMissing();
    ensureStatusFilter();
    bindEvents();
    setTimeout(patchOpenPage, 0);
    setTimeout(patchOpenPage, 400);
    setTimeout(function () {
      if ($("#coordination.page.active")) renderAll();
    }, 800);
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else setTimeout(boot, 100);

  root.InboundCoordinationUI = {
    renderAll: renderAll,
    renderCoordinationBoard: renderCoordinationBoard,
    renderAdvancedList: renderAdvancedList,
    openCoordForm: openCoordForm,
  };
})(typeof window !== "undefined" ? window : globalThis);
