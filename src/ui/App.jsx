import React, { useEffect, useMemo, useRef, useState } from 'react';
import Toolbar from './shell/Toolbar';
import { GridIcon, ListIcon, SearchIcon } from './icons';
import TabBar from './shell/TabBar';
import Sidebar from './shell/Sidebar';
import Menu from './components/Menu';
import useBreakpoint from './hooks/useBreakpoint';
import useSettings from './hooks/useSettings';
import {
  listSourceRoots, selectDirectory, saveSourceRoot, removeSourceRoot, openInNewWindow,
  resolveDroppedFolders
} from './data/sources';
import { getFolderView, setFolderView } from './data/prefs';
import RootsPage from './features/roots/RootsPage';
import FolderPage from './features/folder/FolderPage';
import CosHomePage from './features/cos/CosHomePage';
import CosEntityPage from './features/cos/CosEntityPage';
import CosSetListPage from './features/cos/CosSetListPage';
import CosSetAlbumPage from './features/cos/CosSetAlbumPage';
import FavoritesPage from './features/favorites/FavoritesPage';
import { applyTheme } from './data/settings';
import { invoke, CHANNELS } from './data/ipc';

/**
 * 4.1 外壳、导航与标签页。
 * 位置模型：{ kind: 'roots' | 'folder' | 'favorites' | 'cos-*' }。
 * 每个标签各自持有一份 history/historyIndex（Finder 式），前进后退只作用于当前标签。
 */

let tabSequence = 0;

function createTab(location) {
  tabSequence += 1;
  return { id: `tab-${tabSequence}`, history: [location], historyIndex: 0 };
}

const TAB_SESSION_KEY = 'pav.tabs.v1';

/** 重启后恢复上次的标签：数量、顺序、当前标签、各自的历史位置。 */
function loadTabSession() {
  try {
    const raw = window.localStorage.getItem(TAB_SESSION_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed?.tabs) || parsed.tabs.length === 0) return null;
    const tabs = parsed.tabs
      .filter((entry) => Array.isArray(entry?.history) && entry.history.length > 0
        && entry.history.every((item) => item && typeof item.kind === 'string'))
      .map((entry) => {
        tabSequence += 1;
        const historyIndex = Math.min(
          Math.max(0, Number(entry.historyIndex) || 0),
          entry.history.length - 1
        );
        return { id: `tab-${tabSequence}`, history: entry.history, historyIndex };
      });
    if (tabs.length === 0) return null;
    const activeIndex = Math.min(Math.max(0, Number(parsed.activeIndex) || 0), tabs.length - 1);
    return { tabs, activeTabId: tabs[activeIndex].id };
  } catch (_error) {
    return null;
  }
}

function titleFor(location, sources) {
  if (location.kind === 'folder') {
    const source = sources.find((item) => item.sourceId === location.sourceId);
    const segments = String(location.relativePath || '').split('/').filter(Boolean);
    if (segments.length > 0) return segments[segments.length - 1];
    return source?.label || '文件夹';
  }
  if (location.kind === 'favorites') return '我的收藏';
  if (location.kind === 'cos-home') return 'Cos 图库';
  if (location.kind === 'cos-characters') return '按角色';
  if (location.kind === 'cos-cosers') return '按署名';
  if (location.kind === 'cos-sets') return location.entity?.name || '全部作品';
  if (location.kind === 'cos-set') return location.name || '套图';
  return '文件夹';
}

