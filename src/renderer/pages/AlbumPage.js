import React, { useState, useEffect, useCallback, useRef, useContext, useMemo } from 'react';
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
import BreadcrumbNavigation from '../components/BreadcrumbNavigation';
import Masonry from 'react-masonry-css';
import './AlbumPage.css'; // 我们将添加这个CSS文件
import { ScrollPositionContext } from '../App';
import { useFavorites } from '../contexts/FavoritesContext';
import imageCache from '../utils/ImageCacheManager';
import { getBreadcrumbPaths, getBasename, getDirname, isValidPath } from '../utils/pathUtils';
import CHANNELS from '../../common/ipc-channels';

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
  const [userDensity, setUserDensity] = useState(() => {
  const savedDensity = localStorage.getItem('userDensity');
  return (savedDensity && DENSITY_CONFIG[savedDensity]) ? savedDensity : 'standard';
});
  const [windowWidth, setWindowWidth] = useState(window.innerWidth);
  const [imageHeights, setImageHeights] = useState({}); // 存储图片高度信息
  const [neighboringAlbums, setNeighboringAlbums] = useState({
    prev: null,
    next: null,
    currentIndex: -1,
    total: 0
  });
  const [rootPath, setRootPath] = useState('');
  const [breadcrumbs, setBreadcrumbs] = useState([]); // 面包屑导航数据
  const [metadata, setMetadata] = useState(null); // 当前层级的元数据
  const isSmallScreen = useMediaQuery(theme.breakpoints.down('sm'));
  const scrollContainerRef = useRef(null);
  const initialImagePath = useRef(null); // 存储初始要显示的图片路径
  const [isNavigating, setIsNavigating] = useState(false); // 导航锁，防止重复操作


  // 获取滚动位置上下文
  const scrollContext = useContext(ScrollPositionContext);

  // 解码路径 - 统一的路径解析逻辑
  const decodedAlbumPath = useMemo(() => {
    // 优先使用state中的路径（最可靠）
    if (location.state?.albumPath) {
      return location.state.albumPath;
    }
    // 回退到URL参数 - 使用安全的路径解码
    if (albumPath) {
      try {
        // 先尝试标准的decodeURIComponent
        return decodeURIComponent(albumPath);
      } catch (e) {
        // 如果失败，尝试手动解码%2F为/
        const manualDecoded = albumPath.replace(/%2F/g, '/');
        if (manualDecoded !== albumPath) {
          return manualDecoded;
        }
        console.error('路径解码失败:', albumPath, e);
        return '';
      }
    }
    return '';
  }, [albumPath, location.state]);

  // 检测路径类型（文件夹 vs 相簿）
  const detectPathType = useCallback(async (path) => {
    if (!path || !ipcRenderer) return 'unknown';

    try {
      // 扫描路径获取基本信息
      const scanResult = await ipcRenderer.invoke('scan-directory', path);

      if (!scanResult || !scanResult.nodes) {
        return 'unknown';
      }

      // 检查是否是纯相簿（只有图片，没有子文件夹）
      const hasImages = scanResult.nodes.some(node => node.type === 'album');
      const hasFolders = scanResult.nodes.some(node => node.type === 'folder');

      if (hasImages && !hasFolders) {
        return 'album';
      } else if (hasFolders || (!hasImages && !hasFolders)) {
        return 'folder';
      } else {
        return 'mixed';
      }
    } catch (error) {
      console.error('路径类型检测失败:', error);

      // Fallback: 使用启发式规则判断
      // 如果路径包含常见的关键图片扩展名，可能是相簿
      const imageExtensions = ['.jpg', '.jpeg', '.png', '.gif', '.bmp', '.webp', '.tiff'];
      const hasImageKeywords = imageExtensions.some(ext => path.toLowerCase().includes(ext));

      // 如果路径名包含"相簿"、"album"、"photos"等关键词，可能是相簿
      const albumKeywords = ['相簿', 'album', 'photos', 'pictures', 'images'];
      const hasAlbumKeywords = albumKeywords.some(keyword =>
        path.toLowerCase().includes(keyword)
      );

      if (hasImageKeywords && hasAlbumKeywords) {
        return 'album';
      } else {
        return 'folder'; // 默认当作文件夹处理，更安全
      }
    }
  }, [ipcRenderer]);

  // 获取路径的实际图片数量
  const getPathImageCount = useCallback(async (path) => {
    if (!path || !ipcRenderer) return 0;

    try {
      // 获取该路径下的实际图片列表
      const images = await ipcRenderer.invoke('get-album-images', path);
      return images ? images.length : 0;
    } catch (error) {
      console.error('获取路径图片数量失败:', error);
      return 0;
    }
  }, [ipcRenderer]);

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

  // 加载相簿图片、相邻相簿信息和面包屑数据
  useEffect(() => {
    loadAlbumImages();
    loadNeighboringAlbums();
    loadBreadcrumbData();
    loadRootPath();
    preloadParentDirectory(); // 新增：预加载父目录
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
      // 如果按下ESC或Backspace键且没有打开查看器
      if ((event.key === 'Escape' || event.key === 'Backspace') && !viewerOpen) {
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

      // 使用统一缓存管理器
      const cachedData = imageCache.get('album', decodedAlbumPath);
      if (cachedData) {
        setImages(cachedData);
        setLoading(false);
        return;
      }

      const result = await ipcRenderer.invoke(CHANNELS.GET_ALBUM_IMAGES, decodedAlbumPath);

      // 缓存结果
      imageCache.set('album', decodedAlbumPath, result);

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

  // 加载根路径信息
  const loadRootPath = async () => {
    try {
      // 获取根路径
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
      const rootPathValue = localStorage.getItem(windowStorageKey);

      if (rootPathValue) {
        setRootPath(rootPathValue);
      }
    } catch (err) {
      console.error('加载根路径失败:', err);
    }
  };

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

  // 加载面包屑导航数据 - 与HomePage保持一致
  const loadBreadcrumbData = async () => {
    try {
      if (!decodedAlbumPath || !rootPath) {
        // 如果没有足够的路径信息，使用前端计算作为fallback
        if (decodedAlbumPath) {
          const fallbackBreadcrumbs = getBreadcrumbPaths(decodedAlbumPath, rootPath);
          setBreadcrumbs(fallbackBreadcrumbs);
        }
        return;
      }

      // 使用与HomePage相同的逻辑：扫描父目录获取面包屑信息
      const parentPath = getDirname(decodedAlbumPath);
      if (parentPath && parentPath !== decodedAlbumPath) {
        // 使用统一缓存管理器
        const cachedData = imageCache.get('navigation', parentPath);
        if (cachedData && cachedData.breadcrumbs) {
          setBreadcrumbs(cachedData.breadcrumbs);
          setMetadata(cachedData.metadata);
          return;
        }

        // 如果没有缓存，调用导航扫描API
        if (ipcRenderer) {
          try {
            const response = await ipcRenderer.invoke(CHANNELS.SCAN_NAVIGATION_LEVEL, parentPath);
            if (response.success) {
              // 缓存结果
              imageCache.set('navigation', parentPath, response);
              setBreadcrumbs(response.breadcrumbs);
              setMetadata(response.metadata);
            } else {
              // fallback到前端计算
              const fallbackBreadcrumbs = getBreadcrumbPaths(decodedAlbumPath, rootPath);
              setBreadcrumbs(fallbackBreadcrumbs);
            }
          } catch (error) {
            console.error('加载面包屑数据失败:', error);
            // fallback到前端计算
            const fallbackBreadcrumbs = getBreadcrumbPaths(decodedAlbumPath, rootPath);
            setBreadcrumbs(fallbackBreadcrumbs);
          }
        } else {
          // fallback到前端计算
          const fallbackBreadcrumbs = getBreadcrumbPaths(decodedAlbumPath, rootPath);
          setBreadcrumbs(fallbackBreadcrumbs);
        }
      } else {
        // 已经是根目录，使用前端计算
        const fallbackBreadcrumbs = getBreadcrumbPaths(decodedAlbumPath, rootPath);
        setBreadcrumbs(fallbackBreadcrumbs);
      }
    } catch (error) {
      console.error('加载面包屑数据失败:', error);
      // 最终fallback到前端计算
      if (decodedAlbumPath) {
        const fallbackBreadcrumbs = getBreadcrumbPaths(decodedAlbumPath, rootPath);
        setBreadcrumbs(fallbackBreadcrumbs);
      }
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

      // 获取相簿列表 - 使用统一缓存管理器
      let albums = [];
      const cachedData = imageCache.get('albums', rootPath);

      if (cachedData) {
        albums = cachedData;
      } else {
        albums = await ipcRenderer.invoke('scan-directory', rootPath);
        // 缓存相簿列表
        imageCache.set('albums', rootPath, albums);
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

  // 处理返回 - 统一为严格层级返回
  const handleBack = () => {
    if (isNavigating) return;

    // 保存当前滚动位置
    if (scrollContainerRef.current) {
      scrollContext.savePosition(location.pathname, scrollContainerRef.current.scrollTop);
    }

    // 严格计算父目录路径
    const parentPath = getDirname(decodedAlbumPath);

    // 只要存在有效的父目录，就导航到主页并让其显示该父目录
    if (parentPath && parentPath !== decodedAlbumPath && rootPath && parentPath.startsWith(rootPath)) {
      setIsNavigating(true);
      navigate('/', {
        state: {
          navigateToPath: parentPath,
          fromAlbumPage: true // 保留这个state，以便HomePage知道来源
        }
      });
    } else {
      // 如果没有有效的父目录（例如已经是根目录的直接子级），则直接导航到主页
      navigate('/');
    }
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
    imageCache.clearType('album');
    imageCache.clearType('albums');
    imageCache.clearType('navigation');

    loadAlbumImages();
    loadBreadcrumbData();
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
    const config = DENSITY_CONFIG[userDensity] || DENSITY_CONFIG.standard;
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
    // 新架构：优先使用state中的albumName
    if (location.state?.albumName) {
      return location.state.albumName;
    }
    // 旧架构：从路径解析
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
      navigate(`/album/${encodeURIComponent(targetAlbum.path)}`, {
        state: {
          albumPath: targetAlbum.path,
          albumName: targetAlbum.name,
          fromAlbumPage: true
        }
      });
    }
  };

  // 处理面包屑导航点击
  const handleBreadcrumbNavigate = useCallback(async (targetPath) => {
    if (isNavigating) return;

    // 验证路径有效性 - 放宽验证，让主进程决定路径是否真的无效
    if (!isValidPath(targetPath)) {
      console.warn(`面包屑路径验证失败: ${targetPath}`);
      // 不直接阻止，而是记录警告并继续尝试
    }

    // 保存当前滚动位置
    if (scrollContainerRef.current) {
      scrollContext.savePosition(location.pathname, scrollContainerRef.current.scrollTop);
    }

    // 如果点击的是当前路径，无需导航
    if (targetPath === decodedAlbumPath) {
      return;
    }

    setIsNavigating(true);
    try {
      // 如果目标是根路径，跳转到首页
      if (targetPath === rootPath) {
        navigate('/', {
          state: {
            navigateToPath: rootPath
          }
        });
        return;
      }

      // 检测目标路径的类型
      const pathType = await detectPathType(targetPath);
      console.log(`面包屑导航: ${targetPath}, 类型: ${pathType}`);

      // 如果检测为相簿类型，进一步验证是否真的有图片
      if (pathType === 'album') {
        const imageCount = await getPathImageCount(targetPath);
        console.log(`路径 ${targetPath} 实际图片数量: ${imageCount}`);

        // 如果没有图片，当作文件夹处理
        if (imageCount === 0) {
          console.log(`路径 ${targetPath} 检测为相簿但没有图片，当作文件夹处理`);
          navigate('/', {
            state: {
              navigateToPath: targetPath,
              fromAlbumPage: true
            }
          });
          return;
        }

        // 有图片，正常导航到相簿页面
        const safePath = targetPath.replace(/\//g, '%2F');
        navigate(`/album/${safePath}`, {
          state: {
            albumPath: targetPath,
            albumName: getBasename(targetPath),
            fromAlbumPage: true
          }
        });
      } else if (pathType === 'folder' || pathType === 'mixed') {
        // 文件夹或混合类型：跳转到首页并导航到该文件夹
        navigate('/', {
          state: {
            navigateToPath: targetPath,
            fromAlbumPage: true
          }
        });
      } else {
        // 未知类型：直接跳转到首页文件夹视图
        navigate('/', {
          state: {
            navigateToPath: targetPath,
            fromAlbumPage: true
          }
        });
      }
    } catch (error) {
      console.error('面包屑导航失败:', error);
      setError(`导航失败: ${error.message || '无法访问该路径'}`);
    } finally {
      setTimeout(() => setIsNavigating(false), 100);
    }
  }, [navigate, location.pathname, scrollContext, decodedAlbumPath, rootPath, isNavigating, detectPathType, getPathImageCount]);

  // 处理浮动面板导航
  const handleFloatingPanelNavigate = useCallback((targetPath) => {
    // 保存当前滚动位置
    if (scrollContainerRef.current) {
      scrollContext.savePosition(location.pathname, scrollContainerRef.current.scrollTop);
    }

    // 导航到首页，并设置浏览路径
    navigate('/', {
      state: {
        navigateToPath: targetPath
      }
    });
  }, [navigate, location.pathname, scrollContext]);

  // 处理浮动面板相册打开
  const handleFloatingPanelAlbumClick = useCallback((albumPath, albumName) => {
    // 保存当前滚动位置
    if (scrollContainerRef.current) {
      scrollContext.savePosition(location.pathname, scrollContainerRef.current.scrollTop);
    }

    // 直接导航到相册页面
    navigate(`/album/${encodeURIComponent(albumPath)}`, {
      state: {
        albumPath: albumPath,
        albumName: albumName,
        fromAlbumPage: true
      }
    });
  }, [navigate, location.pathname, scrollContext]);

  // 处理返回到根目录
  const handleReturnToRoot = useCallback(() => {
    if (rootPath) {
      // 保存当前滚动位置
      if (scrollContainerRef.current) {
        scrollContext.savePosition(location.pathname, scrollContainerRef.current.scrollTop);
      }
      
      // 导航到首页，并设置浏览路径
      navigate('/', {
        state: {
          navigateToPath: rootPath
        }
      });
    }
  }, [rootPath, navigate, location.pathname, scrollContext]);

  // 处理返回到父目录
  const handleGoToParent = useCallback(() => {
    // 计算父目录路径
    const parentPath = decodedAlbumPath.substring(0, decodedAlbumPath.lastIndexOf('/'));
    if (parentPath && parentPath !== decodedAlbumPath) {
      // 保存当前滚动位置
      if (scrollContainerRef.current) {
        scrollContext.savePosition(location.pathname, scrollContainerRef.current.scrollTop);
      }
      
      // 导航到首页，并设置浏览路径
      navigate('/', {
        state: {
          navigateToPath: parentPath
        }
      });
    }
  }, [decodedAlbumPath, navigate, location.pathname, scrollContext]);

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

      // 检查是否有缓存的相簿列表 - 使用统一缓存管理器
      const cachedData = imageCache.get('albums', rootPath);
      let albums;
      if (cachedData) {
        albums = cachedData;
      } else {
        // 如果没有缓存，重新扫描目录
        albums = await ipcRenderer.invoke('scan-directory', rootPath);
        // 缓存相簿列表
        imageCache.set('albums', rootPath, albums);
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
        navigate(`/album/${encodeURIComponent(randomAlbum.path)}`, {
          state: {
            albumPath: randomAlbum.path,
            albumName: randomAlbum.name,
            fromAlbumPage: true
          }
        });
      } else {
        setError('没有可用的相簿进行随机选择');
      }
    } catch (err) {
      setError('随机选择相簿时出错: ' + err.message);
    }
  };

  return (
    <Box sx={{ flexGrow: 1, height: '100vh', display: 'flex', flexDirection: 'column' }}>
      <AppBar position="static" color="default" elevation={0} sx={{ borderBottom: 1, borderColor: 'divider' }}>
        <Toolbar variant="dense">
          {/* 用面包屑导航替换左侧的返回、主页和标题 */}
          <BreadcrumbNavigation
            breadcrumbs={breadcrumbs.length > 0 ? breadcrumbs : getBreadcrumbPaths(decodedAlbumPath, rootPath)}
            currentPath={decodedAlbumPath}
            onNavigate={handleBreadcrumbNavigate}
            variant="minimal" // 使用极简模式
            compact={isSmallScreen}
            sx={{ flexGrow: 1, minWidth: 0 }} // 占据主要空间
          />

          {/* 右侧的操作按钮保持不变 */}
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
              <Typography variant="caption" sx={{ mx: 0.5, fontSize: '0.75rem' }}>
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
            {/* 统计信息的新位置 */}
            <Box sx={{ mb: 2, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <Typography variant="caption" color="text.secondary">
                共 {images.length} 张照片
              </Typography>
              <Typography variant="caption" color="text.secondary">
                {metadata ? `当前目录: ${metadata.folderCount} 文件夹, ${metadata.albumCount} 相簿` : ''}
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
                      style={{ marginBottom: `${(DENSITY_CONFIG[userDensity] || DENSITY_CONFIG.standard).spacing}px` }}
                    >
                      <ImageCard
                        image={image}
                        onClick={() => handleImageClick(index)}
                        density={userDensity}
                        onLoad={handleImageLoad}
                        albumPath={decodedAlbumPath}
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
function ImageCard({ image, onClick, density, onLoad, albumPath }) {
  const [imageUrl, setImageUrl] = useState('');
  const [loading, setLoading] = useState(true);
  const [aspectRatio, setAspectRatio] = useState(1); // 默认为1:1
  const [imageLoaded, setImageLoaded] = useState(false);
  const [imageError, setImageError] = useState(false);
  const [retryCount, setRetryCount] = useState(0);
  const maxRetries = 2; // 最大重试次数

  // 使用收藏上下文
  const { isImageFavorited, toggleImageFavorite } = useFavorites();
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

        // 使用统一缓存管理器
        const cachedUrl = imageCache.get('thumbnail', image.path);
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

        // 缓存到统一缓存管理器
        imageCache.set('thumbnail', image.path, url);

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
      imageCache.clearType('thumbnail');
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
      const albumName = albumPath.split('/').pop();
      toggleImageFavorite(image, albumPath, albumName);
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