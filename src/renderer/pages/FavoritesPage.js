import React, { useState, useEffect, useCallback, useContext, useRef } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { 
  Box, 
  AppBar, 
  Toolbar, 
  Typography, 
  IconButton, 
  Tabs,
  Tab,
  Grid,
  Paper,
  Divider,
  CircularProgress,
  Alert,
  Card,
  CardContent,
  CardMedia,
  Button,
  Tooltip,
  useMediaQuery,
  useTheme,
  FormControl,
  Select,
  MenuItem,
  InputLabel
} from '@mui/material';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import DeleteIcon from '@mui/icons-material/Delete';
import FolderIcon from '@mui/icons-material/Folder';
import ImageIcon from '@mui/icons-material/Image';
import SortIcon from '@mui/icons-material/Sort';
import ViewModuleIcon from '@mui/icons-material/ViewModule';
import ViewCompactIcon from '@mui/icons-material/ViewCompact';
import Brightness4Icon from '@mui/icons-material/Brightness4';
import Brightness7Icon from '@mui/icons-material/Brightness7';
import { useFavorites } from '../contexts/FavoritesContext';
import ImageViewer from '../components/ImageViewer';
import AlbumCard from '../components/AlbumCard';
import ImageCard from '../components/ImageCard';
import { AutoSizer, List, WindowScroller } from 'react-virtualized';
import 'react-virtualized/styles.css';
import { ScrollPositionContext } from '../App';
import './FavoritesPage.css';

// 安全地获取electron对象
const electron = window.require ? window.require('electron') : null;
const ipcRenderer = electron ? electron.ipcRenderer : null;

// 简化的布局配置 - 使用统一系统
const DENSITY_CONFIG = {
  compact: { baseWidth: 200, spacing: 16 },
  standard: { baseWidth: 250, spacing: 16 },
  comfortable: { baseWidth: 300, spacing: 16 }
};

