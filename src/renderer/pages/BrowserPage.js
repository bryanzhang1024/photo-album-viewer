import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import {
  Box,
  Tabs,
  Tab,
  IconButton,
  Tooltip,
  Typography,
  Menu,
  MenuItem,
  Divider,
  Snackbar,
  Alert
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import CloseIcon from '@mui/icons-material/Close';
import KeyboardArrowDownIcon from '@mui/icons-material/KeyboardArrowDown';
import FolderOpenIcon from '@mui/icons-material/FolderOpen';
import FolderIcon from '@mui/icons-material/Folder';
import PhotoAlbumIcon from '@mui/icons-material/PhotoAlbum';
import FavoriteIcon from '@mui/icons-material/Favorite';
import HomePage from './HomePage';
import AlbumPage from './AlbumPage';
import FavoritesPage from './FavoritesPage';
import CHANNELS from '../../common/ipc-channels';
import {
  normalizeTargetPath,
  withLastPathTracking,
  getLastPath,
  setLastPath
} from '../utils/navigation';
import { getDirname } from '../utils/pathUtils';

const parseURLPath = (pathname, search) => {
  const searchParams = new URLSearchParams(search);
  const view = searchParams.get('view');
  const safeViewMode = view === 'album' || view === 'favorites' ? view : 'folder';
  const image = searchParams.get('image');

  // 处理不同的路由模式
  if (pathname === '/') {
    return {
      targetPath: '',
      viewMode: 'folder',
      initialImage: null,
      isRoot: true
    };
  }

  if (pathname === '/favorites') {
    return {
      targetPath: '',
      viewMode: 'favorites',
      initialImage: null,
      isRoot: true
    };
  }

  if (pathname === '/browse') {
    return {
      targetPath: '',
      viewMode: safeViewMode,
      initialImage: null,
      isRoot: true
    };
  }

  if (pathname.startsWith('/browse/')) {
    // 新路由模式: /browse/path?view=album&image=xxx
    const pathPart = pathname.replace('/browse/', '');
    const decodedPath = pathPart ? normalizeTargetPath(decodeURIComponent(pathPart)) : '';

    return {
      targetPath: decodedPath,
      viewMode: safeViewMode,
      initialImage: image ? decodeURIComponent(image) : null,
      isRoot: !decodedPath
    };
  }

  // 处理根路径
  return {
    targetPath: '',
    viewMode: 'folder',
    initialImage: null,
    isRoot: true
  };
};

const TABS_SESSION_KEY = 'browser_tabs_session_v1';
const SAVED_TABS_SNAPSHOT_KEY = 'browser_tabs_snapshot_v1';
const DEFAULT_ROOT_PATH_KEY = 'lastRootPath_default';
const createTabId = () => `tab_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
const DRAG_INSERT_BEFORE = 'before';
const DRAG_INSERT_AFTER = 'after';

const getDefaultRootPath = () => normalizeTargetPath(localStorage.getItem(DEFAULT_ROOT_PATH_KEY) || '');

const getPathDisplayName = (targetPath) => {
  const normalized = normalizeTargetPath(targetPath || '').replace(/\/+$/g, '');
  if (!normalized) return '主页';

  const segments = normalized.split('/').filter(Boolean);
  if (!segments.length) return normalized;

  return decodeURIComponent(segments[segments.length - 1]);
};

const normalizeViewMode = (viewMode) => {
  if (viewMode === 'album') return 'album';
  if (viewMode === 'favorites') return 'favorites';
  return 'folder';
};

const getTabTitle = (targetPath, viewMode = 'folder') => {
  if (normalizeViewMode(viewMode) === 'favorites') {
    return '我的收藏';
  }
  return getPathDisplayName(targetPath);
};

const createTabFromState = (state) => ({
  id: createTabId(),
  targetPath: normalizeTargetPath(state?.targetPath || ''),
  viewMode: normalizeViewMode(state?.viewMode),
  initialImage: state?.initialImage || null,
  title: getTabTitle(state?.targetPath || '', state?.viewMode)
});

const sanitizeTabFromSession = (tab) => {
  if (!tab || typeof tab !== 'object') return null;

  const targetPath = normalizeTargetPath(tab.targetPath || '');
  const viewMode = normalizeViewMode(tab.viewMode);

  return {
    id: typeof tab.id === 'string' && tab.id ? tab.id : createTabId(),
    targetPath,
    viewMode,
    initialImage: typeof tab.initialImage === 'string' && tab.initialImage ? tab.initialImage : null,
    title: getTabTitle(targetPath, viewMode)
  };
};

const findSessionTabMatchingURL = (tabsSession, urlState) => {
  if (!tabsSession || !Array.isArray(tabsSession.tabs) || !urlState) {
    return null;
  }

  const normalizedTargetPath = normalizeTargetPath(urlState.targetPath || '');
  const expectedViewMode = normalizeViewMode(urlState.viewMode);
  const expectedImage = urlState.initialImage || null;

  return tabsSession.tabs.find((tab) => (
    tab.viewMode === expectedViewMode
    && (
      expectedViewMode === 'favorites'
        ? true
        : (
          tab.targetPath === normalizedTargetPath
          && (tab.initialImage || null) === expectedImage
        )
    )
  )) || null;
};

export const reorderTabsById = (tabs, sourceTabId, targetTabId, position = DRAG_INSERT_BEFORE) => {
  if (!Array.isArray(tabs) || tabs.length < 2) return tabs;
  if (!sourceTabId || !targetTabId || sourceTabId === targetTabId) return tabs;

  const sourceIndex = tabs.findIndex((tab) => tab.id === sourceTabId);
  if (sourceIndex === -1) return tabs;

  const reordered = [...tabs];
  const [movedTab] = reordered.splice(sourceIndex, 1);
  const targetIndex = reordered.findIndex((tab) => tab.id === targetTabId);
  if (targetIndex === -1) return tabs;

  const insertIndex = targetIndex + (position === DRAG_INSERT_AFTER ? 1 : 0);
  reordered.splice(insertIndex, 0, movedTab);

  return reordered;
};

const createTabsSessionPayload = (tabs, activeTabId) => ({
  tabs: tabs.map((tab) => ({
    id: tab.id,
    targetPath: tab.targetPath || '',
    viewMode: tab.viewMode || 'folder',
    initialImage: tab.initialImage || null
  })),
  activeTabId,
  savedAt: Date.now()
});

const loadTabsSession = (storageKey = TABS_SESSION_KEY) => {
  try {
    const raw = localStorage.getItem(storageKey);
    if (!raw) return null;

    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed?.tabs) || parsed.tabs.length === 0) {
      return null;
    }

    const sanitizedTabs = parsed.tabs
      .map(sanitizeTabFromSession)
      .filter(Boolean);

    if (!sanitizedTabs.length) {
      return null;
    }

    const requestedActiveId = typeof parsed.activeTabId === 'string' ? parsed.activeTabId : null;
    const hasRequestedActive = requestedActiveId && sanitizedTabs.some((tab) => tab.id === requestedActiveId);

    return {
      tabs: sanitizedTabs,
      activeTabId: hasRequestedActive ? requestedActiveId : sanitizedTabs[0].id
    };
  } catch (error) {
    console.warn('恢复标签会话失败:', error);
    return null;
  }
};

const ipcRenderer = window.electronAPI || null;

function BrowserPage({ colorMode, redirectFromOldRoute = false }) {
  const location = useLocation();
  const navigate = useNavigate();
  const params = useParams();
  const hasRestoredSession = useRef(false);
  const hasInitializedTabsSession = useRef(false);
  const initialTabRef = useRef(null);
  const [openFolderMenuAnchorEl, setOpenFolderMenuAnchorEl] = useState(null);
  const [tabsMenuAnchorEl, setTabsMenuAnchorEl] = useState(null);
  const [hasSavedTabsSnapshot, setHasSavedTabsSnapshot] = useState(
    () => Boolean(loadTabsSession(SAVED_TABS_SNAPSHOT_KEY))
  );
  const [successMessage, setSuccessMessage] = useState('');
  const [errorMessage, setErrorMessage] = useState('');
  const draggingTabIdRef = useRef(null);
  const [dragIndicator, setDragIndicator] = useState({ tabId: null, position: DRAG_INSERT_BEFORE });

  // 解析URL状态
  const urlState = useMemo(() =>
    parseURLPath(location.pathname, location.search),
    [location.pathname, location.search]
  );

  if (!initialTabRef.current) {
    initialTabRef.current = createTabFromState(urlState);
  }

  const [tabs, setTabs] = useState(() => [initialTabRef.current]);
  const [activeTabId, setActiveTabId] = useState(() => initialTabRef.current.id);

  const navigateWithPersist = useMemo(
    () => withLastPathTracking(navigate),
    [navigate]
  );

  useEffect(() => {
    if (!hasInitializedTabsSession.current) return;
    if (redirectFromOldRoute) return;

    try {
      localStorage.setItem(TABS_SESSION_KEY, JSON.stringify(createTabsSessionPayload(tabs, activeTabId)));
    } catch (error) {
      console.warn('保存标签会话失败:', error);
    }
  }, [tabs, activeTabId, redirectFromOldRoute]);

  // 处理旧路由的重定向
  useEffect(() => {
    if (redirectFromOldRoute) {
      const { albumPath } = params;
      const searchParams = new URLSearchParams(location.search);
      const image = searchParams.get('image');

      if (albumPath) {
        const targetPath = decodeURIComponent(albumPath);
        const imagePath = image ? decodeURIComponent(image) : null;
        navigateWithPersist(targetPath, {
          viewMode: 'album',
          initialImage: imagePath,
          replace: true,
          state: location.state
        });
      } else {
        navigate('/', { replace: true, state: location.state });
      }
    }
  }, [redirectFromOldRoute, params, location, navigate, navigateWithPersist]);

  // 启动时恢复会话
  useEffect(() => {
    if (hasRestoredSession.current) {
      return;
    }

    // 旧路由重定向流程不做会话恢复
    if (redirectFromOldRoute) {
      hasInitializedTabsSession.current = true;
      return;
    }

    const searchParams = new URLSearchParams(location.search);
    const commandLinePath = searchParams.get('initialPath');

    if (commandLinePath) {
      hasRestoredSession.current = true;
      hasInitializedTabsSession.current = true;
      const decodedPath = decodeURIComponent(commandLinePath);
      const commandLineTab = createTabFromState({
        targetPath: decodedPath,
        viewMode: 'folder',
        initialImage: null
      });
      setTabs([commandLineTab]);
      setActiveTabId(commandLineTab.id);
      navigateWithPersist(decodedPath, {
        viewMode: 'folder',
        initialImage: null,
        replace: true
      });
      return;
    }

    const restoredTabsSession = loadTabsSession();
    if (restoredTabsSession) {
      const matchedURLTab = findSessionTabMatchingURL(restoredTabsSession, urlState);
      const hasExplicitURLIntent = Boolean(urlState.targetPath) || urlState.viewMode === 'favorites';
      if (hasExplicitURLIntent && !matchedURLTab) {
        // 保持深链接行为：URL 无法匹配历史标签时，不覆盖当前 URL 导航
        hasInitializedTabsSession.current = true;
        return;
      }

      hasRestoredSession.current = true;
      hasInitializedTabsSession.current = true;
      setTabs(restoredTabsSession.tabs);
      const nextActiveTabId = matchedURLTab?.id || restoredTabsSession.activeTabId;
      setActiveTabId(nextActiveTabId);

      if (hasExplicitURLIntent) {
        return;
      }

      const activeTab = restoredTabsSession.tabs.find((tab) => tab.id === nextActiveTabId)
        || restoredTabsSession.tabs[0];

      navigateWithPersist(activeTab.targetPath, {
        viewMode: activeTab.viewMode,
        initialImage: activeTab.initialImage,
        replace: true
      });
      return;
    }

    const lastPath = getLastPath();
    if (lastPath) {
      hasRestoredSession.current = true;
      hasInitializedTabsSession.current = true;
      // 恢复上次会话的路径
      const fallbackTab = createTabFromState({
        targetPath: lastPath,
        viewMode: 'folder',
        initialImage: null
      });
      setTabs([fallbackTab]);
      setActiveTabId(fallbackTab.id);
      navigateWithPersist(lastPath, {
        viewMode: 'folder',
        initialImage: null,
        replace: true
      });
      return;
    }

    const defaultRootPath = getDefaultRootPath();
    if (defaultRootPath) {
      hasRestoredSession.current = true;
      hasInitializedTabsSession.current = true;
      const defaultRootTab = createTabFromState({
        targetPath: defaultRootPath,
        viewMode: 'folder',
        initialImage: null
      });
      setTabs([defaultRootTab]);
      setActiveTabId(defaultRootTab.id);
      navigateWithPersist(defaultRootPath, {
        viewMode: 'folder',
        initialImage: null,
        replace: true
      });
      return;
    }

    hasInitializedTabsSession.current = true;
  }, [redirectFromOldRoute, urlState.targetPath, urlState.viewMode, urlState.initialImage, location.search, navigateWithPersist]);

  // 路径变化时保存会话
  useEffect(() => {
    if (urlState.targetPath && !urlState.isRoot) {
      setLastPath(urlState.targetPath);
    } else if (urlState.isRoot) {
      // 如果返回到根目录，可以选择清除lastPath，以便下次打开是主页
      // clearLastPath();
    }
  }, [urlState.targetPath, urlState.isRoot]);

  // URL变化时，将当前URL同步回激活标签
  useEffect(() => {
    if (redirectFromOldRoute) return;

    setTabs((prevTabs) => {
      const activeIndex = prevTabs.findIndex((tab) => tab.id === activeTabId);
      if (activeIndex === -1) {
        return prevTabs;
      }

      const activeTab = prevTabs[activeIndex];
      const normalizedTargetPath = normalizeTargetPath(urlState.targetPath || '');
      const nextViewMode = normalizeViewMode(urlState.viewMode);
      const nextTitle = getTabTitle(normalizedTargetPath, nextViewMode);

      if (
        activeTab.targetPath === normalizedTargetPath &&
        activeTab.viewMode === nextViewMode &&
        activeTab.initialImage === (urlState.initialImage || null) &&
        activeTab.title === nextTitle
      ) {
        return prevTabs;
      }

      const nextTabs = [...prevTabs];
      nextTabs[activeIndex] = {
        ...activeTab,
        targetPath: normalizedTargetPath,
        viewMode: nextViewMode,
        initialImage: urlState.initialImage || null,
        title: nextTitle
      };
      return nextTabs;
    });
  }, [urlState.targetPath, urlState.viewMode, urlState.initialImage, activeTabId, redirectFromOldRoute]);

  const navigateTab = useCallback((tabId, targetPath, viewMode = 'folder', initialImage = null, replace = false) => {
    const normalizedTargetPath = normalizeTargetPath(targetPath || '');
    const nextViewMode = normalizeViewMode(viewMode);
    setTabs((prevTabs) => prevTabs.map((tab) => (
      tab.id === tabId
        ? {
            ...tab,
            targetPath: normalizedTargetPath,
            viewMode: nextViewMode,
            initialImage: initialImage || null,
            title: getTabTitle(normalizedTargetPath, nextViewMode)
          }
        : tab
    )));

    setActiveTabId(tabId);
    navigateWithPersist(normalizedTargetPath, { viewMode: nextViewMode, initialImage, replace });
  }, [navigateWithPersist]);

  // 导航函数 - 供子组件使用
  const navigateToPath = useCallback(
    (targetPath, viewMode = 'folder', initialImage = null, replace = false) => {
      navigateTab(activeTabId, targetPath, viewMode, initialImage, replace);
    },
    [activeTabId, navigateTab]
  );

  // 面包屑导航函数
  const navigateToBreadcrumb = (targetPath) => {
    // 根据路径类型自动判断视图模式
    // 这里可以加入路径类型检测逻辑
    navigateToPath(targetPath, 'folder');
  };

  // 相册点击处理
  const handleAlbumClick = (albumPath, albumName = null, initialImage = null) => {
    navigateToPath(albumPath, 'album', initialImage);
  };

  // 文件夹点击处理
  const handleFolderClick = (folderPath) => {
    navigateToPath(folderPath, 'folder');
  };

  // 返回处理
  const handleGoBack = () => {
    // 根据当前路径计算父路径
    if (!urlState.targetPath || urlState.isRoot) {
      return; // 已经在根目录
    }

    const parentPath = normalizeTargetPath(getDirname(urlState.targetPath));
    if (!parentPath || parentPath === urlState.targetPath) {
      navigateToPath('', 'folder');
      return;
    }
    navigateToPath(parentPath, 'folder');
  };

  const openNewTab = useCallback((targetPath = '', viewMode = 'folder', initialImage = null) => {
    const resolvedTargetPath = (!targetPath && viewMode === 'folder')
      ? (getDefaultRootPath() || '')
      : targetPath;
    const newTab = createTabFromState({ targetPath: resolvedTargetPath, viewMode, initialImage });
    setTabs((prevTabs) => [...prevTabs, newTab]);
    navigateTab(newTab.id, newTab.targetPath, newTab.viewMode, newTab.initialImage, false);
  }, [navigateTab]);

  const clearTabDragIndicator = useCallback(() => {
    setDragIndicator((prev) => (prev.tabId ? { tabId: null, position: DRAG_INSERT_BEFORE } : prev));
  }, []);

  const resolveDragInsertPosition = useCallback((event) => {
    const rect = event.currentTarget?.getBoundingClientRect?.();
    if (!rect) return DRAG_INSERT_BEFORE;
    return event.clientX >= rect.left + rect.width / 2 ? DRAG_INSERT_AFTER : DRAG_INSERT_BEFORE;
  }, []);

  const handleTabDragStart = useCallback((event, tabId) => {
    draggingTabIdRef.current = tabId;
    clearTabDragIndicator();
    if (event.dataTransfer) {
      event.dataTransfer.effectAllowed = 'move';
      event.dataTransfer.setData('text/plain', tabId);
    }
  }, [clearTabDragIndicator]);

  const handleTabDragOver = useCallback((event, targetTabId) => {
    event.preventDefault();
    const position = resolveDragInsertPosition(event);
    setDragIndicator((prev) => (
      prev.tabId === targetTabId && prev.position === position
        ? prev
        : { tabId: targetTabId, position }
    ));
    if (event.dataTransfer) {
      event.dataTransfer.dropEffect = 'move';
    }
  }, [resolveDragInsertPosition]);

  const handleTabDragLeave = useCallback((event, tabId) => {
    const relatedTarget = event.relatedTarget;
    if (relatedTarget && event.currentTarget?.contains?.(relatedTarget)) {
      return;
    }
    setDragIndicator((prev) => (prev.tabId === tabId ? { tabId: null, position: DRAG_INSERT_BEFORE } : prev));
  }, []);

  const handleTabDrop = useCallback((event, targetTabId) => {
    event.preventDefault();
    const sourceTabId = draggingTabIdRef.current
      || (event.dataTransfer ? event.dataTransfer.getData('text/plain') : '');
    const dropPosition = dragIndicator.tabId === targetTabId
      ? dragIndicator.position
      : resolveDragInsertPosition(event);
    draggingTabIdRef.current = null;
    clearTabDragIndicator();
    if (!sourceTabId || sourceTabId === targetTabId) return;

    setTabs((prevTabs) => reorderTabsById(prevTabs, sourceTabId, targetTabId, dropPosition));
  }, [clearTabDragIndicator, dragIndicator.position, dragIndicator.tabId, resolveDragInsertPosition]);

  const handleTabDragEnd = useCallback(() => {
    draggingTabIdRef.current = null;
    clearTabDragIndicator();
  }, [clearTabDragIndicator]);

  const handleTabChange = useCallback((event, nextTabId) => {
    if (!nextTabId || nextTabId === activeTabId) return;
    const targetTab = tabs.find((tab) => tab.id === nextTabId);
    if (!targetTab) return;

    navigateTab(
      targetTab.id,
      targetTab.targetPath,
      targetTab.viewMode,
      targetTab.initialImage,
      true
    );
  }, [activeTabId, tabs, navigateTab]);

  const closeTabById = useCallback((tabId) => {
    let fallbackTab = null;
    let shouldNavigate = false;

    setTabs((prevTabs) => {
      const closingIndex = prevTabs.findIndex((tab) => tab.id === tabId);
      if (closingIndex === -1) return prevTabs;

      if (prevTabs.length === 1) {
        const resetTab = {
          ...prevTabs[0],
          targetPath: '',
          viewMode: 'folder',
          initialImage: null,
          title: '主页'
        };
        fallbackTab = resetTab;
        shouldNavigate = true;
        return [resetTab];
      }

      const nextTabs = prevTabs.filter((tab) => tab.id !== tabId);
      if (tabId === activeTabId) {
        fallbackTab = nextTabs[Math.max(0, closingIndex - 1)] || nextTabs[0];
        shouldNavigate = true;
      }
      return nextTabs;
    });

    if (shouldNavigate && fallbackTab) {
      navigateTab(
        fallbackTab.id,
        fallbackTab.targetPath,
        fallbackTab.viewMode,
        fallbackTab.initialImage,
        true
      );
    }
  }, [activeTabId, navigateTab]);

  const handleCloseOthers = useCallback(() => {
    const activeTab = tabs.find((tab) => tab.id === activeTabId);
    if (!activeTab) return;

    setTabs([activeTab]);
    setTabsMenuAnchorEl(null);
  }, [tabs, activeTabId]);

  const handleSaveTabsSnapshot = useCallback(() => {
    setTabsMenuAnchorEl(null);
    try {
      localStorage.setItem(
        SAVED_TABS_SNAPSHOT_KEY,
        JSON.stringify(createTabsSessionPayload(tabs, activeTabId))
      );
      setHasSavedTabsSnapshot(true);
      setSuccessMessage(`已保存 ${tabs.length} 个标签页`);
    } catch (error) {
      console.warn('保存标签组失败:', error);
      setErrorMessage('保存标签组失败，请稍后重试');
    }
  }, [tabs, activeTabId]);

  const handleRestoreTabsSnapshot = useCallback(() => {
    setTabsMenuAnchorEl(null);

    const savedTabsSession = loadTabsSession(SAVED_TABS_SNAPSHOT_KEY);
    if (!savedTabsSession) {
      setHasSavedTabsSnapshot(false);
      setErrorMessage('没有可恢复的已保存标签组');
      return;
    }

    setTabs(savedTabsSession.tabs);
    setActiveTabId(savedTabsSession.activeTabId);
    const nextActiveTab = savedTabsSession.tabs.find((tab) => tab.id === savedTabsSession.activeTabId)
      || savedTabsSession.tabs[0];
    navigateWithPersist(nextActiveTab.targetPath, {
      viewMode: nextActiveTab.viewMode,
      initialImage: nextActiveTab.initialImage,
      replace: true
    });
    setSuccessMessage(`已恢复 ${savedTabsSession.tabs.length} 个标签页`);
  }, [navigateWithPersist]);

  const handleOpenFolderToTarget = useCallback(async (target) => {
    setOpenFolderMenuAnchorEl(null);
    if (!ipcRenderer) return;

    try {
      const selectedDir = await ipcRenderer.invoke(CHANNELS.SELECT_DIRECTORY);
      if (!selectedDir) return;

      if (target === 'current') {
        navigateTab(activeTabId, selectedDir, 'folder', null, false);
        return;
      }

      if (target === 'new-tab') {
        openNewTab(selectedDir, 'folder', null);
        return;
      }

      if (target === 'new-window') {
        const result = await ipcRenderer.invoke(CHANNELS.CREATE_NEW_INSTANCE, selectedDir);
        if (!result?.success) {
          throw new Error(result?.error || '创建新窗口失败');
        }
      }
    } catch (error) {
      console.error('打开文件夹失败:', error);
    }
  }, [activeTabId, navigateTab, openNewTab]);

  const renderTabsHeader = useMemo(() => (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, minWidth: 0 }}>
      <Tooltip title="打开文件夹">
        <span>
          <IconButton
            size="small"
            onClick={(event) => setOpenFolderMenuAnchorEl(event.currentTarget)}
            aria-label="打开文件夹"
            disabled={!ipcRenderer}
          >
            <FolderOpenIcon fontSize="small" />
          </IconButton>
        </span>
      </Tooltip>

      <Tooltip title="新建标签页">
        <IconButton
          size="small"
          onClick={() => openNewTab('', 'folder', null)}
          aria-label="新建标签页"
        >
          <AddIcon fontSize="small" />
        </IconButton>
      </Tooltip>

      <Tabs
        value={activeTabId}
        onChange={handleTabChange}
        variant="scrollable"
        scrollButtons="auto"
        sx={{ minHeight: 34, flex: 1, minWidth: 0 }}
      >
        {tabs.map((tab) => {
          const isDropTarget = dragIndicator.tabId === tab.id;
          const showBeforeIndicator = isDropTarget && dragIndicator.position === DRAG_INSERT_BEFORE;
          const showAfterIndicator = isDropTarget && dragIndicator.position === DRAG_INSERT_AFTER;

          return (
            <Tab
              key={tab.id}
              value={tab.id}
              disableRipple
              draggable
              onDragStart={(event) => handleTabDragStart(event, tab.id)}
              onDragOver={(event) => handleTabDragOver(event, tab.id)}
              onDragLeave={(event) => handleTabDragLeave(event, tab.id)}
              onDrop={(event) => handleTabDrop(event, tab.id)}
              onDragEnd={handleTabDragEnd}
              sx={{
                minHeight: 34,
                textTransform: 'none',
                minWidth: 120,
                maxWidth: 260,
                px: 1,
                cursor: 'grab',
                position: 'relative',
                ...(showBeforeIndicator ? {
                  '&::before': {
                    content: '""',
                    position: 'absolute',
                    left: 0,
                    top: 4,
                    bottom: 4,
                    width: 2,
                    bgcolor: 'primary.main',
                    borderRadius: 2
                  }
                } : {}),
                ...(showAfterIndicator ? {
                  '&::after': {
                    content: '""',
                    position: 'absolute',
                    right: 0,
                    top: 4,
                    bottom: 4,
                    width: 2,
                    bgcolor: 'primary.main',
                    borderRadius: 2
                  }
                } : {})
              }}
              label={(
                <Box sx={{ display: 'flex', alignItems: 'center', width: '100%', minWidth: 0 }}>
                  {tab.viewMode === 'album'
                    ? <PhotoAlbumIcon sx={{ fontSize: 14, mr: 0.75, flexShrink: 0 }} />
                    : (
                      tab.viewMode === 'favorites'
                        ? <FavoriteIcon sx={{ fontSize: 14, mr: 0.75, flexShrink: 0 }} />
                        : <FolderIcon sx={{ fontSize: 14, mr: 0.75, flexShrink: 0 }} />
                    )}
                  <Typography variant="caption" noWrap sx={{ flex: 1, textAlign: 'left' }}>
                    {tab.title}
                  </Typography>
                  <Box
                    component="span"
                    role="button"
                    tabIndex={-1}
                    sx={{
                      ml: 0.25,
                      p: 0.25,
                      flexShrink: 0,
                      display: 'inline-flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      borderRadius: 0.75,
                      color: 'text.secondary',
                      cursor: 'pointer',
                      '&:hover': {
                        bgcolor: 'action.hover',
                        color: 'text.primary'
                      }
                    }}
                    onMouseDown={(event) => {
                      event.preventDefault();
                      event.stopPropagation();
                    }}
                    onClick={(event) => {
                      event.preventDefault();
                      event.stopPropagation();
                      closeTabById(tab.id);
                    }}
                    aria-label={`关闭标签页 ${tab.title}`}
                  >
                    <CloseIcon sx={{ fontSize: 13 }} />
                  </Box>
                </Box>
              )}
            />
          );
        })}
      </Tabs>

      <Tooltip title="标签页列表">
        <IconButton
          size="small"
          onClick={(event) => setTabsMenuAnchorEl(event.currentTarget)}
          aria-label="标签页列表"
        >
          <KeyboardArrowDownIcon fontSize="small" />
        </IconButton>
      </Tooltip>

      <Menu
        anchorEl={openFolderMenuAnchorEl}
        open={Boolean(openFolderMenuAnchorEl)}
        onClose={() => setOpenFolderMenuAnchorEl(null)}
      >
        <MenuItem onClick={() => handleOpenFolderToTarget('current')}>
          在当前标签打开文件夹
        </MenuItem>
        <MenuItem onClick={() => handleOpenFolderToTarget('new-tab')}>
          在新标签打开文件夹
        </MenuItem>
        <MenuItem onClick={() => handleOpenFolderToTarget('new-window')}>
          在新窗口打开文件夹
        </MenuItem>
      </Menu>

      <Menu
        anchorEl={tabsMenuAnchorEl}
        open={Boolean(tabsMenuAnchorEl)}
        onClose={() => setTabsMenuAnchorEl(null)}
      >
        {tabs.map((tab) => (
          <MenuItem
            key={`menu-${tab.id}`}
            selected={tab.id === activeTabId}
            onClick={() => {
              setTabsMenuAnchorEl(null);
              navigateTab(tab.id, tab.targetPath, tab.viewMode, tab.initialImage, true);
            }}
          >
            {tab.title}
          </MenuItem>
        ))}
        <Divider />
        <MenuItem onClick={handleSaveTabsSnapshot}>
          保存当前标签组
        </MenuItem>
        <MenuItem
          onClick={handleRestoreTabsSnapshot}
          disabled={!hasSavedTabsSnapshot}
        >
          恢复已保存标签组
        </MenuItem>
        <Divider />
        <MenuItem
          onClick={handleCloseOthers}
          disabled={tabs.length <= 1}
        >
          关闭其他标签页
        </MenuItem>
      </Menu>
    </Box>
  ), [activeTabId, closeTabById, dragIndicator.position, dragIndicator.tabId, handleCloseOthers, handleOpenFolderToTarget, handleRestoreTabsSnapshot, handleSaveTabsSnapshot, handleTabChange, handleTabDragEnd, handleTabDragLeave, handleTabDragOver, handleTabDragStart, handleTabDrop, hasSavedTabsSnapshot, navigateTab, openFolderMenuAnchorEl, openNewTab, tabs, tabsMenuAnchorEl]);

  // 如果是重定向，不渲染内容
  if (redirectFromOldRoute) {
    return null;
  }

  const pageContent = urlState.viewMode === 'album'
    ? (
      <AlbumPage
        colorMode={colorMode}
        // 通过props传递URL状态，而不是依赖路由参数
        albumPath={urlState.targetPath}
        initialImage={urlState.initialImage}
        onNavigate={navigateToPath}
        onBreadcrumbNavigate={navigateToBreadcrumb}
        onAlbumClick={handleAlbumClick}
        onGoBack={handleGoBack}
        // 保持兼容性
        urlMode={true}
        tabsHeaderContent={renderTabsHeader}
      />
    )
    : (
      urlState.viewMode === 'favorites'
        ? (
          <FavoritesPage
            colorMode={colorMode}
            urlMode={true}
            onNavigate={navigateToPath}
            tabsHeaderContent={renderTabsHeader}
          />
        )
        : (
      <HomePage
        colorMode={colorMode}
        // 通过props传递URL状态
        currentPath={urlState.targetPath}
        onNavigate={navigateToPath}
        onBreadcrumbNavigate={navigateToBreadcrumb}
        onAlbumClick={handleAlbumClick}
        onFolderClick={handleFolderClick}
        // 保持兼容性
        urlMode={true}
        tabsHeaderContent={renderTabsHeader}
      />
        )
    );

  return (
    <>
      {pageContent}
      <Snackbar
        open={!!successMessage}
        autoHideDuration={3000}
        onClose={() => setSuccessMessage('')}
      >
        <Alert onClose={() => setSuccessMessage('')} severity="success" sx={{ width: '100%' }}>
          {successMessage}
        </Alert>
      </Snackbar>
      <Snackbar
        open={!!errorMessage}
        autoHideDuration={4000}
        onClose={() => setErrorMessage('')}
      >
        <Alert onClose={() => setErrorMessage('')} severity="error" sx={{ width: '100%' }}>
          {errorMessage}
        </Alert>
      </Snackbar>
    </>
  );
}

export default BrowserPage;
