interface PaginationProps {
  page: number
  totalPages: number
  total: number
  from: number
  to: number
  onPageChange: (page: number) => void
  pageSize?: number
  pageSizeOptions?: number[]
  onPageSizeChange?: (size: number) => void
  className?: string
}

export function Pagination({
  page,
  totalPages,
  total,
  from,
  to,
  onPageChange,
  pageSize,
  pageSizeOptions,
  onPageSizeChange,
  className = '',
}: PaginationProps) {
  if (total === 0) return null

  const showSizeSelect =
    pageSize !== undefined &&
    pageSizeOptions !== undefined &&
    onPageSizeChange !== undefined &&
    pageSizeOptions.length > 0

  return (
    <nav className={`pagination${className ? ` ${className}` : ''}`} aria-label="Phân trang">
      <p className="pagination-info">
        {from}–{to} / {total}
      </p>

      <div className="pagination-controls">
        {showSizeSelect && (
          <label className="pagination-size">
            <span className="pagination-size-label">/ trang</span>
            <select
              value={pageSize}
              onChange={(e) => onPageSizeChange(Number(e.target.value))}
              aria-label="Số mục mỗi trang"
            >
              {pageSizeOptions.map((size) => (
                <option key={size} value={size}>
                  {size}
                </option>
              ))}
            </select>
          </label>
        )}

        <button
          type="button"
          className="btn btn--sm btn--ghost pagination-btn"
          disabled={page <= 1}
          onClick={() => onPageChange(page - 1)}
        >
          Trước
        </button>

        <span className="pagination-status">
          {page} / {totalPages}
        </span>

        <button
          type="button"
          className="btn btn--sm btn--ghost pagination-btn"
          disabled={page >= totalPages}
          onClick={() => onPageChange(page + 1)}
        >
          Sau
        </button>
      </div>
    </nav>
  )
}