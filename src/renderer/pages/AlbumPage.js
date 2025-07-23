import React, { useState, useEffect, useCallback, useRef, useContext } from 'react';
import { useParams, useNavigate, useLocation } from 'react-router-dom';
import {
  Box,
  AppBar,
  Toolbar,
  Typography,
  IconButton,
  Button,
  Grid,
  Container,
  CircularProgress,
  Snackbar,
  Alert,
  Paper,
  Tooltip,
  FormControl,
  Select,
  MenuItem,
  InputLabel,
  useMediaQuery,
  useTheme,
  Badge
} from '@mui/material';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import HomeIcon from '@mui/icons-material/Home';
import SortIcon from '@mui/icons-material/Sort';
import RefreshIcon from '@mui/icons-material/Refresh';
import Brightness4Icon from '@mui/icons-material/Brightness4';
import Brightness7Icon from '@mui/icons-material/Brightness7';
import FavoriteBorderIcon from '@mui/icons-material/FavoriteBorder';
import FavoriteIcon from '@mui/icons-material/Favorite';
import CasinoIcon from '@mui/icons-material/Casino';
import TuneIcon from '@mui/icons-material/Tune';
import OpenInNewIcon from '@mui/icons-material/OpenInNew';
import ChevronLeftIcon from '@mui/icons-material/ChevronLeft';
import ChevronRightIcon from '@mui/icons-material/ChevronRight';
import ImageViewer from '../components/ImageViewer';
import Masonry from 'react-masonry-css';
import './AlbumPage.css'; // 我们将添加这个CSS文件
import { ScrollPositionContext } from '../App';
import { useFavorites } from '../contexts/FavoritesContext';

// 安全地获取electron对象
const electron = window.require ? window.require('electron') : null;
const ipcRenderer = electron ? electron.ipcRenderer : null;

// 优化的布局配置 - 根据密度调整基础宽度和间距
const DENSITY_CONFIG = {
  compact: { baseWidth: 180, spacing: 8 },   // 紧凑模式更小间距
  standard: { baseWidth: 220, spacing: 10 }, // 标准模式适中间距
  comfortable: { baseWidth: 280, spacing: 12 } // 宽松模式较大间距
};

