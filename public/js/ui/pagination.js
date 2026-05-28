// /js/ui/pagination.js

export function renderPagination(containerId, currentPage, totalPages, onPageChange) {
  const container = document.getElementById(containerId);

  if (!container) return;

  if (totalPages <= 1) {
    container.innerHTML = '';
    return;
  }

  const pages = [];

  if (currentPage > 1) {
    pages.push({ label: '‹', page: currentPage - 1 });
  }

  for (let i = 1; i <= totalPages; i++) {
    pages.push({
      label: i,
      page: i,
      active: i === currentPage
    });
  }

  if (currentPage < totalPages) {
    pages.push({ label: '›', page: currentPage + 1 });
  }

  container.innerHTML = pages.map(p => `
    <button
      class="page-btn ${p.active ? 'active' : ''}"
      data-page="${p.page}"
    >
      ${p.label}
    </button>
  `).join('');

  container.onclick = (e) => {
    const btn = e.target.closest('.page-btn');

    if (!btn) return;

    const page = Number(btn.dataset.page);

    if (!isNaN(page) && page !== currentPage) {
      onPageChange(page);
    }
  };
}