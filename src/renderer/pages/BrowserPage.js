import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
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
  normalizeTargetPath
} from '../utils/navigation';
import {
  findUniqueLongestSourceRoot,
  getPortableRelativePath,
  isPortableRelativePath,
  resolvePortableRelativePath
} from '../../common/path-codec';
import { sourceIdsEqualV1 } from '../../common/contracts/navigation-contract-v1';
import {
  createDirectoryBrowserLocationFromAbsolutePath,
  findComputerRootSource,
  getBrowserLocationIdentity,
  getParentBrowserLocation,
  getSourceRootBreadcrumbs,
  materializeBrowserLocation,
  rebaseBrowserLocationToSourceRoot
} from '../domain/browserLocation';
import {
  clearLegacyNavigationStorage,
  loadTabsSession,
  rebaseTabsSessionToSourceRoot,
  saveTabsSession
} from '../persistence/sessionAdapter';
import { useRandomNavigationCoordinator } from '../hooks/useRandomNavigationCoordinator';

const createTabId = () => `tab_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
const DRAG_INSERT_BEFORE = 'before';
const DRAG_INSERT_AFTER = 'after';
const HYDRATION_PENDING = 'pending';
const HYDRATION_SUCCEEDED = 'succeeded';
const HYDRATION_FAILED = 'failed';

const createPendingNavigation = (browserLocation, rootOperationToken = null) => ({
  identity: getBrowserLocationIdentity(browserLocation),
  rootOperationToken
});

const parseURLLocation = (pathname, search) => {
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

const materializeRuntimeTab = ({ id, location }, sources) => {
  if (location.kind === 'directory') {
    const materialized = materializeBrowserLocation(location, sources);
    if (!materialized) {
      return materializeRuntimeTab({ id, location: { kind: 'landing' } }, sources);
    }

    const relativePath = location.target.relativePath;
    return {
      id,
      location,
      targetPath: materialized.absolutePath,
      viewMode: materialized.pageViewMode,
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
  sources = [],
  preferredSourceRoot = null
) => {
  const normalizedTargetPath = normalizeTargetPath(targetPath || '');
  if (!normalizedTargetPath) return { kind: 'landing' };

  const normalizedViewMode = normalizeViewMode(viewMode);
  const preferredSourceLocation = preferredSourceRoot
    ? createDirectoryBrowserLocationFromAbsolutePath({
      sourceRoot: preferredSourceRoot,
      absolutePath: normalizedTargetPath,
      viewMode: normalizedViewMode === 'album' ? 'photoSet' : 'browse',
      initialMediaAbsolutePath: initialImage
        ? (isPortableRelativePath(initialImage)
          ? resolvePortableRelativePath(normalizedTargetPath, initialImage)
          : initialImage)
        : null
    })
    : null;
  if (preferredSourceLocation) return preferredSourceLocation;

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

  return null;
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
  || location.kind === 'favorites'
);

const upsertSourceRoot = (sources, source) => {
  const existingIndex = sources.findIndex((item) => (
    sourceIdsEqualV1(item.sourceId, source.sourceId)
  ));
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

function BrowserPage({ colorMode, scrollContext = null }) {
  const location = useLocation();
  const navigate = useNavigate();
  const runtimePlatform = ipcRenderer?.platform || null;
  const hydrationCompletedRef = useRef(false);
  const hydrationGenerationRef = useRef(0);
  const mountedRef = useRef(false);
  const rootOperationGenerationRef = useRef(0);
  const initialTabRef = useRef(null);
  const pendingNavigationRef = useRef(null);
  const observedRouteKeyRef = useRef(`${location.pathname}\n${location.search}`);
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

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      rootOperationGenerationRef.current += 1;
      hydrationGenerationRef.current += 1;
    };
  }, []);

  const beginRootOperation = useCallback(() => {
    rootOperationGenerationRef.current += 1;
    return rootOperationGenerationRef.current;
  }, []);

  const invalidateRootOperations = useCallback(() => {
    rootOperationGenerationRef.current += 1;
  }, []);

  const isCurrentRootOperation = useCallback((operationToken) => (
    mountedRef.current && rootOperationGenerationRef.current === operationToken
  ), []);

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
  const computerRootSource = useMemo(
    () => findComputerRootSource(sources, runtimePlatform),
    [runtimePlatform, sources]
  );
  const displayState = activeTab;
  const activeSourceRoot = useMemo(() => {
    if (activeTab?.location?.kind !== 'directory') return null;
    return sources.find((source) => (
      sourceIdsEqualV1(source.sourceId, activeTab.location.target.sourceId)
    )) || null;
  }, [activeTab, sources]);
  const sourceBreadcrumbs = useMemo(() => {
    if (!activeSourceRoot || activeTab.location.kind !== 'directory') return null;
    return getSourceRootBreadcrumbs(
      activeSourceRoot,
      activeTab.location.target.relativePath
    );
  }, [activeSourceRoot, activeTab]);
  const isComputerRootView = Boolean(
    computerRootSource
    && activeTab?.location?.kind === 'directory'
    && sourceIdsEqualV1(activeTab.location.target.sourceId, computerRootSource.sourceId)
    && activeTab.location.target.relativePath === ''
  );
  const activeTabScrollKey = useMemo(
    () => activeTabId || '__default__',
    [activeTabId]
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
      navigate(buildNavigationTargetUrl(browserLocation.target), options);
      return;
    }

    if (browserLocation.kind === 'favorites') {
      const options = {};
      if (replace) options.replace = true;
      if (state !== undefined) options.state = state;
      navigate('/favorites', options);
      return;
    }

    const options = {};
    if (replace) options.replace = true;
    if (state !== undefined) options.state = state;
    navigate('/', options);
  }, [navigate]);

  const commitTabLocation = useCallback(({
    tabId = createTabId(),
    browserLocation,
    append = false,
    replace = false,
    state,
    sourcesOverride = sourcesRef.current,
    rootOperationToken = null
  }) => {
    if (rootOperationToken === null) {
      invalidateRootOperations();
    } else if (!isCurrentRootOperation(rootOperationToken)) {
      return null;
    }

    const nextTab = createRuntimeTab(browserLocation, sourcesOverride, tabId);
    if (tabId !== activeTabId) saveActiveTabScrollPosition();

    pendingNavigationRef.current = createPendingNavigation(
      browserLocation,
      rootOperationToken
    );
    setTabs((prevTabs) => (
      append
        ? [...prevTabs, nextTab]
        : prevTabs.map((tab) => (tab.id === tabId ? nextTab : tab))
    ));
    setActiveTabId(tabId);
    navigateBrowserLocation(browserLocation, { replace, state });
    return nextTab;
  }, [activeTabId, invalidateRootOperations, isCurrentRootOperation, navigateBrowserLocation, saveActiveTabScrollPosition]);

  const randomNavigation = useRandomNavigationCoordinator({
    activeTab,
    activeTabId,
    activeSourceRoot,
    tabs,
    commitTabLocation,
    ipcRenderer,
    onError: setErrorMessage
  });
  const randomBrowseAvailable = randomNavigation.available && !isComputerRootView;

  const commitValidatedLocation = useCallback(async ({
    browserLocation,
    tabId = activeTabId,
    replace = false
  }) => {
    if (browserLocation.kind !== 'directory' || !ipcRenderer) {
      return commitTabLocation({ tabId, browserLocation, replace });
    }

    const operationToken = beginRootOperation();
    try {
      const result = await ipcRenderer.invoke(CHANNELS.VALIDATE_NAVIGATION_TARGET_V1, {
        contractVersion: 1,
        target: browserLocation.target
      });
      if (!isCurrentRootOperation(operationToken)) return null;
      if (result?.success !== true) {
        setErrorMessage(result?.error || '目录不存在或不可访问');
        return null;
      }
      return commitTabLocation({
        tabId,
        browserLocation,
        replace,
        rootOperationToken: operationToken
      });
    } catch (error) {
      if (!isCurrentRootOperation(operationToken)) return null;
      console.error('验证导航目录失败:', error);
      setErrorMessage('目录不存在或不可访问');
      return null;
    }
  }, [activeTabId, beginRootOperation, commitTabLocation, isCurrentRootOperation]);

  const registerAbsoluteRoot = useCallback(async (absolutePath) => {
    if (computerRootSource) {
      const browserLocation = createLocationFromAbsolutePath(
        absolutePath,
        'folder',
        null,
        sourcesRef.current,
        computerRootSource
      );
      return browserLocation ? {
        browserLocation,
        source: computerRootSource,
        fallback: false
      } : null;
    }
    if (runtimePlatform === 'darwin') return null;

    try {
      const response = await ipcRenderer?.invoke(CHANNELS.SAVE_SOURCE_ROOT_V1, {
        contractVersion: 1,
        sourceId: null,
        rootPath: absolutePath,
        label: null
      });
      const source = response?.ok ? response.data?.source : null;
      if (source) {
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
          source,
          fallback: false
        };
      }
    } catch (error) {
      console.warn('保存来源根目录失败:', error);
    }

    return null;
  }, [computerRootSource, runtimePlatform]);

  const applyRegisteredRoot = useCallback((registered) => {
    if (!registered?.source) return sourcesRef.current;
    let nextSources = sourcesRef.current;
    if (registered.source) {
      nextSources = upsertSourceRoot(nextSources, registered.source);
      setRuntimeSources(nextSources);
    }
    return nextSources;
  }, [setRuntimeSources]);

  useEffect(() => {
    if (hydrationStatus !== HYDRATION_SUCCEEDED) return;

    try {
      saveTabsSession({
        storage: localStorage,
        tabs,
        activeTabId
      });
    } catch (error) {
      console.warn('保存标签会话失败:', error);
    }
  }, [tabs, activeTabId, hydrationStatus]);

  useEffect(() => {
    if (hydrationCompletedRef.current) return undefined;
    let cancelled = false;
    const generation = hydrationGenerationRef.current + 1;
    hydrationGenerationRef.current = generation;
    const isCurrentHydration = () => (
      !cancelled
      && mountedRef.current
      && hydrationGenerationRef.current === generation
    );

    const hydrate = async () => {
      clearLegacyNavigationStorage(localStorage);
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

      if (!isCurrentHydration()) return;
      setRuntimeSources(loadedSources);

      const storedSession = loadTabsSession({
        storage: localStorage
      });
      const storedSnapshot = loadTabsSession({
        storage: localStorage,
        snapshot: true
      });
      const hydrationComputerRoot = findComputerRootSource(loadedSources, runtimePlatform);
      const restoredSession = hydrationComputerRoot && storedSession
        ? rebaseTabsSessionToSourceRoot(
          storedSession,
          loadedSources,
          hydrationComputerRoot
        ) || storedSession
        : storedSession;
      const savedSnapshot = hydrationComputerRoot && storedSnapshot
        ? rebaseTabsSessionToSourceRoot(
          storedSnapshot,
          loadedSources,
          hydrationComputerRoot
        ) || storedSnapshot
        : storedSnapshot;
      if (savedSnapshot && savedSnapshot !== storedSnapshot) {
        saveTabsSession({
          storage: localStorage,
          tabs: savedSnapshot.tabs,
          activeTabId: savedSnapshot.activeTabId,
          snapshot: true
        });
      }
      setHasSavedTabsSnapshot(Boolean(savedSnapshot));

      const nextHydrationStatus = registrySucceeded
        ? HYDRATION_SUCCEEDED
        : HYDRATION_FAILED;
      const applyExplicitURL = (browserLocation) => {
        if (!isCurrentHydration()) return;
        if (browserLocation.kind === 'directory'
            && !materializeBrowserLocation(browserLocation, sourcesRef.current)) {
          const landingTab = createRuntimeTab({ kind: 'landing' }, sourcesRef.current);
          setTabs([landingTab]);
          setActiveTabId(landingTab.id);
          setErrorMessage('照片来源不可用，请重新打开来源目录');
          pendingNavigationRef.current = createPendingNavigation(landingTab.location);
          navigateBrowserLocation(landingTab.location, { replace: true });
          setHydrationStatus(nextHydrationStatus);
          hydrationCompletedRef.current = true;
          return;
        }
        if (getBrowserLocationIdentity(browserLocation)
            !== getBrowserLocationIdentity(urlLocation)) {
          pendingNavigationRef.current = createPendingNavigation(browserLocation);
          navigateBrowserLocation(browserLocation, { replace: true });
        }
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
        hydrationCompletedRef.current = true;
      };

      if (isExplicitURLLocation(urlLocation)) {
        const rebasedURLLocation = hydrationComputerRoot
          ? rebaseBrowserLocationToSourceRoot(
            urlLocation,
            loadedSources,
            hydrationComputerRoot
          )
          : urlLocation;
        applyExplicitURL(rebasedURLLocation || urlLocation);
        return;
      }

      if (restoredSession) {
        const hasMissingSource = restoredSession.tabs.some((tab) => (
          tab.location.kind === 'directory'
          && !materializeBrowserLocation(tab.location, loadedSources)
        ));
        if (hasMissingSource) {
          setErrorMessage('照片来源不可用，请重新打开来源目录');
        }
        const runtimeTabs = materializeSessionTabs(restoredSession, loadedSources);
        const restoredActiveTab = runtimeTabs.find((tab) => (
          tab.id === restoredSession.activeTabId
        )) || runtimeTabs[0];
        setTabs(runtimeTabs);
        setActiveTabId(restoredActiveTab.id);
        pendingNavigationRef.current = createPendingNavigation(restoredActiveTab.location);
        navigateBrowserLocation(restoredActiveTab.location, { replace: true });
        setHydrationStatus(nextHydrationStatus);
        hydrationCompletedRef.current = true;
        return;
      }

      const landingTab = createRuntimeTab({ kind: 'landing' }, loadedSources);
      setTabs([landingTab]);
      setActiveTabId(landingTab.id);
      setHydrationStatus(nextHydrationStatus);
      hydrationCompletedRef.current = true;
    };

    hydrate();
    return () => {
      cancelled = true;
    };
  }, [navigateBrowserLocation, runtimePlatform, setRuntimeSources, urlLocation]);

  useEffect(() => {
    if (hydrationStatus === HYDRATION_PENDING) return;

    const browserLocation = urlLocation;
    if (browserLocation.kind === 'directory'
        && !materializeBrowserLocation(browserLocation, sourcesRef.current)) {
      setErrorMessage('照片来源不可用，请重新打开来源目录');
      return;
    }
    const nextIdentity = getBrowserLocationIdentity(browserLocation);
    const routeKey = `${location.pathname}\n${location.search}`;
    const routeChanged = observedRouteKeyRef.current !== routeKey;
    observedRouteKeyRef.current = routeKey;

    const pendingNavigation = pendingNavigationRef.current;
    if (pendingNavigation) {
      const pendingIsCurrentRootOperation = pendingNavigation.rootOperationToken === null
        || isCurrentRootOperation(pendingNavigation.rootOperationToken);
      if (pendingNavigation.identity !== nextIdentity) {
        if (!routeChanged) return;
        pendingNavigationRef.current = null;
        invalidateRootOperations();
      } else {
        pendingNavigationRef.current = null;
        if (!pendingIsCurrentRootOperation) return;
      }
    } else if (routeChanged) {
      invalidateRootOperations();
    }

    if (!mountedRef.current) return;
    setTabs((prevTabs) => prevTabs.map((tab) => {
      if (tab.id !== activeTabId) return tab;
      if (getBrowserLocationIdentity(tab.location) === nextIdentity) return tab;
      return createRuntimeTab(browserLocation, sourcesRef.current, tab.id);
    }));
  }, [activeTabId, hydrationStatus, invalidateRootOperations, isCurrentRootOperation, location.pathname, location.search, urlLocation]);

  const createLocationForActivePath = useCallback((
    targetPath,
    viewMode = 'folder',
    initialImage = null
  ) => {
    if (viewMode === 'favorites') return { kind: 'favorites' };
    if (!targetPath) return { kind: 'landing' };

    if (activeTab?.location?.kind !== 'directory') {
      return createLocationFromAbsolutePath(
        targetPath,
        viewMode,
        initialImage,
        sourcesRef.current,
        computerRootSource
      );
    }

    const sourceRoot = sourcesRef.current.find((source) => (
      sourceIdsEqualV1(source.sourceId, activeTab.location.target.sourceId)
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
  }, [activeTab, computerRootSource]);

  const navigateToPath = useCallback((
    targetPath,
    viewMode = 'folder',
    initialImage = null,
    replace = false
  ) => {
    const browserLocation = createLocationForActivePath(targetPath, viewMode, initialImage);
    if (!browserLocation) {
      setErrorMessage('该目录未关联照片来源，请先重新打开来源目录');
      return;
    }
    return commitValidatedLocation({
      tabId: activeTabId,
      browserLocation,
      replace
    });
  }, [activeTabId, commitValidatedLocation, createLocationForActivePath]);

  const navigateToBreadcrumb = useCallback((targetPath) => {
    return navigateToPath(targetPath, 'folder');
  }, [navigateToPath]);

  const handleAlbumClick = useCallback((albumPath, albumName = null, initialImage = null) => {
    return navigateToPath(albumPath, 'album', initialImage);
  }, [navigateToPath]);

  const handleFolderClick = useCallback((folderPath) => {
    return navigateToPath(folderPath, 'folder');
  }, [navigateToPath]);

  const handleGoBack = useCallback(() => {
    if (!activeTab?.location) return;
    const parentLocation = getParentBrowserLocation(activeTab.location);
    if (getBrowserLocationIdentity(parentLocation)
        === getBrowserLocationIdentity(activeTab.location)) {
      return;
    }
    return commitValidatedLocation({
      tabId: activeTabId,
      browserLocation: parentLocation
    });
  }, [activeTab, activeTabId, commitValidatedLocation]);

  const openLocationInNewTab = useCallback((
    browserLocation,
    sourcesOverride = sourcesRef.current,
    rootOperationToken = null
  ) => {
    commitTabLocation({
      browserLocation,
      append: true,
      sourcesOverride,
      rootOperationToken
    });
  }, [commitTabLocation]);

  const openNewTab = useCallback((targetPath = '', viewMode = 'folder', initialImage = null) => {
    if (viewMode === 'favorites') {
      openLocationInNewTab({ kind: 'favorites' });
      return;
    }
    if (!targetPath) {
      openLocationInNewTab(activeTab?.location?.kind === 'directory'
        ? activeTab.location
        : { kind: 'landing' });
      return;
    }
    const browserLocation = createLocationFromAbsolutePath(
      targetPath,
      viewMode,
      initialImage,
      sourcesRef.current,
      computerRootSource
    );
    if (!browserLocation) {
      setErrorMessage('该目录未关联照片来源，请先重新打开来源目录');
      return;
    }
    openLocationInNewTab(browserLocation);
  }, [activeTab, computerRootSource, openLocationInNewTab]);

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
      const operationToken = beginRootOperation();

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
        if (!isCurrentRootOperation(operationToken)) return;
        const folders = Array.isArray(result?.folders) ? result.folders : [];
        if (folders.length === 0) {
          setErrorMessage('只支持拖入文件夹');
          return;
        }

        for (const folderPath of folders) {
          const registered = await registerAbsoluteRoot(folderPath);
          if (!isCurrentRootOperation(operationToken)) return;
          if (!registered) {
            setErrorMessage(`无法建立照片来源：${folderPath}`);
            continue;
          }
          const registeredSources = applyRegisteredRoot(registered);
          openLocationInNewTab(
            registered.browserLocation,
            registeredSources,
            operationToken
          );
        }
      } catch (error) {
        if (!isCurrentRootOperation(operationToken)) return;
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
  }, [applyRegisteredRoot, beginRootOperation, isCurrentRootOperation, openLocationInNewTab, registerAbsoluteRoot]);

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
    randomNavigation.clearAllRandomState();
    setTabsMenuAnchorEl(null);
    invalidateRootOperations();

    const savedTabsSession = loadTabsSession({
      storage: localStorage,
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
    pendingNavigationRef.current = createPendingNavigation(nextActiveTab.location);
    navigateBrowserLocation(nextActiveTab.location, { replace: true });
    setSuccessMessage(`已恢复 ${savedTabsSession.tabs.length} 个标签页`);
  }, [invalidateRootOperations, navigateBrowserLocation, randomNavigation.clearAllRandomState]);

  const handleOpenFolderToTarget = useCallback(async (target) => {
    setOpenFolderMenuAnchorEl(null);
    if (!ipcRenderer) return;
    const operationToken = beginRootOperation();

    try {
      const selectedDir = await ipcRenderer.invoke(CHANNELS.SELECT_DIRECTORY);
      if (!selectedDir || !isCurrentRootOperation(operationToken)) return;
      const registered = await registerAbsoluteRoot(selectedDir);
      if (!isCurrentRootOperation(operationToken)) return;
      if (!registered) {
        throw new Error('无法建立照片来源，请检查目录是否可访问');
      }
      const registeredSources = applyRegisteredRoot(registered);

      if (target === 'current') {
        commitTabLocation({
          tabId: activeTabId,
          browserLocation: registered.browserLocation,
          sourcesOverride: registeredSources,
          rootOperationToken: operationToken
        });
        return;
      }

      if (target === 'new-tab') {
        openLocationInNewTab(
          registered.browserLocation,
          registeredSources,
          operationToken
        );
        return;
      }

      if (target === 'new-window') {
        const newWindowPayload = {
          contractVersion: 1,
          target: registered.browserLocation.target
        };
        const result = await ipcRenderer.invoke(CHANNELS.CREATE_NEW_INSTANCE, newWindowPayload);
        if (!isCurrentRootOperation(operationToken)) return;
        if (!result?.success) {
          throw new Error(result?.error || '创建新窗口失败');
        }
      }
    } catch (error) {
      if (!isCurrentRootOperation(operationToken)) return;
      console.error('打开文件夹失败:', error);
      setErrorMessage(error?.message || '打开文件夹失败');
    }
  }, [activeTabId, applyRegisteredRoot, beginRootOperation, commitTabLocation, isCurrentRootOperation, openLocationInNewTab, registerAbsoluteRoot]);

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
        onRandomBrowse={randomBrowseAvailable ? randomNavigation.handleRandomBrowse : null}
        onRandomScopeRefresh={randomBrowseAvailable
          ? randomNavigation.invalidateActiveScope
          : null}
        randomBrowseLoading={randomNavigation.randomBrowseLoading}
        randomBrowseDisabled={isComputerRootView || randomNavigation.randomBrowseDisabled}
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
        onRandomBrowse={randomBrowseAvailable ? randomNavigation.handleRandomBrowse : null}
        onRandomScopeRefresh={randomBrowseAvailable
          ? randomNavigation.invalidateActiveScope
          : null}
        randomBrowseLoading={randomNavigation.randomBrowseLoading}
        randomBrowseDisabled={isComputerRootView || randomNavigation.randomBrowseDisabled}
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