function AlbumPage({ colorMode }) {
  const { albumPath } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const theme = useTheme();
  const [images, setImages] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [sortBy, setSortBy] = useState('name');
  const [sortDirection, setSortDirection] = useState('asc');
  const [viewerOpen, setViewerOpen] = useState(false);
  const [selectedImageIndex, setSelectedImageIndex] = useState(0);
  const [userDensity, setUserDensity] = useState('standard'); // 'standard' | 'comfortable'
  const [windowWidth, setWindowWidth] = useState(window.innerWidth);
  const [imageHeights, setImageHeights] = useState({}); // 存储图片高度信息
  const [neighboringAlbums, setNeighboringAlbums] = useState({
    prev: null,
    next: null,
    currentIndex: -1,
    total: 0
  });
  const isSmallScreen = useMediaQuery(theme.breakpoints.down('sm'));
  const scrollContainerRef = useRef(null);
  const initialImagePath = useRef(null); // 存储初始要显示的图片路径


  // 获取滚动位置上下文
  const scrollContext = useContext(ScrollPositionContext);

  // 解码路径
  const decodedAlbumPath = decodeURIComponent(albumPath);

  // 获取收藏上下文
  const { favorites, isAlbumFavorited, toggleAlbumFavorite } = useFavorites();

  // 从URL参数中获取初始图片路径
  useEffect(() => {
    const searchParams = new URLSearchParams(location.search);
    const imagePath = searchParams.get('image');
    if (imagePath) {
      initialImagePath.current = decodeURIComponent(imagePath);
    } else {
      initialImagePath.current = null;
    }
  }, [location.search]);

  // 加载相簿图片和相邻相簿信息
  useEffect(() => {
    loadAlbumImages();
    loadNeighboringAlbums();
  }, [decodedAlbumPath]);

  // 监听窗口大小变化
  useEffect(() => {
    const handleResize = () => {
      setWindowWidth(window.innerWidth);
    };

    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  // 从localStorage中读取密度设置
  useEffect(() => {
    const savedDensity = localStorage.getItem('userDensity');
    if (savedDensity) {
      setUserDensity(savedDensity);
    }
  }, []);

  // 当密度设置变化时，强制重新计算布局
  useEffect(() => {
    if (images.length > 0) {
      // 强制触发重新渲染
      const event = new Event('resize');
      window.dispatchEvent(event);
    }
  }, [userDensity, images.length, windowWidth]);

  // 添加键盘事件监听
  useEffect(() => {
    const handleKeyDown = (event) => {
      // 如果按下ESC键且没有打开查看器
      if (event.key === 'Escape' && !viewerOpen) {
        handleBack();
      }

      // 按下 r 键触发随机选择相簿
      if (event.key === 'r' && !event.ctrlKey && !event.altKey && !event.metaKey) {
        // 确保不在输入框中，且没有打开查看器
        if (document.activeElement.tagName !== 'INPUT' &&
            document.activeElement.tagName !== 'TEXTAREA' &&
            !document.activeElement.isContentEditable &&
            !viewerOpen) {
          handleRandomAlbum();
        }
      }

      // 按下 h 键返回首页
      if (event.key === 'h' && !event.ctrlKey && !event.altKey && !event.metaKey) {
        // 确保不在输入框中，且没有打开查看器
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
          handleNavigateToAdjacentAlbum('prev');
        }
      }

      // Ctrl+右箭头键 - 跳转到最后一个相簿
      if (event.key === 'ArrowRight' && event.ctrlKey && !event.altKey && !event.metaKey) {
        if (!viewerOpen && neighboringAlbums.currentIndex < neighboringAlbums.total - 1) {
          handleNavigateToAdjacentAlbum('next');
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [viewerOpen, neighboringAlbums]);

  // 加载相簿图片
  const loadAlbumImages = async () => {
    try {
      if (!ipcRenderer) {
        setError('无法访问ipcRenderer, Electron可能没有正确加载');
        return;
      }

      setLoading(true);
      setError('');

      // 检查是否有缓存
      const cacheKey = `album_images_${decodedAlbumPath}`;
      const cachedData = sessionStorage.getItem(cacheKey);

      if (cachedData) {
        setImages(JSON.parse(cachedData));
        setLoading(false);
        return;
      }

      const result = await ipcRenderer.invoke('get-album-images', decodedAlbumPath);

      // 缓存结果到sessionStorage（会话级别）
      try {
        sessionStorage.setItem(cacheKey, JSON.stringify(result));
      } catch (e) {
        console.warn('缓存存储失败', e);
      }

      setImages(result);

      // 如果有初始图片路径，找到对应的索引并打开查看器
      if (initialImagePath.current) {
        const imageIndex = result.findIndex(img => img.path === initialImagePath.current);
        if (imageIndex !== -1) {
          // 使用setTimeout确保在渲染完成后打开查看器
          setTimeout(() => {
            setSelectedImageIndex(imageIndex);
            setViewerOpen(true);
            // 清除初始图片路径，避免重复打开
            initialImagePath.current = null;
          }, 100);
        }
      }

      setLoading(false);
    } catch (err) {
      setError('加载相簿图片时出错: ' + err.message);
      setLoading(false);
    }
  };

  // 加载相邻相簿信息
  const loadNeighboringAlbums = async () => {
    try {
      if (!ipcRenderer) return;

      // 获取根路径 - 使用与随机选择相簿相同的逻辑
      const getWindowStorageKey = () => {
        const searchParams = new URLSearchParams(window.location.search);
        const initialPath = searchParams.get('initialPath');
        if (initialPath) {
          try {
            const pathHash = btoa(decodeURIComponent(initialPath)).replace(/[+/=]/g, '');
            return `lastRootPath_${pathHash}`;
          } catch (e) {
            let hash = 0;
            const str = decodeURIComponent(initialPath);
            for (let i = 0; i < str.length; i++) {
              const char = str.charCodeAt(i);
              hash = ((hash << 5) - hash) + char;
              hash = hash & hash;
            }
            return `lastRootPath_${Math.abs(hash)}`;
          }
        } else {
          return 'lastRootPath_default';
        }
      };
      
      const windowStorageKey = getWindowStorageKey();
      const rootPath = localStorage.getItem(windowStorageKey);
      if (!rootPath) return;

      // 获取相簿列表
      let albums = [];
      const cacheKey = `albums_cache_${rootPath}`;
      const cachedData = localStorage.getItem(cacheKey);
      
      if (cachedData) {
        albums = JSON.parse(cachedData);
      } else {
        albums = await ipcRenderer.invoke('scan-directory', rootPath);
      }

      if (albums.length === 0) return;

      // 使用与HomePage相同的排序逻辑
      const sortedAlbums = [...albums].sort((a, b) => {
        let comparison = 0;
        // 获取当前排序设置
        const savedSortBy = localStorage.getItem('sortBy') || 'name';
        const savedSortDirection = localStorage.getItem('sortDirection') || 'asc';
        
        if (savedSortBy === 'name') {
          comparison = a.name.localeCompare(b.name);
        } else if (savedSortBy === 'imageCount') {
          comparison = a.imageCount - b.imageCount;
        } else if (savedSortBy === 'lastModified') {
          const aDate = a.previewImages[0]?.lastModified || 0;
          const bDate = b.previewImages[0]?.lastModified || 0;
          comparison = new Date(aDate) - new Date(bDate);
        }
        
        return savedSortDirection === 'asc' ? comparison : -comparison;
      });

      // 找到当前相簿索引
      const currentIndex = sortedAlbums.findIndex(album => album.path === decodedAlbumPath);
      
      if (currentIndex !== -1) {
        setNeighboringAlbums({
          prev: currentIndex > 0 ? sortedAlbums[currentIndex - 1] : null,
          next: currentIndex < sortedAlbums.length - 1 ? sortedAlbums[currentIndex + 1] : null,
          currentIndex,
          total: sortedAlbums.length
        });
      }
    } catch (err) {
      console.error('加载相邻相簿信息失败:', err);
    }
  };

  // 处理返回
  const handleBack = () => {
    // 保存当前路径到上下文
    if (scrollContainerRef.current) {
      scrollContext.savePosition('/album/' + albumPath, scrollContainerRef.current.scrollTop);
    }

    navigate(-1);
  };

  // 处理返回首页
  const handleHome = () => {
    // 保存当前路径到上下文
    if (scrollContainerRef.current) {
      scrollContext.savePosition('/album/' + albumPath, scrollContainerRef.current.scrollTop);
    }

    navigate('/');
  };

  // 处理刷新
  const handleRefresh = () => {
    // 清除缓存
    const cacheKey = `album_images_${decodedAlbumPath}`;
    sessionStorage.removeItem(cacheKey);

    loadAlbumImages();
  };

  // 处理排序方式变化
  const handleSortChange = (event) => {
    setSortBy(event.target.value);
  };

  // 处理排序方向变化
  const handleDirectionChange = () => {
    setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc');
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

  // 自然排序函数 - 正确处理数字排序
  const naturalSort = (a, b) => {
    const ax = [], bx = [];
    
    a.replace(/(\d+)|(\D+)/g, (_, $1, $2) => { ax.push([$1 || Infinity, $2 || ""]) });
    b.replace(/(\d+)|(\D+)/g, (_, $1, $2) => { bx.push([$1 || Infinity, $2 || ""]) });
    
    while (ax.length && bx.length) {
      const an = ax.shift();
      const bn = bx.shift();
      const nn = (an[0] - bn[0]) || an[1].localeCompare(bn[1]);
      if (nn) return nn;
    }
    
    return ax.length - bx.length;
  };

  // 排序图片
  const sortedImages = () => {
    if (!images.length) return [];

    return [...images].sort((a, b) => {
      let comparison = 0;

      if (sortBy === 'name') {
        comparison = naturalSort(a.name, b.name);
      } else if (sortBy === 'size') {
        comparison = a.size - b.size;
      } else if (sortBy === 'lastModified') {
        comparison = new Date(a.lastModified) - new Date(b.lastModified);
      }

      return sortDirection === 'asc' ? comparison : -comparison;
    });
  };

  // 处理图片点击
  const handleImageClick = (index) => {
    setSelectedImageIndex(index);
    setViewerOpen(true);
  };

  // 关闭查看器
  const handleCloseViewer = () => {
    setViewerOpen(false);
  };

  // 优化的响应式瀑布流布局 - 更精确的空间计算
  const getMasonryBreakpoints = useCallback(() => {
    const config = DENSITY_CONFIG[userDensity];
    const containerPadding = isSmallScreen ? 8 : 12; // 进一步减少内边距
    const scrollbarWidth = 2; // 最小化滚动条估算
    const availableWidth = Math.max(0, windowWidth - containerPadding * 2 - scrollbarWidth);
    
    // 更精确的空间计算，确保充分利用可用宽度
    const columnWidth = config.baseWidth + config.spacing;
    const columns = Math.max(1, Math.floor((availableWidth + config.spacing) / columnWidth));
    
    return columns;
  }, [windowWidth, isSmallScreen, userDensity]);

  // 获取相簿名称
  const getAlbumName = () => {
    if (!decodedAlbumPath) return '';
    const parts = decodedAlbumPath.split('/');
    return parts[parts.length - 1];
  };

  // 记录图片加载完成后的高度
  const handleImageLoad = (imagePath, height) => {
    setImageHeights(prev => ({
      ...prev,
      [imagePath]: height
    }));
  };


  // 处理导航到收藏页面
  const handleNavigateToFavorites = () => {
    // 保存当前滚动位置
    if (scrollContainerRef.current) {
      scrollContext.savePosition(location.pathname, scrollContainerRef.current.scrollTop);
    }

    navigate('/favorites');
  };

  // 处理相簿收藏切换
  const handleToggleAlbumFavorite = async () => {
    const album = {
      name: getAlbumName(),
      path: decodedAlbumPath,
      imageCount: images.length,
      previewImages: images.slice(0, 4) // 取前4张图片作为预览
    };
    
    await toggleAlbumFavorite(album);
  };


  // 处理导航到相邻相簿
  const handleNavigateToAdjacentAlbum = (direction) => {
    const targetAlbum = direction === 'prev' ? neighboringAlbums.prev : neighboringAlbums.next;
    if (targetAlbum) {
      // 保存当前滚动位置
      if (scrollContainerRef.current) {
        scrollContext.savePosition(location.pathname, scrollContainerRef.current.scrollTop);
      }
      
      // 导航到相邻相簿
      navigate(`/album/${encodeURIComponent(targetAlbum.path)}`);
    }
  };

  // 处理随机选择相簿
  const handleRandomAlbum = async () => {
    try {
      if (!ipcRenderer) {
        setError('无法访问ipcRenderer, Electron可能没有正确加载');
        return;
      }

      // 获取根路径 - 使用与HomePage相同的逻辑
      const getWindowStorageKey = () => {
        const searchParams = new URLSearchParams(window.location.search);
        const initialPath = searchParams.get('initialPath');
        if (initialPath) {
          try {
            const pathHash = btoa(decodeURIComponent(initialPath)).replace(/[+/=]/g, '');
            return `lastRootPath_${pathHash}`;
          } catch (e) {
            let hash = 0;
            const str = decodeURIComponent(initialPath);
            for (let i = 0; i < str.length; i++) {
              const char = str.charCodeAt(i);
              hash = ((hash << 5) - hash) + char;
              hash = hash & hash;
            }
            return `lastRootPath_${Math.abs(hash)}`;
          }
        } else {
          return 'lastRootPath_default';
        }
      };
      
      const windowStorageKey = getWindowStorageKey();
      const rootPath = localStorage.getItem(windowStorageKey);
      if (!rootPath) {
        setError('没有设置根路径，无法随机选择相簿');
        return;
      }

      // 检查是否有缓存的相簿列表
      const cacheKey = `albums_cache_${rootPath}`;
      let albums = [];

      const cachedData = localStorage.getItem(cacheKey);
      if (cachedData) {
        albums = JSON.parse(cachedData);
      } else {
        // 如果没有缓存，重新扫描目录
        albums = await ipcRenderer.invoke('scan-directory', rootPath);
      }

      if (albums.length > 0) {
        // 随机选择一个相簿，但避免选到当前相簿
        let randomAlbum;
        let randomIndex;
        let attempts = 0;
        const maxAttempts = 10; // 防止无限循环

        do {
          randomIndex = Math.floor(Math.random() * albums.length);
          randomAlbum = albums[randomIndex];
          attempts++;
        } while (randomAlbum.path === decodedAlbumPath && albums.length > 1 && attempts < maxAttempts);

        // 保存当前滚动位置
        if (scrollContainerRef.current) {
          scrollContext.savePosition(location.pathname, scrollContainerRef.current.scrollTop);
        }

        // 导航到随机选择的相簿
        navigate(`/album/${encodeURIComponent(randomAlbum.path)}`);
      } else {
        setError('没有可用的相簿进行随机选择');
      }
    } catch (err) {
      setError('随机选择相簿时出错: ' + err.message);
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
            sx={{ mr: 1 }}
            size="small"
          >
            <ArrowBackIcon />
          </IconButton>
          <IconButton
            color="inherit"
            onClick={handleHome}
            sx={{ mr: 2 }}
            size="small"
          >
            <HomeIcon />
          </IconButton>
          <Typography variant="h6" component="div" sx={{ flexGrow: 1, fontSize: { xs: '0.9rem', sm: '1.25rem' }, textOverflow: 'ellipsis', overflow: 'hidden', whiteSpace: 'nowrap' }}>
            {getAlbumName()}
          </Typography>

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
                <MenuItem value="size">大小</MenuItem>
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

            {/* 相邻相簿导航按钮 */}
            <Tooltip title={neighboringAlbums.prev ? `上一个相簿: ${neighboringAlbums.prev.name}` : "已是第一个相簿"}>
              <span>
                <IconButton
                  color="inherit"
                  onClick={() => handleNavigateToAdjacentAlbum('prev')}
                  disabled={!neighboringAlbums.prev}
                  size="small"
                  sx={{ mx: 0.5 }}
                >
                  <ChevronLeftIcon sx={{ fontSize: '1.2rem' }} />
                </IconButton>
              </span>
            </Tooltip>

            {neighboringAlbums.total > 0 && (
              <Typography variant="caption" sx={{ mx: 0.5, color: 'white', fontSize: '0.75rem' }}>
                {neighboringAlbums.currentIndex + 1}/{neighboringAlbums.total}
              </Typography>
            )}

            <Tooltip title={neighboringAlbums.next ? `下一个相簿: ${neighboringAlbums.next.name}` : "已是最后一个相簿"}>
              <span>
                <IconButton
                  color="inherit"
                  onClick={() => handleNavigateToAdjacentAlbum('next')}
                  disabled={!neighboringAlbums.next}
                  size="small"
                  sx={{ mx: 0.5 }}
                >
                  <ChevronRightIcon sx={{ fontSize: '1.2rem' }} />
                </IconButton>
              </span>
            </Tooltip>

            {/* 添加随机选择相簿按钮 */}
            <Tooltip title="随机选择相簿 (R)">
              <IconButton
                color="inherit"
                onClick={handleRandomAlbum}
                size="small"
                sx={{ mx: 0.5 }}
              >
                <CasinoIcon sx={{ fontSize: '1.2rem' }} />
              </IconButton>
            </Tooltip>

            {/* 相簿收藏按钮 */}
            <Tooltip title={isAlbumFavorited(decodedAlbumPath) ? "取消收藏相簿" : "收藏相簿"}>
              <IconButton
                color="inherit"
                onClick={handleToggleAlbumFavorite}
                size="small"
                sx={{ mx: 0.5 }}
              >
                {isAlbumFavorited(decodedAlbumPath) ? 
                  <FavoriteIcon sx={{ fontSize: '1.2rem', color: '#ff5252' }} /> : 
                  <FavoriteBorderIcon sx={{ fontSize: '1.2rem' }} />
                }
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
              disabled={loading}
              size="small"
            >
              <RefreshIcon sx={{ fontSize: '1.2rem' }} />
            </IconButton>
          </Box>
        </Toolbar>
      </AppBar>

      <Box
        ref={scrollContainerRef}
        sx={{ flexGrow: 1, overflow: 'auto', py: 2, px: { xs: 1, sm: 2, md: 3 } }}
        className="scroll-container"
      >
        {loading ? (
          <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '50vh' }}>
            <CircularProgress />
          </Box>
        ) : (
          <>
            <Box sx={{ mb: 1 }}>
              <Typography variant="subtitle2" sx={{ fontSize: '0.8rem' }}>
                相簿路径: {decodedAlbumPath}
              </Typography>
              <Typography variant="caption" color="text.secondary">
                共 {images.length} 张照片 | {userDensity === 'compact' ? '紧凑密度' : userDensity === 'standard' ? '标准密度' : '宽松密度'}
              </Typography>
            </Box>

            {images.length > 0 ? (
              <Box sx={{ minHeight: 'calc(100vh - 120px)' }}>
                <Masonry
                  key={`masonry-${userDensity}-${windowWidth}`} // 强制重新渲染
                  breakpointCols={getMasonryBreakpoints()}
                  className="masonry-grid"
                  columnClassName="masonry-grid_column"
                >
                  {sortedImages().map((image, index) => (
                    <div
                      key={`${image.path}-${index}`}
                      className="masonry-item"
                      style={{ marginBottom: `${DENSITY_CONFIG[userDensity].spacing}px` }}
                    >
                      <ImageCard
                        image={image}
                        onClick={() => handleImageClick(index)}
                        density={userDensity}
                        onLoad={handleImageLoad}
                      />
                    </div>
                  ))}
                </Masonry>
              </Box>
            ) : (
              <Box sx={{ textAlign: 'center', mt: 8 }}>
                <Typography variant="h6" color="text.secondary">
                  未找到图片
                </Typography>
                <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
                  此相簿中没有支持的图片文件
                </Typography>
              </Box>
            )}
          </>
        )}
      </Box>

      {/* 图片查看器 */}
      {viewerOpen && (
        <ImageViewer
          images={sortedImages()}
          currentIndex={selectedImageIndex}
          onClose={handleCloseViewer}
          onIndexChange={setSelectedImageIndex}
        />
      )}

      <Snackbar open={!!error} autoHideDuration={6000} onClose={() => setError('')}>
        <Alert onClose={() => setError('')} severity="error" sx={{ width: '100%' }}>
          {error}
        </Alert>
      </Snackbar>

    </Box>
  );
}

// 图片卡片组件
function ImageCard({ image, onClick, density, onLoad }) {
  const [imageUrl, setImageUrl] = useState('');
  const [loading, setLoading] = useState(true);
  const [aspectRatio, setAspectRatio] = useState(1); // 默认为1:1
  const [imageLoaded, setImageLoaded] = useState(false);
  const [imageError, setImageError] = useState(false);
  const [retryCount, setRetryCount] = useState(0);
  const maxRetries = 2; // 最大重试次数

  // 使用收藏上下文
  const { isImageFavorited, toggleImageFavorite } = useFavorites();
  const { albumPath } = useParams();
  const decodedAlbumPath = decodeURIComponent(albumPath);
  const isFavorited = image ? isImageFavorited(image.path) : false;

  // 安全地获取electron对象
  const electron = window.require ? window.require('electron') : null;
  const ipcRenderer = electron ? electron.ipcRenderer : null;

  useEffect(() => {
    const loadImage = async () => {
      if (!image || !ipcRenderer) return;

      try {
        setLoading(true);
        setImageLoaded(false);
        setImageError(false);

        // 检查会话缓存中是否有图片URL
        const cacheKey = `image_thumbnail_${image.path}`;
        const cachedUrl = sessionStorage.getItem(cacheKey);

        if (cachedUrl) {
          setImageUrl(cachedUrl);
          setLoading(false);
          return;
        }

        // 设置优先级 - 根据文件名排序，常见的首图文件名排在前面
        const filename = image.name.toLowerCase();
        const isPriority =
          filename.includes('cover') ||
          filename.includes('folder') ||
          filename.startsWith('0') ||
          filename.startsWith('1') ||
          filename.startsWith('a') ||
          filename.startsWith('front') ||
          filename.startsWith('main');

        // 获取缩略图 - 使用主进程中配置的分辨率
        const url = await ipcRenderer.invoke('get-image-thumbnail', image.path, isPriority ? 0 : 1);

        if (!url) {
          console.error(`无法获取缩略图: ${image.path}`);
          setImageError(true);
          setLoading(false);
          return;
        }

        // 缓存到会话存储
        try {
          sessionStorage.setItem(cacheKey, url);
        } catch (e) {
          console.warn('缓存缩略图失败', e);
        }

        setImageUrl(url);
      } catch (err) {
        console.error('加载图片出错:', err);
        setImageError(true);
      } finally {
        setLoading(false);
      }
    };

    loadImage();
  }, [image, density, retryCount]);

  // 格式化文件大小
  const formatFileSize = (bytes) => {
    if (bytes < 1024) return bytes + ' B';
    else if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    else return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
  };

  // 处理图片加载完成
  const handleImageLoaded = (e) => {
    const { naturalWidth, naturalHeight } = e.target;
    const ratio = naturalHeight / naturalWidth;
    setAspectRatio(ratio);
    setImageLoaded(true);

    if (onLoad) {
      onLoad(image.path, e.target.height);
    }
  };

  // 处理图片加载错误
  const handleImageError = (e) => {
    console.error(`图片加载失败: ${image.path}`);

    // 尝试重试加载
    if (retryCount < maxRetries) {
      console.log(`重试加载图片(${retryCount + 1}/${maxRetries}): ${image.path}`);
      // 清除缓存
      const cacheKey = `image_thumbnail_${image.path}`;
      sessionStorage.removeItem(cacheKey);
      // 增加重试计数并触发重新加载
      setRetryCount(prev => prev + 1);
    } else {
      // 重试次数用尽，显示错误状态
      setImageError(true);
      e.target.onerror = null;
      e.target.style.display = 'none';
      e.target.parentNode.style.backgroundColor = 'rgba(0,0,0,0.05)';
    }
  };

  // 点击处理
  const handleClick = (e) => {
    // 即使缩略图加载失败，也允许点击查看原图
    onClick(e);
  };

  // 处理收藏点击
  const handleFavoriteClick = (e) => {
    e.stopPropagation(); // 阻止事件冒泡，避免触发卡片点击
    if (image) {
      // 获取相簿名称
      const albumName = decodedAlbumPath.split('/').pop();
      toggleImageFavorite(image, decodedAlbumPath, albumName);
    }
  };

  return (
    <Paper
      sx={{
        width: '100%',
        display: 'flex',
        flexDirection: 'column',
        cursor: 'pointer',
        transition: 'all 0.2s ease-in-out',
        '&:hover': {
          transform: 'translateY(-4px)',
          boxShadow: '0 6px 12px rgba(0,0,0,0.15)'
        },
        overflow: 'hidden',
        borderRadius: 1,
        marginBottom: 0 // 移除底部边距，由masonry-item控制
      }}
      onClick={handleClick}
      elevation={1}
    >
      <Box sx={{ position: 'relative', width: '100%' }}>
        {loading ? (
          <Box sx={{
            paddingTop: aspectRatio > 1.5 ? '133%' : aspectRatio > 0.8 ? '100%' : '75%', // 根据比例调整
            bgcolor: 'rgba(0,0,0,0.05)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            position: 'relative',
            width: '100%'
          }}>
            <CircularProgress
              size={24}
              sx={{
                position: 'absolute',
                top: '50%',
                left: '50%',
                marginTop: '-12px',
                marginLeft: '-12px'
              }}
            />
          </Box>
        ) : imageError ? (
          <Box sx={{
            paddingTop: '75%',
            bgcolor: 'rgba(0,0,0,0.05)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            position: 'relative',
            width: '100%'
          }}>
            <Typography variant="caption" color="text.secondary" sx={{ position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%, -50%)' }}>
              加载失败
            </Typography>
          </Box>
        ) : (
          <div style={{ width: '100%', overflow: 'hidden' }}>
            <img
              src={imageUrl}
              alt={image.name}
              className={imageLoaded ? 'loaded' : ''}
              style={{
                width: '100%',
                display: 'block',
                height: 'auto', // 允许高度自适应
                borderRadius: density === 'compact' ? '2px' : density === 'standard' ? '4px' : '6px'
              }}
              loading="lazy"
              onLoad={handleImageLoaded}
              onError={handleImageError}
            />
          </div>
        )}
      </Box>

      {density !== 'compact' && (
        <Box sx={{ p: 1, flexGrow: 0, bgcolor: 'background.paper' }}>
          <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
            <Box sx={{ flexGrow: 1, overflow: 'hidden' }}>
              <Typography
                variant="subtitle2"
                component="div"
                noWrap
                title={image.name}
                sx={{ fontSize: '0.8rem' }}
              >
                {image.name}
              </Typography>

              <Typography
                variant="caption"
                color="text.secondary"
                sx={{ display: 'block', fontSize: '0.7rem' }}
              >
                {formatFileSize(image.size)}
              </Typography>
            </Box>

            <IconButton
              size="small"
              sx={{
                ml: 0.5,
                p: 0.5,
                color: isFavorited ? 'error.main' : 'primary.main',
                '&:hover': {
                  color: 'error.main'
                }
              }}
              onClick={handleFavoriteClick}
              aria-label={isFavorited ? "取消收藏" : "添加收藏"}
            >
              {isFavorited ? <FavoriteIcon fontSize="small" /> : <FavoriteBorderIcon fontSize="small" />}
            </IconButton>
          </Box>
        </Box>
      )}
    </Paper>
  );
}

export default AlbumPage;