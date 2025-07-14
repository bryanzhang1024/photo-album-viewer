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
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Slider,
  Switch,
  FormControlLabel,
  TextField,
  Divider,
  Tooltip,
  Badge
} from '@mui/material';
import FolderOpenIcon from '@mui/icons-material/FolderOpen';
import SortIcon from '@mui/icons-material/Sort';
import RefreshIcon from '@mui/icons-material/Refresh';
import ViewModuleIcon from '@mui/icons-material/ViewModule';
import ViewCompactIcon from '@mui/icons-material/ViewCompact';
import SettingsIcon from '@mui/icons-material/Settings';
import TuneIcon from '@mui/icons-material/Tune';
import SpeedIcon from '@mui/icons-material/Speed';
import FavoriteIcon from '@mui/icons-material/Favorite';
import Brightness4Icon from '@mui/icons-material/Brightness4';
import Brightness7Icon from '@mui/icons-material/Brightness7';
import CasinoIcon from '@mui/icons-material/Casino';
import AlbumCard from '../components/AlbumCard';
import { AutoSizer, List, WindowScroller } from 'react-virtualized';
import 'react-virtualized/styles.css';
import { ScrollPositionContext } from '../App';
import { useFavorites } from '../contexts/FavoritesContext';

// 安全地获取electron对象
const electron = window.require ? window.require('electron') : null;
const ipcRenderer = electron ? electron.ipcRenderer : null;

// 交叉观察器API - 用于检测元素可见性
let intersectionObserver = null;
if (typeof window !== 'undefined' && 'IntersectionObserver' in window) {
  intersectionObserver = new IntersectionObserver(
    (entries) => {
      entries.forEach(entry => {
        // 获取相簿ID并标记可见性
        const albumId = entry.target.dataset.albumId;
        if (albumId) {
          // 通过自定义事件通知组件可见性变化
          const event = new CustomEvent('album-visibility-change', {
            detail: { 
              albumId,
              isVisible: entry.isIntersecting
            }
          });
          window.dispatchEvent(event);
        }
      });
    },
    {
      root: null, // 使用视口作为根
      rootMargin: '100px', // 扩展可见性范围，提前加载
      threshold: 0.1 // 10%可见就触发
    }
  );
}

// 卡片尺寸配置
const getCardConfig = (settings) => ({
  compact: {
    width: Math.min(
      Math.round(settings?.cardWidth * 0.8) || 220,
      window.innerWidth < 600 ? window.innerWidth - 32 : 280
    ),
    height: Math.round((settings?.cardWidth * 0.8) * 0.7) || 160,
    spacing: Math.max(8, Math.min(16, window.innerWidth / 100))
  },
  standard: {
    width: Math.min(
      settings?.cardWidth || 280,
      window.innerWidth < 600 ? window.innerWidth - 32 : 350
    ),
    height: Math.round(settings?.cardWidth * 0.9) || 260,
    spacing: Math.max(12, Math.min(24, window.innerWidth / 50))
  }
});

