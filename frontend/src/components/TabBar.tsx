import { useRef, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { Dropdown } from 'antd';
import { CloseOutlined } from '@ant-design/icons';
import { useTabStore } from '../store/tabStore';

// ═══════════════════════════════════════════════════
//  TabBar — Professional multi-tab workspace strip
// ═══════════════════════════════════════════════════

/** Route → icon mapping (React nodes). Passed from AppLayout to avoid circular deps. */
export interface TabBarProps {
  iconMap: Record<string, React.ReactNode>;
}

export function TabBar({ iconMap }: TabBarProps) {
  const navigate = useNavigate();
  const { tabs, activeKey, setActiveTab, closeTab, closeAll, closeOthers } = useTabStore();
  const barRef = useRef<HTMLDivElement>(null);
  const activeRef = useRef<HTMLDivElement>(null);

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
      {tabs.map((tab) => {
        const isActive = tab.key === activeKey;
        return (
          <Dropdown key={tab.key} menu={getContextMenu(tab.key)} trigger={['contextMenu']}>
            <div
              ref={isActive ? activeRef : undefined}
              className={`rg-tab ${isActive ? 'rg-tab-active' : ''}`}
              onClick={() => handleActivate(tab.key)}
              onMouseDown={(e) => handleMiddleClick(e, tab.key)}
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
            </div>
          </Dropdown>
        );
      })}
    </div>
  );
}
