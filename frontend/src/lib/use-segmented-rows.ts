import { useLayoutEffect, useRef, useState } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";

// 250K * 34px = 8.5M px, comfortably below browser scroll-height limits.
// Keep the existing continuous-scrolling experience through 500K rows.
export const ROW_PAGE_SIZE = 250_000;
export const ROW_PAGING_THRESHOLD = 500_000;

export function useSegmentedRows(total: number, rowHeight: number, overscan: number) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [requestedPage, setRequestedPage] = useState(0);
  const pendingRow = useRef<number | null>(null);
  const segmented = total > ROW_PAGING_THRESHOLD;
  const pageCount = segmented ? Math.ceil(total / ROW_PAGE_SIZE) : 1;
  const page = Math.min(requestedPage, pageCount - 1);
  const offset = segmented ? page * ROW_PAGE_SIZE : 0;
  const count = segmented ? Math.min(ROW_PAGE_SIZE, total - offset) : total;
  const virtual = useVirtualizer({
    count,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => rowHeight,
    overscan,
  });

  // After a page change, scroll using the NEW local count (the last page may be
  // shorter). The Worker and selection API always use global display positions.
  useLayoutEffect(() => {
    const row = pendingRow.current;
    if (row !== null && row >= offset && row < offset + count) {
      pendingRow.current = null;
      virtual.scrollToIndex(row - offset);
    }
  }, [offset, count, virtual]);

  function scrollToRow(row: number) {
    if (!Number.isInteger(row) || row < 0 || row >= total) return;
    const nextPage = segmented ? Math.floor(row / ROW_PAGE_SIZE) : 0;
    if (nextPage === page) virtual.scrollToIndex(row - offset);
    else {
      pendingRow.current = row;
      setRequestedPage(nextPage);
    }
  }

  const range = virtual.getVirtualItems().map((item) => ({
    ...item,
    index: offset + item.index,
    key: offset + item.index,
  }));
  return {
    scrollRef,
    range,
    height: virtual.getTotalSize(),
    scrollToRow,
    segmented,
    page,
    pageCount,
    offset,
    count,
    total,
  };
}
