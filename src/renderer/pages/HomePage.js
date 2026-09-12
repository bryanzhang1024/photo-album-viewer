import React, { useState, useEffect, useCallback, useMemo, useRef, useContext } from 'react';
import { getBasename, getDirname, getRelativePath, getBreadcrumbPaths } from '../utils/pathUtils';
import { useNavigate, useLocation } from 'react-router-dom';
import { 
  Box, 
  Typography, 
  Button, 
  CircularProgress,
  LinearProgress,
  Alert,
  Snackbar,
  Paper,
  useMediaQuery,
  useTheme
} from '@mui/material';
import SettingsIcon from '@mui/icons-material/Settings';
import CollectionsIcon from '@mui/icons-material/Collections';
import AlbumCard from '../components/AlbumCard';
import ImageCard from '../components/ImageCard';
import ImageViewer from '../components/ImageViewer';
import BreadcrumbNavigation from '../components/BreadcrumbNavigation';
import { Virtuoso } from 'react-virtuoso';
import { ScrollPositionContext } from '../App';
import { useFavorites } from '../contexts/FavoritesContext';
import { useSettings } from '../contexts/SettingsContext';
import imageCache from '../utils/ImageCacheManager';
import CHANNELS from '../../common/ipc-channels';
import useSorting from '../hooks/useSorting';
import { getFolderSortScopeKey, compareByFolderSort } from '../utils/sortPreference';
import useGridThumbnailPrefetch, { extractHomePageRowPaths } from '../hooks/useGridThumbnailPrefetch';
import PageLayout from '../components/PageLayout';
import GridPageToolbar from '../components/GridPageToolbar';
import { GRID_CONFIG, DEFAULT_DENSITY, computeGridColumns, chunkIntoRows } from '../utils/virtualGrid';
import {
  canViewAsPhotoSet,
  getPrimaryKind,
  getPrimaryView
} from '../utils/nodeModel';

// 安全地获取electron对象
const ipcRenderer = window.electronAPI || null;