export default function App() {
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [sidebarManuallyToggled, setSidebarManuallyToggled] = useState(false);
  const [sources, setSources] = useState([]);
  const [sourceError, setSourceError] = useState('');
  const [viewMode, setViewMode] = useState('grid');
  const [bootSession] = useState(loadTabSession);
  const [tabs, setTabs] = useState(() => bootSession?.tabs ?? [createTab({ kind: 'roots' })]);
  const [activeTabId, setActiveTabId] = useState(() => bootSession?.activeTabId ?? tabs[0].id);
  const [menu, setMenu] = useState(null);
  const [searchQuery, setSearchQuery] = useState('');
  const searchInputRef = useRef(null);
  const breakpoint = useBreakpoint();
  const settings = useSettings();

  const activeTab = tabs.find((tab) => tab.id === activeTabId) || tabs[0];
  const location = activeTab.history[activeTab.historyIndex];
  const source = location.kind === 'folder'
    ? sources.find((item) => item.sourceId === location.sourceId)
    : null;

  useEffect(() => {
    if (breakpoint === 'medium' || breakpoint === 'small') {
      setSidebarCollapsed(true);
      setSidebarManuallyToggled(false);
      return;
    }
    if (!sidebarManuallyToggled) setSidebarCollapsed(false);
  }, [breakpoint, sidebarManuallyToggled]);

  useEffect(() => {
    applyTheme(settings.theme);
    if (settings.theme === 'auto' && window.matchMedia) {
      const media = window.matchMedia('(prefers-color-scheme: light)');
      const handler = () => applyTheme('auto');
      media.addEventListener?.('change', handler);
      return () => media.removeEventListener?.('change', handler);
    }
    return undefined;
  }, [settings.theme]);

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
      setViewMode(getFolderView(source.sourceId, location.relativePath || '', settings.defaultViewMode));
    }
  }, [location, source, settings.defaultViewMode]);

  useEffect(() => {
    setSearchQuery('');
  }, [location]);

  // 标签页自动落盘：数量、顺序、当前标签与各自历史位置。
  useEffect(() => {
    try {
      const activeIndex = Math.max(0, tabs.findIndex((tab) => tab.id === activeTabId));
      window.localStorage.setItem(TAB_SESSION_KEY, JSON.stringify({
        tabs: tabs.map((tab) => ({ history: tab.history, historyIndex: tab.historyIndex })),
        activeIndex
      }));
    } catch (_error) {
      // 存储不可用时只在本次运行内保留
    }
  }, [tabs, activeTabId]);

  const changeViewMode = (mode) => {
    setViewMode(mode);
    if (location.kind === 'folder' && source) {
      setFolderView(source.sourceId, location.relativePath || '', mode);
    }
  };

  const navigate = (next, options = {}) => {
    if (options.newTab) {
      const tab = createTab(next);
      setTabs((prev) => [...prev, tab]);
      setActiveTabId(tab.id);
      return;
    }
    setTabs((prev) => prev.map((tab) => {
      if (tab.id !== activeTabId) return tab;
      const history = [...tab.history.slice(0, tab.historyIndex + 1), next];
      return { ...tab, history, historyIndex: history.length - 1 };
    }));
  };

  const jumpToHistoryIndex = (targetIndex) => {
    setTabs((prev) => prev.map((tab) => (
      tab.id === activeTabId
        ? { ...tab, historyIndex: Math.min(tab.historyIndex, targetIndex) }
        : tab
    )));
  };

  const openHistoryMenu = (anchor) => {
    setMenu({ kind: 'history', anchor });
  };

  const goBack = () => {
    setTabs((prev) => prev.map((tab) => (
      tab.id === activeTabId
        ? { ...tab, historyIndex: Math.max(0, tab.historyIndex - 1) }
        : tab
    )));
  };

  const goForward = () => {
    setTabs((prev) => prev.map((tab) => (
      tab.id === activeTabId
        ? { ...tab, historyIndex: Math.min(tab.history.length - 1, tab.historyIndex + 1) }
        : tab
    )));
  };

  const openNewTab = () => {
    const tab = createTab(location);
    setTabs((prev) => [...prev, tab]);
    setActiveTabId(tab.id);
  };

  const selectTab = (id) => setActiveTabId(id);

  const closeTab = (id) => {
    const index = tabs.findIndex((tab) => tab.id === id);
    if (index < 0) return;
    if (tabs.length === 1) {
      const tab = createTab({ kind: 'roots' });
      setTabs([tab]);
      setActiveTabId(tab.id);
      return;
    }
    const next = tabs.filter((tab) => tab.id !== id);
    if (id === activeTabId) {
      setActiveTabId(next[Math.max(0, index - 1)].id);
    }
    setTabs(next);
  };

  const closeOtherTabs = (id) => {
    const keep = tabs.find((tab) => tab.id === id);
    if (!keep) return;
    setTabs([keep]);
    setActiveTabId(keep.id);
  };

  const closeTabsToRight = (id) => {
    const index = tabs.findIndex((tab) => tab.id === id);
    if (index < 0) return;
    const next = tabs.slice(0, index + 1);
    setTabs(next);
    if (!next.some((tab) => tab.id === activeTabId)) setActiveTabId(id);
  };

  const reorderTabs = (sourceId, targetId) => {
    const from = tabs.findIndex((tab) => tab.id === sourceId);
    const to = tabs.findIndex((tab) => tab.id === targetId);
    if (from < 0 || to < 0 || from === to) return;
    const next = [...tabs];
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);
    setTabs(next);
  };

  const saveTabGroup = () => {
    try {
      window.localStorage.setItem('pav.tabgroup.v1', JSON.stringify(tabs.map((tab) => ({
        history: tab.history,
        historyIndex: tab.historyIndex
      }))));
      setSourceError('已保存当前标签组');
    } catch (_error) {
      setSourceError('保存标签组失败');
    }
  };

  const restoreTabGroup = () => {
    try {
      const raw = window.localStorage.getItem('pav.tabgroup.v1');
      if (!raw) {
        setSourceError('还没有保存过标签组');
        return;
      }
      const saved = JSON.parse(raw);
      if (!Array.isArray(saved) || saved.length === 0) return;
      const restored = saved.map((entry) => ({
        id: (() => { tabSequence += 1; return `tab-${tabSequence}`; })(),
        history: entry.history,
        historyIndex: Math.min(entry.historyIndex, entry.history.length - 1)
      }));
      setTabs(restored);
      setActiveTabId(restored[0].id);
    } catch (_error) {
      setSourceError('恢复标签组失败');
    }
  };

  const upsertSource = (nextSource) => {
    setSources((prev) => {
      const exists = prev.some((item) => item.sourceId === nextSource.sourceId);
      return exists
        ? prev.map((item) => (item.sourceId === nextSource.sourceId ? nextSource : item))
        : [...prev, nextSource];
    });
  };

  // 打开文件夹：选目录 → 注册为照片来源 → 由用户选在当前标签/新标签/新窗口打开。
  const requestOpenFolder = async (anchor) => {
    setMenu(null);
    try {
      const selectedPath = await selectDirectory();
      if (!selectedPath) return;
      const registered = await saveSourceRoot(selectedPath);
      upsertSource(registered);
      setSourceError('');
      setMenu({ kind: 'open-folder', anchor, source: registered });
    } catch (error) {
      setSourceError(error?.message || '打开文件夹失败');
    }
  };

  const requestRemoveSource = (targetSource, anchor) => {
    setMenu({ kind: 'remove-source', anchor, source: targetSource });
  };

  const confirmRemoveSource = async () => {
    const target = menu?.source;
    if (!target) return;
    try {
      await removeSourceRoot(target.sourceId);
      setSources((prev) => prev.filter((item) => item.sourceId !== target.sourceId));
      if (location.kind === 'folder' && location.sourceId === target.sourceId) {
        navigate({ kind: 'roots' });
      }
      setSourceError('');
    } catch (error) {
      setSourceError(error?.message || '移除照片来源失败');
    }
  };

  useEffect(() => {
    const onDragOver = (event) => {
      event.preventDefault();
    };
    const onDrop = async (event) => {
      event.preventDefault();
      const dropped = [...(event.dataTransfer?.files || [])]
        .map((file) => file.path)
        .filter(Boolean);
      if (dropped.length === 0) return;
      try {
        const { folders, rejected } = await resolveDroppedFolders(dropped);
        const registered = [];
        for (const folderPath of folders) {
          registered.push(await saveSourceRoot(folderPath));
        }
        registered.forEach((item) => upsertSource(item));
        if (rejected.length > 0) {
          setSourceError('只支持拖入文件夹');
        } else {
          setSourceError('');
        }
        registered.forEach((item) => {
          navigate({ kind: 'folder', sourceId: item.sourceId, relativePath: '' }, { newTab: true });
        });
      } catch (error) {
        setSourceError(error?.message || '拖入文件夹失败');
      }
    };
    window.addEventListener('dragover', onDragOver);
    window.addEventListener('drop', onDrop);
    return () => {
      window.removeEventListener('dragover', onDragOver);
      window.removeEventListener('drop', onDrop);
    };
  }, [navigate]);

  const onSidebarNavigate = (key, anchor) => {
    if (key === 'folder') {
      navigate({ kind: 'roots' });
      return;
    }
    if (key === 'favorites') {
      navigate({ kind: 'favorites' });
      return;
    }
    if (key === 'cos') {
      navigate({ kind: 'cos-home' });
      return;
    }
    if (key === 'cos-all') {
      navigate({ kind: 'cos-sets', viewKind: 'all' });
      return;
    }
    if (key === 'cos-characters') {
      navigate({ kind: 'cos-characters' });
      return;
    }
    if (key === 'cos-cosers') {
      navigate({ kind: 'cos-cosers' });
      return;
    }
    if (key === 'open-folder') {
      requestOpenFolder(anchor);
      return;
    }
    if (sources.some((item) => item.sourceId === key)) {
      navigate({ kind: 'folder', sourceId: key, relativePath: '' });
    }
  };

  // 全局快捷键：输入框内不拦截；查看器打开时只让查看器处理方向键与 Esc。
  useEffect(() => {
    const isEditable = (target) => {
      if (!target) return false;
      const tag = target.tagName;
      return tag === 'INPUT' || tag === 'TEXTAREA' || target.isContentEditable;
    };
    const viewerOpen = () => Boolean(document.querySelector('[role="dialog"]'));
    const goUp = () => {
      if (location.kind !== 'folder') return;
      const segments = String(location.relativePath || '').split('/').filter(Boolean);
      if (segments.length === 0) {
        navigate({ kind: 'roots' });
        return;
      }
      navigate({
        kind: 'folder',
        sourceId: location.sourceId,
        relativePath: segments.slice(0, -1).join('/'),
        siblings: null
      });
    };
    const cycleTab = (step) => {
      const index = tabs.findIndex((tab) => tab.id === activeTabId);
      if (index < 0) return;
      const next = (index + step + tabs.length) % tabs.length;
      setActiveTabId(tabs[next].id);
    };
    const onKey = (event) => {
      if (isEditable(event.target)) return;
      if (!(event.metaKey || event.ctrlKey)) return;
      const key = event.key;
      if (key === '{' || (key === '[' && event.shiftKey)) {
        event.preventDefault();
        cycleTab(-1);
        return;
      }
      if (key === '}' || (key === ']' && event.shiftKey)) {
        event.preventDefault();
        cycleTab(1);
        return;
      }
      if (key === '[') {
        event.preventDefault();
        goBack();
        return;
      }
      if (key === ']') {
        event.preventDefault();
        goForward();
        return;
      }
      if (key === 'ArrowUp') {
        if (viewerOpen()) return;
        event.preventDefault();
        goUp();
        return;
      }
      if (key.toLowerCase() === 'f') {
        if (viewerOpen()) return;
        event.preventDefault();
        const input = searchInputRef.current?.querySelector?.('input')
          || searchInputRef.current
          || document.querySelector('.cos-search input')
          || document.querySelector('input[type="search"]');
        if (input) {
          input.focus();
          if (typeof input.select === 'function') input.select();
        }
        return;
      }
      if (key === ',') {
        event.preventDefault();
        invoke(CHANNELS.OPEN_SETTINGS_WINDOW).catch(() => {});
        return;
      }
      if (key.toLowerCase() === 'w') {
        event.preventDefault();
        closeTab(activeTabId);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [activeTabId, tabs, location, activeTab.historyIndex]);

  const title = titleFor(location, sources);

  const menuItems = useMemo(() => {
    if (!menu) return [];
    if (menu.kind === 'open-folder') {
      const target = { kind: 'folder', sourceId: menu.source.sourceId, relativePath: '' };
      return [
        { key: 'current', label: '在当前标签页打开', onSelect: () => navigate(target) },
        { key: 'new-tab', label: '在新标签页打开', onSelect: () => navigate(target, { newTab: true }) },
        {
          key: 'new-window',
          label: '在新窗口中打开',
          onSelect: () => {
            openInNewWindow({ sourceId: menu.source.sourceId }).catch((error) => {
              setSourceError(error?.message || '创建新窗口失败');
            });
          }
        }
      ];
    }
    if (menu.kind === 'tab') {
      return [
        { key: 'other', label: '关闭其他标签页', onSelect: () => closeOtherTabs(menu.tabId) },
        { key: 'right', label: '关闭右侧标签页', onSelect: () => closeTabsToRight(menu.tabId) },
        { key: 'save-group', label: '保存当前标签组', onSelect: saveTabGroup },
        { key: 'restore-group', label: '恢复已保存标签组', onSelect: restoreTabGroup }
      ];
    }
    if (menu.kind === 'history') {
      const recent = [];
      for (let i = activeTab.historyIndex - 1; i >= 0 && recent.length < 10; i -= 1) {
        const entry = activeTab.history[i];
        recent.push({
          key: `h-${i}`,
          label: `${recent.length + 1}. ${titleFor(entry, sources)}`,
          onSelect: () => jumpToHistoryIndex(i)
        });
      }
      if (recent.length === 0) {
        recent.push({ key: 'empty', label: '还没有历史记录', disabled: true, onSelect: () => {} });
      }
      return recent;
    }
    if (menu.kind === 'remove-source') {
      return [
        {
          key: 'remove',
          label: `移除「${menu.source.label}」（不会删除磁盘文件）`,
          danger: true,
          onSelect: confirmRemoveSource
        }
      ];
    }
    return [];
  }, [menu, sources]);

  const activeKey = useMemo(() => {
    if (location.kind === 'roots') return 'folder';
    if (location.kind === 'favorites') return 'favorites';
    if (location.kind === 'folder') return location.sourceId;
    if (location.kind === 'cos-home') return 'cos';
    if (location.kind === 'cos-characters') return 'cos-characters';
    if (location.kind === 'cos-cosers') return 'cos-cosers';
    if (location.kind === 'cos-sets') {
      if (location.viewKind === 'characters') return 'cos-characters';
      if (location.viewKind === 'cosers') return 'cos-cosers';
      return 'cos-all';
    }
    return 'cos';
  }, [location]);

  const tabItems = tabs.map((tab) => ({
    id: tab.id,
    title: titleFor(tab.history[tab.historyIndex], sources),
    active: tab.id === activeTabId
  }));

  return (
    <div className="app">
      <Toolbar
        title={title}
        sidebarCollapsed={sidebarCollapsed}
        onToggleSidebar={() => {
          setSidebarManuallyToggled(true);
          setSidebarCollapsed((value) => !value);
        }}
        canGoBack={activeTab.historyIndex > 0}
        canGoForward={activeTab.historyIndex < activeTab.history.length - 1}
        onBack={goBack}
        onForward={goForward}
        onBackLongPress={openHistoryMenu}
        right={location.kind === 'folder' ? (
          <>
            <div className="segmented">
              <button className="icon-button" type="button" aria-label="图标视图"
                aria-pressed={viewMode === 'grid'} onClick={() => changeViewMode('grid')}><GridIcon /></button>
              <button className="icon-button" type="button" aria-label="列表视图"
                aria-pressed={viewMode === 'list'} onClick={() => changeViewMode('list')}><ListIcon /></button>
            </div>
            <label className="cos-search toolbar-search" ref={searchInputRef}>
              <SearchIcon />
              <input
                type="search"
                value={searchQuery}
                aria-label="搜索这个文件夹"
                placeholder="搜索这个文件夹"
                onChange={(event) => setSearchQuery(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Escape') setSearchQuery('');
                }}
              />
            </label>
          </>
        ) : null}
      />
      <TabBar
        tabs={tabItems}
        onSelect={selectTab}
        onClose={closeTab}
        onNew={openNewTab}
        onContextMenu={(event, id) => setMenu({ kind: 'tab', point: { x: event.clientX, y: event.clientY }, tabId: id })}
        onReorder={reorderTabs}
      />
      <div className="body">
        <Sidebar
          collapsed={sidebarCollapsed}
          sources={sources}
          sourceError={sourceError}
          active={activeKey}
          onNavigate={onSidebarNavigate}
          onRequestRemoveSource={requestRemoveSource}
        />
        <main className="main">
          {location.kind === 'favorites' ? (
            <FavoritesPage
              onOpenFolder={(item) => navigate({
                kind: 'folder',
                sourceId: item.sourceId,
                relativePath: item.relativePath
              })}
            />
          ) : location.kind === 'cos-home' ? (
            <CosHomePage onNavigate={navigate} />
          ) : location.kind === 'cos-characters' ? (
            <CosEntityPage
              kind="characters"
              onOpenEntity={(entity) => navigate({
                kind: 'cos-sets',
                viewKind: 'characters',
                entity
              })}
            />
          ) : location.kind === 'cos-cosers' ? (
            <CosEntityPage
              kind="cosers"
              onOpenEntity={(entity) => navigate({
                kind: 'cos-sets',
                viewKind: 'cosers',
                entity
              })}
            />
          ) : location.kind === 'cos-sets' ? (
            <CosSetListPage
              viewKind={location.viewKind}
              entity={location.entity}
              onOpenSet={(set, options) => navigate({
                kind: 'cos-set',
                setId: set.id,
                name: set.displayName,
                options
              })}
            />
          ) : location.kind === 'cos-set' ? (
            <CosSetAlbumPage
              setId={location.setId}
              setName={location.name}
              options={location.options || null}
              onNavigateSet={(next) => navigate({
                kind: 'cos-set',
                setId: next.setId,
                name: next.name,
                options: next.options
              })}
            />
          ) : location.kind === 'roots' ? (
            <RootsPage
              sources={sources}
              onOpen={(item) => navigate({ kind: 'folder', sourceId: item.sourceId, relativePath: '' })}
              onOpenFolder={requestOpenFolder}
            />
          ) : source ? (
            <FolderPage
              key={`${source.sourceId}:${location.relativePath}`}
              source={source}
              relativePath={location.relativePath}
              viewMode={viewMode}
              onViewModeChange={changeViewMode}
              siblings={location.siblings || null}
              onOpenRoots={() => navigate({ kind: 'roots' })}
              searchQuery={searchQuery}
              onSearchChange={setSearchQuery}
              onOpenInNewTab={(target) => navigate({
                kind: 'folder',
                sourceId: target.sourceId,
                relativePath: target.relativePath
              }, { newTab: true })}
              onOpenInNewWindow={(target) => {
                openInNewWindow({ sourceId: target.sourceId, relativePath: target.relativePath })
                  .catch((error) => setSourceError(error?.message || '创建新窗口失败'));
              }}
              onOpenFolder={(relativePath, context) => navigate({
                kind: 'folder',
                sourceId: source.sourceId,
                relativePath,
                siblings: context?.siblings || null
              })}
            />
          ) : (
            <div style={{ padding: 48, color: 'var(--text-dim)', textAlign: 'center', fontSize: 12.5 }}>
              照片来源已不存在，请从侧栏重新选择。
            </div>
          )}
        </main>
      </div>
      <Menu
        open={Boolean(menu)}
        anchor={menu?.anchor}
        items={menuItems}
        onClose={() => setMenu(null)}
        label={menu?.kind === 'remove-source' ? '移除照片来源'
          : (menu?.kind === 'tab' ? '标签页菜单'
            : (menu?.kind === 'history' ? '后退历史' : '选择打开方式'))}
      />
    </div>
  );
}