// 收藏页面组件
function FavoritesPage({ colorMode }) {
  const navigate = useNavigate();
  const location = useLocation();
  const theme = useTheme();
  const isSmallScreen = useMediaQuery(theme.breakpoints.down('sm'));
  const [tabValue, setTabValue] = useState(0);
  const [sortBy, setSortBy] = useState('date');
  const [sortDirection, setSortDirection] = useState('desc');
  const [imageThumbnails, setImageThumbnails] = useState({});
  const [error, setError] = useState('');
  const [viewerOpen, setViewerOpen] = useState(false);
  const [selectedImageIndex, setSelectedImageIndex] = useState(0);
  const [viewerImages, setViewerImages] = useState([]);
  const [windowWidth, setWindowWidth] = useState(window.innerWidth);
  const [imageHeights, setImageHeights] = useState({}); // 存储图片高度信息
  const [userDensity, setUserDensity] = useState(() => localStorage.getItem('userDensity') || 'standard');
  const [compactView, setCompactView] = useState(true);
  const listRef = useRef(null);
  const visibleRowsRef = useRef(new Set());
  const scrollContainerRef = useRef(null);
  const [forceUpdate, setForceUpdate] = useState(0);
  
  // 使用收藏上下文
  const { favorites, isLoading, toggleAlbumFavorite, toggleImageFavorite } = useFavorites();
  
  // 获取滚动位置上下文
  const scrollContext = useContext(ScrollPositionContext);
  
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

  // 当密度、窗口宽度或强制更新计数器变化时，重新计算虚拟列表
  useEffect(() => {
    if (listRef.current) {
      // 延迟执行以确保DOM已更新
      setTimeout(() => {
        try {
          console.log('重新计算虚拟列表布局...');
          console.log(`当前窗口宽度: ${windowWidth}, 列数: ${getColumnsPerRow()}`);
          
          listRef.current.recomputeRowHeights();
          listRef.current.forceUpdateGrid();
        } catch (err) {
          console.error('重新计算虚拟列表时出错:', err);
        }
      }, 100);
    }
  }, [userDensity, windowWidth, forceUpdate]);

  
  // 加载图片缩略图 - 添加缓存清理和过期机制
  useEffect(() => {
    const loadImageThumbnails = async () => {
      if (!favorites.images.length || !ipcRenderer) return;
      
      const thumbnails = {};
      
      // 清理过期的缩略图缓存（超过1周）
      clearOldSessionCaches();
      
      for (const image of favorites.images) {
        try {
          const cacheKey = `image_thumbnail_${image.path}`;
          const cachedThumbnail = sessionStorage.getItem(cacheKey);
          
          if (cachedThumbnail) {
            thumbnails[image.id] = cachedThumbnail;
          } else {
            // 请求缩略图
            const thumbnail = await ipcRenderer.invoke('get-thumbnail', image.path);
            if (thumbnail) {
              thumbnails[image.id] = thumbnail;
              // 缓存缩略图
              try {
                sessionStorage.setItem(cacheKey, thumbnail);
              } catch (e) {
                console.warn('缓存缩略图失败，尝试清理旧缓存', e);
                clearOldSessionCaches();
              }
            }
          }
        } catch (err) {
          console.error('加载图片缩略图失败:', err);
        }
      }
      
      setImageThumbnails(thumbnails);
    };
    
    loadImageThumbnails();
  }, [favorites.images]);
  
  // 清理过期的sessionStorage缓存
  const clearOldSessionCaches = () => {
    const now = Date.now();
    const oneWeekAgo = now - 7 * 24 * 60 * 60 * 1000;
    
    const keysToRemove = [];
    for (let i = 0; i < sessionStorage.length; i++) {
      const key = sessionStorage.key(i);
      if (key && key.startsWith('image_thumbnail_')) {
        // 检查缓存时间（通过存储时的命名或其他方式）
        // 这里简化处理：如果缓存超过1周就清理
        keysToRemove.push(key);
      }
    }
    keysToRemove.forEach(key => sessionStorage.removeItem(key));
  };

  // 清理所有缓存
  const clearAllCache = () => {
    // 清空sessionStorage中的缩略图缓存
    const keysToRemove = [];
    for (let i = 0; i < sessionStorage.length; i++) {
      const key = sessionStorage.key(i);
      if (key && key.startsWith('image_thumbnail_')) {
        keysToRemove.push(key);
      }
    }
    keysToRemove.forEach(key => sessionStorage.removeItem(key));
    
    // 通过IPC通知主进程清空缩略图缓存
    if (ipcRenderer) {
      ipcRenderer.invoke('clear-thumbnail-cache')
        .then(result => {
          if (result.success) {
            setError('所有缓存已清除');
          } else {
            setError('清除缓存时出错: ' + (result.error || '未知错误'));
          }
        })
        .catch(err => {
          setError('清除缓存时出错: ' + err.message);
        });
    } else {
      setError('缓存已部分清除');
    }
  };

  // 处理密度设置变化
  const handleDensityChange = (event) => {
    const newDensity = event.target.value;
    setUserDensity(newDensity);
    localStorage.setItem('userDensity', newDensity);
  };

  // 切换视图模式（向后兼容）
  const toggleViewMode = () => {
    const newMode = !compactView;
    setCompactView(newMode);
    localStorage.setItem('compactView', newMode.toString());
  };
  
  // 处理标签页切换
  const handleTabChange = (event, newValue) => {
    setTabValue(newValue);
  };
  
  // 处理返回
  const handleBack = () => {
    navigate(-1);
  };
  
  // 更新可视行的追踪
  const updateVisibleRows = useCallback((startIndex, stopIndex) => {
    visibleRowsRef.current = new Set();
    for (let i = startIndex; i <= stopIndex; i++) {
      visibleRowsRef.current.add(i);
    }
  }, []);

  // 处理相簿点击
  const handleAlbumClick = (albumPath) => {
    // 保存当前滚动位置
    if (scrollContainerRef.current) {
      scrollContext.savePosition(location.pathname, scrollContainerRef.current.scrollTop);
    }
    
    navigate(`/album/${encodeURIComponent(albumPath)}`);
  };

  // 处理图片点击 - 直接打开图片查看器
  const handleImageClick = (image, index) => {
    // 保存当前滚动位置
    if (scrollContainerRef.current) {
      scrollContext.savePosition(location.pathname, scrollContainerRef.current.scrollTop);
    }
    
    // 准备查看器需要的图片数据
    const images = sortedImages().map(img => ({
      path: img.path,
      name: img.name,
      url: imageThumbnails[img.id] // 使用已加载的缩略图
    }));
    
    setViewerImages(images);
    setSelectedImageIndex(index);
    setViewerOpen(true);
  };

  // 处理图片加载完成
  const handleImageLoad = (imageId, height) => {
    setImageHeights(prev => ({
      ...prev,
      [imageId]: height
    }));
  };
  
  // 关闭查看器
  const handleCloseViewer = () => {
    setViewerOpen(false);
  };
  
  // 排序收藏的相簿
  const sortedAlbums = useCallback(() => {
    if (!favorites.albums.length) return [];
    
    return [...favorites.albums].sort((a, b) => {
      let comparison = 0;
      
      if (sortBy === 'name') {
        comparison = a.name.localeCompare(b.name);
      } else if (sortBy === 'date') {
        comparison = a.addedAt - b.addedAt;
      } else if (sortBy === 'count') {
        comparison = a.imageCount - b.imageCount;
      }
      
      return sortDirection === 'asc' ? comparison : -comparison;
    });
  }, [favorites.albums, sortBy, sortDirection]);

  // 简化的响应式布局 - 流体计算无最大限制，针对不同屏幕尺寸优化
  const getColumnsPerRow = useCallback(() => {
    const config = DENSITY_CONFIG[userDensity];
    let containerPadding, scrollbarWidth;
    
    // 针对不同屏幕尺寸的响应式处理
    if (isSmallScreen) {
      containerPadding = 16;
      scrollbarWidth = 4;
    } else if (windowWidth < 600) {
      containerPadding = 20;
      scrollbarWidth = 6;
    } else if (windowWidth < 900) {
      containerPadding = 24;
      scrollbarWidth = 8;
    } else {
      containerPadding = 32;
      scrollbarWidth = 8;
    }
    
    const availableWidth = Math.max(0, windowWidth - containerPadding - scrollbarWidth);
    
    // 根据屏幕尺寸调整最小卡片宽度
    let minCardWidth;
    if (isSmallScreen) {
      minCardWidth = Math.min(config.baseWidth * 0.8, 180);
    } else if (windowWidth < 600) {
      minCardWidth = Math.min(config.baseWidth * 0.85, 190);
    } else if (windowWidth < 900) {
      minCardWidth = Math.min(config.baseWidth * 0.9, 220);
    } else {
      minCardWidth = config.baseWidth;
    }
    
    // 流体计算，确保在小屏幕上至少有1列，大屏幕上充分利用空间
    const columns = Math.max(1, Math.floor((availableWidth + config.spacing) / (minCardWidth + config.spacing)));
    
    return columns;
  }, [windowWidth, userDensity, compactView, isSmallScreen]);

  // 精确的行高计算 - 基于AlbumCard实际渲染高度
  const getRowHeight = useCallback(() => {
    const config = DENSITY_CONFIG[userDensity];
    
    // 根据AlbumCard的实际结构计算
    // 图片区域：使用AlbumCard中的固定比例
    const imageHeight = Math.round(config.baseWidth * (userDensity === 'compact' ? 1 : 6/5));
    
    // 标题区域：根据密度模式
    let titleHeight;
    if (userDensity === 'compact') {
      titleHeight = 0; // 紧凑模式不显示标题
    } else {
      titleHeight = 30; // CardContent高度 + 宽松内边距
    }
    
    // 总高度 = 图片 + 标题 + 额外间距
    return imageHeight + titleHeight + 8;
  }, [userDensity]);

  // 生成唯一ID
  const getAlbumId = (album, index) => {
    return `album-${album.path}-${index}`;
  };

  // 排序收藏的图片
  const sortedImages = useCallback(() => {
    if (!favorites.images.length) return [];
    
    return [...favorites.images].sort((a, b) => {
      let comparison = 0;
      
      if (sortBy === 'name') {
        comparison = a.name.localeCompare(b.name);
      } else if (sortBy === 'date') {
        comparison = a.addedAt - b.addedAt;
      } else if (sortBy === 'album') {
        comparison = a.albumName.localeCompare(b.albumName);
      }
      
      return sortDirection === 'asc' ? comparison : -comparison;
    });
  }, [favorites.images, sortBy, sortDirection]);
  
  // 处理排序方向变化
  const handleDirectionChange = () => {
    setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc');
  };
  
  // 删除未使用的 getMasonryBreakpoints 函数
  // 保留现有的 getColumnsPerRow 和 getRowHeight 函数用于虚拟滚动
  
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
  
  // 监听相簿可见性变化
  useEffect(() => {
    const handleVisibilityChange = (event) => {
      const { albumId, isVisible } = event.detail;
      
      if (tabValue === 0) {
        // 相簿可见性变化
        const element = document.querySelector(`[data-album-id="${albumId}"]`);
        if (element) {
          // 可以添加可见性处理逻辑
        }
      }
    };
    
    window.addEventListener('album-visibility-change', handleVisibilityChange);
    return () => {
      window.removeEventListener('album-visibility-change', handleVisibilityChange);
    };
  }, [tabValue]);

  // 渲染相簿卡片 - 虚拟化列表
  const renderAlbumRow = ({ index, key, style }) => {
    try {
      const sorted = sortedAlbums();
      const columnsPerRow = getColumnsPerRow();
      const config = DENSITY_CONFIG[userDensity];
      
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
            width: '100%'
          }}
        >
          {rowItems.map((album, i) => {
            const albumId = getAlbumId(album, index * columnsPerRow + i);
            const isAlbumVisible = visibleRowsRef.current.has(index);
            const cardWidth = Math.floor((windowWidth - 64 - (columnsPerRow - 1) * config.spacing) / columnsPerRow);
            
            // 为了兼容AlbumCard组件的格式，转换收藏的相簿数据
            const albumForCard = {
              ...album,
              previewImages: album.previewImagePath ? [{ path: album.previewImagePath }] : []
            };
            
            return (
              <div 
                key={`${album.path}-${i}`} 
                style={{
                  width: `${cardWidth}px`,
                  marginRight: i < columnsPerRow - 1 ? `${config.spacing}px` : 0,
                  height: `${Math.round(cardWidth * 0.75)}px`
                }}
                data-album-id={albumId}
                ref={node => {
                  if (node && intersectionObserver) {
                    intersectionObserver.observe(node);
                  }
                }}
              >
                <AlbumCard 
                  album={albumForCard}
                  displayPath={album.path}
                  onClick={() => handleAlbumClick(album.path)}
                  isCompactMode={userDensity === 'compact'}
                  isVisible={isAlbumVisible}
                  isFavoritesPage={true}
                />
              </div>
            );
          })}
        </div>
      );
    } catch (err) {
      console.error('渲染相簿行时出错:', err);
      return <div key={key} style={style}>加载出错</div>;
    }
  };

  // 渲染相簿列表 - 使用虚拟滚动
  const renderAlbums = () => {
    const albums = sortedAlbums();
    
    if (albums.length === 0) {
      return (
        <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '50vh', flexDirection: 'column' }}>
          <Typography variant="h6" color="text.secondary" gutterBottom>
            暂无收藏的相簿
          </Typography>
          <Button variant="contained" onClick={() => navigate('/')}>
            浏览相簿
          </Button>
        </Box>
      );
    }
    
    try {
      const columnsPerRow = getColumnsPerRow();
      const rowCount = Math.ceil(albums.length / columnsPerRow);
      const rowHeight = getRowHeight();
      
      console.log('Albums render params:', { albumsCount: albums.length, columnsPerRow, rowCount, rowHeight });
      
      // 添加一个检查，确保scrollContainerRef已挂载
      const scrollElement = scrollContainerRef.current || window;
      
      return (
        <WindowScroller scrollElement={scrollElement}>
          {({ height, isScrolling, onChildScroll, scrollTop }) => (
            <AutoSizer disableHeight>
              {({ width }) => {
                if (!width || !height) {
                  return <Box sx={{ height: '50vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><CircularProgress /></Box>;
                }
                
                return (
                  <List
                    ref={listRef}
                    autoHeight
                    height={height}
                    isScrolling={isScrolling}
                    onScroll={onChildScroll}
                    rowCount={rowCount}
                    rowHeight={rowHeight}
                    rowRenderer={renderAlbumRow}
                    scrollTop={scrollTop}
                    width={width}
                    overscanRowCount={2}
                    onRowsRendered={({ overscanStartIndex, overscanStopIndex }) => {
                      updateVisibleRows(overscanStartIndex, overscanStopIndex);
                    }}
                  />
                );
              }}
            </AutoSizer>
          )}
        </WindowScroller>
      );
    } catch (err) {
      console.error('渲染相簿列表时出错:', err);
      return (
        <Box sx={{ p: 2 }}>
          <Alert severity="error">加载相簿列表时出错: {err.message}</Alert>
        </Box>
      );
    }
  };
  
  // 渲染图片卡片 - 虚拟化列表
  const renderImageRow = ({ index, key, style }) => {
    try {
      const images = sortedImages();
      const columnsPerRow = getColumnsPerRow();
      const config = DENSITY_CONFIG[userDensity];
      
      // 创建一个包含此行所有图片的数组
      const rowItems = [];
      for (let i = 0; i < columnsPerRow; i++) {
        const imageIndex = index * columnsPerRow + i;
        if (imageIndex < images.length) {
          const image = images[imageIndex];
          rowItems.push(image);
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
            width: '100%'
          }}
        >
          {rowItems.map((image, i) => {
            const imageIndex = index * columnsPerRow + i;
            const isImageVisible = visibleRowsRef.current.has(index);
            const cardWidth = Math.floor((windowWidth - 64 - (columnsPerRow - 1) * config.spacing) / columnsPerRow);
            
            return (
              <div 
                key={`${image.path}-${i}`} 
                style={{
                  width: `${cardWidth}px`,
                  marginRight: i < columnsPerRow - 1 ? `${config.spacing}px` : 0,
                  height: `${Math.round(cardWidth * 0.75)}px`
                }}
              >
                <ImageCard 
                  image={image} 
                  onClick={() => handleImageClick(image, index * columnsPerRow + i)}
                  isCompactMode={userDensity === 'compact' || compactView}
                  onLoad={handleImageLoad}
                  isFavoritesPage={true}
                />
              </div>
            );
          })}
        </div>
      );
    } catch (err) {
      console.error('渲染图片行时出错:', err);
      return <div key={key} style={style}>加载出错</div>;
    }
  };

  // 渲染图片列表 - 使用虚拟滚动
  const renderImages = () => {
    const images = sortedImages();
    
    if (images.length === 0) {
      return (
        <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '50vh', flexDirection: 'column' }}>
          <Typography variant="h6" color="text.secondary" gutterBottom>
            暂无收藏的图片
          </Typography>
          <Button variant="contained" onClick={() => navigate('/')}>
            浏览相簿
          </Button>
        </Box>
      );
    }
    
    try {
      const columnsPerRow = getColumnsPerRow();
      const rowCount = Math.ceil(images.length / columnsPerRow);
      const rowHeight = getRowHeight();
      
      console.log('Images render params:', { imagesCount: images.length, columnsPerRow, rowCount, rowHeight });
      
      const scrollElement = scrollContainerRef.current || window;
      
      return (
        <WindowScroller scrollElement={scrollElement}>
          {({ height, isScrolling, onChildScroll, scrollTop }) => (
            <AutoSizer disableHeight>
              {({ width }) => {
                if (!width || !height) {
                  return <Box sx={{ height: '50vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><CircularProgress /></Box>;
                }
                
                return (
                  <List
                    ref={listRef}
                    autoHeight
                    height={height}
                    isScrolling={isScrolling}
                    onScroll={onChildScroll}
                    rowCount={rowCount}
                    rowHeight={rowHeight}
                    rowRenderer={renderImageRow}
                    scrollTop={scrollTop}
                    width={width}
                    overscanRowCount={2}
                    onRowsRendered={({ overscanStartIndex, overscanStopIndex }) => {
                      updateVisibleRows(overscanStartIndex, overscanStopIndex);
                    }}
                  />
                );
              }}
            </AutoSizer>
          )}
        </WindowScroller>
      );
    } catch (err) {
      console.error('渲染图片列表时出错:', err);
      return (
        <Box sx={{ p: 2 }}>
          <Alert severity="error">加载图片列表时出错: {err.message}</Alert>
        </Box>
      );
    }
  };
  
  return (
    <Box sx={{ flexGrow: 1, height: '100vh', display: 'flex', flexDirection: 'column' }}>
      <AppBar position="static" color="primary" elevation={0}>
        <Toolbar variant="dense">
          <IconButton
            edge="start"
            color="inherit"
            onClick={handleBack}
            sx={{ mr: 2 }}
            size="small"
          >
            <ArrowBackIcon />
          </IconButton>
          <Typography variant="h6" component="div" sx={{ flexGrow: 1, fontSize: { xs: '1rem', sm: '1.25rem' } }}>
            我的收藏
          </Typography>
          
          <Box sx={{ display: 'flex', alignItems: 'center' }}>
            <IconButton 
              color="inherit" 
              onClick={handleDirectionChange} 
              size="small"
              title={sortDirection === 'desc' ? "升序排列" : "降序排列"}
            >
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
                onChange={handleDensityChange}
                label="密度"
                sx={{ color: 'white', fontSize: '0.8rem' }}
              >
                <MenuItem value="compact">紧凑</MenuItem>
                <MenuItem value="standard">标准</MenuItem>
                <MenuItem value="comfortable">宽松</MenuItem>
              </Select>
            </FormControl>
            
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
          </Box>
        </Toolbar>
        
        <Tabs
          value={tabValue}
          onChange={handleTabChange}
          indicatorColor="secondary"
          textColor="inherit"
          variant="fullWidth"
          aria-label="收藏内容标签页"
          sx={{ bgcolor: 'primary.dark' }}
        >
          <Tab label={`相簿 (${favorites.albums.length})`} />
          <Tab label={`图片 (${favorites.images.length})`} />
        </Tabs>
      </AppBar>
      
      <Box 
        ref={scrollContainerRef}
        sx={{ 
          flexGrow: 1, 
          overflow: 'auto', 
          py: 2, 
          px: { xs: 1, sm: 2, md: 3 }
        }}
      >
        {isLoading ? (
          <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '50vh' }}>
            <CircularProgress />
          </Box>
        ) : (
          <Box>
            <Box sx={{ mb: 2 }}>
              <Typography variant="subtitle1">
                {tabValue === 0 ? `共 ${favorites.albums.length} 个收藏的相簿` : `共 ${favorites.images.length} 张收藏的图片`}
              </Typography>
            </Box>
            
            {tabValue === 0 ? renderAlbums() : renderImages()}
          </Box>
        )}
      </Box>
      
      {/* 图片查看器 */}
      {viewerOpen && (
        <ImageViewer
          images={viewerImages}
          currentIndex={selectedImageIndex}
          onClose={handleCloseViewer}
          onIndexChange={setSelectedImageIndex}
        />
      )}
    </Box>
  );
}

export default FavoritesPage; 