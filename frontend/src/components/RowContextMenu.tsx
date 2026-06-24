import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { Menu } from 'antd';
import type { MenuProps } from 'antd';

type RowContextMenuVariant = 'dark' | 'light';

type RowContextMenuProps = {
  open: boolean;
  position: { x: number; y: number } | null;
  items: MenuProps['items'];
  onClose: () => void;
  variant?: RowContextMenuVariant;
};

export function RowContextMenu({ open, position, items, onClose, variant = 'light' }: RowContextMenuProps) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;

    const handleClickOutside = (e: MouseEvent) => {
      if (e.button !== 0) return;
      if (ref.current && !ref.current.contains(e.target as Node)) {
        onClose();
      }
    };

    const handleContextMenuOutside = (e: MouseEvent) => {
      if (ref.current && ref.current.contains(e.target as Node)) return;
      onClose();
    };

    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };

    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('contextmenu', handleContextMenuOutside, true);
    document.addEventListener('keydown', handleEscape);

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('contextmenu', handleContextMenuOutside, true);
      document.removeEventListener('keydown', handleEscape);
    };
  }, [open, onClose]);

  if (!open || !position) return null;

  return createPortal(
    <div
      ref={ref}
      role="menu"
      style={{
        position: 'fixed',
        left: position.x,
        top: position.y,
        zIndex: 1050,
      }}
      onContextMenu={(e) => e.preventDefault()}
    >
      <Menu
        className={`rg-context-menu rg-context-menu--${variant}`}
        items={items}
        onClick={onClose}
        mode="vertical"
        selectable={false}
      />
    </div>,
    document.body,
  );
}