function HomePage({
  colorMode,
  // URL模式的新props
  currentPath: urlCurrentPath = null,
  onNavigate = null,
  onBreadcrumbNavigate = null,
  onAlbumClick = null,
  onFolderClick = null,
  onOpenFavoritesInNewTab = null,
  onRandomBrowse = null,
  onRandomScopeRefresh = null,
  randomBrowseLoading = false,
  randomBrowseDisabled = false,
  sourceBoundary = null,
  sourceBreadcrumbs = null,
  urlMode = false,
  tabsHeaderContent = null,
  tabScrollKey = null
}) {
  const navigate = useNavigate();
  const location = useLocation();
  const theme = useTheme();
  const rootPath = sourceBoundary?.rootPath || '';
  const [navigationState, setNavigationState] = useState(() => ({
    path: '',
    nodes: [],
    directImages: [],
    breadcrumbs: [],
    metadata: null
  }));
  const [loading, setLoading] = useState(false);
  const [scanProgress, setScanProgress] = useState(null);
  const [error, setError] = useState('');
  const [userDensity, setUserDensity] = useState(() => {
    const savedDensity = localStorage.getItem('userDensity');
    return (savedDensity && GRID_CONFIG[savedDensity]) ? savedDensity : DEFAULT_DENSITY;
  });
  const [windowWidth, setWindowWidth] = useState(window.innerWidth);
  const [windowHeight, setWindowHeight] = useState(window.innerHeight);
  const isSmallScreen = useMediaQuery(theme.breakpoints.down('sm'));
  const scrollContainerRef = useRef(null);
  const activeScanPathRef = useRef('');
  const scanGenerationRef = useRef(0);
  const [virtualScrollParent, setVirtualScrollParent] = useState(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchHasFocus, setSearchHasFocus] = useState(false);
  const [viewerOpen, setViewerOpen] = useState(false);
  const [selectedImageIndex, setSelectedImageIndex] = useState(0);
  const { path: currentPath, nodes: navigationNodes, directImages, breadcrumbs, metadata } = navigationState;
  const displayedBreadcrumbs = Array.isArray(sourceBreadcrumbs)
    ? sourceBreadcrumbs
    : breadcrumbs;
  const homeSortFields = useMemo(() => ['name', 'imageCount', 'lastModified'], []);
  const homeLegacySortKeys = useMemo(
    () => ({ sortByKey: 'sortBy', sortDirectionKey: 'sortDirection' }),
    []
  );
  const folderSortScopeKey = useMemo(
    () => getFolderSortScopeKey(currentPath, rootPath),
    [currentPath, rootPath]
  );
  const { sortBy, sortDirection, handleSortChange, handleDirectionChange } = useSorting('name', 'asc', {
    scopeKey: folderSortScopeKey,
    storageNamespace: 'sorting:folder',
    allowedSortBy: homeSortFields,
    legacyKeys: homeLegacySortKeys
  });
  const albumNodes = useMemo(
    () => navigationNodes.filter(node => canViewAsPhotoSet(node)),
    [navigationNodes]
  );
  const updateNavigationState = useCallback((data, fallbackPath = '') => {
    setNavigationState({
      path: data?.currentPath ?? fallbackPath ?? '',
      nodes: data?.nodes ?? [],
      directImages: data?.directImages ?? [],
      breadcrumbs: data?.breadcrumbs ?? [],
      metadata: data?.metadata ?? null
    });
  }, [setNavigationState]);

  const normalizedSearchQuery = useMemo(
    () => searchQuery.trim().toLowerCase(),
    [searchQuery]
  );

  useEffect(() => {
    setSearchQuery('');
    setSearchHasFocus(false);
  }, [currentPath]);

  const filteredNodes = useMemo(() => {
    if (!navigationNodes.length) {
      return [];
    }

    if (!normalizedSearchQuery) {
      return navigationNodes;
    }

    return navigationNodes.filter((node) => {
      const nodeName = (node.name || '').toLowerCase();
      if (nodeName.includes(normalizedSearchQuery)) {
        return true;
      }

      const relativePath = currentPath
        ? getRelativePath(currentPath, node.path) || node.name
        : node.name;

      if (relativePath && relativePath.toLowerCase().includes(normalizedSearchQuery)) {
        return true;
      }

      return (node.path || '').toLowerCase().includes(normalizedSearchQuery);
    });
  }, [navigationNodes, normalizedSearchQuery, currentPath]);

  const filteredDirectImages = useMemo(() => {
    if (!directImages.length) {
      return [];
    }

    if (!normalizedSearchQuery) {
      return directImages;
    }

    return directImages.filter((image) => {
      const imageName = (image.name || '').toLowerCase();
      if (imageName.includes(normalizedSearchQuery)) {
        return true;
      }

      return (image.path || '').toLowerCase().includes(normalizedSearchQuery);
    });
  }, [directImages, normalizedSearchQuery]);
  
  // 获取滚动位置上下文
  const scrollContext = useContext(ScrollPositionContext);
  const scrollPositionKey = useMemo(
    () => `${tabScrollKey || '__default__'}::${location.pathname}${location.search}`,
    [tabScrollKey, location.pathname, location.search]
  );
  const saveScrollPosition = useCallback(() => {
    if (scrollContainerRef.current) {
      scrollContext.savePosition(scrollPositionKey, scrollContainerRef.current.scrollTop);
    }
  }, [scrollContext, scrollPositionKey]);
  
  // 获取收藏上下文
  const {
    isFolderFavorited,
    isAlbumFavorited,
    toggleFolderFavorite,
    toggleAlbumFavorite
  } = useFavorites();
  const { settings } = useSettings();
  const homeSortGrouping = settings?.homeSortGrouping || 'mixed';


  // 监听窗口大小变化
  useEffect(() => {
    const handleResize = () => {
      setWindowWidth(window.innerWidth);
      setWindowHeight(window.innerHeight);

      // 添加日志以便调试
      console.log(`窗口大小变化: ${window.innerWidth}x${window.innerHeight}`);

    };

    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  useEffect(() => {
    if (scrollContainerRef.current) {
      setVirtualScrollParent(scrollContainerRef.current);
    }
  }, []);

  const overscanConfig = useMemo(() => {
    const usableHeight = Math.max(windowHeight, 600);
    return {
      top: Math.round(usableHeight * 0.75),
      bottom: Math.round(usableHeight * 1.25)
    };
  }, [windowHeight]);

  const estimatedGridRowHeight = useMemo(() => {
    const densityConfig = GRID_CONFIG[userDensity] || GRID_CONFIG[DEFAULT_DENSITY];
    const baseHeight = (densityConfig.itemWidth * 3) / 2;
    return Math.round(baseHeight + densityConfig.gap);
  }, [userDensity]);
  
  
  // 在组件挂载后恢复滚动位置
  useEffect(() => {
    const timer = setTimeout(() => {
      if (scrollContainerRef.current) {
        const savedPosition = scrollContext.getPosition(scrollPositionKey);
        scrollContainerRef.current.scrollTop = savedPosition;
      }
    }, 100);
    
    return () => clearTimeout(timer);
  }, [scrollContext, scrollPositionKey]);

  
  useEffect(() => {
    if (!ipcRenderer?.on) {
      return undefined;
    }

    const handleScanProgress = (_event, payload) => {
      if (!payload || payload.targetPath !== activeScanPathRef.current) {
        return;
      }

      if (payload.done) {
        setScanProgress(null);
        return;
      }

      setScanProgress({
        processed: payload.processed || 0,
        total: payload.total || 0,
        targetPath: payload.targetPath
      });
    };

    ipcRenderer.on(CHANNELS.SCAN_NAVIGATION_PROGRESS, handleScanProgress);
    return () => {
      ipcRenderer.removeListener(CHANNELS.SCAN_NAVIGATION_PROGRESS, handleScanProgress);
    };
  }, []);

  // 智能导航扫描 - 新架构（使用统一缓存）
  const scanNavigationLevel = useCallback(async (targetPath) => {
    let generation = 0;

    try {
      if (!ipcRenderer) {
        setError('无法访问ipcRenderer, Electron可能没有正确加载');
        return;
      }

      const cachedData = imageCache.get('navigation', targetPath);
      if (cachedData) {
        console.log(`使用缓存数据: ${targetPath}`);
        updateNavigationState(cachedData, targetPath);
        console.log(`从缓存加载: ${cachedData.metadata.totalNodes} 个节点`);
        setScanProgress(null);
        return;
      }

      generation = scanGenerationRef.current + 1;
      scanGenerationRef.current = generation;
      activeScanPathRef.current = targetPath;
      setLoading(true);
      setScanProgress(null);
      setError('');

      console.log(`开始扫描导航层级: ${targetPath}`);
      const response = await ipcRenderer.invoke(CHANNELS.SCAN_NAVIGATION_LEVEL, targetPath);

      if (generation !== scanGenerationRef.current) {
        return;
      }

      if (response.success) {
        imageCache.set('navigation', targetPath, response);
        updateNavigationState(response, targetPath);
        console.log(`扫描完成: ${response.metadata.totalNodes} 个节点`);
      } else {
        setError(response.error?.message || '扫描失败');
      }
    } catch (err) {
      if (generation !== 0 && scanGenerationRef.current === generation) {
        console.error('扫描错误:', err);
        setError('扫描文件夹时出错: ' + err.message);
      }
    } finally {
      if (generation !== 0 && generation === scanGenerationRef.current) {
        if (activeScanPathRef.current === targetPath) {
          activeScanPathRef.current = '';
        }
        setScanProgress(null);
        setLoading(false);
      }
    }
  }, [updateNavigationState]);

  // 处理节点点击 - 支持文件夹和相册 - 使用 useCallback 缓存
  const handleNodeClick = useCallback(async (node) => {
    const primaryView = getPrimaryView(node);

    if (primaryView === 'folder') {
      if (onFolderClick) {
        saveScrollPosition();
        onFolderClick(node.path);
        return;
      }
      setError('该目录未关联照片来源，请重新打开来源');
      return;
    }

    saveScrollPosition();
    if (onAlbumClick) {
      onAlbumClick(node.path, node.name);
    } else {
      setError('该目录未关联照片来源，请重新打开来源');
    }
  }, [onFolderClick, onAlbumClick, saveScrollPosition]);

  const handleNodeOpenPhotoSet = useCallback(async (node) => {
    if (!node?.path) return;

    saveScrollPosition();
    if (onAlbumClick) {
      onAlbumClick(node.path, node.name);
      return;
    }
    setError('该目录未关联照片来源，请重新打开来源');
  }, [onAlbumClick, saveScrollPosition]);

  const handleNodeBrowseChildren = useCallback(async (node) => {
    if (!node?.path) return;

    saveScrollPosition();
    if (onFolderClick) {
      onFolderClick(node.path);
      return;
    }
    setError('该目录未关联照片来源，请重新打开来源');
  }, [onFolderClick, saveScrollPosition]);

  const handleDirectImageClick = useCallback((index) => {
    saveScrollPosition();
    setSelectedImageIndex(index);
    setViewerOpen(true);
  }, [saveScrollPosition]);

  const handleCloseViewer = useCallback(() => {
    setViewerOpen(false);
  }, []);

  // 处理浮动导航面板的相册点击
  const handleFloatingPanelAlbumClick = useCallback((albumPath, albumName) => {
    saveScrollPosition();
    if (onAlbumClick) {
      onAlbumClick(albumPath, albumName);
    } else {
      setError('该目录未关联照片来源，请重新打开来源');
    }
  }, [onAlbumClick, saveScrollPosition]);
  
  // 重新扫描
  const handleRefresh = useCallback(() => {
    const refreshTargetPath = currentPath || rootPath;
    if (refreshTargetPath) {
      if (onRandomBrowse) onRandomScopeRefresh?.();
      imageCache.clearType('navigation');
      scanNavigationLevel(refreshTargetPath);
    }
  }, [currentPath, rootPath, onRandomBrowse, onRandomScopeRefresh, scanNavigationLevel]);
  

  
  const sortedDisplayItems = useMemo(() => {
    const nodeItems = filteredNodes.map((node) => ({
      itemKind: 'node',
      key: `node:${node.path}`,
      name: node.name || '',
      path: node.path || '',
      lastModified: node.lastModified || 0,
      count: getPrimaryKind(node) === 'folder' ? (node.childFolders || 0) : (node.imageCount || 0),
      groupRank: getPrimaryKind(node) === 'folder' ? 0 : 1,
      node
    }));
    const imageItems = filteredDirectImages.map((image) => ({
      itemKind: 'image',
      key: `image:${image.path}`,
      name: image.name || '',
      path: image.path || '',
      lastModified: image.lastModified || 0,
      count: 1,
      groupRank: 2,
      image
    }));

    return [...nodeItems, ...imageItems].sort((a, b) => {
      if (homeSortGrouping === 'containersFirst' && a.groupRank !== b.groupRank) {
        return a.groupRank - b.groupRank;
      }

      return compareByFolderSort(a, b, sortBy, sortDirection);
    });
  }, [filteredNodes, filteredDirectImages, sortBy, sortDirection, homeSortGrouping]);

  const sortedDirectImages = useMemo(
    () => sortedDisplayItems
      .filter((item) => item.itemKind === 'image')
      .map((item) => item.image),
    [sortedDisplayItems]
  );

  const directImageIndexByPath = useMemo(
    () => sortedDirectImages.reduce((acc, image, index) => {
      acc[image.path] = index;
      return acc;
    }, {}),
    [sortedDirectImages]
  );

  const columnsCount = useMemo(
    () => computeGridColumns(windowWidth, userDensity, { isSmallScreen }),
    [windowWidth, userDensity, isSmallScreen]
  );

  const gridRows = useMemo(
    () => chunkIntoRows(sortedDisplayItems, columnsCount),
    [sortedDisplayItems, columnsCount]
  );

  const { handleRangeChanged } = useGridThumbnailPrefetch({
    gridRows,
    extractPathsFromRow: extractHomePageRowPaths
  });

  const hasActiveSearch = Boolean(normalizedSearchQuery);
  const totalItemsCount = navigationNodes.length + directImages.length;
  const filteredItemsCount = sortedDisplayItems.length;

  const handleViewerImageDeleted = useCallback((deletedPath) => {
    if (!deletedPath) return;

    setNavigationState(prevState => {
      const nextDirectImages = (prevState.directImages || []).filter(image => image.path !== deletedPath);
      const nextState = {
        ...prevState,
        directImages: nextDirectImages,
        metadata: prevState.metadata
          ? {
              ...prevState.metadata,
              directImageCount: nextDirectImages.length
            }
          : prevState.metadata
      };

      imageCache.set('navigation', prevState.path || currentPath, {
        success: true,
        currentPath: nextState.path,
        nodes: nextState.nodes,
        directImages: nextState.directImages,
        breadcrumbs: nextState.breadcrumbs,
        metadata: nextState.metadata
      });

      return nextState;
    });
  }, [currentPath]);

  // 获取节点显示路径 - 使用 useMemo 缓存路径计算
  const nodeDisplayPaths = useMemo(() => {
    if (!currentPath || !navigationNodes.length) return {};

    return navigationNodes.reduce((acc, node) => {
      const relativePath = getRelativePath(currentPath, node.path);
      acc[node.path] = relativePath || node.name;
      return acc;
    }, {});
  }, [navigationNodes, currentPath]);

  const getNodeDisplayPath = (node) => {
    if (!node || !currentPath) return '';
    return nodeDisplayPaths[node.path] || node.name;
  };
  
  // 处理导航到收藏页面
  const handleNavigateToFavorites = () => {
    // 保存当前滚动位置
    saveScrollPosition();

    if (onOpenFavoritesInNewTab) {
      onOpenFavoritesInNewTab();
      return;
    }

    if (urlMode && onNavigate) {
      onNavigate('', 'favorites');
      return;
    }

    navigate('/favorites');
  };

  const handleToggleCurrentFolderFavorite = useCallback(() => {
    if (!currentPath) return;

    toggleFolderFavorite({
      path: currentPath,
      name: getBasename(currentPath),
      childFolders: metadata?.folderCount || 0
    });
  }, [currentPath, metadata?.folderCount, toggleFolderFavorite]);

  const handleToggleCurrentPhotoSetFavorite = useCallback(() => {
    if (!currentPath || directImages.length === 0) return;

    toggleAlbumFavorite({
      kind: 'photoSet',
      path: currentPath,
      name: getBasename(currentPath),
      imageCount: directImages.length,
      previewImages: directImages.slice(0, 4)
    });
  }, [currentPath, directImages, toggleAlbumFavorite]);
  
  
  // 随机浏览只由 canonical coordinator 处理。
  const handleRandomAlbum = useCallback(() => {
    if (!onRandomBrowse) return;
    Promise.resolve()
      .then(() => onRandomBrowse())
      .catch((error) => setError(error?.message || '随机浏览失败'));
  }, [onRandomBrowse]);

  // 返回上级目录
  const handleGoUp = async () => {
    const isAtNavigationRoot = sourceBoundary
      ? sourceBoundary.relativePath === ''
      : currentPath === rootPath;
    if (!currentPath || isAtNavigationRoot) return;

    // 获取当前路径的上级目录
    const parentPath = getDirname(currentPath);

    // 如果上级目录存在，则导航到上级
    if (parentPath && parentPath !== currentPath) {
      saveScrollPosition();

      if (onNavigate) {
        onNavigate(parentPath, 'folder');
        return;
      }
      setError('该目录未关联照片来源，请重新打开来源');
    }
  };

  const handleBreadcrumbNavigate = useCallback((targetPath) => {
    if (onBreadcrumbNavigate) {
      saveScrollPosition();
      onBreadcrumbNavigate(targetPath);
      return;
    }
    setError('该目录未关联照片来源，请重新打开来源');
  }, [onBreadcrumbNavigate, saveScrollPosition]);

  // URL模式初始化 - 处理来自BrowserPage的props
  useEffect(() => {
    if (urlMode && urlCurrentPath !== null) {
      console.log('URL模式：设置当前路径为', urlCurrentPath);
      if (urlCurrentPath) {
        scanNavigationLevel(urlCurrentPath);
      } else {
        updateNavigationState({ currentPath: '', nodes: [], directImages: [], breadcrumbs: [], metadata: null }, '');
      }
      return;
    }
  }, [urlMode, urlCurrentPath, scanNavigationLevel, updateNavigationState]);

  // 添加键盘快捷键监听
  useEffect(() => {
    const handleKeyDown = (event) => {
      if (viewerOpen) {
        return;
      }

      if (searchHasFocus) {
        return;
      }

      if (document.activeElement.tagName === 'INPUT' || 
          document.activeElement.tagName === 'TEXTAREA' ||
          document.activeElement.isContentEditable) {
        return; // 在输入框中时，禁用部分快捷键
      }

      if (event.ctrlKey || event.altKey || event.metaKey) {
        return;
      }

      switch (event.key) {
        case 'e':
        case 'E':
          handleRandomAlbum();
          break;
        case 'r':
        case 'R':
          handleRefresh();
          break;
        case 'Backspace':
          handleGoUp();
          break;
        default:
          break;
      }
    };
    
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [handleGoUp, handleRandomAlbum, handleRefresh, searchHasFocus, viewerOpen]);

  const canRefreshCurrentFolder = Boolean(currentPath || rootPath);
  const randomDisabled = !onRandomBrowse || randomBrowseDisabled || randomBrowseLoading;
  
    const renderHeader = () => (
      <>
        <BreadcrumbNavigation
          breadcrumbs={displayedBreadcrumbs}
          currentPath={currentPath}
          onNavigate={handleBreadcrumbNavigate}
          variant="minimal"
          compact={isSmallScreen}
          sx={{ flexGrow: 1, minWidth: 0 }}
        />
        <Button
          size="small"
          color="inherit"
          startIcon={<CollectionsIcon />}
          onClick={() => navigate('/cos')}
          sx={{ whiteSpace: 'nowrap', mr: 0.5 }}
        >
          Cos 图库
        </Button>
        <GridPageToolbar
          searchQuery={searchQuery}
          onSearchChange={setSearchQuery}
          searchPlaceholder="搜索当前文件夹"
          onSearchFocusChange={setSearchHasFocus}
          sortOptions={[
            { value: 'name', label: '名称' },
            { value: 'imageCount', label: '照片数量' },
            { value: 'lastModified', label: '修改时间' }
          ]}
          sortBy={sortBy}
          sortDirection={sortDirection}
          onSortChange={handleSortChange}
          onSortDirectionChange={handleDirectionChange}
          userDensity={userDensity}
          onDensityChange={(value) => {
            setUserDensity(value);
            localStorage.setItem('userDensity', value);
          }}
          onRandomAlbum={handleRandomAlbum}
          randomDisabled={randomDisabled}
          onRefresh={handleRefresh}
          refreshDisabled={!canRefreshCurrentFolder}
          refreshAriaLabel="刷新当前文件夹"
          favoriteMenuItems={[
            {
              id: 'folder',
              label: isFolderFavorited(currentPath) ? '取消收藏当前文件夹' : '收藏当前文件夹',
              checked: isFolderFavorited(currentPath),
              disabled: !currentPath,
              onClick: handleToggleCurrentFolderFavorite
            },
            {
              id: 'photoSet',
              label: isAlbumFavorited(currentPath) ? '取消收藏当前照片集合' : '收藏当前照片集合',
              checked: isAlbumFavorited(currentPath),
              disabled: !currentPath || (!isAlbumFavorited(currentPath) && directImages.length === 0),
              onClick: handleToggleCurrentPhotoSetFavorite
            }
          ]}
          openFavoritesItem={{
            label: '打开我的收藏',
            onClick: handleNavigateToFavorites
          }}
          onOpenSettings={() => navigate('/settings')}
        />
      </>
    );
  
  const renderScanProgress = () => {
    if (!scanProgress || !scanProgress.total) {
      return null;
    }

    const progressValue = Math.min(
      100,
      Math.round((scanProgress.processed / scanProgress.total) * 100)
    );

    return (
      <Box sx={{ mb: 2 }}>
        <LinearProgress variant="determinate" value={progressValue} />
        <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.75 }}>
          正在扫描 {scanProgress.processed} / {scanProgress.total} 项…
        </Typography>
      </Box>
    );
  };

  const renderContent = () => {
    const hasContent = navigationNodes.length > 0 || directImages.length > 0;

    if (loading && !hasContent && !scanProgress) {
      return (
        <Paper elevation={2} sx={{ p: 3, textAlign: 'center' }}>
          <CircularProgress />
          <Typography variant="body1" sx={{ mt: 2 }}>
            正在加载文件夹...
          </Typography>
        </Paper>
      );
    }

    if (!hasContent && !loading && !scanProgress) {
      return (
        <Paper elevation={2} sx={{ p: 3, textAlign: 'center' }}>
          <Typography variant="h6" gutterBottom>没有找到相簿</Typography>
          <Typography variant="body2" color="text.secondary" paragraph>
            请在设置页面选择一个包含照片相簿的文件夹
          </Typography>
          <Button
            variant="contained"
            startIcon={<SettingsIcon />}
            onClick={() => navigate('/settings')}
          >
            打开设置
          </Button>
        </Paper>
      );
    }

    const densityConfig = GRID_CONFIG[userDensity] || GRID_CONFIG[DEFAULT_DENSITY];
    const rowsToRender = gridRows.length > 0 ? gridRows : (sortedDisplayItems.length ? [sortedDisplayItems] : []);

    if (hasActiveSearch && filteredItemsCount === 0) {
      return (
        <Paper elevation={2} sx={{ p: 3, textAlign: 'center' }}>
          <Typography variant="h6" gutterBottom>没有匹配的项目</Typography>
          <Typography variant="body2" color="text.secondary">
            换个关键词或者清空搜索看看
          </Typography>
        </Paper>
      );
    }

    return (
      <Box>
        {renderScanProgress()}
        {metadata && (
          <Box sx={{ mb: 2, display: 'flex', justifyContent: 'flex-start', alignItems: 'center', gap: 2 }}>
            <Typography variant="caption" color="text.secondary">
              共 {metadata.albumCount} 个相簿, {metadata.directImageCount || 0} 张照片
            </Typography>
          </Box>
        )}
        {hasActiveSearch && (
          <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1 }}>
            匹配 {filteredItemsCount} / {totalItemsCount} 项
          </Typography>
        )}
        {rowsToRender.length > 0 ? (
          <Virtuoso
            data={rowsToRender}
            customScrollParent={virtualScrollParent || undefined}
            overscan={Math.max(overscanConfig.top, overscanConfig.bottom)}
            increaseViewportBy={overscanConfig}
            computeItemKey={(rowIndex, row) => {
              const firstItem = Array.isArray(row) ? row[0] : null;
              return firstItem?.key ? `row-${firstItem.key}` : `row-${rowIndex}`;
            }}
            rangeChanged={handleRangeChanged}
            itemContent={(rowIndex, row) => (
              <Box
                sx={{
                  display: 'grid',
                  gridTemplateColumns: `repeat(${columnsCount}, minmax(0, 1fr))`,
                  gap: `${densityConfig.gap}px`,
                  mb: `${densityConfig.gap}px`,
                  px: { xs: 1, sm: 2, md: 3 },
                  minHeight: `${estimatedGridRowHeight}px`
                }}
              >
                {row.map((item, colIndex) => {
                  const itemKey = item?.key || `${rowIndex}-${colIndex}`;
                  if (item.itemKind === 'node') {
                    return (
                      <Box key={itemKey} sx={{ width: '100%' }}>
                        <AlbumCard
                          node={item.node}
                          displayPath={getNodeDisplayPath(item.node)}
                          onClick={() => handleNodeClick(item.node)}
                          onBrowseChildren={() => handleNodeBrowseChildren(item.node)}
                          onOpenPhotoSet={() => handleNodeOpenPhotoSet(item.node)}
                          isCompactMode={userDensity === 'compact'}
                        />
                      </Box>
                    );
                  }

                  const imageIndex = directImageIndexByPath[item.image.path] ?? 0;
                  return (
                    <Box key={itemKey} sx={{ width: '100%', aspectRatio: '2/3' }}>
                      <ImageCard
                        image={item.image}
                        onClick={() => handleDirectImageClick(imageIndex)}
                        density={userDensity}
                        albumPath={currentPath}
                      />
                    </Box>
                  );
                })}
              </Box>
            )}
          />
        ) : null}
        {viewerOpen && (
          <ImageViewer
            images={sortedDirectImages}
            currentIndex={selectedImageIndex}
            onClose={handleCloseViewer}
            onIndexChange={setSelectedImageIndex}
            onImageDeleted={handleViewerImageDeleted}
          />
        )}
      </Box>
    );
  };
  
    return (
      <PageLayout
        loading={loading}
        error={error}
        headerContent={renderHeader()}
        subHeaderContent={tabsHeaderContent}
        scrollContainerRef={scrollContainerRef}
      >
        {renderContent()}
        <Snackbar 
          open={!!error} 
          autoHideDuration={6000} 
          onClose={() => setError('')} 
          anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
        >
          <Alert onClose={() => setError('')} severity="error" sx={{ width: '100%' }}>
            {error}
          </Alert>
        </Snackbar>
      </PageLayout>
    );
  }
export default HomePage; 
