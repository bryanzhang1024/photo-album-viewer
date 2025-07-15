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
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Slider,
  Switch,
  FormControlLabel,
  TextField,
  Divider,
  Badge
} from '@mui/material';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import SortIcon from '@mui/icons-material/Sort';
import RefreshIcon from '@mui/icons-material/Refresh';
import ViewModuleIcon from '@mui/icons-material/ViewModule';
import ViewCompactIcon from '@mui/icons-material/ViewCompact';
import Brightness4Icon from '@mui/icons-material/Brightness4';
import Brightness7Icon from '@mui/icons-material/Brightness7';
import TuneIcon from '@mui/icons-material/Tune';
import FavoriteBorderIcon from '@mui/icons-material/FavoriteBorder';
import FavoriteIcon from '@mui/icons-material/Favorite';
import CasinoIcon from '@mui/icons-material/Casino';
import ImageViewer from '../components/ImageViewer';
import Masonry from 'react-masonry-css';
import './AlbumPage.css'; // 我们将添加这个CSS文件
import { ScrollPositionContext } from '../App';
import { useFavorites } from '../contexts/FavoritesContext';

// 安全地获取electron对象
const electron = window.require ? window.require('electron') : null;
const ipcRenderer = electron ? electron.ipcRenderer : null;

// 默认性能设置
const DEFAULT_PERFORMANCE_SETTINGS = {
  concurrentTasks: 10,
  preloadDistance: 5,
  cacheTimeout: 60, // 分钟
  cacheEnabled: true,
  thumbnailResolution: 450, // 缩略图分辨率
  cardWidth: 280 // 卡片基础宽度
};

// 卡片尺寸配置 - 与HomePage.js中保持一致
const getCardConfig = (settings) => ({
  compact: {
    minWidth: 160, // 紧凑模式下卡片最小宽度
    idealWidth: Math.round(settings?.cardWidth * 0.8) || 220, // 紧凑模式下理想宽度（与HomePage中的width保持一致）
    spacing: 16 // 紧凑模式下卡片间距
  },
  standard: {
    minWidth: 200, // 标准模式下卡片最小宽度
    idealWidth: settings?.cardWidth || 280, // 标准模式下理想宽度（与HomePage中的width保持一致）
    spacing: 24 // 标准模式下卡片间距
  }
});

