/**
 * THE ZOOS 입고조정 협의 엔진
 * - 데모 데이터 없음
 * - 기존 InboundTableEngine / InboundUpdateEngine / ProductDetailEngine 과 연동
 * - localStorage 기반 저장 (WorkspaceStorage 패턴과 동일하게 확장 가능)
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.InboundCoordinationEngine = api;
})(typeof window !== "undefined" ? window : globalThis, function () {
  "use strict";

  const STORAGE_KEY = "thezoos-english-portfolio-inbound-coordination-v1";
  // 확정일 비고 컬럼명 (담당자 표기 제거). 기존 데이터 호환을 위해 구 헤더도 읽음.
  const REMARK_HEADER = "비고(확정일)";
  const REMARK_HEADER_LEGACY = "비고(확정일-담당자)";

  // ---------- 유틸 ----------
  function clean(value) {
    return value === null || value === undefined ? "" : String(value).trim();
  }

  /** 상태 정규화: 회신대기 → 업체조율확정 → 입고완료 (구버전 호환) */
  function normalizeStatus(value) {
    const s = clean(value);
    if (!s || s === "진행중") return "회신대기";
    if (s === "완료") return "업체조율확정";
    if (s === "회신대기" || s === "업체조율확정" || s === "입고완료") return s;
    return "회신대기";
  }

  function barcode(value) {
    return clean(value).replace(/\.0$/, "").replace(/\s+/g, "");
  }

  function normalizeDate(value) {
    const s = clean(value);
    if (!s) return "";
    const m = s.match(/(20\d{2})[-./년]\s*(\d{1,2})[-./월]\s*(\d{1,2})/);
    if (m) {
      return `${m[1]}-${String(Number(m[2])).padStart(2, "0")}-${String(Number(m[3])).padStart(2, "0")}`;
    }
    const short = s.match(/^(\d{1,2})[-./](\d{1,2})$/);
    if (short) {
      const y = new Date().getFullYear();
      return `${y}-${String(Number(short[1])).padStart(2, "0")}-${String(Number(short[2])).padStart(2, "0")}`;
    }
    if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
    return s;
  }

  function dateTimeIso() {
    return new Date().toISOString().slice(0, 19).replace("T", " ");
  }

  function uid() {
    return `coord_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
  }

  // ---------- 저장소 ----------
  function loadLogs() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return [];
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) return [];
      // 구버전 상태값(진행중/완료) → 신규(회신대기/업체조율확정) 자동 변환
      return parsed.map((r) => ({
        ...r,
        status: normalizeStatus(r && r.status),
      }));
    } catch (_) {
      return [];
    }
  }

  function saveLogs(logs) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(logs || []));
    } catch (e) {
      console.warn("[InboundCoordination] save failed", e);
    }
  }

  // ---------- CRUD ----------
  /**
   * @param {object} entry
   * @param {string} entry.barcode
   * @param {string} [entry.productName]
   * @param {string} [entry.vendor]
   * @param {string} [entry.reqDate] YYYY-MM-DD
   * @param {string} [entry.reqContent]
   * @param {string} [entry.dueDate]
   * @param {string} [entry.reply]
   * @param {string} [entry.replyDate]
   * @param {string} [entry.confirmedDate]  최종 확정 입고일
   * @param {string} [entry.originalPlannedDate] 조정 전 예정일
   * @param {string} [entry.type] 앞당김|지연|수량변경|기타
   * @param {string} [entry.channel] 메일|전화|카톡|미팅 등
   * @param {string} [entry.requester]
   * @param {string} [entry.memo]
   */
  function addLog(entry) {
    const logs = loadLogs();
    const now = dateTimeIso();
    const record = {
      id: uid(),
      barcode: barcode(entry.barcode),
      productName: clean(entry.productName),
      vendor: clean(entry.vendor),
      reqDate: normalizeDate(entry.reqDate) || now.slice(0, 10),
      reqContent: clean(entry.reqContent),
      dueDate: normalizeDate(entry.dueDate),
      reply: clean(entry.reply),
      replyDate: normalizeDate(entry.replyDate),
      confirmedDate: normalizeDate(entry.confirmedDate),
      originalPlannedDate: normalizeDate(entry.originalPlannedDate),
      type: clean(entry.type) || inferType(entry),
      channel: clean(entry.channel),
      requester: clean(entry.requester),
      memo: clean(entry.memo),
      status: normalizeStatus(entry.status),
      createdAt: now,
      updatedAt: now,
    };
    if (!record.barcode) {
      throw new Error("바코드는 필수입니다.");
    }
    logs.unshift(record);
    saveLogs(logs);
    return record;
  }

  function updateLog(id, patch) {
    const logs = loadLogs();
    const idx = logs.findIndex((r) => r.id === id);
    if (idx < 0) return null;
    const prev = logs[idx];
    const next = {
      ...prev,
      ...Object.fromEntries(
        Object.entries(patch || {}).map(([k, v]) => {
          if (["reqDate", "dueDate", "replyDate", "confirmedDate", "originalPlannedDate"].includes(k)) {
            return [k, normalizeDate(v)];
          }
          if (k === "barcode") return [k, barcode(v)];
          if (k === "status") return [k, normalizeStatus(v)];
          return [k, clean(v)];
        })
      ),
      updatedAt: dateTimeIso(),
    };
    if (!next.type && (next.confirmedDate || next.originalPlannedDate)) {
      next.type = inferType(next);
    }
    logs[idx] = next;
    saveLogs(logs);
    return next;
  }

  function removeLog(id) {
    const logs = loadLogs().filter((r) => r.id !== id);
    saveLogs(logs);
    return logs;
  }

  function getLogsByBarcode(code) {
    const bc = barcode(code);
    if (!bc) return [];
    return loadLogs()
      .filter((r) => barcode(r.barcode) === bc)
      .sort((a, b) => (b.updatedAt || "").localeCompare(a.updatedAt || ""));
  }

  function getAllLogs() {
    return loadLogs().slice().sort((a, b) => (b.updatedAt || "").localeCompare(a.updatedAt || ""));
  }

  function getLatestByBarcode(code) {
    return getLogsByBarcode(code)[0] || null;
  }

  // ---------- 타입 추론 ----------
  function inferType(entry) {
    const orig = normalizeDate(entry.originalPlannedDate);
    const conf = normalizeDate(entry.confirmedDate);
    if (orig && conf) {
      if (conf < orig) return "앞당김";
      if (conf > orig) return "지연";
    }
    return clean(entry.type) || "기타";
  }

  // ---------- 기존 스케줄 엔진과 연동 ----------
  /**
   * 확정일이 있는 최신 로그를 이용해
   * 입고 행의 비고(확정일) 값을 생성
   */
  function buildRemarkFromLatest(log) {
    if (!log || !log.confirmedDate) return "";
    return log.confirmedDate;
  }

  /** 행에서 확정일 비고 읽기 (신규 헤더 우선, 구 헤더 호환) */
  function readRemarkFromRow(row) {
    return clean(row?.[REMARK_HEADER]) || clean(row?.[REMARK_HEADER_LEGACY]) || "";
  }

  /**
   * 스케줄 행 배열에 최신 확정일을 반영
   * @param {Array} scheduleRows  기존 입고예정 행들
   * @returns {{ rows: Array, appliedCount: number }}
   */
  function applyConfirmedToSchedule(scheduleRows) {
    const logs = loadLogs();
    const latestMap = new Map();
    logs.forEach((log) => {
      const bc = barcode(log.barcode);
      if (!bc) return;
      const prev = latestMap.get(bc);
      if (!prev || (log.updatedAt || "") > (prev.updatedAt || "")) {
        latestMap.set(bc, log);
      }
    });

    let appliedCount = 0;
    const rows = (scheduleRows || []).map((row) => {
      const bc = barcode(row.바코드 || row.barcode || row.상품코드);
      const log = latestMap.get(bc);
      const next = { ...row };
      const ownership = row._coordinationOverride;
      const headers = [REMARK_HEADER, REMARK_HEADER_LEGACY];
      if (!log || !log.confirmedDate) {
        if (ownership && ownership.barcode === bc) {
          headers.forEach((header) => {
            const original = ownership.originalRemarks?.[header];
            if (!original || next[header] !== ownership.appliedRemark) return;
            if (original.present) next[header] = original.value;
            else delete next[header];
          });
          delete next._coordinationOverride;
        }
        return next;
      }
      appliedCount += 1;
      const remark = buildRemarkFromLatest(log);
      const originalRemarks = {};
      headers.forEach((header) => {
        const previous = ownership?.barcode === bc ? ownership.originalRemarks?.[header] : null;
        originalRemarks[header] = previous && row[header] === ownership.appliedRemark
          ? { ...previous }
          : { present: Object.prototype.hasOwnProperty.call(row, header), value: row[header] };
      });
      next._coordinationOverride = { barcode: bc, logId: log.id, appliedRemark: remark, originalRemarks };
      next[REMARK_HEADER] = remark;
      // 기존 엔진이 구 헤더를 아직 쓰는 동안 호환용으로도 기록
      next[REMARK_HEADER_LEGACY] = remark;
      if (!next.입고예정원본일 && log.originalPlannedDate) {
        next.입고예정원본일 = log.originalPlannedDate;
      }
      return next;
    });
    return { rows, appliedCount };
  }

  /**
   * 앞당겨진 품목만 필터
   * InboundTableEngine.resolveInboundSchedule 결과를 사용하거나,
   * 로그 기준으로 직접 판별
   */
  function getAdvancedInboundItems(scheduleRows, inboundTableEngine) {
    const rows = scheduleRows || [];
    const advanced = [];

    rows.forEach((row) => {
      let planned = "";
      let confirmed = "";
      let changed = false;

      if (inboundTableEngine && typeof inboundTableEngine.resolveInboundSchedule === "function") {
        const sch = inboundTableEngine.resolveInboundSchedule(row);
        planned = sch.plannedDate || "";
        confirmed = sch.confirmedDate || "";
        changed = Boolean(sch.changed);
      } else {
        // 폴백: 로그 + 비고 직접 사용
        const bc = barcode(row.바코드 || row.barcode);
        const latest = getLatestByBarcode(bc);
        planned =
          normalizeDate(row.입고예정원본일) ||
          normalizeDate(row.입고예정일) ||
          normalizeDate(row.다음입고) ||
          (latest && latest.originalPlannedDate) ||
          "";
        confirmed =
          normalizeDate(readRemarkFromRow(row)) ||
          (latest && latest.confirmedDate) ||
          "";
        changed = Boolean(planned && confirmed && planned !== confirmed);
      }

      if (changed && confirmed && planned && confirmed < planned) {
        const latest = getLatestByBarcode(row.바코드 || row.barcode);
        advanced.push({
          ...row,
          _plannedDate: planned,
          _confirmedDate: confirmed,
          _diffDays: daysBetween(planned, confirmed),
          _latestLog: latest,
          _vendor: (latest && latest.vendor) || clean(row.국내업체 || row.수입업체 || ""),
          _replySummary: latest
            ? (latest.reply || latest.reqContent || "").slice(0, 80)
            : "",
        });
      }
    });

    // 확정일이 빠른 순
    advanced.sort((a, b) => (a._confirmedDate || "").localeCompare(b._confirmedDate || ""));
    return advanced;
  }

  function daysBetween(fromYmd, toYmd) {
    try {
      const a = new Date(fromYmd);
      const b = new Date(toYmd);
      return Math.round((b - a) / 86400000);
    } catch (_) {
      return null;
    }
  }

  /**
   * 상품 상세용 요약
   */
  function getProductCoordinationSummary(barcodeOrRow) {
    const bc =
      typeof barcodeOrRow === "string"
        ? barcode(barcodeOrRow)
        : barcode(barcodeOrRow?.바코드 || barcodeOrRow?.barcode || barcodeOrRow?.상품코드);
    const logs = getLogsByBarcode(bc);
    const latest = logs[0] || null;
    return {
      barcode: bc,
      count: logs.length,
      latest,
      logs,
      hasConfirmed: Boolean(latest && latest.confirmedDate),
      isAdvanced:
        latest &&
        latest.originalPlannedDate &&
        latest.confirmedDate &&
        latest.confirmedDate < latest.originalPlannedDate,
    };
  }

  // ---------- 엑셀/시트 연동용 파서 (선택) ----------
  function parseCoordinationRows(rows) {
    if (!Array.isArray(rows) || !rows.length) return [];
    const headerIndex = rows.findIndex((row) => {
      const cells = (row || []).map(clean);
      return cells.includes("바코드") && (cells.includes("요청내용") || cells.includes("확정입고일"));
    });
    if (headerIndex < 0) return [];
    const headers = rows[headerIndex].map(clean);
    const idx = (name) => headers.indexOf(name);

    return rows
      .slice(headerIndex + 1)
      .map((row) => {
        const get = (name) => (idx(name) >= 0 ? clean(row[idx(name)]) : "");
        const bc = barcode(get("바코드") || get("상품코드"));
        if (!bc) return null;
        return {
          barcode: bc,
          productName: get("상품명") || get("제품명"),
          vendor: get("업체") || get("거래처"),
          reqDate: get("요청일"),
          reqContent: get("요청내용") || get("요청사항"),
          dueDate: get("요청기한") || get("기한"),
          reply: get("업체회신") || get("회신"),
          replyDate: get("회신일"),
          confirmedDate: get("확정입고일") || get("확정일"),
          originalPlannedDate: get("원본예정일") || get("기존예정일"),
          type: get("조정유형") || get("유형"),
          channel: get("소통방식") || get("채널"),
          requester: get("요청자") || get("담당자"),
          memo: get("메모") || get("비고"),
          status: normalizeStatus(get("상태")),
        };
      })
      .filter(Boolean);
  }

  function importFromRows(rows, { replace = false } = {}) {
    const parsed = parseCoordinationRows(rows);
    if (!parsed.length) return { imported: 0, logs: loadLogs() };
    let logs = replace ? [] : loadLogs();
    parsed.forEach((p) => {
      try {
        const record = {
          id: uid(),
          ...p,
          reqDate: normalizeDate(p.reqDate) || dateTimeIso().slice(0, 10),
          dueDate: normalizeDate(p.dueDate),
          replyDate: normalizeDate(p.replyDate),
          confirmedDate: normalizeDate(p.confirmedDate),
          originalPlannedDate: normalizeDate(p.originalPlannedDate),
          type: p.type || inferType(p),
          createdAt: dateTimeIso(),
          updatedAt: dateTimeIso(),
        };
        logs.unshift(record);
      } catch (_) {}
    });
    saveLogs(logs);
    return { imported: parsed.length, logs };
  }

  function exportForSheet() {
    const logs = getAllLogs();
    const headers = [
      "바코드",
      "상품명",
      "업체",
      "요청일",
      "요청내용",
      "요청기한",
      "업체회신",
      "회신일",
      "확정입고일",
      "원본예정일",
      "조정유형",
      "소통방식",
      "요청자",
      "메모",
      "상태",
      "수정일시",
    ];
    const body = logs.map((r) => [
      r.barcode,
      r.productName,
      r.vendor,
      r.reqDate,
      r.reqContent,
      r.dueDate,
      r.reply,
      r.replyDate,
      r.confirmedDate,
      r.originalPlannedDate,
      r.type,
      r.channel,
      r.requester,
      r.memo,
      normalizeStatus(r.status),
      r.updatedAt,
    ]);
    return [headers, ...body];
  }

  function clearAll() {
    saveLogs([]);
  }

  return {
    STORAGE_KEY,
    REMARK_HEADER,
    REMARK_HEADER_LEGACY,
    readRemarkFromRow,
    loadLogs,
    saveLogs,
    addLog,
    updateLog,
    removeLog,
    getLogsByBarcode,
    getAllLogs,
    getLatestByBarcode,
    applyConfirmedToSchedule,
    getAdvancedInboundItems,
    getProductCoordinationSummary,
    parseCoordinationRows,
    importFromRows,
    exportForSheet,
    clearAll,
    normalizeDate,
    inferType,
  };
});
