import { useCallback, useMemo, useState } from 'react';
import type { Key, MouseEvent, ReactNode } from 'react';

export type RowAction<T> =
  | {
      key: string;
      label: ReactNode;
      icon?: ReactNode;
      danger?: boolean;
      disabled?: boolean | ((record: T) => boolean);
      onClick: (record: T) => void;
    }
  | { type: 'divider' };

export type RowContextMenuState<T> = {
  record: T;
  x: number;
  y: number;
} | null;

export type UseRowActionsOptions<T> = {
  getRowId: (record: T) => Key;
  primaryAction?: (record: T) => void;
  actions?: RowAction<T>[];
  activeClassName?: string;
};

export function useRowActions<T>({
  getRowId,
  primaryAction,
  actions = [],
  activeClassName = 'rg-row-active',
}: UseRowActionsOptions<T>) {
  const [activeId, setActiveId] = useState<Key | null>(null);
  const [contextMenu, setContextMenu] = useState<RowContextMenuState<T>>(null);

  const onRow = useCallback(
    (record: T) => ({
      onClick: () => setActiveId(getRowId(record)),
      onDoubleClick: () => primaryAction?.(record),
      onContextMenu: (e: MouseEvent<HTMLElement>) => {
        e.preventDefault();
        setActiveId(getRowId(record));
        setContextMenu({ record, x: e.clientX, y: e.clientY });
      },
    }),
    [getRowId, primaryAction],
  );

  const rowClassName = useCallback(
    (record: T) => (getRowId(record) === activeId ? activeClassName : ''),
    [getRowId, activeId, activeClassName],
  );

  const contextMenuItems = useMemo(() => {
    if (!contextMenu) return [];
    return actions.map((a) => {
      if ('type' in a) return { type: 'divider' as const };
      return {
        key: a.key,
        label: a.label,
        icon: a.icon,
        danger: a.danger,
        disabled:
          typeof a.disabled === 'function' ? a.disabled(contextMenu.record) : a.disabled,
        onClick: () => a.onClick(contextMenu.record),
      };
    });
  }, [actions, contextMenu]);

  const closeContextMenu = useCallback(() => setContextMenu(null), []);

  return {
    activeId,
    setActiveId,
    onRow,
    rowClassName,
    contextMenu,
    contextMenuItems,
    closeContextMenu,
  };
}
