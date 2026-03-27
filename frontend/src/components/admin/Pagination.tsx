interface PaginationProps {
  page: number;
  totalPages: number;
  totalItems: number;
  pageSize: number;
  onPageChange: (page: number) => void;
  /** RR2-07: When true, pagination controls are disabled to prevent double-clicks during load */
  isLoading?: boolean;
}

export default function Pagination({ page, totalPages, totalItems, pageSize, onPageChange, isLoading = false }: PaginationProps) {
  if (totalPages <= 1) return null;

  const start = (page - 1) * pageSize + 1;
  const end = Math.min(page * pageSize, totalItems);

  // Build page number list with ellipsis
  const pages: (number | "...")[] = [];
  for (let p = 1; p <= totalPages; p++) {
    if (p === 1 || p === totalPages || (p >= page - 1 && p <= page + 1)) {
      pages.push(p);
    } else if (pages[pages.length - 1] !== "...") {
      pages.push("...");
    }
  }

  return (
    <nav className="pagination" aria-label="Pagination">
      <span className="pagination__info" aria-live="polite">
        {start}–{end} of {totalItems}
      </span>
      <div className="pagination__controls">
        <button
          className="pagination__btn"
          onClick={() => onPageChange(page - 1)}
          disabled={page === 1 || isLoading}
          aria-label="Previous page"
          aria-disabled={page === 1 || isLoading}
        >
          ‹
        </button>
        {pages.map((p, i) =>
          p === "..." ? (
            <span key={`ellipsis-${i}`} className="pagination__ellipsis">…</span>
          ) : (
            <button
              key={p}
              className={`pagination__btn${p === page ? " pagination__btn--active" : ""}`}
              onClick={() => onPageChange(p)}
              disabled={isLoading}
              aria-label={`Go to page ${p}`}
              aria-current={p === page ? "page" : undefined}
            >
              {p}
            </button>
          )
        )}
        <button
          className="pagination__btn"
          onClick={() => onPageChange(page + 1)}
          disabled={page === totalPages || isLoading}
          aria-label="Next page"
          aria-disabled={page === totalPages || isLoading}
        >
          ›
        </button>
      </div>
    </nav>
  );
}