// 预设的断点配置，根据屏幕宽度确定最佳列数
const BREAKPOINTS = {
  xs: 600,   // 超小屏幕
  sm: 960,   // 小屏幕
  md: 1280,  // 中等屏幕
  lg: 1920,  // 大屏幕
  xl: 2560   // 超大屏幕
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
  const [compactView, setCompactView] = useState(true);
  const [windowWidth, setWindowWidth] = useState(window.innerWidth);
  const [imageHeights, setImageHeights] = useState({}); // 存储图片高度信息
  const isSmallScreen = useMediaQuery(theme.breakpoints.down('sm'));
  const scrollContainerRef = useRef(null);
  const initialImagePath = useRef(null); // 存储初始要显示的图片路径

  // 性能设置
  const [performanceSettings, setPerformanceSettings] = useState(() => {
    const savedSettings = localStorage.getItem('performance_settings');
    return savedSettings ? JSON.parse(savedSettings) : DEFAULT_PERFORMANCE_SETTINGS;
  });

  // 设置对话框
  const [settingsDialogOpen, setSettingsDialogOpen] = useState(false);
  const [tempSettings, setTempSettings] = useState({...performanceSettings});

  // 获取滚动位置上下文
  const scrollContext = useContext(ScrollPositionContext);

  // 解码路径
  const decodedAlbumPath = decodeURIComponent(albumPath);

  // 获取收藏上下文
  const { favorites } = useFavorites();

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

  // 加载相簿图片
  useEffect(() => {
    loadAlbumImages();
  }, [decodedAlbumPath]);

  // 监听窗口大小变化
  useEffect(() => {
    const handleResize = () => {
      setWindowWidth(window.innerWidth);
    };

    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  // 从localStorage中读取视图设置
  useEffect(() => {
    const savedViewMode = localStorage.getItem('compactView');

    if (savedViewMode !== null) {
      setCompactView(savedViewMode === 'true');
    }
  }, []);

  // 当性能设置变化时，强制重新计算布局
  useEffect(() => {
    // 只有在初始加载后才执行
    if (images.length > 0) {
      // 应用新的卡片宽度设置
      const style = document.createElement('style');
      const config = getCardConfig(performanceSettings);

      style.textContent = `
        .compact-view .masonry-grid_column {
          width: ${Math.round(config.compact.idealWidth)}px !important;
        }

        .standard-view .masonry-grid_column {
          width: ${config.standard.idealWidth}px !important;
        }
      `;

      // 添加到文档头部
      document.head.appendChild(style);

      // 清理函数
      return () => {
        document.head.removeChild(style);
      };
    }
  }, [performanceSettings, images.length]);

  // 添加ESC键监听，按ESC返回上一页
  useEffect(() => {
    const handleKeyDown = (event) => {
      // 如果按下ESC键且没有打开查看器或设置对话框
      if (event.key === 'Escape' && !viewerOpen && !settingsDialogOpen) {
        handleBack();
      }

      // 按下 r 键触发随机选择相簿
      if (event.key === 'r' && !event.ctrlKey && !event.altKey && !event.metaKey) {
        // 确保不在输入框中，且没有打开查看器或设置对话框
        if (document.activeElement.tagName !== 'INPUT' &&
            document.activeElement.tagName !== 'TEXTAREA' &&
            !document.activeElement.isContentEditable &&
            !viewerOpen && !settingsDialogOpen) {
          handleRandomAlbum();
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [viewerOpen, settingsDialogOpen]);

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

  // 处理返回
  const handleBack = () => {
    // 保存当前路径到上下文
    if (scrollContainerRef.current) {
      scrollContext.savePosition('/album/' + albumPath, scrollContainerRef.current.scrollTop);
    }

    navigate(-1);
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

  // 切换视图模式
  const toggleViewMode = () => {
    const newMode = !compactView;
    setCompactView(newMode);
    localStorage.setItem('compactView', newMode.toString());
  };

  // 排序图片
  const sortedImages = () => {
    if (!images.length) return [];

    return [...images].sort((a, b) => {
      let comparison = 0;

      if (sortBy === 'name') {
        comparison = a.name.localeCompare(b.name);
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

  // 重新设计的瀑布流断点系统 - 基于设备类型优化
  const getMasonryBreakpoints = useCallback(() => {
    const config = compactView ? getCardConfig(performanceSettings).compact : getCardConfig(performanceSettings).standard;
    
    // 设备类型检测和瀑布流优化
    const containerPadding = isSmallScreen ? 16 : 32;
    const scrollbarWidth = 8;
    const availableWidth = Math.max(0, windowWidth - containerPadding - scrollbarWidth);
    
    // 基于设备类型的瀑布流配置
    const deviceConfig = {
      // 手机：单列或双列瀑布流
      phone: { maxCols: { compact: 2, standard: 1 }, minCardWidth: 140 },
      // 平板：双列或三列瀑布流
      tablet: { maxCols: { compact: 3, standard: 2 }, minCardWidth: 160 },
      // 笔记本：三列或四列瀑布流
      laptop: { maxCols: { compact: 4, standard: 3 }, minCardWidth: 180 },
      // 桌面：四列或五列瀑布流
      desktop: { maxCols: { compact: 5, standard: 4 }, minCardWidth: 200 },
      // 超宽屏：六列或八列瀑布流
      ultrawide: { maxCols: { compact: 8, standard: 6 }, minCardWidth: 220 }
    };
    
    // 检测设备类型
    let deviceType = 'phone';
    if (windowWidth >= 1920) deviceType = 'ultrawide';
    else if (windowWidth >= 1200) deviceType = 'desktop';
    else if (windowWidth >= 768) deviceType = 'laptop';
    else if (windowWidth >= 481) deviceType = 'tablet';
    
    const device = deviceConfig[deviceType];
    const maxColumns = device.maxCols[compactView ? 'compact' : 'standard'];
    const minCardWidth = device.minCardWidth;
    
    // 基于可用宽度的智能计算
    const idealCardWidth = config.idealWidth;
    const spacing = config.spacing;
    
    let columns = Math.floor((availableWidth + spacing) / (Math.max(minCardWidth, idealCardWidth * 0.8) + spacing));
    
    // 确保在设备限制范围内
    columns = Math.max(1, Math.min(columns, maxColumns));
    
    // 特殊处理极端小屏幕
    if (windowWidth < 400) {
      columns = Math.min(columns, compactView ? 2 : 1);
    }
    
    return columns;
  }, [windowWidth, compactView, isSmallScreen, performanceSettings]);

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

  // 处理打开设置对话框
  const handleOpenSettings = () => {
    setTempSettings({...performanceSettings});
    setSettingsDialogOpen(true);
  };

  // 处理关闭设置对话框
  const handleCloseSettings = () => {
    setSettingsDialogOpen(false);
  };

  // 处理保存设置
  const handleSaveSettings = () => {
    setPerformanceSettings(tempSettings);
    localStorage.setItem('performance_settings', JSON.stringify(tempSettings));
    setSettingsDialogOpen(false);

    // 通知用户需要刷新以应用某些设置
    setError('设置已保存，正在应用新的卡片宽度...');

    // 强制重新计算瀑布流布局 - 自动刷新
    setTimeout(() => {
      // 触发窗口大小变化，强制重新计算列数
      setWindowWidth(prev => prev + 1);
      setTimeout(() => {
        setWindowWidth(window.innerWidth);
        setError('');
      }, 50);
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
  const handleRandomAlbum = async () => {
    try {
      if (!ipcRenderer) {
        setError('无法访问ipcRenderer, Electron可能没有正确加载');
        return;
      }

      // 获取根路径
      const rootPath = localStorage.getItem('lastRootPath');
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
            sx={{ mr: 2 }}
            size="small"
          >
            <ArrowBackIcon />
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

            <Tooltip title="调整卡片宽度">
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
                共 {images.length} 张照片 | {compactView ? "紧凑视图" : "标准视图"}
              </Typography>
            </Box>

            {images.length > 0 ? (
              <Box sx={{ minHeight: 'calc(100vh - 120px)' }}>
                <Masonry
                  breakpointCols={getMasonryBreakpoints()}
                  className={`masonry-grid ${compactView ? 'compact-view' : 'standard-view'}`}
                  columnClassName="masonry-grid_column"
                >
                  {sortedImages().map((image, index) => (
                    <div
                      key={`${image.path}-${index}`}
                      className="masonry-item"
                    >
                      <ImageCard
                        image={image}
                        onClick={() => handleImageClick(index)}
                        isCompactMode={compactView}
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

      {/* 设置对话框 */}
      <Dialog open={settingsDialogOpen} onClose={handleCloseSettings}>
        <DialogTitle>
          <Box sx={{ display: 'flex', alignItems: 'center' }}>
            <TuneIcon sx={{ mr: 1 }} />
            卡片宽度设置
          </Box>
        </DialogTitle>
        <DialogContent dividers>
          <Box sx={{ mb: 3 }}>
            <Typography gutterBottom>卡片宽度</Typography>
            <Typography variant="caption" color="text.secondary">
              调整相簿卡片的宽度。较大的宽度显示更多细节，较小的宽度可在同一屏幕显示更多图片。
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

// 图片卡片组件
function ImageCard({ image, onClick, isCompactMode, onLoad }) {
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
  }, [image, isCompactMode, retryCount]);

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
                borderRadius: isCompactMode ? '4px' : '4px 4px 0 0'
              }}
              loading="lazy"
              onLoad={handleImageLoaded}
              onError={handleImageError}
            />
          </div>
        )}
      </Box>

      {!isCompactMode && (
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