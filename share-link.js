(function attachShareLink(root, factory) {
  const api = factory();
  root.ShareLink = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (root.document) api.initShareButton(root.document, root.navigator, root.location);
})(typeof globalThis !== "undefined" ? globalThis : window, function createShareLink() {
  "use strict";

  async function shareCurrentPage({ navigatorRef, locationRef, title = "THE ZOOS Order Mapping and Inventory Demo" }) {
    const url = String(locationRef?.href || "");
    if (typeof navigatorRef?.share === "function") {
      try {
        await navigatorRef.share({ title, text: "Explore the THE ZOOS portfolio demo.", url });
        return { method: "share", url };
      } catch (error) {
        if (error?.name === "AbortError") return { method: "cancelled", url };
      }
    }
    if (typeof navigatorRef?.clipboard?.writeText === "function") {
      try {
        await navigatorRef.clipboard.writeText(url);
        return { method: "clipboard", url };
      } catch (_) {}
    }
    return { method: "manual", url };
  }

  function notify(message) {
    if (typeof globalThis.showToast === "function") globalThis.showToast(message);
    else if (typeof globalThis.alert === "function") globalThis.alert(message);
  }

  function initShareButton(documentRef, navigatorRef, locationRef) {
    const header = documentRef.querySelector("main > header");
    if (!header || documentRef.querySelector("#share-site-link")) return null;
    const button = documentRef.createElement("button");
    button.id = "share-site-link";
    button.className = "secondary share-site-button";
    button.type = "button";
    button.textContent = "공유 링크";
    const user = header.querySelector(".user");
    if (user) user.before(button); else header.appendChild(button);
    button.addEventListener("click", async () => {
      const result = await shareCurrentPage({ navigatorRef, locationRef });
      if (result.method === "clipboard") notify("공유 링크를 복사했습니다.");
      if (result.method === "share") notify("공유창을 열었습니다.");
      if (result.method === "manual") {
        const value = typeof globalThis.prompt === "function" ? globalThis.prompt("아래 링크를 복사해 공유하세요.", result.url) : null;
        if (value !== null) notify("공유할 링크를 표시했습니다.");
      }
    });
    return button;
  }

  return { shareCurrentPage, initShareButton };
});
