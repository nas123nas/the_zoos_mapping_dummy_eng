(function attachFileDropEngine(root, factory) {
  const api = factory();
  root.FileDropEngine = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof globalThis !== "undefined" ? globalThis : window, function createFileDropEngine() {
  "use strict";

  const ALLOWED_EXTENSION = /\.(xlsx|xls|csv)$/i;

  function validateFiles(files) {
    const list = Array.from(files || []);
    if (list.length !== 1) return { ok: false, message: "파일은 한 번에 1개만 첨부해주세요." };
    const file = list[0];
    if (!ALLOWED_EXTENSION.test(String(file?.name || ""))) {
      return { ok: false, message: "지원 형식은 .xlsx, .xls, .csv입니다." };
    }
    return { ok: true, file };
  }

  function createSelectionStore() {
    let selectedFile = null;
    return {
      set(file) { selectedFile = file || null; },
      get() { return selectedFile; },
      clear() { selectedFile = null; },
    };
  }

  return { validateFiles, createSelectionStore };
});
