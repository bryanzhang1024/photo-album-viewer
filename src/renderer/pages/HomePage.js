import React, { useState, useEffect, useCallback, useMemo, useRef, useContext } from 'react';
import { getBasename, getDirname, getRelativePath, getBreadcrumbPaths, isValidPath } from '../utils/pathUtils';
import { useNavigate, useLocation } from 'react-router-dom';
import { 
  Box, 
  Typography, 
  Button, 
  AppBar, 
  Toolbar, 
  IconButton, 
  MenuItem,
  FormControl,
  Select,
  InputLabel,
  TextField,
  InputAdornment,
  CircularProgress,
  Alert,
  Snackbar,
  Paper,
  useMediaQuery,
  useTheme,
  Tooltip,
  Badge
} from '@mui/material';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import HomeIcon from '@mui/icons-material/Home';
import SortIcon from '@mui/icons-material/Sort';
import SearchIcon from '@mui/icons-material/Search';
import ClearIcon from '@mui/icons-material/Clear';
import RefreshIcon from '@mui/icons-material/Refresh';
import FavoriteBorderIcon from '@mui/icons-material/FavoriteBorder';
import FavoriteIcon from '@mui/icons-material/Favorite';
import CasinoIcon from '@mui/icons-material/Casino';
import SettingsIcon from '@mui/icons-material/Settings';
import ChevronLeftIcon from '@mui/icons-material/ChevronLeft';
import ChevronRightIcon from '@mui/icons-material/ChevronRight';
import AlbumCard from '../components/AlbumCard';
import ImageCard from '../components/ImageCard';
import ImageViewer from '../components/ImageViewer';
import BreadcrumbNavigation from '../components/BreadcrumbNavigation';
import { Virtuoso } from 'react-virtuoso';
import { ScrollPositionContext } from '../App';
import { useFavorites } from '../contexts/FavoritesContext';
import imageCache from '../utils/ImageCacheManager';
import CHANNELS from '../../common/ipc-channels';
import useSorting from '../hooks/useSorting';
import PageLayout from '../components/PageLayout';
import { GRID_CONFIG, DEFAULT_DENSITY, computeGridColumns, chunkIntoRows } from '../utils/virtualGrid';
import { navigateToBrowsePath } from '../utils/navigation';

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
  urlMode = false,
  tabsHeaderContent = null,
  tabScrollKey = null
}) {
  const navigate = useNavigate();
  const location = useLocation();
  const theme = useTheme();
  const [rootPath, setRootPath] = useState('');
  const [navigationState, setNavigationState] = useState(() => ({
    path: '',
    nodes: [],
    directImages: [],
    breadcrumbs: [],
    metadata: null
  }));
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [userDensity, setUserDensity] = useState(() => {
    const savedDensity = localStorage.getItem('userDensity');
    return (savedDensity && GRID_CONFIG[savedDensity]) ? savedDensity : DEFAULT_DENSITY;
  });
  const [windowWidth, setWindowWidth] = useState(window.innerWidth);
  const [windowHeight, setWindowHeight] = useState(window.innerHeight);
  const isSmallScreen = useMediaQuery(theme.breakpoints.down('sm'));
  const scrollContainerRef = useRef(null);
  const [virtualScrollParent, setVirtualScrollParent] = useState(null);
  const [urlPathProcessed, setUrlPathProcessed] = useState(false);
  const [isNavigating, setIsNavigating] = useState(false); // 导航锁，防止重复操作
  const [searchQuery, setSearchQuery] = useState('');
  const [searchHasFocus, setSearchHasFocus] = useState(false);
  const [viewerOpen, setViewerOpen] = useState(false);
  const [selectedImageIndex, setSelectedImageIndex] = useState(0);
  const { path: currentPath, nodes: navigationNodes, directImages, breadcrumbs, metadata } = navigationState;
  const homeSortFields = useMemo(() => ['name', 'imageCount', 'lastModified'], []);
  const homeLegacySortKeys = useMemo(
    () => ({ sortByKey: 'sortBy', sortDirectionKey: 'sortDirection' }),
    []
  );
  const { sortBy, sortDirection, handleSortChange, handleDirectionChange } = useSorting('name', 'asc', {
    scopeKey: currentPath || '__root__',
    storageNamespace: 'sorting:folder',
    allowedSortBy: homeSortFields,
    legacyKeys: homeLegacySortKeys
  });
  const albumNodes = useMemo(
    () => navigationNodes.filter(node => node.type === 'album'),
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
  
  // 为当前窗口生成唯一的存储键
  const getWindowStorageKey = () => {
    const searchParams = new URLSearchParams(window.location.search);
    const initialPath = searchParams.get('initialPath');
    if (initialPath) {
      // 如果有URL参数，使用该路径的哈希值作为标识
      try {
        const pathHash = btoa(decodeURIComponent(initialPath)).replace(/[+/=]/g, '');
        return `lastRootPath_${pathHash}`;
      } catch (e) {
        // 如果btoa失败（如中文字符），使用简单哈希
        let hash = 0;
        const str = decodeURIComponent(initialPath);
        for (let i = 0; i < str.length; i++) {
          const char = str.charCodeAt(i);
          hash = ((hash << 5) - hash) + char;
          hash = hash & hash; // 转换为32位整数
        }
        return `lastRootPath_${Math.abs(hash)}`;
      }
    } else {
      // 否则使用默认键
      return 'lastRootPath_default';
    }
  };

  const [windowStorageKey] = useState(getWindowStorageKey());

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

  const estimatedRowHeight = useMemo(() => {
    const densityConfig = GRID_CONFIG[userDensity] || GRID_CONFIG[DEFAULT_DENSITY];
    const baseHeight = densityConfig.itemWidth;
    return Math.round(baseHeight + densityConfig.gap);
  }, [userDensity]);

  const estimatedImageRowHeight = useMemo(() => {
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

  
  // 智能导航扫描 - 新架构（使用统一缓存）
  const scanNavigationLevel = useCallback(async (targetPath) => {
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
        return;
      }

      setLoading(true);
      setError('');

      console.log(`开始扫描导航层级: ${targetPath}`);
      const response = await ipcRenderer.invoke(CHANNELS.SCAN_NAVIGATION_LEVEL, targetPath);

      if (response.success) {
        imageCache.set('navigation', targetPath, response);
        updateNavigationState(response, targetPath);
        console.log(`扫描完成: ${response.metadata.totalNodes} 个节点`);
      } else {
        setError(response.error?.message || '扫描失败');
      }
    } catch (err) {
      console.error('扫描错误:', err);
      setError('扫描文件夹时出错: ' + err.message);
    } finally {
      setLoading(false);
    }
  }, [updateNavigationState]);

  // 处理导航点击 - 支持URL模式
  const handleNavigate = async (targetPath) => {
    if (targetPath === currentPath || isNavigating) return; // 避免重复导航和并发操作

    // 进入下一级前先保存当前列表滚动位置，便于返回恢复
    saveScrollPosition();

    // URL模式：使用传入的回调函数
    if (urlMode && onNavigate) {
      onNavigate(targetPath, 'folder');
      return;
    }

    // 传统模式：内部处理
    // 验证路径有效性
    if (!isValidPath(targetPath)) {
      console.warn(`路径验证失败: ${targetPath}`);
      // 对于导航操作，即使路径验证失败也尝试继续，让主进程处理
      console.log(`继续尝试导航到: ${targetPath}`);
    }

    console.log(`导航到: ${targetPath}`);
    setIsNavigating(true);
    try {
      await scanNavigationLevel(targetPath);
    } catch (error) {
      console.error('导航失败:', error);
      setError(`导航失败: ${error.message || '未知错误'}`);
    } finally {
      setIsNavigating(false);
    }
  };

  // 处理节点点击 - 支持文件夹和相册 - 使用 useCallback 缓存
  const handleNodeClick = useCallback(async (node) => {
    if (node.type === 'folder') {
      // 文件夹类型：统一复用导航逻辑，确保滚动位置被保存
      if (urlMode && onFolderClick) {
        saveScrollPosition();
        onFolderClick(node.path);
        return;
      }
      await handleNavigate(node.path);
    } else if (node.type === 'album') {
      // 相册类型：打开相册页面
      saveScrollPosition();
      if (urlMode && onAlbumClick) {
        onAlbumClick(node.path, node.name);
      } else {
        navigateToBrowsePath(navigate, node.path, { viewMode: 'album' });
      }
    }
  }, [urlMode, onFolderClick, onAlbumClick, handleNavigate, navigate, saveScrollPosition]);

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
    if (urlMode && onAlbumClick) {
      onAlbumClick(albumPath, albumName);
    } else {
      navigateToBrowsePath(navigate, albumPath, { viewMode: 'album' });
    }
  }, [urlMode, onAlbumClick, navigate, saveScrollPosition]);
  
  // 重新扫描
  const handleRefresh = () => {
    const refreshTargetPath = currentPath || rootPath;
    if (refreshTargetPath) {
      imageCache.clearType('navigation');
      scanNavigationLevel(refreshTargetPath);
    }
  };
  

  
  // 排序节点 - 使用 useMemo 缓存结果
  const sortedNodesData = useMemo(() => {
    if (!filteredNodes.length) return [];

    return [...filteredNodes].sort((a, b) => {
      // 文件夹总是排在相册前面
      if (a.type !== b.type) {
        if (a.type === 'folder' && b.type === 'album') return -1;
        if (a.type === 'album' && b.type === 'folder') return 1;
      }

      let comparison = 0;

      if (sortBy === 'name') {
        comparison = a.name.localeCompare(b.name, undefined, { numeric: true });
      } else if (sortBy === 'imageCount') {
        comparison = (a.imageCount || 0) - (b.imageCount || 0);
      } else if (sortBy === 'lastModified') {
        const aDate = a.lastModified || 0;
        const bDate = b.lastModified || 0;
        comparison = new Date(aDate) - new Date(bDate);
      }

      return sortDirection === 'asc' ? comparison : -comparison;
    });
  }, [filteredNodes, sortBy, sortDirection]);

  const sortedDirectImages = useMemo(() => {
    if (!filteredDirectImages.length) return [];

    return [...filteredDirectImages].sort((a, b) => {
      let comparison = 0;

      if (sortBy === 'name') {
        comparison = (a.name || '').localeCompare(b.name || '', undefined, { numeric: true });
      } else if (sortBy === 'lastModified') {
        comparison = new Date(a.lastModified || 0) - new Date(b.lastModified || 0);
      }

      return sortDirection === 'asc' ? comparison : -comparison;
    });
  }, [filteredDirectImages, sortBy, sortDirection]);

  const columnsCount = useMemo(
    () => computeGridColumns(windowWidth, userDensity, { isSmallScreen }),
    [windowWidth, userDensity, isSmallScreen]
  );

  const gridRows = useMemo(
    () => chunkIntoRows(sortedNodesData, columnsCount),
    [sortedNodesData, columnsCount]
  );

  const imageRows = useMemo(
    () => chunkIntoRows(sortedDirectImages, columnsCount),
    [sortedDirectImages, columnsCount]
  );

  const hasActiveSearch = Boolean(normalizedSearchQuery);
  const totalItemsCount = navigationNodes.length + directImages.length;
  const filteredItemsCount = sortedNodesData.length + sortedDirectImages.length;

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
  
  
  // 处理随机选择相簿
  const handleRandomAlbum = useCallback(() => {
    if (albumNodes.length > 0) {
      // 随机选择一个相簿
      const randomIndex = Math.floor(Math.random() * albumNodes.length);
      const randomAlbum = albumNodes[randomIndex];
      
      // 保存当前滚动位置
      saveScrollPosition();
      
      // 导航到随机选择的相簿
      if (urlMode && onAlbumClick) {
        onAlbumClick(randomAlbum.path, randomAlbum.name);
      } else {
        navigateToBrowsePath(navigate, randomAlbum.path, { viewMode: 'album' });
      }
    } else {
      setError('没有可用的相簿进行随机选择');
    }
  }, [urlMode, onAlbumClick, albumNodes, navigate, saveScrollPosition]);

  // 处理导航面板的文件夹导航 - 真正的层级浏览
  const handleNavigationPanelNavigate = (folderPath) => {
    // 保存当前滚动位置
    saveScrollPosition();

    // 导航逻辑：使用统一的currentPath
    if (folderPath && folderPath !== currentPath) {
      scanNavigationLevel(folderPath);
      console.log('导航到:', folderPath, '根路径:', rootPath);
    }
  };

  // 返回根目录
  const handleReturnToRoot = () => {
    saveScrollPosition();
    scanNavigationLevel(rootPath);
  };

  // 返回上级目录
  const handleGoUp = async () => {
    if (!currentPath || currentPath === rootPath || isNavigating) return;

    // 获取当前路径的上级目录
    const parentPath = getDirname(currentPath);

    // 如果上级目录存在，则导航到上级
    if (parentPath && parentPath !== currentPath) {
      saveScrollPosition();

      if (urlMode && onNavigate) {
        onNavigate(parentPath, 'folder');
        return;
      }

      setIsNavigating(true);
      try {
        await scanNavigationLevel(parentPath);
      } catch (error) {
        console.error('返回上级失败:', error);
        setError(`返回上级失败: ${error.message}`);
      } finally {
        setIsNavigating(false);
      }
    }
  };

  const handleBreadcrumbNavigate = useCallback((targetPath) => {
    if (urlMode && onBreadcrumbNavigate) {
      saveScrollPosition();
      onBreadcrumbNavigate(targetPath);
      return;
    }

    handleNavigate(targetPath);
  }, [urlMode, onBreadcrumbNavigate, handleNavigate, saveScrollPosition]);

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

  // 处理从AlbumPage返回的导航请求 (仅非URL模式)
  useEffect(() => {
    if (urlMode) return; // URL模式下不处理这个逻辑
    if (location.state?.navigateToPath) {
      const targetPath = location.state.navigateToPath;
      console.log(`从相册页面返回，导航到: ${targetPath}`);

      // 异步处理：设置根路径，等待完成后扫描目标路径
      const parentPath = getDirname(targetPath);
      setRootPath(parentPath);

      // 使用setTimeout确保状态更新后再执行导航
      setTimeout(async () => {
        try {
          await scanNavigationLevel(targetPath);
          // 只有在导航成功后才清除state
          navigate(location.pathname, { replace: true, state: null });
        } catch (error) {
          console.error('从相册返回导航失败:', error);
          setError(`导航失败: ${error.message}`);
        }
      }, 100);
      return;
    }
  }, [location.state, urlMode, navigate, scanNavigationLevel]);

  // 从localStorage中读取上次的路径，并处理URL参数 (仅非URL模式)
  useEffect(() => {
    if (urlMode) return; // URL模式下不处理localStorage逻辑
    if (urlPathProcessed) {
      console.log('URL参数已处理，跳过重复处理');
      return;
    }

    const searchParams = new URLSearchParams(window.location.search);
    const initialPath = searchParams.get('initialPath');
    
    console.log('URL参数检查:', { search: location.search, initialPath, urlPathProcessed, fullUrl: window.location.href });
    
    if (initialPath) {
      // 如果有URL参数，使用指定路径 - 优先处理
      const decodedPath = decodeURIComponent(initialPath);
      console.log('使用URL参数路径:', decodedPath);
      console.log('窗口存储键:', windowStorageKey);
      setRootPath(decodedPath);
      localStorage.setItem(windowStorageKey, decodedPath);
      scanNavigationLevel(decodedPath);
      setUrlPathProcessed(true);
    } else if (!urlPathProcessed) {
      // 否则使用localStorage中的路径（仅当URL参数未处理时）
      const savedPath = localStorage.getItem(windowStorageKey);
      if (savedPath) {
        console.log('使用localStorage路径:', savedPath);
        console.log('窗口存储键:', windowStorageKey);
        setRootPath(savedPath);
        scanNavigationLevel(savedPath);
      }
      setUrlPathProcessed(true);
    }
  }, [location.search, urlMode, urlPathProcessed, windowStorageKey, scanNavigationLevel]);

  // 添加键盘快捷键监听
  useEffect(() => {
    const handleKeyDown = (event) => {
      if (searchHasFocus) {
        return;
      }

      if (document.activeElement.tagName === 'INPUT' || 
          document.activeElement.tagName === 'TEXTAREA' ||
          document.activeElement.isContentEditable) {
        return; // 在输入框中时，禁用部分快捷键
      }

      switch (event.key) {
        case 'r':
          handleRandomAlbum();
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
  }, [handleGoUp, handleRandomAlbum, searchHasFocus]);

  const canRefreshCurrentFolder = Boolean(currentPath || rootPath);
  
    const renderHeader = () => (
      <>
        <BreadcrumbNavigation
          breadcrumbs={breadcrumbs}
          currentPath={currentPath}
          onNavigate={handleBreadcrumbNavigate}
          variant="minimal"
          compact={isSmallScreen}
          sx={{ flexGrow: 1, minWidth: 0 }}
        />
        <Box
          sx={{
            display: 'flex',
            alignItems: 'center',
            flexShrink: 0,
            ml: 2,
            gap: 1,
            flexWrap: { xs: 'wrap', sm: 'nowrap' },
            justifyContent: { xs: 'flex-start', sm: 'flex-end' }
          }}
        >
          <TextField
            value={searchQuery}
            onChange={(event) => setSearchQuery(event.target.value)}
            placeholder="搜索当前文件夹"
            size="small"
            variant="outlined"
            sx={{
              minWidth: { xs: '100%', sm: 200 },
              maxWidth: { xs: '100%', sm: 260 },
              mr: { xs: 0, sm: 1 },
              mb: { xs: 1, sm: 0 },
              '& .MuiInputBase-root': {
                bgcolor: 'rgba(0,0,0,0.04)'
              }
            }}
            onFocus={() => setSearchHasFocus(true)}
            onBlur={() => setSearchHasFocus(false)}
            InputProps={{
              startAdornment: (
                <InputAdornment position="start">
                  <SearchIcon fontSize="small" />
                </InputAdornment>
              ),
              endAdornment: searchQuery ? (
                <InputAdornment position="end">
                  <IconButton
                    size="small"
                    aria-label="清除搜索"
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => setSearchQuery('')}
                  >
                    <ClearIcon fontSize="small" />
                  </IconButton>
                </InputAdornment>
              ) : null
            }}
            onKeyDown={(event) => {
              if (event.key === 'Escape') {
                setSearchQuery('');
                event.currentTarget.blur();
              }
            }}
          />

          <FormControl variant="outlined" size="small" sx={{
            minWidth: { xs: 80, sm: 120 },
            mr: 1,
            bgcolor: 'rgba(0,0,0,0.05)',
            borderRadius: 1
          }}>
            <InputLabel id="sort-select-label" sx={{ fontSize: '0.8rem' }}>排序</InputLabel>
            <Select
              labelId="sort-select-label"
              value={sortBy}
              onChange={handleSortChange}
              label="排序"
              sx={{ fontSize: '0.8rem' }}
            >
              <MenuItem value="name">名称</MenuItem>
              <MenuItem value="imageCount">照片数量</MenuItem>
              <MenuItem value="lastModified">修改时间</MenuItem>
            </Select>
          </FormControl>
          <IconButton color="inherit" onClick={handleDirectionChange} size="small">
            <SortIcon sx={{
              transform: sortDirection === 'desc' ? 'rotate(180deg)' : 'none',
              transition: 'transform 0.3s'
            }} />
          </IconButton>
          <FormControl variant="outlined" size="small" sx={{
            minWidth: { xs: 80, sm: 100 },
            ml: 0.5,
            mr: 1,
            bgcolor: 'rgba(0,0,0,0.05)',
            borderRadius: 1
          }}>
            <InputLabel id="density-select-label" sx={{ fontSize: '0.8rem' }}>密度</InputLabel>
            <Select
              labelId="density-select-label"
              value={userDensity}
              onChange={(e) => {
                setUserDensity(e.target.value);
                localStorage.setItem('userDensity', e.target.value);
              }}
              label="密度"
              sx={{ fontSize: '0.8rem' }}
            >
              <MenuItem value="compact">紧凑</MenuItem>
              <MenuItem value="standard">标准</MenuItem>
              <MenuItem value="comfortable">宽松</MenuItem>
            </Select>
          </FormControl>
          <Tooltip title="刷新当前文件夹">
            <span>
              <IconButton
                color="inherit"
                onClick={handleRefresh}
                size="small"
                sx={{ mx: 0.5 }}
                aria-label="刷新当前文件夹"
                disabled={!canRefreshCurrentFolder}
              >
                <RefreshIcon />
              </IconButton>
            </span>
          </Tooltip>
          <Tooltip title="随机选择相簿 (R)">
            <span>
              <IconButton
                color="inherit"
                onClick={handleRandomAlbum}
                size="small"
                sx={{ mx: 0.5 }}
                disabled={albumNodes.length === 0}
              >
                <CasinoIcon />
              </IconButton>
            </span>
          </Tooltip>
          <Tooltip title={isFolderFavorited(currentPath) ? "取消收藏当前文件夹" : "收藏当前文件夹"}>
            <span>
              <IconButton
                color="inherit"
                onClick={handleToggleCurrentFolderFavorite}
                size="small"
                sx={{ mx: 0.5 }}
                disabled={!currentPath}
                aria-label="收藏当前文件夹"
              >
                {isFolderFavorited(currentPath)
                  ? <FavoriteIcon sx={{ color: '#ff5252' }} />
                  : <FavoriteBorderIcon />}
              </IconButton>
            </span>
          </Tooltip>
          <Tooltip title={isAlbumFavorited(currentPath) ? "取消收藏当前照片集合" : "收藏当前照片集合"}>
            <span>
              <IconButton
                color="inherit"
                onClick={handleToggleCurrentPhotoSetFavorite}
                size="small"
                sx={{ mx: 0.5 }}
                disabled={!currentPath || directImages.length === 0}
                aria-label="收藏当前照片集合"
              >
                {isAlbumFavorited(currentPath)
                  ? <FavoriteIcon sx={{ color: '#ff5252' }} />
                  : <FavoriteBorderIcon />}
              </IconButton>
            </span>
          </Tooltip>
          <Tooltip title="我的收藏">
            <IconButton
              color="inherit"
              onClick={handleNavigateToFavorites}
              size="small"
              sx={{ mx: 0.5 }}
            >
              <FavoriteIcon />
            </IconButton>
          </Tooltip>
          <Tooltip title="设置">
            <IconButton
              color="inherit"
              onClick={() => navigate('/settings')}
              size="small"
            >
              <SettingsIcon />
            </IconButton>
          </Tooltip>
        </Box>
      </>
    );
  
  const renderContent = () => {
    // 显示加载状态
    if (loading) {
      return (
        <Paper elevation={2} sx={{ p: 3, textAlign: 'center' }}>
          <CircularProgress />
          <Typography variant="body1" sx={{ mt: 2 }}>
            正在加载文件夹...
          </Typography>
        </Paper>
      );
    }

    const hasContent = navigationNodes.length > 0 || directImages.length > 0;

    if (!hasContent) {
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
    const rowsToRender = gridRows.length > 0 ? gridRows : (sortedNodesData.length ? [sortedNodesData] : []);
    const imageRowsToRender = imageRows.length > 0 ? imageRows : (sortedDirectImages.length ? [sortedDirectImages] : []);

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
              return firstItem?.path ? `row-${firstItem.path}` : `row-${rowIndex}`;
            }}
            itemContent={(rowIndex, row) => (
              <Box
                sx={{
                  display: 'grid',
                  gridTemplateColumns: `repeat(${columnsCount}, minmax(0, 1fr))`,
                  gap: `${densityConfig.gap}px`,
                  mb: `${densityConfig.gap}px`,
                  px: { xs: 1, sm: 2, md: 3 },
                  minHeight: `${estimatedRowHeight}px`
                }}
              >
                {row.map((item, colIndex) => {
                  const itemKey = item?.path || `${rowIndex}-${colIndex}`;
                  return (
                    <Box key={itemKey} sx={{ width: '100%' }}>
                      <AlbumCard
                        node={item}
                        displayPath={getNodeDisplayPath(item)}
                        onClick={() => handleNodeClick(item)}
                        isCompactMode={userDensity === 'compact'}
                      />
                    </Box>
                  );
                })}
              </Box>
            )}
          />
        ) : null}
        {imageRowsToRender.length > 0 ? (
          <Box
            data-testid="direct-images-section"
            style={{
              marginTop: rowsToRender.length > 0 ? `${densityConfig.gap}px` : undefined
            }}
          >
            <Virtuoso
              data={imageRowsToRender}
              customScrollParent={virtualScrollParent || undefined}
              overscan={Math.max(overscanConfig.top, overscanConfig.bottom)}
              increaseViewportBy={overscanConfig}
              computeItemKey={(rowIndex, row) => {
                const firstImage = Array.isArray(row) ? row[0] : null;
                return firstImage?.path ? `image-row-${firstImage.path}` : `image-row-${rowIndex}`;
              }}
              itemContent={(rowIndex, row) => (
                <Box
                  sx={{
                    display: 'grid',
                    gridTemplateColumns: `repeat(${columnsCount}, minmax(0, 1fr))`,
                    gap: `${densityConfig.gap}px`,
                    mb: `${densityConfig.gap}px`,
                    px: { xs: 1, sm: 2, md: 3 },
                    minHeight: `${estimatedImageRowHeight}px`
                  }}
                >
                  {row.map((image, colIndex) => {
                    const actualIndex = rowIndex * columnsCount + colIndex;
                    return (
                      <Box key={image.path} sx={{ width: '100%', aspectRatio: '2/3' }}>
                        <ImageCard
                          image={image}
                          onClick={() => handleDirectImageClick(actualIndex)}
                          density={userDensity}
                          albumPath={currentPath}
                        />
                      </Box>
                    );
                  })}
                </Box>
              )}
            />
          </Box>
        ) : null}
        {viewerOpen && (
          <ImageViewer
            images={sortedDirectImages}
            currentIndex={selectedImageIndex}
            onClose={handleCloseViewer}
            onIndexChange={setSelectedImageIndex}
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
