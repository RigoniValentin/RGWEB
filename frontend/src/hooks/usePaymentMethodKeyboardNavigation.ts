import { useEffect, useMemo, useRef, useState } from 'react';

interface PaymentMethodKeyboardNavigationOptions<T> {
  enabled: boolean;
  items: T[];
  selectedIds: number[];
  getId: (item: T) => number;
  onToggle: (id: number) => void;
  onConfirm: () => void;
}

function isEditableElement(element: Element | null): boolean {
  if (!(element instanceof HTMLElement)) return false;
  const tag = element.tagName;
  return element.isContentEditable || tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
}

function getGridColumnCount(grid: HTMLDivElement | null): number {
  if (!grid || grid.children.length === 0) return 1;

  const children = Array.from(grid.children) as HTMLElement[];
  const firstTop = children[0]?.offsetTop ?? 0;
  const firstDifferentRow = children.findIndex(child => child.offsetTop !== firstTop);

  return firstDifferentRow > 0 ? firstDifferentRow : Math.max(children.length, 1);
}

export function usePaymentMethodKeyboardNavigation<T>({
  enabled,
  items,
  selectedIds,
  getId,
  onToggle,
  onConfirm,
}: PaymentMethodKeyboardNavigationOptions<T>) {
  const gridRef = useRef<HTMLDivElement | null>(null);
  const [activeId, setActiveId] = useState<number | undefined>();

  const itemIds = useMemo(() => items.map(getId), [items, getId]);

  // Tag grid element so CSS can apply hover styles
  useEffect(() => {
    const el = gridRef.current;
    if (el) el.dataset.pmGrid = 'true';
  });

  useEffect(() => {
    if (!enabled || itemIds.length === 0) return;

    setActiveId(current => {
      if (current !== undefined && itemIds.includes(current)) return current;
      return selectedIds.find(id => itemIds.includes(id)) ?? itemIds[0];
    });
  }, [enabled, itemIds, selectedIds]);

  useEffect(() => {
    if (!enabled || activeId === undefined) return;
    const activeIndex = itemIds.indexOf(activeId);
    if (activeIndex < 0) return;
    const element = gridRef.current?.children[activeIndex] as HTMLElement | undefined;
    element?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }, [enabled, activeId, itemIds]);

  useEffect(() => {
    if (!enabled || itemIds.length === 0) return;

    const moveActive = (delta: number) => {
      setActiveId(current => {
        const currentIndex = current !== undefined ? itemIds.indexOf(current) : -1;
        const baseIndex = currentIndex >= 0 ? currentIndex : 0;
        const nextIndex = Math.min(Math.max(baseIndex + delta, 0), itemIds.length - 1);
        return itemIds[nextIndex];
      });
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.isComposing || isEditableElement(document.activeElement)) return;

      if (event.key === 'ArrowLeft') {
        event.preventDefault();
        event.stopPropagation();
        moveActive(-1);
        return;
      }

      if (event.key === 'ArrowRight') {
        event.preventDefault();
        event.stopPropagation();
        moveActive(1);
        return;
      }

      if (event.key === 'ArrowUp') {
        event.preventDefault();
        event.stopPropagation();
        moveActive(-getGridColumnCount(gridRef.current));
        return;
      }

      if (event.key === 'ArrowDown') {
        event.preventDefault();
        event.stopPropagation();
        moveActive(getGridColumnCount(gridRef.current));
        return;
      }

      if (event.key === 'Enter') {
        if (event.ctrlKey || event.metaKey) {
          const id = activeId ?? itemIds[0];
          if (id !== undefined) {
            event.preventDefault();
            event.stopPropagation();
            setActiveId(id);
            onToggle(id);
          }
          return;
        }

        if (selectedIds.length > 0) {
          event.preventDefault();
          event.stopPropagation();
          onConfirm();
        }
      }
    };

    // Use capture phase so our handler fires before (and can suppress) any
    // bubble-phase shortcuts registered by the parent modal (e.g. Ctrl+Enter in sales).
    window.addEventListener('keydown', handleKeyDown, { capture: true });
    return () => window.removeEventListener('keydown', handleKeyDown, { capture: true });
  }, [enabled, itemIds, activeId, selectedIds.length, onToggle, onConfirm]);

  return { activeId, gridRef, setActiveId };
}