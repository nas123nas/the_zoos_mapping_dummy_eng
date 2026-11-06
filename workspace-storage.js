(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.WorkspaceStorage = api;
})(typeof window !== "undefined" ? window : globalThis, function () {
  function compactMaster(master) {
    if (!master) return master;
    const { content, encoding, ...metadata } = master;
    return metadata;
  }

  function createPersistableWorkspace(workspace) {
    return {
      ...workspace,
      fixedMaster: compactMaster(workspace.fixedMaster),
      masterHistory: (workspace.masterHistory || []).map(compactMaster),
    };
  }

  function parseStoredWorkspace(stored) {
    try {
      const workspace = JSON.parse(stored);
      if (!workspace || typeof workspace !== "object" || Array.isArray(workspace)) return null;
      const arrayFields = [
        "masterHistory", "jobs", "learningHistory", "reviewDrafts", "reviewItems",
        "productCatalog", "mappingPreviewRows", "orderAnalysisRows", "inboundUpdates",
        "productMemos", "containerInboundRecords", "smartstoreReservations", "expiryLots",
        "rowOverrides", "mappingDecisions",
      ];
      for (const field of arrayFields) {
        if (Object.hasOwn(workspace, field) && !Array.isArray(workspace[field])) workspace[field] = [];
      }
      return workspace;
    } catch (_) {
      return null;
    }
  }

  return { createPersistableWorkspace, parseStoredWorkspace };
});
