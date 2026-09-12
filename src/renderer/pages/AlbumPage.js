import React, { useState, useEffect, useCallback, useRef, useContext, useMemo } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import {
  Box,
  Typography,
  Button,
  CircularProgress,
  Snackbar,
  Alert,
  Paper,
  useMediaQuery,
  useTheme
} from '@mui/material';
import ImageViewer from '../components/ImageViewer';
import BreadcrumbNavigation from '../components/BreadcrumbNavigation';
import ImageCard from '../components/ImageCard';
import { Virtuoso } from 'react-virtuoso';
import { ScrollPositionContext } from '../App';
import { useFavorites } from '../contexts/FavoritesContext';
import imageCache from '../utils/ImageCacheManager';
import { getBreadcrumbPaths, getBasename, getDirname, isValidPath } from '../utils/pathUtils';
import CHANNELS from '../../common/ipc-channels';
import useSorting from '../hooks/useSorting';
import useAlbumImages from '../hooks/useAlbumImages';
import useGridThumbnailPrefetch, { extractAlbumImageRowPaths } from '../hooks/useGridThumbnailPrefetch';
import useBreadcrumbs from '../hooks/useBreadcrumbs';
import useNeighboringAlbums from '../hooks/useNeighboringAlbums';
import PageLayout from '../components/PageLayout';
import GridPageToolbar from '../components/GridPageToolbar';
import { GRID_CONFIG, DEFAULT_DENSITY, computeGridColumns, chunkIntoRows } from '../utils/virtualGrid';
import {
  buildNodeFromScanResponse,
  getPrimaryView
} from '../utils/nodeModel';

// 安全地获取electron对象
const ipcRenderer = window.electronAPI || null;