// 默认优化设置
const DEFAULT_PERFORMANCE_SETTINGS = {
  concurrentTasks: 10,
  preloadDistance: 5,
  cacheTimeout: 60, // 分钟
  cacheEnabled: true,
  thumbnailResolution: 450, // 缩略图分辨率（宽度，高度会按比例调整）
  cardWidth: 280 // 卡片基础宽度
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
  const [compactView, setCompactView] = useState(true);
  const [windowWidth, setWindowWidth] = useState(window.innerWidth);
  const [visibleAlbums, setVisibleAlbums] = useState(new Set());
  const isSmallScreen = useMediaQuery(theme.breakpoints.down('sm'));
  const listRef = useRef(null);
  const visibleRowsRef = useRef(new Set());
  const scrollContainerRef = useRef(null);
  const [forceUpdate, setForceUpdate] = useState(0); // 添加强制更新计数器
  
  // 获取滚动位置上下文
  const scrollContext = useContext(ScrollPositionContext);
  
  // 获取收藏上下文
  const { favorites } = useFavorites();
  
  // 性能设置
  const [performanceSettings, setPerformanceSettings] = useState(() => {
    const savedSettings = localStorage.getItem('performance_settings');
    return savedSettings ? JSON.parse(savedSettings) : DEFAULT_PERFORMANCE_SETTINGS;
  });
  
  // 设置对话框
  const [settingsDialogOpen, setSettingsDialogOpen] = useState(false);
  const [tempSettings, setTempSettings] = useState({...performanceSettings});
  
  // 同步性能设置到主进程
  useEffect(() => {
    if (ipcRenderer) {
      ipcRenderer.invoke('update-performance-settings', performanceSettings)
        .catch(err => console.error('更新性能设置失败:', err));
    }
  }, [performanceSettings]);
  
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
  
  // 监听相簿可见性变化
  useEffect(() => {
    const handleVisibilityChange = (event) => {
      const { albumId, isVisible } = event.detail;
      
      setVisibleAlbums(prevVisibleAlbums => {
        const newVisibleAlbums = new Set(prevVisibleAlbums);
        if (isVisible) {
          newVisibleAlbums.add(albumId);
        } else {
          newVisibleAlbums.delete(albumId);
        }
        return newVisibleAlbums;
      });
    };
    
    window.addEventListener('album-visibility-change', handleVisibilityChange);
    return () => {
      window.removeEventListener('album-visibility-change', handleVisibilityChange);
    };
  }, []);
  
  // 从localStorage中读取上次的路径和视图设置
  useEffect(() => {
    const savedPath = localStorage.getItem('lastRootPath');
    const savedViewMode = localStorage.getItem('compactView');
    
    if (savedViewMode !== null) {
      setCompactView(savedViewMode === 'true');
    }
    
    if (savedPath) {
      setRootPath(savedPath);
      scanDirectory(savedPath);
    }
  }, []);
  
  // 当视图模式、窗口宽度或强制更新计数器变化时，重新计算虚拟列表
  useEffect(() => {
    if (listRef.current) {
      // 延迟执行以确保DOM已更新
      setTimeout(() => {
        try {
          // 重新计算行高和缓存
          console.log('重新计算虚拟列表布局...');
          console.log(`当前窗口宽度: ${windowWidth}, 列数: ${getColumnsPerRow()}`);
          
          listRef.current.recomputeRowHeights();
          listRef.current.forceUpdateGrid();
        } catch (err) {
          console.error('重新计算虚拟列表时出错:', err);
        }
      }, 100);
    }
  }, [compactView, windowWidth, performanceSettings, forceUpdate]);
  
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
        localStorage.setItem('lastRootPath', selectedDir);
        await scanDirectory(selectedDir);
      }
    } catch (err) {
      setError('选择文件夹时出错: ' + err.message);
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
  
  // 切换视图模式
  const toggleViewMode = () => {
    const newMode = !compactView;
    setCompactView(newMode);
    localStorage.setItem('compactView', newMode.toString());
    
    // 延迟一下强制更新列表，确保DOM已更新
    setTimeout(() => {
      if (listRef.current) {
        try {
          console.log('视图模式切换，重新计算虚拟列表...');
          listRef.current.recomputeRowHeights();
          listRef.current.forceUpdateGrid();
        } catch (err) {
          console.error('视图模式切换时重新计算虚拟列表出错:', err);
        }
      }
    }, 100);
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
  
  // 根据窗口宽度和卡片配置计算每行显示的相簿数量
  const getColumnsPerRow = useCallback(() => {
    const config = compactView ? getCardConfig(performanceSettings).compact : getCardConfig(performanceSettings).standard;
    
    // 更精确的内边距计算 - 响应式
    const containerPadding = isSmallScreen ? 16 : 32; // 总内边距
    const scrollbarWidth = 8; // 现代浏览器滚动条更窄
    const availableWidth = Math.max(0, windowWidth - containerPadding - scrollbarWidth);
    
    // 更智能的列数计算，允许卡片更宽
    const minCardWidth = config.width * 0.9; // 允许卡片比配置宽度稍小
    const columnsCount = Math.max(1, Math.floor((availableWidth + config.spacing) / (minCardWidth + config.spacing)));
    
    // 超宽屏幕优化
    if (windowWidth > 1920) {
      return Math.min(columnsCount, compactView ? 8 : 6);
    }
    
    // 大屏幕优化
    if (windowWidth > 1200) {
      return Math.min(columnsCount, compactView ? 6 : 5);
    }
    
    // 中等屏幕
    if (windowWidth > 768) {
      return Math.min(columnsCount, compactView ? 4 : 3);
    }
    
    // 小屏幕时限制列数
    if (isSmallScreen) {
      return Math.min(columnsCount, compactView ? 2 : 1);
    }
    
    return columnsCount;
  }, [windowWidth, compactView, isSmallScreen, performanceSettings]);
  
  // 计算行高
  const getRowHeight = useCallback(() => {
    try {
      const config = compactView ? getCardConfig(performanceSettings).compact : getCardConfig(performanceSettings).standard;
      // 行高 = 卡片高度 + 上下间距，确保有足够的空间
      const rowHeight = config.height + config.spacing;
      return rowHeight;
    } catch (err) {
      console.error('计算行高时出错:', err);
      // 返回默认行高
      return 280;
    }
  }, [compactView, performanceSettings]);
  
  // 生成唯一ID
  const getAlbumId = (album, index) => {
    return `album-${album.path}-${index}`;
  };
  
  // 更新可视行的追踪
  const updateVisibleRows = useCallback((startIndex, stopIndex) => {
    visibleRowsRef.current = new Set();
    for (let i = startIndex; i <= stopIndex; i++) {
      visibleRowsRef.current.add(i);
    }
  }, []);
  
  // 渲染行（用于虚拟列表）
  const renderRow = ({ index, key, style }) => {
    try {
      const sorted = sortedAlbums();
      const columnsPerRow = getColumnsPerRow();
      const config = compactView ? getCardConfig(performanceSettings).compact : getCardConfig(performanceSettings).standard;
      
      // 创建一个包含此行所有相簿的数组
      const rowItems = [];
      for (let i = 0; i < columnsPerRow; i++) {
        const albumIndex = index * columnsPerRow + i;
        if (albumIndex < sorted.length) {
          const album = sorted[albumIndex];
          rowItems.push(album);
        }
      }
      
      return (
        <div 
          key={key} 
          style={{
            ...style,
            display: 'flex',
            flexDirection: 'row',
            marginBottom: `${config.spacing}px`,
            width: '100%' // 确保行占满整个宽度
          }}
        >
          {rowItems.map((album, i) => {
            const albumId = getAlbumId(album, index * columnsPerRow + i);
            const isAlbumVisible = visibleRowsRef.current.has(index);
            
            return (
              <div 
                key={`${album.path}-${i}`} 
                style={{
                  width: `${config.width}px`,
                  marginRight: i < columnsPerRow - 1 ? `${config.spacing}px` : 0,
                  height: `${config.height}px`
                }}
                data-album-id={albumId}
                ref={node => {
                  if (node && intersectionObserver) {
                    intersectionObserver.observe(node);
                  }
                }}
              >
                <AlbumCard 
                  album={album}
                  displayPath={getAlbumDisplayPath(album)}
                  onClick={() => handleAlbumClick(album.path)}
                  isCompactMode={compactView}
                  isVisible={isAlbumVisible}
                />
              </div>
            );
          })}
        </div>
      );
    } catch (err) {
      console.error('渲染行时出错:', err);
      return <div key={key} style={style}>加载出错</div>;
    }
  };
  
  // 当列表滚动时更新可视范围
  const onRowsRendered = ({ overscanStartIndex, overscanStopIndex }) => {
    updateVisibleRows(overscanStartIndex, overscanStopIndex);
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
    
    // 通知用户需要刷新以应用某些设置
    setError('设置已保存。某些设置可能需要重新加载相簿才能生效。');
    
    // 强制重新计算虚拟列表
    if (listRef.current) {
      setTimeout(() => {
        if (listRef.current) {
          listRef.current.recomputeRowHeights();
          listRef.current.forceUpdateGrid();
        }
      }, 100);
    }
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
  
  // 添加一个useEffect来确保WindowScroller能够正确地获取滚动元素
  useEffect(() => {
    // 确保scrollContainerRef已经设置
    if (scrollContainerRef.current) {
      // 强制更新，确保WindowScroller使用正确的滚动元素
      setForceUpdate(prev => prev + 1);
    }
  }, [scrollContainerRef.current]);
  
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
            
            <IconButton 
              color="inherit" 
              onClick={toggleViewMode} 
              size="small"
              sx={{ mx: 0.5 }}
              title={compactView ? "切换到标准视图" : "切换到紧凑视图"}
            >
              {compactView ? <ViewCompactIcon sx={{ fontSize: '1.2rem' }} /> : <ViewModuleIcon sx={{ fontSize: '1.2rem' }} />}
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
                <Badge 
                  badgeContent={favorites.albums.length + favorites.images.length} 
                  color="secondary"
                  max={99}
                  sx={{
                    '& .MuiBadge-badge': {
                      fontSize: '0.6rem',
                      height: '16px',
                      minWidth: '16px',
                    }
                  }}
                >
                  <FavoriteIcon sx={{ fontSize: '1.2rem' }} />
                </Badge>
              </IconButton>
            </Tooltip>
            
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
            
            <Tooltip title="性能优化设置">
              <IconButton 
                color="inherit"
                onClick={handleOpenSettings}
                size="small"
                sx={{ mx: 0.5 }}
              >
                <TuneIcon sx={{ fontSize: '1.2rem' }} />
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
          </Box>
        </Toolbar>
      </AppBar>
      
      <Box 
        ref={scrollContainerRef}
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
            
            <WindowScroller scrollElement={scrollContainerRef.current || window}>
              {({ height, isScrolling, onChildScroll, scrollTop }) => (
                <AutoSizer disableHeight>
                  {({ width }) => {
                    try {
                      const columnsPerRow = getColumnsPerRow();
                      const rowCount = Math.ceil(sortedAlbums().length / columnsPerRow);
                      const rowHeight = getRowHeight();
                      
                      console.log(`虚拟列表参数 - 宽度: ${width}, 高度: ${height}, 列数: ${columnsPerRow}, 行数: ${rowCount}, 行高: ${rowHeight}, 滚动位置: ${scrollTop}`);
                      
                      // 添加key属性，在列数变化时强制重新创建List组件
                      const listKey = `list-${columnsPerRow}-${compactView}-${forceUpdate}`;
                      
                      return (
                        <List
                          key={listKey}
                          ref={listRef}
                          autoHeight
                          height={height}
                          isScrolling={isScrolling}
                          onScroll={onChildScroll}
                          rowCount={rowCount}
                          rowHeight={rowHeight}
                          rowRenderer={renderRow}
                          scrollTop={scrollTop}
                          width={width}
                          overscanRowCount={performanceSettings.preloadDistance || 10}
                          onRowsRendered={onRowsRendered}
                        />
                      );
                    } catch (err) {
                      console.error('渲染虚拟列表时出错:', err);
                      return (
                        <Box sx={{ p: 2 }}>
                          <Alert severity="error">加载相簿列表时出错: {err.message}</Alert>
                        </Box>
                      );
                    }
                  }}
                </AutoSizer>
              )}
            </WindowScroller>
          </Box>
        )}
      </Box>
      
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
      
      <Dialog open={settingsDialogOpen} onClose={handleCloseSettings}>
        <DialogTitle>
          <Box sx={{ display: 'flex', alignItems: 'center' }}>
            <SpeedIcon sx={{ mr: 1 }} />
            性能优化设置
          </Box>
        </DialogTitle>
        <DialogContent dividers>
          <Box sx={{ mb: 3 }}>
            <Typography gutterBottom>并发任务数量</Typography>
            <Typography variant="caption" color="text.secondary">
              同时处理的缩略图生成任务数量。增加可提高速度，但可能导致系统负担过重。
            </Typography>
            <Box sx={{ display: 'flex', alignItems: 'center' }}>
              <Slider
                value={tempSettings.concurrentTasks}
                min={1}
                max={20}
                step={1}
                marks={[
                  { value: 1, label: '1' },
                  { value: 10, label: '10' },
                  { value: 20, label: '20' }
                ]}
                valueLabelDisplay="auto"
                onChange={(_, value) => handleSettingChange('concurrentTasks', value)}
              />
            </Box>
          </Box>
          
          <Divider sx={{ my: 2 }} />
          
          <Box sx={{ mb: 3 }}>
            <Typography gutterBottom>预加载距离</Typography>
            <Typography variant="caption" color="text.secondary">
              可视区域外预加载的行数。增加可减少滚动时的空白，但会增加初始加载时间。
            </Typography>
            <Box sx={{ display: 'flex', alignItems: 'center' }}>
              <Slider
                value={tempSettings.preloadDistance}
                min={1}
                max={10}
                step={1}
                marks={[
                  { value: 1, label: '1' },
                  { value: 5, label: '5' },
                  { value: 10, label: '10' }
                ]}
                valueLabelDisplay="auto"
                onChange={(_, value) => handleSettingChange('preloadDistance', value)}
              />
            </Box>
          </Box>
          
          <Divider sx={{ my: 2 }} />
          
          <Box sx={{ mb: 3 }}>
            <Typography gutterBottom>缩略图分辨率</Typography>
            <Typography variant="caption" color="text.secondary">
              缩略图的宽度像素值。较低的分辨率可提高加载速度和节省存储空间，但图像细节会减少。
            </Typography>
            <Box sx={{ display: 'flex', alignItems: 'center' }}>
              <Slider
                value={tempSettings.thumbnailResolution}
                min={150}
                max={600}
                step={50}
                marks={[
                  { value: 150, label: '小' },
                  { value: 300, label: '中' },
                  { value: 450, label: '大' },
                  { value: 600, label: '超大' }
                ]}
                valueLabelDisplay="auto"
                valueLabelFormat={value => `${value}px`}
                onChange={(_, value) => handleSettingChange('thumbnailResolution', value)}
              />
            </Box>
          </Box>
          
          <Divider sx={{ my: 2 }} />
          
          <Box sx={{ mb: 3 }}>
            <Typography gutterBottom>卡片宽度</Typography>
            <Typography variant="caption" color="text.secondary">
              调整相簿卡片的宽度。较大的宽度显示更多细节，较小的宽度可在同一屏幕显示更多相簿。
            </Typography>
            <Box sx={{ display: 'flex', alignItems: 'center' }}>
              <Slider
                value={tempSettings.cardWidth}
                min={180}
                max={400}
                step={20}
                marks={[
                  { value: 180, label: '窄' },
                  { value: 280, label: '标准' },
                  { value: 340, label: '宽' },
                  { value: 400, label: '超宽' }
                ]}
                valueLabelDisplay="auto"
                valueLabelFormat={value => `${value}px`}
                onChange={(_, value) => handleSettingChange('cardWidth', value)}
              />
            </Box>
          </Box>
          
          <Divider sx={{ my: 2 }} />
          
          <Box sx={{ mb: 3 }}>
            <Typography gutterBottom>缓存设置</Typography>
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
              <FormControlLabel
                control={
                  <Switch
                    checked={tempSettings.cacheEnabled}
                    onChange={(e) => handleSettingChange('cacheEnabled', e.target.checked)}
                  />
                }
                label="启用缓存"
              />
              
              <Box sx={{ display: 'flex', alignItems: 'center', mt: 1 }}>
                <TextField
                  label="缓存超时(分钟)"
                  type="number"
                  size="small"
                  disabled={!tempSettings.cacheEnabled}
                  value={tempSettings.cacheTimeout}
                  onChange={(e) => handleSettingChange('cacheTimeout', parseInt(e.target.value, 10) || 60)}
                  inputProps={{ min: 5, max: 1440 }}
                  sx={{ width: 180 }}
                />
                <Typography variant="caption" color="text.secondary" sx={{ ml: 2 }}>
                  缓存有效时间，超过后将重新加载
                </Typography>
              </Box>
              
              <Box sx={{ mt: 2 }}>
                <Button 
                  variant="outlined" 
                  color="error" 
                  onClick={clearAllCache} 
                  size="small"
                >
                  清空所有缓存
                </Button>
                <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1 }}>
                  清除所有缓存的相册、图片和缩略图数据
                </Typography>
              </Box>
            </Box>
          </Box>
        </DialogContent>
        <DialogActions>
          <Button onClick={handleResetSettings} color="inherit">
            恢复默认
          </Button>
          <Button onClick={handleCloseSettings}>
            取消
          </Button>
          <Button onClick={handleSaveSettings} variant="contained">
            保存
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}

export default HomePage; 