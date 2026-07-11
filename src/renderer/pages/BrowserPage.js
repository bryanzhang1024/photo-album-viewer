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
  buildNavigationTargetUrl,
  parseBrowseLocation,
  normalizeTargetPath,
  withLastPathTracking,
  getLastPath,
  setLastPath
} from '../utils/navigation';
import {
  findUniqueLongestSourceRoot,
  getPortableRelativePath,
  isPortableRelativePath,
  resolvePortableRelativePath
} from '../../common/path-codec';
import {
  getBrowserLocationIdentity,
  getParentBrowserLocation,
  getSourceRootBreadcrumbs,
  materializeBrowserLocation
} from '../domain/browserLocation';
import {
  loadTabsSession,
  saveTabsSession
} from '../persistence/sessionAdapter';

const DEFAULT_ROOT_PATH_KEY = 'lastRootPath_default';
const createTabId = () => `tab_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
const DRAG_INSERT_BEFORE = 'before';
const DRAG_INSERT_AFTER = 'after';
const HYDRATION_PENDING = 'pending';
const HYDRATION_SUCCEEDED = 'succeeded';
const HYDRATION_FAILED = 'failed';

const getDefaultRootPath = () => normalizeTargetPath(localStorage.getItem(DEFAULT_ROOT_PATH_KEY) || '');

const parseURLLocation = (pathname, search) => {
  const searchParams = new URLSearchParams(search);
  if (pathname === '/browse'
      && searchParams.get('view') === 'favorites'
      && !searchParams.has('sourceId')) {
    return { kind: 'favorites' };
  }

  return parseBrowseLocation(pathname, search) || { kind: 'landing' };
};

const getPathDisplayName = (targetPath) => {
  const normalized = normalizeTargetPath(targetPath || '').replace(/\/+$/g, '');
  if (!normalized) return '主页';

  const segments = normalized.split('/').filter(Boolean);
  if (!segments.length) return normalized;

  const lastSegment = segments[segments.length - 1];
  try {
    return decodeURIComponent(lastSegment);
  } catch (_error) {
    return lastSegment;
  }
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

const getLegacyInitialImageProjection = (location) => {
  const initialImage = location.legacyInitialMediaPath;
  if (!initialImage) return null;
  if (!isPortableRelativePath(initialImage)) return normalizeTargetPath(initialImage);

  try {
    return resolvePortableRelativePath(location.legacyAbsolutePath, initialImage);
  } catch (_error) {
    return null;
  }
};

const materializeRuntimeTab = ({ id, location }, sources) => {
  if (location.kind === 'directory') {
    const materialized = materializeBrowserLocation(location, sources);
    if (!materialized) {
      return {
        id,
        location,
        targetPath: '',
        viewMode: location.target.viewMode === 'photoSet' ? 'album' : 'folder',
        initialImage: null,
        title: getPathDisplayName(location.target.relativePath),
        sourceBoundary: null
      };
    }

    const relativePath = location.target.relativePath;
    return {
      id,
      location,
      targetPath: materialized.absolutePath,
      viewMode: materialized.legacyViewMode,
      initialImage: materialized.absoluteInitialImage,
      title: relativePath
        ? getPathDisplayName(materialized.absolutePath)
        : materialized.sourceRoot.label,
      sourceBoundary: {
        sourceId: materialized.sourceRoot.sourceId,
        label: materialized.sourceRoot.label,
        rootPath: materialized.sourceRoot.rootPath,
        relativePath
      }
    };
  }

  if (location.kind === 'legacyAbsolute') {
    const targetPath = normalizeTargetPath(location.legacyAbsolutePath);
    return {
      id,
      location,
      targetPath,
      viewMode: normalizeViewMode(location.viewMode),
      initialImage: getLegacyInitialImageProjection(location),
      title: getTabTitle(targetPath, location.viewMode),
      sourceBoundary: null
    };
  }

  if (location.kind === 'favorites') {
    return {
      id,
      location,
      targetPath: '',
      viewMode: 'favorites',
      initialImage: null,
      title: '我的收藏',
      sourceBoundary: null
    };
  }

  return {
    id,
    location: { kind: 'landing' },
    targetPath: '',
    viewMode: 'folder',
    initialImage: null,
    title: '主页',
    sourceBoundary: null
  };
};

const createRuntimeTab = (location, sources, id = createTabId()) => (
  materializeRuntimeTab({ id, location }, sources)
);

const materializeSessionTabs = (session, sources) => session.tabs.map((tab) => (
  materializeRuntimeTab(tab, sources)
));

const getCanonicalInitialMediaPath = (sourceRoot, targetRelativePath, initialImage) => {
  if (!initialImage) return null;

  const targetAbsolutePath = resolvePortableRelativePath(
    sourceRoot.rootPath,
    targetRelativePath
  );
  let absoluteImagePath = initialImage;
  if (isPortableRelativePath(initialImage)) {
    absoluteImagePath = resolvePortableRelativePath(targetAbsolutePath, initialImage);
  }

  if (getPortableRelativePath(targetAbsolutePath, absoluteImagePath) === null) {
    return null;
  }
  return getPortableRelativePath(sourceRoot.rootPath, absoluteImagePath);
};

const createLocationFromAbsolutePath = (
  targetPath,
  viewMode = 'folder',
  initialImage = null,
  sources = []
) => {
  const normalizedTargetPath = normalizeTargetPath(targetPath || '');
  if (!normalizedTargetPath) return { kind: 'landing' };

  const normalizedViewMode = normalizeViewMode(viewMode);
  const match = findUniqueLongestSourceRoot(sources, normalizedTargetPath);
  if (match.status === 'resolved') {
    return {
      kind: 'directory',
      target: {
        sourceId: match.source.sourceId,
        relativePath: match.relativePath,
        viewMode: normalizedViewMode === 'album' ? 'photoSet' : 'browse',
        initialMediaRelativePath: getCanonicalInitialMediaPath(
          match.source,
          match.relativePath,
          initialImage
        )
      }
    };
  }

  let legacyInitialMediaPath = initialImage || null;
  if (legacyInitialMediaPath && isPortableRelativePath(legacyInitialMediaPath)) {
    legacyInitialMediaPath = resolvePortableRelativePath(
      normalizedTargetPath,
      legacyInitialMediaPath
    );
  }
  return {
    kind: 'legacyAbsolute',
    legacyAbsolutePath: normalizedTargetPath,
    viewMode: normalizedViewMode === 'album' ? 'album' : 'folder',
    legacyInitialMediaPath
  };
};

const resolveURLLocation = (location, sources) => {
  if (location.kind !== 'legacyAbsolute') return location;
  return createLocationFromAbsolutePath(
    location.legacyAbsolutePath,
    location.viewMode,
    location.legacyInitialMediaPath,
    sources
  );
};

const findSessionTabMatchingLocation = (session, location) => {
  if (!session || !location) return null;
  const identity = getBrowserLocationIdentity(location);
  return session.tabs.find((tab) => (
    getBrowserLocationIdentity(tab.location) === identity
  )) || null;
};

const isExplicitURLLocation = (location) => (
  location.kind === 'directory'
  || location.kind === 'legacyAbsolute'
  || location.kind === 'favorites'
);

const upsertSourceRoot = (sources, source) => {
  const existingIndex = sources.findIndex((item) => item.sourceId === source.sourceId);
  if (existingIndex === -1) return [...sources, source];
  const nextSources = [...sources];
  nextSources[existingIndex] = source;
  return nextSources;
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

const ipcRenderer = window.electronAPI || null;

const isExternalFileDrag = (event) => {
  const types = Array.from(event.dataTransfer?.types || []);
  return types.includes('Files');
};

function BrowserPage({ colorMode, scrollContext = null, redirectFromOldRoute = false }) {
  const location = useLocation();
  const navigate = useNavigate();
  const params = useParams();
  const hydrationCompletedRef = useRef(false);
  const initialTabRef = useRef(null);
  const pendingNavigationRef = useRef(null);
  const sourcesRef = useRef([]);
  const [openFolderMenuAnchorEl, setOpenFolderMenuAnchorEl] = useState(null);
  const [tabsMenuAnchorEl, setTabsMenuAnchorEl] = useState(null);
  const [hasSavedTabsSnapshot, setHasSavedTabsSnapshot] = useState(false);
  const [successMessage, setSuccessMessage] = useState('');
  const [errorMessage, setErrorMessage] = useState('');
  const [sources, setSources] = useState([]);
  const [hydrationStatus, setHydrationStatus] = useState(HYDRATION_PENDING);
  const draggingTabIdRef = useRef(null);
  const [dragIndicator, setDragIndicator] = useState({ tabId: null, position: DRAG_INSERT_BEFORE });

  const urlLocation = useMemo(() =>
    parseURLLocation(location.pathname, location.search),
    [location.pathname, location.search]
  );

  if (!initialTabRef.current) {
    initialTabRef.current = createRuntimeTab(urlLocation, []);
  }

  const [tabs, setTabs] = useState(() => [initialTabRef.current]);
  const [activeTabId, setActiveTabId] = useState(() => initialTabRef.current.id);
  const activeTab = useMemo(
    () => tabs.find((tab) => tab.id === activeTabId) || tabs[0] || initialTabRef.current,
    [activeTabId, tabs]
  );
  const displayState = activeTab;
  const activeSourceRoot = useMemo(() => {
    if (activeTab?.location?.kind !== 'directory') return null;
    return sources.find((source) => source.sourceId === activeTab.location.target.sourceId) || null;
  }, [activeTab, sources]);
  const sourceBreadcrumbs = useMemo(() => {
    if (!activeSourceRoot || activeTab.location.kind !== 'directory') return null;
    return getSourceRootBreadcrumbs(
      activeSourceRoot,
      activeTab.location.target.relativePath
    );
  }, [activeSourceRoot, activeTab]);
  const activeTabScrollKey = useMemo(
    () => activeTabId || '__default__',
    [activeTabId]
  );

  const navigateWithPersist = useMemo(
    () => withLastPathTracking(navigate),
    [navigate]
  );

  const saveActiveTabScrollPosition = useCallback(() => {
    if (!scrollContext?.savePosition) {
      return;
    }

    const scrollContainer = document.querySelector('.scroll-container');
    if (!scrollContainer) {
      return;
    }

    const scopedKey = `${activeTabScrollKey}::${location.pathname}${location.search}`;
    scrollContext.savePosition(scopedKey, scrollContainer.scrollTop || 0);
  }, [activeTabScrollKey, location.pathname, location.search, scrollContext]);

  const setRuntimeSources = useCallback((nextSources) => {
    sourcesRef.current = nextSources;
    setSources(nextSources);
    setTabs((prevTabs) => prevTabs.map((tab) => (
      materializeRuntimeTab(tab, nextSources)
    )));
  }, []);

  const navigateBrowserLocation = useCallback((browserLocation, {
    replace = false,
    state
  } = {}) => {
    if (browserLocation.kind === 'directory') {
      const options = {};
      if (replace) options.replace = true;
      if (state !== undefined) options.state = state;
      const projected = createRuntimeTab(browserLocation, sourcesRef.current);
      if (projected.targetPath) setLastPath(projected.targetPath);
      navigate(buildNavigationTargetUrl(browserLocation.target), options);
      return;
    }

    if (browserLocation.kind === 'favorites') {
      navigateWithPersist('', {
        viewMode: 'favorites',
        initialImage: null,
        replace,
        ...(state !== undefined ? { state } : {})
      });
      return;
    }

    if (browserLocation.kind === 'legacyAbsolute') {
      navigateWithPersist(browserLocation.legacyAbsolutePath, {
        viewMode: browserLocation.viewMode,
        initialImage: getLegacyInitialImageProjection(browserLocation),
        replace,
        ...(state !== undefined ? { state } : {})
      });
      return;
    }

    navigateWithPersist('', {
      viewMode: 'folder',
      initialImage: null,
      replace,
      ...(state !== undefined ? { state } : {})
    });
  }, [navigate, navigateWithPersist]);

  const commitTabLocation = useCallback(({
    tabId = createTabId(),
    browserLocation,
    append = false,
    replace = false,
    state,
    sourcesOverride = sourcesRef.current
  }) => {
    const nextTab = createRuntimeTab(browserLocation, sourcesOverride, tabId);
    if (tabId !== activeTabId) saveActiveTabScrollPosition();

    pendingNavigationRef.current = getBrowserLocationIdentity(browserLocation);
    setTabs((prevTabs) => (
      append
        ? [...prevTabs, nextTab]
        : prevTabs.map((tab) => (tab.id === tabId ? nextTab : tab))
    ));
    setActiveTabId(tabId);
    navigateBrowserLocation(browserLocation, { replace, state });
    return nextTab;
  }, [activeTabId, navigateBrowserLocation, saveActiveTabScrollPosition]);

  const registerAbsoluteRoot = useCallback(async (absolutePath) => {
    try {
      const response = await ipcRenderer?.invoke(CHANNELS.SAVE_SOURCE_ROOT_V1, {
        contractVersion: 1,
        sourceId: null,
        rootPath: absolutePath,
        label: null
      });
      const source = response?.ok ? response.data?.source : null;
      if (source) {
        const nextSources = upsertSourceRoot(sourcesRef.current, source);
        setRuntimeSources(nextSources);
        return {
          browserLocation: {
            kind: 'directory',
            target: {
              sourceId: source.sourceId,
              relativePath: '',
              viewMode: 'browse',
              initialMediaRelativePath: null
            }
          },
          sources: nextSources
        };
      }
    } catch (error) {
      console.warn('保存来源根目录失败:', error);
    }

    return {
      browserLocation: createLocationFromAbsolutePath(
        absolutePath,
        'folder',
        null,
        sourcesRef.current
      ),
      sources: sourcesRef.current
    };
  }, [setRuntimeSources]);

  useEffect(() => {
    if (hydrationStatus !== HYDRATION_SUCCEEDED || redirectFromOldRoute) return;

    try {
      saveTabsSession({
        storage: localStorage,
        tabs,
        activeTabId
      });
    } catch (error) {
      console.warn('保存标签会话失败:', error);
    }
  }, [tabs, activeTabId, hydrationStatus, redirectFromOldRoute]);

  useEffect(() => {
    if (!redirectFromOldRoute) return;

    const { albumPath } = params;
    const searchParams = new URLSearchParams(location.search);
    const imagePath = searchParams.get('image');

    if (albumPath) {
      let targetPath = albumPath;
      try {
        targetPath = decodeURIComponent(albumPath);
      } catch (_error) {
        // Keep malformed legacy input usable instead of crashing the redirect.
      }
      navigateWithPersist(targetPath, {
        viewMode: 'album',
        initialImage: imagePath || null,
        replace: true,
        state: location.state
      });
    } else {
      navigate('/', { replace: true, state: location.state });
    }
  }, [redirectFromOldRoute, params, location, navigate, navigateWithPersist]);

  useEffect(() => {
    if (hydrationCompletedRef.current || redirectFromOldRoute) return undefined;
    let cancelled = false;

    const hydrate = async () => {
      let loadedSources = [];
      let registrySucceeded = false;
      try {
        const response = await ipcRenderer?.invoke(CHANNELS.LOAD_SOURCE_ROOTS_V1, {
          contractVersion: 1
        });
        if (response?.ok && Array.isArray(response.data?.sources)) {
          loadedSources = response.data.sources;
          registrySucceeded = true;
        }
      } catch (error) {
        console.warn('加载来源根目录失败:', error);
      }

      if (cancelled) return;
      hydrationCompletedRef.current = true;
      setRuntimeSources(loadedSources);

      const restoredSession = loadTabsSession({
        storage: localStorage,
        sources: loadedSources
      });
      const savedSnapshot = loadTabsSession({
        storage: localStorage,
        sources: loadedSources,
        snapshot: true
      });
      setHasSavedTabsSnapshot(Boolean(savedSnapshot));

      const nextHydrationStatus = registrySucceeded
        ? HYDRATION_SUCCEEDED
        : HYDRATION_FAILED;
      const resolvedURLLocation = resolveURLLocation(urlLocation, loadedSources);
      const searchParams = new URLSearchParams(location.search);
      const commandLinePath = searchParams.get('initialPath');

      const applyExplicitURL = (browserLocation) => {
        const matchingTab = findSessionTabMatchingLocation(restoredSession, browserLocation);
        if (matchingTab) {
          const runtimeTabs = materializeSessionTabs(restoredSession, sourcesRef.current);
          setTabs(runtimeTabs);
          setActiveTabId(matchingTab.id);
        } else {
          const explicitTab = createRuntimeTab(browserLocation, sourcesRef.current);
          setTabs([explicitTab]);
          setActiveTabId(explicitTab.id);
        }
        setHydrationStatus(nextHydrationStatus);
      };

      if (urlLocation.kind === 'directory') {
        applyExplicitURL(resolvedURLLocation);
        return;
      }

      if (commandLinePath) {
        const registered = await registerAbsoluteRoot(commandLinePath);
        if (cancelled) return;
        const commandLineTab = createRuntimeTab(
          registered.browserLocation,
          registered.sources
        );
        setTabs([commandLineTab]);
        setActiveTabId(commandLineTab.id);
        pendingNavigationRef.current = getBrowserLocationIdentity(registered.browserLocation);
        navigateBrowserLocation(registered.browserLocation, { replace: true });
        setHydrationStatus(nextHydrationStatus);
        return;
      }

      if (isExplicitURLLocation(resolvedURLLocation)) {
        applyExplicitURL(resolvedURLLocation);
        return;
      }

      if (restoredSession) {
        const runtimeTabs = materializeSessionTabs(restoredSession, loadedSources);
        const restoredActiveTab = runtimeTabs.find((tab) => (
          tab.id === restoredSession.activeTabId
        )) || runtimeTabs[0];
        setTabs(runtimeTabs);
        setActiveTabId(restoredActiveTab.id);
        pendingNavigationRef.current = getBrowserLocationIdentity(restoredActiveTab.location);
        navigateBrowserLocation(restoredActiveTab.location, { replace: true });
        setHydrationStatus(nextHydrationStatus);
        return;
      }

      const lastPath = getLastPath();
      const defaultRootPath = lastPath ? '' : getDefaultRootPath();
      const fallbackPath = lastPath || defaultRootPath;
      if (fallbackPath) {
        const fallbackLocation = createLocationFromAbsolutePath(
          fallbackPath,
          'folder',
          null,
          loadedSources
        );
        const fallbackTab = createRuntimeTab(fallbackLocation, loadedSources);
        setTabs([fallbackTab]);
        setActiveTabId(fallbackTab.id);
        pendingNavigationRef.current = getBrowserLocationIdentity(fallbackLocation);
        navigateBrowserLocation(fallbackLocation, { replace: true });
      } else {
        const landingTab = createRuntimeTab({ kind: 'landing' }, loadedSources);
        setTabs([landingTab]);
        setActiveTabId(landingTab.id);
      }
      setHydrationStatus(nextHydrationStatus);
    };

    hydrate();
    return () => {
      cancelled = true;
    };
  }, [location.search, navigateBrowserLocation, redirectFromOldRoute, registerAbsoluteRoot, setRuntimeSources, urlLocation]);

  useEffect(() => {
    if (hydrationStatus === HYDRATION_PENDING || redirectFromOldRoute) return;

    const browserLocation = resolveURLLocation(urlLocation, sourcesRef.current);
    const nextIdentity = getBrowserLocationIdentity(browserLocation);
    if (pendingNavigationRef.current) {
      if (pendingNavigationRef.current !== nextIdentity) return;
      pendingNavigationRef.current = null;
    }

    setTabs((prevTabs) => prevTabs.map((tab) => {
      if (tab.id !== activeTabId) return tab;
      if (getBrowserLocationIdentity(tab.location) === nextIdentity) return tab;
      return createRuntimeTab(browserLocation, sourcesRef.current, tab.id);
    }));
  }, [activeTabId, hydrationStatus, redirectFromOldRoute, urlLocation]);

  useEffect(() => {
    if (displayState?.targetPath) setLastPath(displayState.targetPath);
  }, [displayState?.targetPath]);

  const createLocationForActivePath = useCallback((
    targetPath,
    viewMode = 'folder',
    initialImage = null
  ) => {
    if (viewMode === 'favorites') return { kind: 'favorites' };
    if (!targetPath) return { kind: 'landing' };

    if (activeTab?.location?.kind !== 'directory') {
      return createLocationFromAbsolutePath(targetPath, viewMode, initialImage, []);
    }

    const sourceRoot = sourcesRef.current.find((source) => (
      source.sourceId === activeTab.location.target.sourceId
    ));
    if (!sourceRoot) return null;

    const relativePath = getPortableRelativePath(sourceRoot.rootPath, targetPath);
    if (relativePath === null) return null;
    const initialMediaRelativePath = getCanonicalInitialMediaPath(
      sourceRoot,
      relativePath,
      initialImage
    );
    if (initialImage && initialMediaRelativePath === null) return null;

    return {
      kind: 'directory',
      target: {
        sourceId: activeTab.location.target.sourceId,
        relativePath,
        viewMode: viewMode === 'album' ? 'photoSet' : 'browse',
        initialMediaRelativePath
      }
    };
  }, [activeTab]);

  const navigateToPath = useCallback((
    targetPath,
    viewMode = 'folder',
    initialImage = null,
    replace = false
  ) => {
    const browserLocation = createLocationForActivePath(targetPath, viewMode, initialImage);
    if (!browserLocation) return;
    commitTabLocation({
      tabId: activeTabId,
      browserLocation,
      replace
    });
  }, [activeTabId, commitTabLocation, createLocationForActivePath]);

  const navigateToBreadcrumb = useCallback((targetPath) => {
    navigateToPath(targetPath, 'folder');
  }, [navigateToPath]);

  const handleAlbumClick = useCallback((albumPath, albumName = null, initialImage = null) => {
    navigateToPath(albumPath, 'album', initialImage);
  }, [navigateToPath]);

  const handleFolderClick = useCallback((folderPath) => {
    navigateToPath(folderPath, 'folder');
  }, [navigateToPath]);

  const handleGoBack = useCallback(() => {
    if (!activeTab?.location) return;
    const parentLocation = getParentBrowserLocation(activeTab.location);
    if (getBrowserLocationIdentity(parentLocation)
        === getBrowserLocationIdentity(activeTab.location)) {
      return;
    }
    commitTabLocation({
      tabId: activeTabId,
      browserLocation: parentLocation
    });
  }, [activeTab, activeTabId, commitTabLocation]);

  const openLocationInNewTab = useCallback((browserLocation, sourcesOverride = sourcesRef.current) => {
    commitTabLocation({
      browserLocation,
      append: true,
      sourcesOverride
    });
  }, [commitTabLocation]);

  const openNewTab = useCallback((targetPath = '', viewMode = 'folder', initialImage = null) => {
    if (viewMode === 'favorites') {
      openLocationInNewTab({ kind: 'favorites' });
      return;
    }
    const resolvedTargetPath = (!targetPath && viewMode === 'folder')
      ? getDefaultRootPath()
      : targetPath;
    openLocationInNewTab(createLocationFromAbsolutePath(
      resolvedTargetPath,
      viewMode,
      initialImage,
      sourcesRef.current
    ));
  }, [openLocationInNewTab]);

  const openFavoritesInNewTab = useCallback(() => {
    openLocationInNewTab({ kind: 'favorites' });
  }, [openLocationInNewTab]);

  useEffect(() => {
    const handleDocumentDragOver = (event) => {
      if (!isExternalFileDrag(event)) return;
      event.preventDefault();
      if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy';
    };

    const handleDocumentDrop = async (event) => {
      if (!isExternalFileDrag(event)) return;
      event.preventDefault();
      if (!ipcRenderer) return;

      const droppedPaths = Array.from(event.dataTransfer?.files || [])
        .map((file) => {
          try {
            return ipcRenderer.getPathForFile?.(file) || file.path || '';
          } catch (_error) {
            return '';
          }
        })
        .filter(Boolean);

      if (droppedPaths.length === 0) {
        setErrorMessage('只支持拖入文件夹');
        return;
      }

      try {
        const result = await ipcRenderer.invoke(CHANNELS.RESOLVE_DROPPED_FOLDERS, droppedPaths);
        const folders = Array.isArray(result?.folders) ? result.folders : [];
        if (folders.length === 0) {
          setErrorMessage('只支持拖入文件夹');
          return;
        }

        for (const folderPath of folders) {
          const registered = await registerAbsoluteRoot(folderPath);
          openLocationInNewTab(registered.browserLocation, registered.sources);
        }
      } catch (error) {
        console.error('处理拖入文件夹失败:', error);
        setErrorMessage('打开拖入文件夹失败');
      }
    };

    document.addEventListener('dragover', handleDocumentDragOver);
    document.addEventListener('drop', handleDocumentDrop);
    return () => {
      document.removeEventListener('dragover', handleDocumentDragOver);
      document.removeEventListener('drop', handleDocumentDrop);
    };
  }, [openLocationInNewTab, registerAbsoluteRoot]);

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

    commitTabLocation({
      tabId: targetTab.id,
      browserLocation: targetTab.location,
      replace: true
    });
  }, [activeTabId, commitTabLocation, tabs]);

  const closeTabById = useCallback((tabId) => {
    const closingIndex = tabs.findIndex((tab) => tab.id === tabId);
    if (closingIndex === -1) return;

    if (tabs.length === 1) {
      commitTabLocation({
        tabId,
        browserLocation: { kind: 'landing' },
        replace: true
      });
      return;
    }

    const nextTabs = tabs.filter((tab) => tab.id !== tabId);
    setTabs(nextTabs);
    if (tabId !== activeTabId) return;

    const fallbackTab = nextTabs[Math.max(0, closingIndex - 1)] || nextTabs[0];
    commitTabLocation({
      tabId: fallbackTab.id,
      browserLocation: fallbackTab.location,
      replace: true
    });
  }, [activeTabId, commitTabLocation, tabs]);

  const handleCloseOthers = useCallback(() => {
    const activeTab = tabs.find((tab) => tab.id === activeTabId);
    if (!activeTab) return;

    setTabs([activeTab]);
    setTabsMenuAnchorEl(null);
  }, [tabs, activeTabId]);

  const handleSaveTabsSnapshot = useCallback(() => {
    setTabsMenuAnchorEl(null);
    try {
      if (hydrationStatus !== HYDRATION_SUCCEEDED) {
        throw new Error('SourceRoot hydration is incomplete');
      }
      saveTabsSession({
        storage: localStorage,
        tabs,
        activeTabId,
        snapshot: true
      });
      setHasSavedTabsSnapshot(true);
      setSuccessMessage(`已保存 ${tabs.length} 个标签页`);
    } catch (error) {
      console.warn('保存标签组失败:', error);
      setErrorMessage('保存标签组失败，请稍后重试');
    }
  }, [tabs, activeTabId, hydrationStatus]);

  const handleRestoreTabsSnapshot = useCallback(() => {
    setTabsMenuAnchorEl(null);

    const savedTabsSession = loadTabsSession({
      storage: localStorage,
      sources: sourcesRef.current,
      snapshot: true
    });
    if (!savedTabsSession) {
      setHasSavedTabsSnapshot(false);
      setErrorMessage('没有可恢复的已保存标签组');
      return;
    }

    const runtimeTabs = materializeSessionTabs(savedTabsSession, sourcesRef.current);
    setTabs(runtimeTabs);
    setActiveTabId(savedTabsSession.activeTabId);
    const nextActiveTab = runtimeTabs.find((tab) => tab.id === savedTabsSession.activeTabId)
      || runtimeTabs[0];
    pendingNavigationRef.current = getBrowserLocationIdentity(nextActiveTab.location);
    navigateBrowserLocation(nextActiveTab.location, { replace: true });
    setSuccessMessage(`已恢复 ${savedTabsSession.tabs.length} 个标签页`);
  }, [navigateBrowserLocation]);

  const handleOpenFolderToTarget = useCallback(async (target) => {
    setOpenFolderMenuAnchorEl(null);
    if (!ipcRenderer) return;

    try {
      const selectedDir = await ipcRenderer.invoke(CHANNELS.SELECT_DIRECTORY);
      if (!selectedDir) return;
      const registered = await registerAbsoluteRoot(selectedDir);

      if (target === 'current') {
        commitTabLocation({
          tabId: activeTabId,
          browserLocation: registered.browserLocation,
          sourcesOverride: registered.sources
        });
        return;
      }

      if (target === 'new-tab') {
        openLocationInNewTab(registered.browserLocation, registered.sources);
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
  }, [activeTabId, commitTabLocation, openLocationInNewTab, registerAbsoluteRoot]);

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
              commitTabLocation({
                tabId: tab.id,
                browserLocation: tab.location,
                replace: true
              });
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
  ), [activeTabId, closeTabById, commitTabLocation, dragIndicator.position, dragIndicator.tabId, handleCloseOthers, handleOpenFolderToTarget, handleRestoreTabsSnapshot, handleSaveTabsSnapshot, handleTabChange, handleTabDragEnd, handleTabDragLeave, handleTabDragOver, handleTabDragStart, handleTabDrop, hasSavedTabsSnapshot, openFolderMenuAnchorEl, openNewTab, tabs, tabsMenuAnchorEl]);

  // 如果是重定向，不渲染内容
  if (redirectFromOldRoute) {
    return null;
  }

  const pageContent = displayState.viewMode === 'album'
    ? (
      <AlbumPage
        colorMode={colorMode}
        // 通过props传递URL状态，而不是依赖路由参数
        albumPath={displayState.targetPath}
        initialImage={displayState.initialImage}
        sourceBoundary={displayState.sourceBoundary}
        sourceBreadcrumbs={sourceBreadcrumbs}
        onNavigate={navigateToPath}
        onBreadcrumbNavigate={navigateToBreadcrumb}
        onAlbumClick={handleAlbumClick}
        onGoBack={handleGoBack}
        onOpenFavoritesInNewTab={openFavoritesInNewTab}
        // 保持兼容性
        urlMode={true}
        tabsHeaderContent={renderTabsHeader}
        tabScrollKey={activeTabScrollKey}
      />
    )
    : (
      displayState.viewMode === 'favorites'
        ? (
          <FavoritesPage
            colorMode={colorMode}
            urlMode={true}
            onNavigate={navigateToPath}
            tabsHeaderContent={renderTabsHeader}
            tabScrollKey={activeTabScrollKey}
          />
        )
        : (
      <HomePage
        colorMode={colorMode}
        // 通过props传递URL状态
        currentPath={displayState.targetPath}
        sourceBoundary={displayState.sourceBoundary}
        sourceBreadcrumbs={sourceBreadcrumbs}
        onNavigate={navigateToPath}
        onBreadcrumbNavigate={navigateToBreadcrumb}
        onAlbumClick={handleAlbumClick}
        onFolderClick={handleFolderClick}
        onOpenFavoritesInNewTab={openFavoritesInNewTab}
        // 保持兼容性
        urlMode={true}
        tabsHeaderContent={renderTabsHeader}
        tabScrollKey={activeTabScrollKey}
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
