import React, { useEffect, useMemo, useState } from 'react';
import Toolbar from './shell/Toolbar';
import { GridIcon, ListIcon } from './icons';
import TabBar from './shell/TabBar';
import Sidebar from './shell/Sidebar';
import useBreakpoint from './hooks/useBreakpoint';
import { listSourceRoots } from './data/sources';
import { getFolderView, setFolderView } from './data/prefs';
import RootsPage from './features/roots/RootsPage';
import FolderPage from './features/folder/FolderPage';

/**
 * 4.0 外壳与导航。位置模型：{ kind: 'roots' } 或 { kind: 'folder', sourceId, relativePath }。
 * S1 范围：照片来源页 + 文件夹网格 / 列表。
 */
export default function App() {
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [sources, setSources] = useState([]);
  const [sourceError, setSourceError] = useState('');
  const [viewMode, setViewMode] = useState('grid');
  const [history, setHistory] = useState([{ kind: 'roots' }]);
  const [historyIndex, setHistoryIndex] = useState(0);
  const breakpoint = useBreakpoint();

  const location = history[historyIndex];
  const source = location.kind === 'folder'
    ? sources.find((item) => item.sourceId === location.sourceId)
    : null;

  useEffect(() => {
    if (breakpoint === 'medium' || breakpoint === 'small') {
      setSidebarCollapsed(true);
    }
  }, [breakpoint]);

  useEffect(() => {
    let alive = true;
    listSourceRoots()
      .then((roots) => {
        if (alive) setSources(roots);
      })
      .catch((error) => {
        if (alive) setSourceError(error?.message || '来源加载失败');
      });
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    if (location.kind === 'folder' && source) {
      setViewMode(getFolderView(source.sourceId, location.relativePath || ''));
    }
  }, [location, source]);

  const changeViewMode = (mode) => {
    setViewMode(mode);
    if (location.kind === 'folder' && source) {
      setFolderView(source.sourceId, location.relativePath || '', mode);
    }
  };

  const navigate = (next) => {
    setHistory((prev) => [...prev.slice(0, historyIndex + 1), next]);
    setHistoryIndex((index) => index + 1);
  };

  const onSidebarNavigate = (key) => {
    if (key === 'folder') {
      navigate({ kind: 'roots' });
      return;
    }
    if (sources.some((item) => item.sourceId === key)) {
      navigate({ kind: 'folder', sourceId: key, relativePath: '' });
    }
  };

  const segments = location.kind === 'folder'
    ? String(location.relativePath || '').split('/').filter(Boolean)
    : [];
  const title = location.kind === 'folder'
    ? (segments.length > 0 ? segments[segments.length - 1] : (source?.label || '文件夹'))
    : '文件夹';

  const activeKey = useMemo(() => {
    if (location.kind === 'roots') return 'folder';
    return location.sourceId;
  }, [location]);

  return (
    <div className="app">
      <Toolbar
        title={title}
        sidebarCollapsed={sidebarCollapsed}
        onToggleSidebar={() => setSidebarCollapsed((value) => !value)}
        canGoBack={historyIndex > 0}
        canGoForward={historyIndex < history.length - 1}
        onBack={() => setHistoryIndex((index) => Math.max(0, index - 1))}
        onForward={() => setHistoryIndex((index) => Math.min(history.length - 1, index + 1))}
        right={location.kind === 'folder' ? (
          <div className="segmented">
            <button className="icon-button" type="button" aria-label="图标视图"
              aria-pressed={viewMode === 'grid'} onClick={() => changeViewMode('grid')}><GridIcon /></button>
            <button className="icon-button" type="button" aria-label="列表视图"
              aria-pressed={viewMode === 'list'} onClick={() => changeViewMode('list')}><ListIcon /></button>
          </div>
        ) : null}
      />
      <TabBar tabs={[{ id: 'current', title, active: true }]} />
      <div className="body">
        <Sidebar
          collapsed={sidebarCollapsed}
          sources={sources}
          sourceError={sourceError}
          active={activeKey}
          onNavigate={onSidebarNavigate}
        />
        <main className="main">
          {location.kind === 'roots' ? (
            <RootsPage
              sources={sources}
              onOpen={(item) => navigate({ kind: 'folder', sourceId: item.sourceId, relativePath: '' })}
            />
          ) : source ? (
            <FolderPage
              key={`${source.sourceId}:${location.relativePath}`}
              source={source}
              relativePath={location.relativePath}
              viewMode={viewMode}
              onViewModeChange={changeViewMode}
              siblings={location.siblings || null}
              onOpenFolder={(relativePath, context) => navigate({
                kind: 'folder',
                sourceId: source.sourceId,
                relativePath,
                siblings: context?.siblings || null
              })}
            />
          ) : (
            <div style={{ padding: 48, color: "var(--text-dim)", textAlign: "center", fontSize: 12.5 }}>正在加载来源…</div>
          )}
        </main>
      </div>
    </div>
  );
}
