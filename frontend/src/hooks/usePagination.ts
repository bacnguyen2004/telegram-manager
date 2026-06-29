import { useEffect, useMemo, useState } from 'react'
import { paginateSlice } from '../utils/pagination'

export function usePagination<T>(items: T[], initialPageSize = 10) {
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(initialPageSize)

  const result = useMemo(
    () => paginateSlice(items, page, pageSize),
    [items, page, pageSize],
  )

  useEffect(() => {
    setPage(1)
  }, [items, pageSize])

  useEffect(() => {
    if (page > result.totalPages) {
      setPage(result.totalPages)
    }
  }, [page, result.totalPages])

  return {
    ...result,
    page: result.currentPage,
    setPage,
    pageSize,
    setPageSize,
  }
}