function AlbumPage({
  colorMode,
  // URL模式的新props
  albumPath: urlAlbumPath = null,
  initialImage: urlInitialImage = null,
  onNavigate = null,
  onBreadcrumbNavigate = null,
  onAlbumClick = null,
  onGoBack = null,
  onOpenFavoritesInNewTab = null,
  onRandomBrowse = null,
  randomBrowseLoading = false,
  randomBrowseDisabled = false,
  sourceBoundary = null,
  sourceBreadcrumbs = null,
  readOnly = false,
  collectionSetId = null,
  urlMode = false,
  tabsHeaderContent = null,
  tabScrollKey = null,
  embeddedMode = false,
  headerLeadingContent = null,
  headerExtraActions = null
}) {
  const navigate = useNavigate();
  const location = useLocation();
  const theme = useTheme();
  const [viewerOpen, setViewerOpen] = useState(false);
  const [selectedImageIndex, setSelectedImageIndex] = useState(0);
  const [error, setError] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [userDensity, setUserDensity] = useState(() => {
    const savedDensity = localStorage.getItem('userDensity');
    return (savedDensity && GRID_CONFIG[savedDensity]) ? savedDensity : DEFAULT_DENSITY;
  });
  const [windowWidth, setWindowWidth] = useState(window.innerWidth);
  const [windowHeight, setWindowHeight] = useState(window.innerHeight);
  const rootPath = sourceBoundary?.rootPath || '';
  const isSmallScreen = useMediaQuery(theme.breakpoints.down('sm'));
  const scrollContainerRef = useRef(null);
  const [virtualScrollParent, setVirtualScrollParent] = useState(null);
  const initialImagePath = useRef(null); // 存储初始要显示的图片路径
  const [isNavigating, setIsNavigating] = useState(false); // 导航锁，防止重复操作
  const [searchHasFocus, setSearchHasFocus] = useState(false);
  const [childFolderCount, setChildFolderCount] = useState(0);


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

  const navigateToFolderPath = useCallback((targetPath, options = {}) => {
    saveScrollPosition();

    if (onNavigate) {
      onNavigate(targetPath, 'folder', null, options.replace ?? false);
      return;
    }
    setError('该目录未关联照片来源，请重新打开来源');
  }, [onNavigate, saveScrollPosition]);

  const navigateToAlbumPath = useCallback((targetPath, albumName = null, initialImage = null, options = {}) => {
    saveScrollPosition();

    if (onAlbumClick) {
      onAlbumClick(targetPath, albumName, initialImage);
      return;
    }

    setError('该目录未关联照片来源，请重新打开来源');
  }, [onAlbumClick, saveScrollPosition]);

  const decodedAlbumPath = urlAlbumPath || '';
  const breadcrumbRootPath = rootPath;
  const albumSortFields = useMemo(() => ['name', 'size', 'lastModified'], []);
  const albumLegacySortKeys = useMemo(
    () => ({ sortByKey: 'sortBy', sortDirectionKey: 'sortDirection' }),
    []
  );
  const { sortBy, sortDirection, handleSortChange, handleDirectionChange } = useSorting('name', 'asc', {
    scopeKey: decodedAlbumPath || '__root__',
    storageNamespace: 'sorting:album',
    allowedSortBy: albumSortFields,
    legacyKeys: albumLegacySortKeys
  });

  // 使用自定义 Hooks
  const normalizedSearchQuery = useMemo(
    () => searchQuery.trim().toLowerCase(),
    [searchQuery]
  );

  const {
    images,
    totalCount,
    hasMore,
    loading,
    loadingMore,
    error: loadError,
    loadImages,
    loadMore,
    ensureImageLoaded,
    refresh,
    removeImage,
    queryKey
  } = useAlbumImages(decodedAlbumPath, {
    collectionSetId,
    sortBy,
    sortDirection,
    searchQuery: normalizedSearchQuery
  });
  const { breadcrumbs, metadata, loadBreadcrumbs } = useBreadcrumbs(
    decodedAlbumPath,
    breadcrumbRootPath,
    sourceBreadcrumbs
  );
  const { neighboringAlbums, siblingAlbums, loadNeighboringAlbums } = useNeighboringAlbums(decodedAlbumPath);
  const handleRefreshAlbum = useCallback(() => {
    refresh();
  }, [refresh]);

  useEffect(() => {
    setSearchQuery('');
    setSearchHasFocus(false);
  }, [decodedAlbumPath]);

  // 检测路径类型（文件夹 vs 相簿）
  const loadChildFolderCount = useCallback(async (path) => {
    if (!path || !ipcRenderer) {
      setChildFolderCount(0);
      return 0;
    }

    try {
      const cachedResponse = imageCache.get('navigation', path);
      const response = cachedResponse || await ipcRenderer.invoke(CHANNELS.SCAN_NAVIGATION_LEVEL, path);

      if (!cachedResponse && response?.success) {
        imageCache.set('navigation', path, response);
      }

      const childCount = response?.success ? (response.nodes?.length || 0) : 0;
      setChildFolderCount(childCount);
      return childCount;
    } catch (error) {
      console.error('加载子目录信息失败:', error);
      setChildFolderCount(0);
      return 0;
    }
  }, [ipcRenderer]);

  // 获取收藏上下文
  const { favorites, isAlbumFavorited, toggleAlbumFavorite } = useFavorites();

  // 初始图片只接受 BrowserPage 传入的 canonical target 投影。
  useEffect(() => {
    initialImagePath.current = urlInitialImage || null;
  }, [urlInitialImage]);

  // 加载相簿图片、相邻相簿信息和面包屑数据
  useEffect(() => {
    let cancelled = false; // 竞态条件保护

    const loadAllData = async () => {
      if (cancelled) return;

      let located = null;
      if (initialImagePath.current) {
        located = await ensureImageLoaded(initialImagePath.current);
      } else {
        await loadImages();
      }

      if (cancelled) return;
      if (!embeddedMode) {
        await loadNeighboringAlbums();

        if (cancelled) return;
        await loadBreadcrumbs();

        if (cancelled) return;
        await loadChildFolderCount(decodedAlbumPath);

        if (cancelled) return;
        await preloadParentDirectory();
      } else {
        setChildFolderCount(0);
      }

      if (initialImagePath.current && located?.globalIndex >= 0) {
        const imageIndex = located.globalIndex - (located.offset || 0);
        if (imageIndex !== -1) {
          setTimeout(() => {
            setSelectedImageIndex(imageIndex);
            setViewerOpen(true);
            initialImagePath.current = null;
          }, 100);
        }
      }
    };

    loadAllData();

    return () => {
      cancelled = true;
    };
  }, [decodedAlbumPath, embeddedMode, queryKey, loadImages, ensureImageLoaded, loadNeighboringAlbums, loadBreadcrumbs, loadChildFolderCount]);

  // 监听窗口大小变化
  useEffect(() => {
    const handleResize = () => {
      setWindowWidth(window.innerWidth);
      setWindowHeight(window.innerHeight);
    };

    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  useEffect(() => {
    if (scrollContainerRef.current) {
      setVirtualScrollParent(scrollContainerRef.current);
    }
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => {
      if (!scrollContainerRef.current) {
        return;
      }

      const savedPosition = scrollContext.getPosition(scrollPositionKey);
      scrollContainerRef.current.scrollTop = savedPosition;
    }, 100);

    return () => clearTimeout(timer);
  }, [scrollContext, scrollPositionKey]);

  // 从localStorage中读取密度设置
  useEffect(() => {
    const savedDensity = localStorage.getItem('userDensity');
    if (savedDensity) {
      setUserDensity(savedDensity);
    }
  }, []);

  // 预加载父目录 - 性能优化
  const preloadParentDirectory = async () => {
    try {
      if (!decodedAlbumPath || !rootPath) {
        return;
      }

      // 计算父目录路径
      const parentPath = getDirname(decodedAlbumPath);

      // 检查是否需要预加载
      if (!parentPath || parentPath === decodedAlbumPath || !parentPath.startsWith(rootPath)) {
        return; // 已经是根目录或超出根目录范围，不需要预加载
      }

      // 延迟预加载，等待主要内容加载完成
      setTimeout(async () => {
        try {
          // 使用缓存管理器的预加载功能
          await imageCache.prefetch('navigation', parentPath);
          console.log(`父目录预加载已启动: ${parentPath}`);
        } catch (error) {
          console.warn('父目录预加载失败:', error);
          // 静默失败，不影响用户体验
        }
      }, 1000); // 1秒后开始预加载
    } catch (error) {
      console.warn('预加载父目录时出错:', error);
    }
  };



  // 处理返回 - 支持URL模式
  const handleBack = () => {
    if (isNavigating) return;

    // URL模式：使用传入的回调函数
    if (urlMode && onGoBack) {
      onGoBack();
      return;
    }
    const parentPath = getDirname(decodedAlbumPath);

    if (parentPath && parentPath !== decodedAlbumPath && rootPath && parentPath.startsWith(rootPath)) {
      setIsNavigating(true);
      navigateToFolderPath(parentPath);
      setTimeout(() => setIsNavigating(false), 0);
      return;
    }

    navigateToFolderPath('', { replace: false });
  };

  // 处理返回首页
  const handleHome = () => {
    navigateToFolderPath('', { replace: false });
  };

  // 切换密度设置（循环：紧凑->标准->宽松）
  const cycleDensity = () => {
    const densities = ['compact', 'standard', 'comfortable'];
    const currentIndex = densities.indexOf(userDensity);
    const nextIndex = (currentIndex + 1) % densities.length;
    const newDensity = densities[nextIndex];
    setUserDensity(newDensity);
    localStorage.setItem('userDensity', newDensity);
  };

  useEffect(() => {
    if (!images.length) {
      setViewerOpen(false);
      setSelectedImageIndex(0);
      return;
    }

    if (selectedImageIndex >= images.length) {
      setSelectedImageIndex(0);
    }
  }, [images.length, selectedImageIndex]);

  const hasActiveSearch = Boolean(normalizedSearchQuery);
  const totalImagesCount = totalCount;
  const filteredImagesCount = totalCount;
  const canRefreshAlbum = Boolean(decodedAlbumPath);

  const handleLoadMore = useCallback(() => {
    if (hasMore && !loadingMore && !loading) {
      loadMore();
    }
  }, [hasMore, loadingMore, loading, loadMore]);

  const handleViewerImageDeleted = useCallback((deletedPath) => {
    removeImage(deletedPath);
  }, [removeImage]);

  // 处理图片点击
  const handleImageClick = (index) => {
    setSelectedImageIndex(index);
    setViewerOpen(true);
  };

  // 关闭查看器
  const handleCloseViewer = () => {
    setViewerOpen(false);
  };

  // 计算网格列数
  const columnsCount = useMemo(
    () => computeGridColumns(windowWidth, userDensity, { isSmallScreen }),
    [windowWidth, userDensity, isSmallScreen]
  );

  // 将一维图片数组转换为二维网格行
  const gridRows = useMemo(
    () => chunkIntoRows(images, columnsCount),
    [images, columnsCount]
  );

  const { handleRangeChanged } = useGridThumbnailPrefetch({
    gridRows,
    extractPathsFromRow: extractAlbumImageRowPaths
  });

  const densityConfig = useMemo(
    () => GRID_CONFIG[userDensity] || GRID_CONFIG[DEFAULT_DENSITY],
    [userDensity]
  );

  const estimatedRowHeight = useMemo(() => {
    const baseHeight = (densityConfig.itemWidth * 3) / 2;
    return Math.round(baseHeight + densityConfig.gap);
  }, [densityConfig]);

  const overscanConfig = useMemo(() => {
    const usableHeight = Math.max(windowHeight, 600);
    return {
      top: Math.round(usableHeight * 0.75),
      bottom: Math.round(usableHeight * 1.25)
    };
  }, [windowHeight]);

  // 获取相簿名称
  const getAlbumName = () => {
    // 新架构：优先使用state中的albumName
    if (location.state?.albumName) {
      return location.state.albumName;
    }
    // 旧架构：从路径解析
    if (!decodedAlbumPath) return '';
    const parts = decodedAlbumPath.split('/');
    return parts[parts.length - 1];
  };

  // 处理导航到收藏页面
  const handleNavigateToFavorites = () => {
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

  // 处理相簿收藏切换
  const handleToggleAlbumFavorite = async () => {
    const album = {
      name: getAlbumName(),
      path: decodedAlbumPath,
      imageCount: totalCount,
      previewImages: images.slice(0, 4)
    };
    
    await toggleAlbumFavorite(album);
  };


  // 处理导航到相邻相簿
  const handleNavigateToAdjacentAlbum = useCallback((direction) => {
    let targetAlbum = null;

    if (direction === 'prev') {
      targetAlbum = neighboringAlbums.prev;
    } else if (direction === 'next') {
      targetAlbum = neighboringAlbums.next;
    } else if (direction === 'first' && siblingAlbums.length > 0) {
      targetAlbum = siblingAlbums[0];
    } else if (direction === 'last' && siblingAlbums.length > 0) {
      targetAlbum = siblingAlbums[siblingAlbums.length - 1];
    }

    if (targetAlbum) {
      navigateToAlbumPath(targetAlbum.path, targetAlbum.name);
    }
  }, [neighboringAlbums, siblingAlbums, navigateToAlbumPath]);

  const handleOpenContainerView = useCallback(() => {
    navigateToFolderPath(decodedAlbumPath);
  }, [decodedAlbumPath, navigateToFolderPath]);

  const resolveTargetView = useCallback(async (targetPath) => {
    if (!targetPath || !ipcRenderer) {
      return 'folder';
    }

    const cachedResponse = imageCache.get('navigation', targetPath);
    const response = cachedResponse || await ipcRenderer.invoke(CHANNELS.SCAN_NAVIGATION_LEVEL, targetPath);

    if (!cachedResponse && response?.success) {
      imageCache.set('navigation', targetPath, response);
    }

    if (!response?.success) {
      throw new Error(response?.error?.message || 'Failed to scan target directory');
    }

    return getPrimaryView(buildNodeFromScanResponse(response));
  }, [ipcRenderer]);

  // 处理面包屑导航点击
  const handleBreadcrumbNavigate = useCallback(async (targetPath) => {
    if (isNavigating) return;

    // URL模式：使用传入的回调函数
    if (urlMode && onBreadcrumbNavigate) {
      onBreadcrumbNavigate(targetPath);
      return;
    }

    // 传统模式：原有逻辑
    // 验证路径有效性 - 放宽验证，让主进程决定路径是否真的无效
    if (!isValidPath(targetPath)) {
      console.warn(`面包屑路径验证失败: ${targetPath}`);
    }

    if (targetPath === decodedAlbumPath) {
      return;
    }

    setIsNavigating(true);
    try {
      if (!targetPath || targetPath === rootPath) {
        navigateToFolderPath(rootPath || '');
        return;
      }

      const targetView = await resolveTargetView(targetPath);
      console.log(`面包屑导航: ${targetPath}, 视图: ${targetView}`);

      if (targetView === 'album') {
        navigateToAlbumPath(targetPath, getBasename(targetPath));
      } else {
        navigateToFolderPath(targetPath);
      }
    } catch (error) {
      console.error('面包屑导航失败:', error);
      setError(`导航失败: ${error.message || '无法访问该路径'}`);
    } finally {
      setTimeout(() => setIsNavigating(false), 100);
    }
  }, [isNavigating, urlMode, onBreadcrumbNavigate, decodedAlbumPath, rootPath, resolveTargetView, navigateToFolderPath, navigateToAlbumPath]);

  // 随机浏览只由 canonical coordinator 处理。
  const handleRandomAlbum = useCallback(() => {
    if (!onRandomBrowse) return;
    Promise.resolve()
      .then(() => onRandomBrowse())
      .catch((error) => setError(error?.message || '随机浏览失败'));
  }, [onRandomBrowse]);

  // 添加键盘事件监听
  useEffect(() => {
    const handleKeyDown = (event) => {
      const activeElement = document.activeElement;
      if (searchHasFocus || activeElement?.tagName === 'INPUT' ||
          activeElement?.tagName === 'TEXTAREA' || activeElement?.isContentEditable) {
        return;
      }

      // 如果按下ESC或Backspace键且没有打开查看器
      const isBackKey = event.key === 'Backspace' || (!embeddedMode && event.key === 'Escape');
      if (isBackKey && !viewerOpen) {
        event.preventDefault();
        event.stopPropagation();
        handleBack();
        return;
      }

      if (embeddedMode) return;

      // 按下 e 键触发随机选择相簿
      if ((event.key === 'e' || event.key === 'E') && !event.ctrlKey && !event.altKey && !event.metaKey) {
        if (document.activeElement.tagName !== 'INPUT' &&
            document.activeElement.tagName !== 'TEXTAREA' &&
            !document.activeElement.isContentEditable &&
            !viewerOpen) {
          handleRandomAlbum();
        }
      }

      // 按下 r 键刷新当前相簿
      if ((event.key === 'r' || event.key === 'R') && !event.ctrlKey && !event.altKey && !event.metaKey) {
        if (document.activeElement.tagName !== 'INPUT' &&
            document.activeElement.tagName !== 'TEXTAREA' &&
            !document.activeElement.isContentEditable &&
            !viewerOpen) {
          handleRefreshAlbum();
        }
      }

      // 按下 h 键返回首页
      if (event.key === 'h' && !event.ctrlKey && !event.altKey && !event.metaKey) {
        if (document.activeElement.tagName !== 'INPUT' &&
            document.activeElement.tagName !== 'TEXTAREA' &&
            !document.activeElement.isContentEditable &&
            !viewerOpen) {
          handleHome();
        }
      }

      // 左箭头键 - 上一个相簿
      if (event.key === 'ArrowLeft' && !event.ctrlKey && !event.altKey && !event.metaKey) {
        if (!viewerOpen && neighboringAlbums.prev) {
          handleNavigateToAdjacentAlbum('prev');
        }
      }

      // 右箭头键 - 下一个相簿
      if (event.key === 'ArrowRight' && !event.ctrlKey && !event.altKey && !event.metaKey) {
        if (!viewerOpen && neighboringAlbums.next) {
          handleNavigateToAdjacentAlbum('next');
        }
      }

      // Ctrl+左箭头键 - 跳转到第一个相簿
      if (event.key === 'ArrowLeft' && event.ctrlKey && !event.altKey && !event.metaKey) {
        if (!viewerOpen && neighboringAlbums.currentIndex > 0) {
          handleNavigateToAdjacentAlbum('first');
        }
      }

      // Ctrl+右箭头键 - 跳转到最后一个相簿
      if (event.key === 'ArrowRight' && event.ctrlKey && !event.altKey && !event.metaKey) {
        if (!viewerOpen && neighboringAlbums.currentIndex < neighboringAlbums.total - 1) {
          handleNavigateToAdjacentAlbum('last');
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [
    viewerOpen,
    neighboringAlbums,
    embeddedMode,
    searchHasFocus,
    handleRandomAlbum,
    handleRefreshAlbum,
    handleBack,
    handleHome,
    handleNavigateToAdjacentAlbum
  ]);

  const randomDisabled = !onRandomBrowse || randomBrowseDisabled || randomBrowseLoading;

  const renderHeader = () => (
    <>
      {headerLeadingContent || (
        <BreadcrumbNavigation
          breadcrumbs={breadcrumbs.length > 0
            ? breadcrumbs
            : getBreadcrumbPaths(decodedAlbumPath, breadcrumbRootPath)}
          currentPath={decodedAlbumPath}
          onNavigate={handleBreadcrumbNavigate}
          variant="minimal"
          compact={isSmallScreen}
          sx={{ flexGrow: 1, minWidth: 0 }}
        />
      )}
      <GridPageToolbar
        searchQuery={searchQuery}
        onSearchChange={setSearchQuery}
        searchPlaceholder="搜索当前相簿"
        onSearchFocusChange={setSearchHasFocus}
        sortOptions={[
          { value: 'name', label: '名称' },
          { value: 'size', label: '大小' },
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
        showRandom={!embeddedMode}
        onRefresh={handleRefreshAlbum}
        refreshDisabled={!canRefreshAlbum}
        refreshAriaLabel="刷新当前相簿"
        navigation={embeddedMode ? null : {
          prev: neighboringAlbums.prev,
          next: neighboringAlbums.next,
          currentIndex: neighboringAlbums.currentIndex,
          total: neighboringAlbums.total,
          onPrev: () => handleNavigateToAdjacentAlbum('prev'),
          onNext: () => handleNavigateToAdjacentAlbum('next')
        }}
        favoriteMenuItems={[
          {
            id: 'album',
            label: isAlbumFavorited(decodedAlbumPath) ? '取消收藏相簿' : '收藏相簿',
            checked: isAlbumFavorited(decodedAlbumPath),
            disabled: false,
            onClick: handleToggleAlbumFavorite
          }
        ]}
        openFavoritesItem={{
          label: '打开我的收藏',
          onClick: handleNavigateToFavorites
        }}
        onOpenSettings={() => navigate('/settings')}
        showFavorites={!embeddedMode}
        showSettings={!embeddedMode}
        extraActions={headerExtraActions}
      />
    </>
  );

  const renderContent = () => (
    <>
      <Box sx={{ mb: 2 }}>
        <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
          共 {totalImagesCount} 张照片
        </Typography>
        {hasActiveSearch && (
          <Typography variant="caption" color="text.secondary">
            匹配 {filteredImagesCount} 张
          </Typography>
        )}
      </Box>
      {childFolderCount > 0 && (
        <Paper
          elevation={0}
          sx={{
            mb: 2,
            px: 2,
            py: 1.25,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 2,
            bgcolor: 'action.hover'
          }}
        >
          <Typography variant="body2" color="text.secondary">
            该目录还有 {childFolderCount} 个子文件夹
          </Typography>
          <Button size="small" variant="outlined" onClick={handleOpenContainerView}>
            进入浏览
          </Button>
        </Paper>
      )}
      {filteredImagesCount > 0 ? (
        <Virtuoso
          data={gridRows}
          customScrollParent={virtualScrollParent || undefined}
          overscan={Math.max(overscanConfig.top, overscanConfig.bottom)}
          increaseViewportBy={overscanConfig}
          computeItemKey={(rowIndex, imageRow) => {
            const firstImage = Array.isArray(imageRow) ? imageRow[0] : null;
            return firstImage?.path ? `row-${firstImage.path}` : `row-${rowIndex}`;
          }}
          rangeChanged={handleRangeChanged}
          endReached={handleLoadMore}
          itemContent={(rowIndex, imageRow) => {
            const config = densityConfig;
            const columns = columnsCount;

            return (
              <Box
                sx={{
                  display: 'grid',
                  gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`,
                  gap: `${config.gap}px`,
                  mb: `${config.gap}px`,
                  px: { xs: 2, sm: 3 },
                  minHeight: `${estimatedRowHeight}px`
                }}
              >
                {imageRow.map((image, colIndex) => {
                  const actualIndex = rowIndex * columns + colIndex;
                  return (
                    <Box
                      key={image.path}
                      sx={{
                        width: '100%',
                        aspectRatio: '2/3' // 固定 2:3 比例
                      }}
                    >
                      <ImageCard
                        image={image}
                        onClick={() => handleImageClick(actualIndex)}
                        density={userDensity}
                        albumPath={decodedAlbumPath}
                      />
                    </Box>
                  );
                })}
              </Box>
            );
          }}
        />
      ) : (
        <Box sx={{ textAlign: 'center', mt: 8 }}>
          <Typography variant="h6" color="text.secondary">
            {totalImagesCount === 0 ? '未找到图片' : '没有匹配的照片'}
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
            {totalImagesCount === 0 ? '此相簿中没有支持的图片文件' : '换个关键词或者清空搜索再试'}
          </Typography>
        </Box>
      )}
      {viewerOpen && (
        <ImageViewer
          images={images}
          currentIndex={selectedImageIndex}
          onClose={handleCloseViewer}
          onIndexChange={setSelectedImageIndex}
          onImageDeleted={handleViewerImageDeleted}
          readOnly={readOnly}
          hasMore={hasMore}
          onNearEnd={handleLoadMore}
        />
      )}
      <Snackbar open={!!error} autoHideDuration={6000} onClose={() => setError('')}>
        <Alert onClose={() => setError('')} severity="error" sx={{ width: '100%' }}>
          {error}
        </Alert>
      </Snackbar>
    </>
  );

  return (
    <PageLayout
      loading={loading}
      error={loadError}
      headerContent={renderHeader()}
      subHeaderContent={tabsHeaderContent}
      scrollContainerRef={scrollContainerRef}
    >
      {renderContent()}
    </PageLayout>
  );
}

export default AlbumPage;
