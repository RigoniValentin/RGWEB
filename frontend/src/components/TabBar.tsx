import { useRef, useEffect, useCallback, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Dropdown } from 'antd';
import { CloseOutlined } from '@ant-design/icons';
import { useTabStore } from '../store/tabStore';

// ═══════════════════════════════════════════════════
//  TabBar — Modern draggable tab strip
// ═══════════════════════════════════════════════════

/** Route → icon mapping (React nodes). Passed from AppLayout to avoid circular deps. */
export interface TabBarProps {
  iconMap: Record<string, React.ReactNode>;
}

export function TabBar({ iconMap }: TabBarProps) {
  const navigate = useNavigate();
  const { tabs, activeKey, setActiveTab, closeTab, closeAll, closeOthers, reorderTabs } = useTabStore();
  const barRef = useRef<HTMLDivElement>(null);
  const activeRef = useRef<HTMLDivElement>(null);

  // ── Drag state ──────────────────────────────────
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);

  // Auto-scroll to active tab
  useEffect(() => {
    if (activeRef.current && barRef.current) {
      const bar = barRef.current;
      const tab = activeRef.current;
      const tabLeft = tab.offsetLeft;
      const tabRight = tabLeft + tab.offsetWidth;
      const barScrollLeft = bar.scrollLeft;
      const barVisibleRight = barScrollLeft + bar.clientWidth;

      if (tabLeft < barScrollLeft) {
        bar.scrollTo({ left: tabLeft - 8, behavior: 'smooth' });
      } else if (tabRight > barVisibleRight) {
        bar.scrollTo({ left: tabRight - bar.clientWidth + 8, behavior: 'smooth' });
      }
    }
  }, [activeKey]);

  const handleActivate = useCallback((key: string) => {
    setActiveTab(key);
    navigate(key);
  }, [setActiveTab, navigate]);

  const handleClose = useCallback((e: React.MouseEvent, key: string) => {
    e.stopPropagation();
    const newActive = closeTab(key);
    navigate(newActive);
  }, [closeTab, navigate]);

  const handleMiddleClick = useCallback((e: React.MouseEvent, key: string) => {
    if (e.button === 1) {
      e.preventDefault();
      const tab = tabs.find(t => t.key === key);
      if (tab?.closable) {
        const newActive = closeTab(key);
        navigate(newActive);
      }
    }
  }, [tabs, closeTab, navigate]);

  // ── Drag handlers ──────────────────────────────
  const handleDragStart = useCallback((e: React.DragEvent, index: number) => {
    // Dashboard (index 0, non-closable) is pinned — can't drag it
    if (!tabs[index]?.closable) { e.preventDefault(); return; }
    setDragIndex(index);
    e.dataTransfer.effectAllowed = 'move';
    // Use a transparent drag image for a cleaner look
    const ghost = document.createElement('div');
    ghost.style.opacity = '0';
    document.body.appendChild(ghost);
    e.dataTransfer.setDragImage(ghost, 0, 0);
    setTimeout(() => document.body.removeChild(ghost), 0);
  }, [tabs]);

  const handleDragOver = useCallback((e: React.DragEvent, index: number) => {
    // Don't allow dropping on the pinned Dashboard tab (index 0)
    if (!tabs[index]?.closable) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    setDragOverIndex(index);
  }, [tabs]);

  const handleDragEnd = useCallback(() => {
    if (dragIndex !== null && dragOverIndex !== null && dragIndex !== dragOverIndex) {
      reorderTabs(dragIndex, dragOverIndex);
    }
    setDragIndex(null);
    setDragOverIndex(null);
  }, [dragIndex, dragOverIndex, reorderTabs]);

  const getContextMenu = (key: string) => ({
    items: [
      {
        key: 'close',
        label: 'Cerrar',
        disabled: !tabs.find(t => t.key === key)?.closable,
        onClick: () => { const na = closeTab(key); navigate(na); },
      },
      {
        key: 'closeOthers',
        label: 'Cerrar otros',
        onClick: () => { closeOthers(key); navigate(key); },
      },
      {
        key: 'closeAll',
        label: 'Cerrar todos',
        onClick: () => { const na = closeAll(); navigate(na); },
      },
    ],
  });

  return (
    <div className="rg-tabbar" ref={barRef}>
      {tabs.map((tab, index) => {
        const isActive = tab.key === activeKey;
        const isDragging = dragIndex === index;
        const isOver = dragOverIndex === index && dragIndex !== index;

        return (
          <Dropdown key={tab.key} menu={getContextMenu(tab.key)} trigger={['contextMenu']}>
            <div
              ref={isActive ? activeRef : undefined}
              className={
                `rg-tab${isActive ? ' rg-tab-active' : ''}` +
                `${isDragging ? ' rg-tab-dragging' : ''}` +
                `${isOver ? ' rg-tab-dragover' : ''}`
              }
              draggable={tab.closable}
              onClick={() => handleActivate(tab.key)}
              onMouseDown={(e) => handleMiddleClick(e, tab.key)}
              onDragStart={(e) => handleDragStart(e, index)}
              onDragOver={(e) => handleDragOver(e, index)}
              onDragEnd={handleDragEnd}
              onDragLeave={() => setDragOverIndex(null)}
            >
              <span className="rg-tab-icon">{iconMap[tab.key]}</span>
              <span className="rg-tab-label">{tab.label}</span>
              {tab.closable && (
                <span
                  className="rg-tab-close"
                  onClick={(e) => handleClose(e, tab.key)}
                  title="Cerrar pestaña"
                >
                  <CloseOutlined />
                </span>
              )}
              {isActive && <span className="rg-tab-indicator" />}
            </div>
          </Dropdown>
        );
      })}
    </div>
  );
}
