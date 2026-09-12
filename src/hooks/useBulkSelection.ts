"use client";

import { useCallback, useMemo, useState } from "react";

export function useBulkSelection<T>(items: T[], getId: (item: T) => string) {
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  const visibleIds = useMemo(() => items.map(getId), [items, getId]);

  const isSelected = useCallback(
    (item: T) => selectedIds.has(getId(item)),
    [getId, selectedIds]
  );

  const toggle = useCallback(
    (item: T) => {
      const id = getId(item);
      setSelectedIds((prev) => {
        const next = new Set(prev);
        if (next.has(id)) next.delete(id);
        else next.add(id);
        return next;
      });
    },
    [getId]
  );

  const toggleAll = useCallback(() => {
    setSelectedIds((prev) => {
      const allVisibleSelected =
        visibleIds.length > 0 && visibleIds.every((id) => prev.has(id));
      if (allVisibleSelected) return new Set();
      return new Set(visibleIds);
    });
  }, [visibleIds]);

  const clear = useCallback(() => setSelectedIds(new Set()), []);

  const selectedItems = useMemo(
    () => items.filter((item) => selectedIds.has(getId(item))),
    [getId, items, selectedIds]
  );

  const allSelected = visibleIds.length > 0 && visibleIds.every((id) => selectedIds.has(id));
  const someSelected = visibleIds.some((id) => selectedIds.has(id)) && !allSelected;

  return {
    selectedIds,
    selectedItems,
    count: selectedIds.size,
    isSelected,
    toggle,
    toggleAll,
    clear,
    allSelected,
    someSelected,
  };
}
