/** Shared viewport layout: top-aligned content and sticky page controls. */
(function () {
  "use strict";
  const basis = document.querySelector(".sidebar-nav > .data-basis-card");
  if (basis) {
    const details = document.createElement("details");
    details.className = "responsive-data-basis";
    const summary = document.createElement("summary");
    summary.textContent = "데이터 기준 일시";
    details.appendChild(summary);
    basis.closest(".sidebar").appendChild(details);
    details.appendChild(basis);
    const compact = matchMedia("(max-width: 850px)");
    const sync = () => { details.open = !compact.matches; };
    compact.addEventListener("change", sync);
    sync();
  }
  document.querySelectorAll(".nav-item[data-page]").forEach(button => {
    button.addEventListener("click", () => {
      const reset = () => window.scrollTo({ top: 0, left: 0, behavior: "instant" });
      reset();
      requestAnimationFrame(reset);
    });
  });
  const pages = [...document.querySelectorAll("main > .page")];
  const observer = new ResizeObserver(entries => {
    entries.forEach(({ target }) => {
      if (target.offsetHeight) target.parentElement.style.setProperty("--page-heading-height", `${target.offsetHeight}px`);
    });
  });
  pages.forEach(page => {
    const heading = page.querySelector(":scope > .page-heading");
    if (heading) observer.observe(heading);
    page.querySelectorAll(".section-title").forEach(title => {
      if (title.querySelector(".table-search-form, .inbound-category-filters, input[type=search]")) title.classList.add("sticky-list-controls");
    });
    page.querySelectorAll(".inventory-panel-controls, .ops-toolbar").forEach(control => control.classList.add("sticky-list-controls"));
    page.querySelectorAll("table").forEach(table => {
      if (table.closest(".table-scroll-shell, .h-scroll-wrap, .inventory-table-wrap, .responsive-table-viewport")) return;
      const viewport = document.createElement("div");
      viewport.className = "responsive-table-viewport";
      viewport.tabIndex = 0;
      viewport.setAttribute("role", "region");
      viewport.setAttribute("aria-label", `${page.querySelector("h2")?.textContent || "데이터"} 표 · 가로 스크롤`);
      table.before(viewport);
      viewport.appendChild(table);
    });
  });
})();
