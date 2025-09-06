import React, { useState, useEffect, useCallback, useMemo, useRef, useContext } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { 
  Box, 
  Container,
  Typography, 
  Button, 
  Grid, 
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
import FolderOpenIcon from '@mui/icons-material/FolderOpen';
import SortIcon from '@mui/icons-material/Sort';
import RefreshIcon from '@mui/icons-material/Refresh';
import FavoriteIcon from '@mui/icons-material/Favorite';
import Brightness4Icon from '@mui/icons-material/Brightness4';
import Brightness7Icon from '@mui/icons-material/Brightness7';
import CasinoIcon from '@mui/icons-material/Casino';
import OpenInNewIcon from '@mui/icons-material/OpenInNew';
import SettingsIcon from '@mui/icons-material/Settings';
import AlbumCard from '../components/AlbumCard';
import FloatingNavigationPanel from '../components/FloatingNavigationPanel';
import Masonry from 'react-masonry-css';
import './AlbumPage.css';
import { ScrollPositionContext } from '../App';
import { useFavorites } from '../contexts/FavoritesContext';

// 安全地获取electron对象
const electron = window.require ? window.require('electron') : null;
const ipcRenderer = electron ? electron.ipcRenderer : null;


// 优化布局配置 - 采用收藏页面的紧凑设计
const DENSITY_CONFIG = {
  compact: { baseWidth: 180, spacing: 8 },
  standard: { baseWidth: 220, spacing: 10 },
  comfortable: { baseWidth: 280, spacing: 12 }
};

function HomePage({ colorMode }) {
  const navigate = useNavigate();
  const location = useLocation();
  const theme = useTheme();
  const [rootPath, setRootPath] = useState('');
  const [albums, setAlbums] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [sortBy, setSortBy] = useState('name');
  const [sortDirection, setSortDirection] = useState('asc');
  const [userDensity, setUserDensity] = useState(() => localStorage.getItem('userDensity') || 'standard');
  const [windowWidth, setWindowWidth] = useState(window.innerWidth);
  const isSmallScreen = useMediaQuery(theme.breakpoints.down('sm'));
  const scrollContainerRef = useRef(null);
  const [forceUpdate, setForceUpdate] = useState(0);
  const [urlPathProcessed, setUrlPathProcessed] = useState(false);
  
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
      
      // 触发强制更新，确保虚拟列表重新计算
      setForceUpdate(prev => prev + 1);
    };
    
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);
  
  
  // 从localStorage中读取上次的路径，并处理URL参数
  useEffect(() => {
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
      // 按下 r 键触发随机选择相簿
      if (event.key === 'r' && !event.ctrlKey && !event.altKey && !event.metaKey) {
        // 确保不在输入框中
        if (document.activeElement.tagName !== 'INPUT' && 
            document.activeElement.tagName !== 'TEXTAREA' &&
            !document.activeElement.isContentEditable) {
          handleRandomAlbum();
        }
      }
    };
    
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [albums]); // 依赖albums数组，确保有相簿数据时才能正常工作
  
  // 处理文件夹选择
  const handleSelectDirectory = async () => {
    try {
      if (!ipcRenderer) {
        setError('无法访问ipcRenderer, Electron可能没有正确加载');
        return;
      }
      
      const selectedDir = await ipcRenderer.invoke('select-directory');
      if (selectedDir) {
        setRootPath(selectedDir);
        // 保存到localStorage
        localStorage.setItem(windowStorageKey, selectedDir);
        await scanDirectory(selectedDir);
      }
    } catch (err) {
      setError('选择文件夹时出错: ' + err.message);
    }
  };

  // 处理新实例选择文件夹（启动新的应用实例）
  const handleOpenNewInstance = async () => {
    try {
      if (!ipcRenderer) {
        setError('无法访问ipcRenderer, Electron可能没有正确加载');
        return;
      }
      
      const selectedDir = await ipcRenderer.invoke('select-directory');
      if (selectedDir) {
        // 启动新的应用实例来加载这个文件夹
        const result = await ipcRenderer.invoke('create-new-instance', selectedDir);
        if (result.success) {
          console.log('新实例已启动');
        } else {
          setError('启动新实例失败: ' + result.error);
        }
      }
    } catch (err) {
      setError('启动新实例时出错: ' + err.message);
    }
  };
  
  // 扫描文件夹
  const scanDirectory = async (path) => {
    try {
      if (!ipcRenderer) {
        setError('无法访问ipcRenderer, Electron可能没有正确加载');
        return;
      }
      
      setLoading(true);
      setError('');
      
      // 检查是否有缓存
      const cacheKey = `albums_cache_${path}`;
      const cachedData = localStorage.getItem(cacheKey);
      const cacheTimestampKey = `albums_cache_timestamp_${path}`;
      const cacheTimestamp = localStorage.getItem(cacheTimestampKey);
      
      // 如果缓存不超过1小时，则使用缓存
      if (cachedData && cacheTimestamp) {
        const now = Date.now();
        const timestamp = parseInt(cacheTimestamp, 10);
        if (now - timestamp < 60 * 60 * 1000) { // 1小时
          setAlbums(JSON.parse(cachedData));
          setLoading(false);
          return;
        }
      }
      
      const result = await ipcRenderer.invoke('scan-directory', path);
      
      // 缓存结果
      try {
        localStorage.setItem(cacheKey, JSON.stringify(result));
        localStorage.setItem(cacheTimestampKey, Date.now().toString());
      } catch (e) {
        // localStorage可能已满，清理旧缓存
        console.warn('缓存存储失败，尝试清理旧缓存', e);
        clearOldCaches();
      }
      
      setAlbums(result);
      setLoading(false);
    } catch (err) {
      setError('扫描文件夹时出错: ' + err.message);
      setLoading(false);
    }
  };
  
  // 清理旧缓存
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
  
  // 清空所有缓存
  const clearAllCache = () => {
    // 清空localStorage中的相册缓存
    const keysToRemove = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && (key.startsWith('albums_cache_') || key.startsWith('album_images_'))) {
        keysToRemove.push(key);
      }
    }
    keysToRemove.forEach(key => localStorage.removeItem(key));
    
    // 清空sessionStorage中的预览图缓存
    const sessionKeysToRemove = [];
    for (let i = 0; i < sessionStorage.length; i++) {
      const key = sessionStorage.key(i);
      if (key && (key.startsWith('album_preview_') || key.startsWith('image_thumbnail_'))) {
        sessionKeysToRemove.push(key);
      }
    }
    sessionKeysToRemove.forEach(key => sessionStorage.removeItem(key));
    
    // 通过IPC通知主进程清空缩略图缓存
    if (ipcRenderer) {
      ipcRenderer.invoke('clear-thumbnail-cache')
        .then(result => {
          if (result.success) {
            setError('所有缓存已成功清除。可能需要重新加载应用以完全应用更改。');
          } else {
            setError('清除缓存时出现错误: ' + (result.error || '未知错误'));
          }
        })
        .catch(err => {
          setError('清除缓存时出现错误: ' + err.message);
        });
    } else {
      setError('缓存部分清除成功。重新加载应用以完全应用更改。');
    }
  };
  
  // 重新扫描
  const handleRefresh = () => {
    if (rootPath) {
      // 清除缓存
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
      
      scanDirectory(rootPath);
    }
  };
  
  // 处理排序方式变化
  const handleSortChange = (event) => {
    setSortBy(event.target.value);
  };
  
  // 处理排序方向变化
  const handleDirectionChange = () => {
    setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc');
  };
  
  
  // 排序相簿
  const sortedAlbums = () => {
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
  };
  
  // 处理相簿点击
  const handleAlbumClick = (albumPath) => {
    // 保存当前滚动位置
    if (scrollContainerRef.current) {
      scrollContext.savePosition(location.pathname, scrollContainerRef.current.scrollTop);
    }
    
    // 用encodeURIComponent处理路径中的特殊字符
    navigate(`/album/${encodeURIComponent(albumPath)}`);
  };
  
  // 计算相簿的路径显示方式
  const getAlbumDisplayPath = (album) => {
    if (!rootPath) return album.name;
    
    const relativePath = album.path.replace(rootPath, '');
    return relativePath.startsWith('/') ? relativePath.substring(1) : relativePath;
  };
  
  // 优化的响应式瀑布流布局 - 采用收藏页面的断点式设计
  const getMasonryBreakpoints = useCallback(() => {
    const config = DENSITY_CONFIG[userDensity];
    const containerPadding = isSmallScreen ? 8 : 12;
    const scrollbarWidth = 2;
    const availableWidth = Math.max(0, windowWidth - containerPadding * 2 - scrollbarWidth);
    
    const columnWidth = config.baseWidth + config.spacing;
    const columns = Math.max(1, Math.floor((availableWidth + config.spacing) / columnWidth));
    
    return columns;
  }, [windowWidth, isSmallScreen, userDensity]);
  
  
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
      
      // 强制重新计算虚拟列表
      if (listRef.current) {
        listRef.current.recomputeRowHeights();
        listRef.current.forceUpdateGrid();
      }
      
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
  const handleRandomAlbum = () => {
    const sorted = sortedAlbums();
    if (sorted.length > 0) {
      // 随机选择一个相簿
      const randomIndex = Math.floor(Math.random() * sorted.length);
      const randomAlbum = sorted[randomIndex];
      
      // 保存当前滚动位置
      if (scrollContainerRef.current) {
        scrollContext.savePosition(location.pathname, scrollContainerRef.current.scrollTop);
      }
      
      // 导航到随机选择的相簿
      navigate(`/album/${encodeURIComponent(randomAlbum.path)}`);
    } else {
      setError('没有可用的相簿进行随机选择');
    }
  };

  // 处理导航面板的文件夹导航
  const handleNavigationPanelNavigate = (folderPath) => {
    // 保存当前滚动位置
    if (scrollContainerRef.current) {
      scrollContext.savePosition(location.pathname, scrollContainerRef.current.scrollTop);
    }
    
    // 检查是否是当前已经扫描的路径的子目录
    if (folderPath && folderPath !== rootPath) {
      // 导航到新的文件夹 - 设置为新的根路径并重新扫描
      setRootPath(folderPath);
      localStorage.setItem(windowStorageKey, folderPath);
      scanDirectory(folderPath);
    }
  };
  
  return (
    <Box sx={{ flexGrow: 1, height: '100vh', display: 'flex', flexDirection: 'column' }}>
      <AppBar position="static" color="primary" elevation={0}>
        <Toolbar variant="dense">
          <Typography variant="h6" component="div" sx={{ flexGrow: 1, fontSize: { xs: '1rem', sm: '1.25rem' } }}>
            照片相簿浏览器
          </Typography>
          <Button 
            color="inherit" 
            startIcon={<FolderOpenIcon />}
            onClick={handleSelectDirectory}
            size="small"
            sx={{ mr: 1 }}
          >
            选择文件夹
          </Button>
          
          <Button 
            color="inherit" 
            startIcon={<OpenInNewIcon />}
            onClick={handleOpenNewInstance}
            size="small"
            sx={{ mr: 1 }}
          >
            新实例选择文件夹
          </Button>
          
          <Box sx={{ display: 'flex', alignItems: 'center' }}>
            <FormControl variant="outlined" size="small" sx={{ 
              minWidth: { xs: 80, sm: 120 },
              mr: 1,
              bgcolor: 'rgba(255,255,255,0.1)', 
              borderRadius: 1 
            }}>
              <InputLabel id="sort-select-label" sx={{ color: 'white', fontSize: '0.8rem' }}>排序</InputLabel>
              <Select
                labelId="sort-select-label"
                value={sortBy}
                onChange={handleSortChange}
                label="排序"
                sx={{ color: 'white', fontSize: '0.8rem' }}
              >
                <MenuItem value="name">名称</MenuItem>
                <MenuItem value="imageCount">照片数量</MenuItem>
                <MenuItem value="lastModified">修改时间</MenuItem>
              </Select>
            </FormControl>
            
            <IconButton color="inherit" onClick={handleDirectionChange} size="small">
              <SortIcon sx={{ 
                transform: sortDirection === 'desc' ? 'rotate(180deg)' : 'none',
                transition: 'transform 0.3s',
                fontSize: '1.2rem'
              }} />
            </IconButton>
            
            
            {/* 添加随机选择相簿按钮 */}
            <Tooltip title="随机选择相簿 (R)">
              <IconButton 
                color="inherit"
                onClick={handleRandomAlbum}
                size="small"
                sx={{ mx: 0.5 }}
                disabled={albums.length === 0}
              >
                <CasinoIcon sx={{ fontSize: '1.2rem' }} />
              </IconButton>
            </Tooltip>
            
            {/* 收藏按钮 */}
            <Tooltip title="我的收藏">
              <IconButton 
                color="inherit"
                onClick={handleNavigateToFavorites}
                size="small"
                sx={{ mx: 0.5 }}
              >
                <FavoriteIcon sx={{ fontSize: '1.2rem' }} />
              </IconButton>
            </Tooltip>
            
            {/* 密度选择 */}
            <FormControl variant="outlined" size="small" sx={{ 
              minWidth: { xs: 80, sm: 100 },
              mr: 1,
              bgcolor: 'rgba(255,255,255,0.1)', 
              borderRadius: 1 
            }}>
              <InputLabel id="density-select-label" sx={{ color: 'white', fontSize: '0.8rem' }}>密度</InputLabel>
              <Select
                labelId="density-select-label"
                value={userDensity}
                onChange={(e) => {
                  setUserDensity(e.target.value);
                  localStorage.setItem('userDensity', e.target.value);
                }}
                label="密度"
                sx={{ color: 'white', fontSize: '0.8rem' }}
              >
                <MenuItem value="compact">紧凑</MenuItem>
                <MenuItem value="standard">标准</MenuItem>
                <MenuItem value="comfortable">宽松</MenuItem>
              </Select>
            </FormControl>
            
            {/* 深色模式切换按钮 */}
            <Tooltip title={colorMode.mode === 'dark' ? "切换到浅色模式" : "切换到深色模式"}>
              <IconButton 
                color="inherit"
                onClick={colorMode.toggleColorMode}
                size="small"
                sx={{ mx: 0.5 }}
              >
                {colorMode.mode === 'dark' ? <Brightness7Icon sx={{ fontSize: '1.2rem' }} /> : <Brightness4Icon sx={{ fontSize: '1.2rem' }} />}
              </IconButton>
            </Tooltip>
            
            <IconButton 
              color="inherit" 
              onClick={handleRefresh} 
              disabled={!rootPath || loading}
              size="small"
            >
              <RefreshIcon sx={{ fontSize: '1.2rem' }} />
            </IconButton>
            
            <Tooltip title="设置">
              <IconButton 
                color="inherit" 
                onClick={() => navigate('/settings')}
                size="small"
              >
                <SettingsIcon sx={{ fontSize: '1.2rem' }} />
              </IconButton>
            </Tooltip>
          </Box>
        </Toolbar>
      </AppBar>
      
      <Box 
        ref={scrollContainerRef}
        className="scroll-container"
        sx={{ 
          flexGrow: 1, 
          overflow: 'auto', 
          py: 2, 
          px: { xs: 1, sm: 2, md: 3 },
          bgcolor: theme => theme.palette.background.default,
          width: '100%',
          maxWidth: '100vw'
        }}
      >
        {loading ? (
          <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '50vh' }}>
            <CircularProgress />
          </Box>
        ) : error ? (
          <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>
        ) : albums.length === 0 ? (
          <Paper elevation={2} sx={{ p: 3, textAlign: 'center' }}>
            <Typography variant="h6" gutterBottom>没有找到相簿</Typography>
            <Typography variant="body2" color="text.secondary" paragraph>
              请选择一个包含照片相簿的文件夹
            </Typography>
            <Button 
              variant="contained" 
              startIcon={<FolderOpenIcon />}
              onClick={handleSelectDirectory}
            >
              选择文件夹
            </Button>
          </Paper>
        ) : (
          <Box>
            <Box sx={{ mb: 2 }}>
              <Typography variant="subtitle1">
                找到 {albums.length} 个相簿
              </Typography>
              <Typography variant="caption" color="text.secondary" display="block">
                根目录: {rootPath}
              </Typography>
            </Box>
            
            <Masonry
              key={`albums-masonry-${userDensity}-${windowWidth}`}
              breakpointCols={getMasonryBreakpoints()}
              className="masonry-grid"
              columnClassName="masonry-grid_column"
            >
              {sortedAlbums().map((album) => (
                <div key={album.path} style={{ marginBottom: `${DENSITY_CONFIG[userDensity].spacing}px` }}>
                  <AlbumCard
                    album={album}
                    displayPath={getAlbumDisplayPath(album)}
                    onClick={() => handleAlbumClick(album.path)}
                    isCompactMode={userDensity === 'compact'}
                    isVisible={true}
                  />
                </div>
              ))}
            </Masonry>
          </Box>
        )}
      </Box>

      {/* 浮动导航面板 */}
      <FloatingNavigationPanel
        currentPath={rootPath}
        onNavigate={handleNavigationPanelNavigate}
        rootPath={rootPath}
        isVisible={!!rootPath} // 只有选择了根路径后才显示
      />
      
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
      
    </Box>
  );
}

export default HomePage; 