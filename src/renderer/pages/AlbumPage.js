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
import FavoriteBorderIcon from '@mui/icons-material/FavoriteBorder';
import FavoriteIcon from '@mui/icons-material/Favorite';
import CasinoIcon from '@mui/icons-material/Casino';
import TuneIcon from '@mui/icons-material/Tune';
import OpenInNewIcon from '@mui/icons-material/OpenInNew';
import ChevronLeftIcon from '@mui/icons-material/ChevronLeft';
import ChevronRightIcon from '@mui/icons-material/ChevronRight';
import ImageViewer from '../components/ImageViewer';
import BreadcrumbNavigation from '../components/BreadcrumbNavigation';
import ImageCard from '../components/ImageCard';
import { Virtuoso } from 'react-virtuoso';
import { ScrollPositionContext } from '../App';
import { useFavorites } from '../contexts/FavoritesContext';
import imageCache from '../utils/ImageCacheManager';
import { getBreadcrumbPaths, getBasename, getDirname, isValidPath, safeDecodeURIPath } from '../utils/pathUtils';
import CHANNELS from '../../common/ipc-channels';
import useSorting from '../hooks/useSorting';
import useAlbumImages from '../hooks/useAlbumImages';
import useBreadcrumbs from '../hooks/useBreadcrumbs';
import useNeighboringAlbums from '../hooks/useNeighboringAlbums';
import PageLayout from '../components/PageLayout';
import { GRID_CONFIG, DEFAULT_DENSITY, computeGridColumns, chunkIntoRows } from '../utils/virtualGrid';

// 安全地获取electron对象
const electron = window.require ? window.require('electron') : null;
const ipcRenderer = electron ? electron.ipcRenderer : null;


