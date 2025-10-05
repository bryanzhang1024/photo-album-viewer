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
import RefreshIcon from '@mui/icons-material/Refresh';
import FavoriteIcon from '@mui/icons-material/Favorite';
import CasinoIcon from '@mui/icons-material/Casino';
import SettingsIcon from '@mui/icons-material/Settings';
import ChevronLeftIcon from '@mui/icons-material/ChevronLeft';
import ChevronRightIcon from '@mui/icons-material/ChevronRight';
import AlbumCard from '../components/AlbumCard';
import BreadcrumbNavigation from '../components/BreadcrumbNavigation';
import { Virtuoso } from 'react-virtuoso';
import { ScrollPositionContext } from '../App';
import { useFavorites } from '../contexts/FavoritesContext';
import imageCache from '../utils/ImageCacheManager';
import CHANNELS from '../../common/ipc-channels';
import useSorting from '../hooks/useSorting';
import PageLayout from '../components/PageLayout';
import { GRID_CONFIG, DEFAULT_DENSITY, computeGridColumns, chunkIntoRows } from '../utils/virtualGrid';

// 安全地获取electron对象
const electron = window.require ? window.require('electron') : null;
const ipcRenderer = electron ? electron.ipcRenderer : null;


function HomePage({
  colorMode,
  // URL模式的新props
  currentPath: urlCurrentPath = null,
  onNavigate = null,
  onBreadcrumbNavigate = null,
  onAlbumClick = null,
  onFolderClick = null,
  urlMode = false
}) {
  const navigate = useNavigate();
  const location = useLocation();
  const theme = useTheme();
  const [rootPath, setRootPath] = useState('');
  const [albums, setAlbums] = useState([]);
  const [navigationNodes, setNavigationNodes] = useState([]); // 新的导航节点数据
  const [currentPath, setCurrentPath] = useState(''); // 当前导航路径
  const [breadcrumbs, setBreadcrumbs] = useState([]); // 面包屑导航
  const [metadata, setMetadata] = useState(null); // 当前层级的元数据
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const { sortBy, sortDirection, handleSortChange, handleDirectionChange } = useSorting('name', 'asc');
  const [userDensity, setUserDensity] = useState(() => {
    const savedDensity = localStorage.getItem('userDensity');
    return (savedDensity && GRID_CONFIG[savedDensity]) ? savedDensity : DEFAULT_DENSITY;
  });
  const [windowWidth, setWindowWidth] = useState(window.innerWidth);
  const isSmallScreen = useMediaQuery(theme.breakpoints.down('sm'));
  const scrollContainerRef = useRef(null);
  const [virtualScrollParent, setVirtualScrollParent] = useState(null);
  const [urlPathProcessed, setUrlPathProcessed] = useState(false);
  const [browsingPath, setBrowsingPath] = useState(null); // 当前浏览路径（兼容性保留）
  const [useNewArchitecture, setUseNewArchitecture] = useState(true); // 是否使用新架构
  const [isNavigating, setIsNavigating] = useState(false); // 导航锁，防止重复操作
  
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
  
  // 获取收藏上下文
  const { favorites } = useFavorites();


  // 监听窗口大小变化
  useEffect(() => {
    const handleResize = () => {
      setWindowWidth(window.innerWidth);

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
  
  
  // URL模式初始化 - 处理来自BrowserPage的props
  useEffect(() => {
    if (urlMode && urlCurrentPath !== null) {
      console.log('URL模式：设置当前路径为', urlCurrentPath);
      setCurrentPath(urlCurrentPath);
      setBrowsingPath(urlCurrentPath);

      // 如果有路径，扫描该路径
      if (urlCurrentPath) {
        scanNavigationLevel(urlCurrentPath);
      } else {
        // 空路径，需要用户选择根目录
        setNavigationNodes([]);
        setAlbums([]);
        setBreadcrumbs([]);
        setMetadata(null);
      }
      return;
    }
  }, [urlMode, urlCurrentPath]);

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
          if (useNewArchitecture) {
            await scanNavigationLevel(targetPath);
          } else {
            await scanDirectory(targetPath);
          }
          // 只有在导航成功后才清除state
          navigate(location.pathname, { replace: true, state: null });
        } catch (error) {
          console.error('从相册返回导航失败:', error);
          setError(`导航失败: ${error.message}`);
        }
      }, 100);
      return;
    }
  }, [location.state]);

  // 从设置页面接收新的根路径
  useEffect(() => {
    if (location.state?.newRootPath) {
      const newPath = location.state.newRootPath;
      console.log(`从设置页面接收到新的根路径: ${newPath}`);
      setRootPath(newPath);
      if (useNewArchitecture) {
        scanNavigationLevel(newPath);
      } else {
        scanDirectory(newPath);
      }
      // 清除state，防止重复触发
      navigate(location.pathname, { replace: true, state: null });
    }
  }, [location.state, navigate, useNewArchitecture]);

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
      scanDirectory(decodedPath);
      setUrlPathProcessed(true);
    } else if (!urlPathProcessed) {
      // 否则使用localStorage中的路径（仅当URL参数未处理时）
      const savedPath = localStorage.getItem(windowStorageKey);
      if (savedPath) {
        console.log('使用localStorage路径:', savedPath);
        console.log('窗口存储键:', windowStorageKey);
        setRootPath(savedPath);
        scanDirectory(savedPath);
      }
      setUrlPathProcessed(true);
    }
  }, [location.search, urlPathProcessed]);
  
  
  // 在组件挂载后恢复滚动位置
  useEffect(() => {
    const timer = setTimeout(() => {
      const savedPosition = scrollContext.getPosition(location.pathname);
      if (savedPosition && scrollContainerRef.current) {
        scrollContainerRef.current.scrollTop = savedPosition;
      }
    }, 100);
    
    return () => clearTimeout(timer);
  }, [location.pathname, scrollContext]);
  
  // 添加键盘快捷键监听
  useEffect(() => {
    const handleKeyDown = (event) => {
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
  }, [albums, handleGoUp, handleRandomAlbum]); // 添加依赖
  

  
  // 智能导航扫描 - 新架构（使用统一缓存）
  const scanNavigationLevel = async (targetPath) => {
    try {
      if (!ipcRenderer) {
        setError('无法访问ipcRenderer, Electron可能没有正确加载');
        return;
      }

      // 使用统一缓存管理器
      const cachedData = imageCache.get('navigation', targetPath);
      if (cachedData) {
        console.log(`使用缓存数据: ${targetPath}`);
        setNavigationNodes(cachedData.nodes);
        setCurrentPath(cachedData.currentPath);
        setBreadcrumbs(cachedData.breadcrumbs);
        setMetadata(cachedData.metadata);

        // 兼容性数据
        const albumNodes = cachedData.nodes.filter(node => node.type === 'album');
        setAlbums(albumNodes);
        setBrowsingPath(targetPath);

        console.log(`从缓存加载: ${cachedData.metadata.totalNodes} 个节点`);
        return;
      }

      setLoading(true);
      setError('');

      console.log(`开始扫描导航层级: ${targetPath}`);
      const response = await ipcRenderer.invoke(CHANNELS.SCAN_NAVIGATION_LEVEL, targetPath);

      if (response.success) {
        // 缓存结果
        imageCache.set('navigation', targetPath, response);

        setNavigationNodes(response.nodes);
        setCurrentPath(response.currentPath);
        setBreadcrumbs(response.breadcrumbs);
        setMetadata(response.metadata);

        // 同时更新旧数据以保持兼容性
        const albumNodes = response.nodes.filter(node => node.type === 'album');
        setAlbums(albumNodes);
        setBrowsingPath(targetPath);

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
  };

  // 扫描文件夹 - 兼容性保留
  const scanDirectory = async (path) => {
    if (useNewArchitecture) {
      return await scanNavigationLevel(path);
    }

    // 原有的扫描逻辑（兼容性保留）
    try {
      if (!ipcRenderer) {
        setError('无法访问ipcRenderer, Electron可能没有正确加载');
        return;
      }

      setLoading(true);
      setError('');

      // 更新浏览路径
      setBrowsingPath(path);

      // 使用统一缓存管理器
      const cachedData = imageCache.get('albums', path);
      if (cachedData) {
        setAlbums(cachedData);
        setLoading(false);
        return;
      }

        const albums = await ipcRenderer.invoke(CHANNELS.SCAN_DIRECTORY, path);

      // 缓存结果
      imageCache.set('albums', path, result);

      setAlbums(result);
      setLoading(false);
    } catch (err) {
      setError('扫描文件夹时出错: ' + err.message);
      setLoading(false);
    }
  };

  // 处理导航点击 - 支持URL模式
  const handleNavigate = async (targetPath) => {
    if (targetPath === currentPath || isNavigating) return; // 避免重复导航和并发操作

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
      // 文件夹类型：导航到该文件夹
      if (urlMode && onFolderClick) {
        onFolderClick(node.path);
      } else {
        await scanNavigationLevel(node.path);
      }
    } else if (node.type === 'album') {
      // 相册类型：打开相册页面
      if (urlMode && onAlbumClick) {
        onAlbumClick(node.path, node.name);
      } else {
        navigate(`/album`, { state: {
          albumPath: node.path,
          albumName: node.name,
          fromHomePage: true,
          browsingPath: currentPath || rootPath
        }});
      }
    }
  }, [urlMode, onFolderClick, onAlbumClick, navigate, currentPath, rootPath, scanNavigationLevel]);

  // 处理浮动导航面板的相册点击
  const handleFloatingPanelAlbumClick = useCallback((albumPath, albumName) => {
    if (urlMode && onAlbumClick) {
      onAlbumClick(albumPath, albumName);
    } else {
      // 使用新的URL格式
      navigate(`/browse/${encodeURIComponent(albumPath)}?view=album`);
    }
  }, [urlMode, onAlbumClick, navigate]);
  
  // 清理旧缓存（兼容性保留）
  const clearOldCaches = () => {
    // 遍历localStorage，删除超过1周的缓存
    const now = Date.now();
    const oneWeekAgo = now - 7 * 24 * 60 * 60 * 1000;

    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && key.startsWith('albums_cache_timestamp_')) {
        const timestamp = parseInt(localStorage.getItem(key), 10);
        if (timestamp < oneWeekAgo) {
          const cacheKey = key.replace('timestamp_', '');
          localStorage.removeItem(cacheKey);
          localStorage.removeItem(key);
        }
      }
    }
  };
  

  // 重新扫描
  const handleRefresh = () => {
    if (rootPath) {
      // 清除统一缓存
      imageCache.clearType('navigation');
      imageCache.clearType('albums');

      // 清除旧架构缓存（兼容性）
      const navCacheKey = `navigation_cache_${rootPath}`;
      const navCacheTimestampKey = `navigation_cache_timestamp_${rootPath}`;
      localStorage.removeItem(navCacheKey);
      localStorage.removeItem(navCacheTimestampKey);

      const cacheKey = `albums_cache_${rootPath}`;
      const cacheTimestampKey = `albums_cache_timestamp_${rootPath}`;
      localStorage.removeItem(cacheKey);
      localStorage.removeItem(cacheTimestampKey);

      // 清除会话缓存中的预览图缓存
      for (let i = 0; i < sessionStorage.length; i++) {
        const key = sessionStorage.key(i);
        if (key && key.startsWith('album_preview_')) {
          sessionStorage.removeItem(key);
        }
      }

      if (useNewArchitecture) {
        scanNavigationLevel(rootPath);
      } else {
        scanDirectory(rootPath);
      }
    }
  };
  

  
  // 排序相簿 - 使用 useMemo 缓存结果
  const sortedAlbumsData = useMemo(() => {
    if (!albums.length) return [];

    return [...albums].sort((a, b) => {
      let comparison = 0;

      if (sortBy === 'name') {
        comparison = a.name.localeCompare(b.name);
      } else if (sortBy === 'imageCount') {
        comparison = a.imageCount - b.imageCount;
      } else if (sortBy === 'lastModified') {
        const aDate = a.previewImages[0]?.lastModified || 0;
        const bDate = b.previewImages[0]?.lastModified || 0;
        comparison = new Date(aDate) - new Date(bDate);
      }

      return sortDirection === 'asc' ? comparison : -comparison;
    });
  }, [albums, sortBy, sortDirection]);

  // 新架构的排序函数 - 使用 useMemo 缓存结果
  const sortedNodesData = useMemo(() => {
    if (!navigationNodes.length) return [];

    return [...navigationNodes].sort((a, b) => {
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
  }, [navigationNodes, sortBy, sortDirection]);

  const displayItems = useMemo(
    () => (useNewArchitecture ? sortedNodesData : sortedAlbumsData),
    [useNewArchitecture, sortedNodesData, sortedAlbumsData]
  );

  const columnsCount = useMemo(
    () => computeGridColumns(windowWidth, userDensity, { isSmallScreen }),
    [windowWidth, userDensity, isSmallScreen]
  );

  const gridRows = useMemo(
    () => chunkIntoRows(displayItems, columnsCount),
    [displayItems, columnsCount]
  );

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
  
  // 处理相簿点击
  const handleAlbumClick = (albumPath) => {
    // URL模式：使用传入的回调函数
    if (urlMode && onAlbumClick) {
      onAlbumClick(albumPath);
      return;
    }

    // 传统模式：保存当前滚动位置
    if (scrollContainerRef.current) {
      scrollContext.savePosition(location.pathname, scrollContainerRef.current.scrollTop);
    }

    // 使用新的URL格式
    navigate(`/browse/${encodeURIComponent(albumPath)}?view=album`);
  };

  // 获取当前显示的路径信息 - 使用 useMemo 缓存
  const currentPathInfo = useMemo(() => {
    if (!rootPath) return null;

    if (browsingPath && browsingPath !== rootPath) {
      // 显示相对路径
      const relativePath = getRelativePath(rootPath, browsingPath);
      return {
        type: 'browsing',
        displayPath: relativePath || browsingPath,
        fullPath: browsingPath
      };
    }

    return {
      type: 'root',
      displayPath: getBasename(rootPath),
      fullPath: rootPath
    };
  }, [rootPath, browsingPath]);
  
  // 计算相簿的路径显示方式
  const getAlbumDisplayPath = (album) => {
    if (!browsingPath) return album.name;
    
    const relativePath = album.path.replace(browsingPath, '');
    return relativePath.startsWith('/') ? relativePath.substring(1) : relativePath;
  };
  
  // 打开设置对话框
  const handleOpenSettings = () => {
    setTempSettings({...performanceSettings});
    setSettingsDialogOpen(true);
  };
  
  // 关闭设置对话框
  const handleCloseSettings = () => {
    setSettingsDialogOpen(false);
  };
  
  // 保存设置
  const handleSaveSettings = () => {
    setPerformanceSettings(tempSettings);
    localStorage.setItem('performance_settings', JSON.stringify(tempSettings));
    setSettingsDialogOpen(false);

    // 自动刷新应用设置
    setError('设置已保存，正在自动应用...');

    // 强制重新计算布局
    setTimeout(() => {
      // 强制重新计算列数和网格
      setWindowWidth(prev => prev + 1); // 触发useCallback重新计算
      setTimeout(() => setWindowWidth(window.innerWidth), 50);
      setError('');
    }, 100);
  };
  
  // 处理设置变化
  const handleSettingChange = (key, value) => {
    setTempSettings(prev => ({
      ...prev,
      [key]: value
    }));
  };
  
  // 重置为默认设置
  const handleResetSettings = () => {
    setTempSettings({...DEFAULT_PERFORMANCE_SETTINGS});
  };
  
  // 处理导航到收藏页面
  const handleNavigateToFavorites = () => {
    // 保存当前滚动位置
    if (scrollContainerRef.current) {
      scrollContext.savePosition(location.pathname, scrollContainerRef.current.scrollTop);
    }
    
    navigate('/favorites');
  };
  
  
  // 处理随机选择相簿
  const handleRandomAlbum = useCallback(() => {
    const sorted = useNewArchitecture ? sortedNodesData.filter(node => node.type === 'album') : sortedAlbumsData;
    if (sorted.length > 0) {
      // 随机选择一个相簿
      const randomIndex = Math.floor(Math.random() * sorted.length);
      const randomAlbum = sorted[randomIndex];
      
      // 保存当前滚动位置
      if (scrollContainerRef.current) {
        scrollContext.savePosition(location.pathname, scrollContainerRef.current.scrollTop);
      }
      
      // 导航到随机选择的相簿
      if (urlMode && onAlbumClick) {
        onAlbumClick(randomAlbum.path, randomAlbum.name);
      } else {
        navigate(`/browse/${encodeURIComponent(randomAlbum.path)}?view=album`);
      }
    } else {
      setError('没有可用的相簿进行随机选择');
    }
  }, [urlMode, onAlbumClick, useNewArchitecture, sortedNodesData, sortedAlbumsData, scrollContext, location.pathname, navigate]);

  // 处理导航面板的文件夹导航 - 真正的层级浏览
  const handleNavigationPanelNavigate = (folderPath) => {
    // 保存当前滚动位置
    if (scrollContainerRef.current) {
      scrollContext.savePosition(location.pathname, scrollContainerRef.current.scrollTop);
    }

    // 导航逻辑：使用统一的currentPath
    if (folderPath && folderPath !== currentPath) {
      scanDirectory(folderPath);
      console.log('导航到:', folderPath, '根路径:', rootPath);
    }
  };

  // 返回根目录
  const handleReturnToRoot = () => {
    if (scrollContainerRef.current) {
      scrollContext.savePosition(location.pathname, scrollContainerRef.current.scrollTop);
    }
    scanDirectory(rootPath);
  };

  // 返回上级目录
  const handleGoUp = async () => {
    if (!currentPath || currentPath === rootPath || isNavigating) return;

    // 获取当前路径的上级目录
    const parentPath = getDirname(currentPath);

    // 如果上级目录存在，则导航到上级
    if (parentPath && parentPath !== currentPath) {
      setIsNavigating(true);
      try {
        await scanDirectory(parentPath);
      } catch (error) {
        console.error('返回上级失败:', error);
        setError(`返回上级失败: ${error.message}`);
      } finally {
        setIsNavigating(false);
      }
    }
  };
  
    const renderHeader = () => (
      <>
        <BreadcrumbNavigation
          breadcrumbs={breadcrumbs}
          currentPath={currentPath}
          onNavigate={urlMode && onBreadcrumbNavigate ? onBreadcrumbNavigate : handleNavigate}
          variant="minimal"
          compact={isSmallScreen}
          sx={{ flexGrow: 1, minWidth: 0 }}
        />
        <Box sx={{ display: 'flex', alignItems: 'center', flexShrink: 0, ml: 2 }}>

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
          <Tooltip title="随机选择相簿 (R)">
            <IconButton
              color="inherit"
              onClick={handleRandomAlbum}
              size="small"
              sx={{ mx: 0.5 }}
              disabled={albums.length === 0}
            >
              <CasinoIcon />
            </IconButton>
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
          <FormControl variant="outlined" size="small" sx={{
            minWidth: { xs: 80, sm: 100 },
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
          <IconButton
            color="inherit"
            onClick={handleRefresh}
            disabled={!rootPath || loading}
            size="small"
          >
            <RefreshIcon />
          </IconButton>
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
    const hasContent = useNewArchitecture ? navigationNodes.length > 0 : albums.length > 0;

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
    const rowsToRender = gridRows.length > 0 ? gridRows : [displayItems];

    return (
      <Box>
        {metadata && (
          <Box sx={{ mb: 2, display: 'flex', justifyContent: 'flex-start', alignItems: 'center', gap: 2 }}>
            <Typography variant="caption" color="text.secondary">
              共 {metadata.folderCount} 个文件夹, {metadata.albumCount} 个相簿
            </Typography>
            <Typography variant="caption" color="text.secondary">
              总计 {metadata.totalImages} 张图片
            </Typography>
          </Box>
        )}
        <Virtuoso
          data={rowsToRender}
          customScrollParent={virtualScrollParent || undefined}
          overscan={200}
          itemContent={(rowIndex, row) => (
            <Box
              sx={{
                display: 'grid',
                gridTemplateColumns: `repeat(${columnsCount}, minmax(0, 1fr))`,
                gap: `${densityConfig.gap}px`,
                mb: `${densityConfig.gap}px`,
                px: { xs: 1, sm: 2, md: 3 }
              }}
            >
              {row.map((item, colIndex) => {
                const itemKey = item?.path || `${rowIndex}-${colIndex}`;
                return (
                  <Box key={itemKey} sx={{ width: '100%' }}>
                    {useNewArchitecture ? (
                      <AlbumCard
                        node={item}
                        displayPath={getNodeDisplayPath(item)}
                        onClick={() => handleNodeClick(item)}
                        isCompactMode={userDensity === 'compact'}
                      />
                    ) : (
                      <AlbumCard
                        album={item}
                        displayPath={getAlbumDisplayPath(item)}
                        onClick={() => handleAlbumClick(item.path)}
                        isCompactMode={userDensity === 'compact'}
                      />
                    )}
                  </Box>
                );
              })}
            </Box>
          )}
        />
      </Box>
    );
  };
  
    return (
      <PageLayout
        loading={loading}
        error={error}
        headerContent={renderHeader()}
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