function AlbumPage({
  colorMode,
  // URL模式的新props
  albumPath: urlAlbumPath = null,
  initialImage: urlInitialImage = null,
  onNavigate = null,
  onBreadcrumbNavigate = null,
  onAlbumClick = null,
  onGoBack = null,
  urlMode = false
}) {
  const { albumPath } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const theme = useTheme();
  const { sortBy, sortDirection, handleSortChange, handleDirectionChange } = useSorting('name', 'asc');
  const [viewerOpen, setViewerOpen] = useState(false);
  const [selectedImageIndex, setSelectedImageIndex] = useState(0);
  const [userDensity, setUserDensity] = useState(() => {
    const savedDensity = localStorage.getItem('userDensity');
    return (savedDensity && GRID_CONFIG[savedDensity]) ? savedDensity : DEFAULT_DENSITY;
  });
  const [windowWidth, setWindowWidth] = useState(window.innerWidth);
  const [rootPath, setRootPath] = useState('');
  const isSmallScreen = useMediaQuery(theme.breakpoints.down('sm'));
  const scrollContainerRef = useRef(null);
  const [virtualScrollParent, setVirtualScrollParent] = useState(null);
  const initialImagePath = useRef(null); // 存储初始要显示的图片路径
  const [isNavigating, setIsNavigating] = useState(false); // 导航锁，防止重复操作


  // 获取滚动位置上下文
  const scrollContext = useContext(ScrollPositionContext);

  // 解码路径 - 统一的路径解析逻辑
  const decodedAlbumPath = useMemo(() => {
    if (urlMode && urlAlbumPath !== null) return urlAlbumPath;
    if (location.state?.albumPath) return location.state.albumPath;
    return albumPath ? safeDecodeURIPath(albumPath) : '';
  }, [urlMode, urlAlbumPath, albumPath, location.state]);

  // 使用自定义 Hooks
  const { images, loading, error, loadImages } = useAlbumImages(decodedAlbumPath);
  const { breadcrumbs, metadata, loadBreadcrumbs } = useBreadcrumbs(decodedAlbumPath, rootPath);
  const { neighboringAlbums, siblingAlbums, loadNeighboringAlbums } = useNeighboringAlbums(decodedAlbumPath);

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
    if (urlMode && urlInitialImage) {
      // URL模式：使用传入的初始图片路径
      initialImagePath.current = urlInitialImage;
    } else {
      // 传统模式：从URL参数获取
      const searchParams = new URLSearchParams(location.search);
      const imagePath = searchParams.get('image');
      if (imagePath) {
        initialImagePath.current = decodeURIComponent(imagePath);
      } else {
        initialImagePath.current = null;
      }
    }
  }, [urlMode, urlInitialImage, location.search]);

  // 加载相簿图片、相邻相簿信息和面包屑数据
  useEffect(() => {
    let cancelled = false; // 竞态条件保护

    const loadAllData = async () => {
      if (cancelled) return;
      const result = await loadImages();

      if (cancelled) return;
      await loadNeighboringAlbums();

      if (cancelled) return;
      await loadBreadcrumbs();

      if (cancelled) return;
      await loadRootPath();

      if (cancelled) return;
      await preloadParentDirectory();

      // 如果有初始图片路径，找到对应的索引并打开查看器
      if (initialImagePath.current && result.length > 0) {
        const imageIndex = result.findIndex(img => img.path === initialImagePath.current);
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

    // Cleanup: 组件卸载或路径变化时取消旧请求
    return () => {
      cancelled = true;
    };
  }, [decodedAlbumPath, loadImages, loadNeighboringAlbums, loadBreadcrumbs]);

  // 监听窗口大小变化
  useEffect(() => {
    const handleResize = () => {
      setWindowWidth(window.innerWidth);
    };

    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  useEffect(() => {
    if (scrollContainerRef.current) {
      setVirtualScrollParent(scrollContainerRef.current);
    }
  }, []);

  // 从localStorage中读取密度设置
  useEffect(() => {
    const savedDensity = localStorage.getItem('userDensity');
    if (savedDensity) {
      setUserDensity(savedDensity);
    }
  }, []);

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



  // 处理返回 - 支持URL模式
  const handleBack = () => {
    if (isNavigating) return;

    // URL模式：使用传入的回调函数
    if (urlMode && onGoBack) {
      onGoBack();
      return;
    }

    // 传统模式：原有逻辑
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
  const sortedImages = useMemo(() => {
    if (!images.length) return [];

    const sorted = [...images].sort((a, b) => {
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

    return sorted;
  }, [images, sortBy, sortDirection]);

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
    () => chunkIntoRows(sortedImages, columnsCount),
    [sortedImages, columnsCount]
  );

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
      // URL模式：使用传入的回调函数
      if (urlMode && onAlbumClick) {
        onAlbumClick(targetAlbum.path, targetAlbum.name);
        return;
      }

      // 传统模式：原有逻辑
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

    // URL模式：使用传入的回调函数
    if (urlMode && onBreadcrumbNavigate) {
      onBreadcrumbNavigate(targetPath);
      return;
    }

    // 传统模式：原有逻辑
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
  const handleRandomAlbum = () => {
    if (siblingAlbums.length <= 1) {
      // 如果没有其他相簿可选，则不执行任何操作
      setError('没有其他相簿可供随机选择');
      return;
    }

    let randomAlbum;
    let attempts = 0;
    const maxAttempts = 10; // 防止无限循环

    // 随机选择一个相簿，但避免选到当前相簿
    do {
      const randomIndex = Math.floor(Math.random() * siblingAlbums.length);
      randomAlbum = siblingAlbums[randomIndex];
      attempts++;
    } while (randomAlbum.path === decodedAlbumPath && siblingAlbums.length > 1 && attempts < maxAttempts);

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
  };

  const renderHeader = () => (
    <>
      <BreadcrumbNavigation
        breadcrumbs={breadcrumbs.length > 0 ? breadcrumbs : getBreadcrumbPaths(decodedAlbumPath, rootPath)}
        currentPath={decodedAlbumPath}
        onNavigate={handleBreadcrumbNavigate}
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
            <MenuItem value="size">大小</MenuItem>
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
        <Tooltip title={neighboringAlbums.prev ? `上一个相簿: ${neighboringAlbums.prev.name}` : "已是第一个相簿"}>
          <span>
            <IconButton
              color="inherit"
              onClick={() => handleNavigateToAdjacentAlbum('prev')}
              disabled={!neighboringAlbums.prev}
              size="small"
              sx={{ mx: 0.5 }}
            >
              <ChevronLeftIcon />
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
              <ChevronRightIcon />
            </IconButton>
          </span>
        </Tooltip>
        <Tooltip title="随机选择相簿 (R)">
          <IconButton
            color="inherit"
            onClick={handleRandomAlbum}
            size="small"
            sx={{ mx: 0.5 }}
          >
            <CasinoIcon />
          </IconButton>
        </Tooltip>
        <Tooltip title={isAlbumFavorited(decodedAlbumPath) ? "取消收藏相簿" : "收藏相簿"}>
          <IconButton
            color="inherit"
            onClick={handleToggleAlbumFavorite}
            size="small"
            sx={{ mx: 0.5 }}
          >
            {isAlbumFavorited(decodedAlbumPath) ? 
              <FavoriteIcon sx={{ color: '#ff5252' }} /> : 
              <FavoriteBorderIcon />
            }
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
      </Box>
    </>
  );

  const renderContent = () => (
    <>
      <Box sx={{ mb: 2 }}>
        <Typography variant="caption" color="text.secondary">
          共 {images.length} 张照片
        </Typography>
      </Box>
      {images.length > 0 ? (
        <Virtuoso
          data={gridRows}
          customScrollParent={virtualScrollParent || undefined}
          overscan={200}
          itemContent={(rowIndex, imageRow) => {
            const config = GRID_CONFIG[userDensity];
            const columns = columnsCount;

            return (
              <Box
                sx={{
                  display: 'grid',
                  gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`,
                  gap: `${config.gap}px`,
                  mb: `${config.gap}px`,
                  px: { xs: 2, sm: 3 }
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
                        lazyLoad={true}
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
            未找到图片
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
            此相簿中没有支持的图片文件
          </Typography>
        </Box>
      )}
      {viewerOpen && (
        <ImageViewer
          images={sortedImages}
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
    </>
  );

  return (
    <PageLayout
      loading={loading}
      error={error}
      headerContent={renderHeader()}
      scrollContainerRef={scrollContainerRef}
    >
      {renderContent()}
    </PageLayout>
  );
}

export default AlbumPage;
