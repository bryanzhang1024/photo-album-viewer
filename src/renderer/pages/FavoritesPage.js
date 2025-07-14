import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
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
  useTheme
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
import Masonry from 'react-masonry-css';
import './FavoritesPage.css';

// 安全地获取electron对象
const electron = window.require ? window.require('electron') : null;
const ipcRenderer = electron ? electron.ipcRenderer : null;

// 预设的断点配置，根据屏幕宽度确定最佳列数
const BREAKPOINTS = {
  xs: 600,   // 超小屏幕
  sm: 960,   // 小屏幕
  md: 1280,  // 中等屏幕
  lg: 1920,  // 大屏幕
  xl: 2560   // 超大屏幕
};

// 卡片尺寸配置
const CARD_CONFIG = {
  compact: {
    minWidth: 160, // 紧凑模式下卡片最小宽度
    idealWidth: 220, // 紧凑模式下理想宽度
    spacing: 16 // 紧凑模式下卡片间距
  },
  standard: {
    minWidth: 200, // 标准模式下卡片最小宽度
    idealWidth: 280, // 标准模式下理想宽度
    spacing: 24 // 标准模式下卡片间距
  }
};

// 收藏页面组件
function FavoritesPage({ colorMode }) {
  const navigate = useNavigate();
  const theme = useTheme();
  const isSmallScreen = useMediaQuery(theme.breakpoints.down('sm'));
  const [tabValue, setTabValue] = useState(0);
  const [compactView, setCompactView] = useState(true);
  const [sortBy, setSortBy] = useState('date');
  const [sortDirection, setSortDirection] = useState('desc');
  const [imageThumbnails, setImageThumbnails] = useState({});
  const [error, setError] = useState('');
  const [viewerOpen, setViewerOpen] = useState(false);
  const [selectedImageIndex, setSelectedImageIndex] = useState(0);
  const [viewerImages, setViewerImages] = useState([]);
  const [windowWidth, setWindowWidth] = useState(window.innerWidth);
  const [imageHeights, setImageHeights] = useState({}); // 存储图片高度信息
  
  // 使用收藏上下文
  const { favorites, isLoading, toggleAlbumFavorite, toggleImageFavorite } = useFavorites();
  
  // 从localStorage中读取视图设置
  useEffect(() => {
    const savedViewMode = localStorage.getItem('compactView');
    if (savedViewMode !== null) {
      setCompactView(savedViewMode === 'true');
    }
  }, []);
  
  // 监听窗口大小变化
  useEffect(() => {
    const handleResize = () => {
      setWindowWidth(window.innerWidth);
    };
    
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);
  
  // 加载图片缩略图
  useEffect(() => {
    const loadImageThumbnails = async () => {
      if (!favorites.images.length || !ipcRenderer) return;
      
      const thumbnails = {};
      
      for (const image of favorites.images) {
        try {
          // 检查缓存
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
                console.warn('缓存缩略图失败', e);
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
  
  // 切换视图模式
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
  
  // 处理相簿点击
  const handleAlbumClick = (albumPath) => {
    navigate(`/album/${encodeURIComponent(albumPath)}`);
  };
  
  // 处理图片点击 - 直接打开图片查看器
  const handleImageClick = (image, index) => {
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
  
  // 计算瀑布流的断点
  const getMasonryBreakpoints = useCallback(() => {
    const config = compactView ? CARD_CONFIG.compact : CARD_CONFIG.standard;
    const containerPadding = 48; // 左右各24px
    const availableWidth = windowWidth - containerPadding;
    
    // 使用固定宽度计算每行可容纳的列数
    const cardWidth = config.idealWidth;
    const cardSpacing = config.spacing;
    const maxColumns = Math.floor((availableWidth + cardSpacing) / (cardWidth + cardSpacing));
    
    // 确保至少有1列
    const columnsCount = Math.max(1, maxColumns);
    
    // 自定义断点配置，根据实际卡片宽度设置
    const breakpointCols = {
      default: columnsCount
    };
    
    // 为每个断点设置列数，并确保使用正确的卡片宽度
    const breakpoints = Object.keys(BREAKPOINTS).sort((a, b) => BREAKPOINTS[a] - BREAKPOINTS[b]);
    breakpoints.forEach(bp => {
      const bpWidth = BREAKPOINTS[bp];
      const bpAvailableWidth = bpWidth - containerPadding;
      const bpMaxColumns = Math.floor((bpAvailableWidth + cardSpacing) / (cardWidth + cardSpacing));
      const bpColumns = Math.max(1, Math.min(bpMaxColumns, columnsCount));
      
      breakpointCols[bpWidth] = bpColumns;
    });
    
    return breakpointCols;
  }, [windowWidth, compactView, isSmallScreen]);
  
  // 记录图片加载完成后的高度
  const handleImageLoad = (imagePath, height) => {
    setImageHeights(prev => ({
      ...prev,
      [imagePath]: height
    }));
  };
  
  // 渲染相簿卡片
  const renderAlbumCard = (album) => {
    // 为了兼容AlbumCard组件的格式，转换收藏的相簿数据
    const albumForCard = {
      ...album,
      previewImages: album.previewImagePath ? [{ path: album.previewImagePath }] : []
    };
    
    return (
      <AlbumCard
        album={albumForCard}
        displayPath={album.path}
        onClick={() => handleAlbumClick(album.path)}
        isCompactMode={false}
        isVisible={true}
        isFavoritesPage={true}
      />
    );
  };
  
  // 渲染相簿列表
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
    
    return (
      <Grid container spacing={2}>
        {albums.map(album => (
          <Grid item xs={12} sm={6} md={4} lg={3} key={album.id}>
            {renderAlbumCard(album)}
          </Grid>
        ))}
      </Grid>
    );
  };
  
  // 渲染图片列表
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
    
    return (
      <Masonry
        breakpointCols={getMasonryBreakpoints()}
        className={`masonry-grid ${compactView ? 'compact-view' : 'standard-view'}`}
        columnClassName="masonry-grid_column"
      >
        {images.map((image, index) => (
          <div 
            key={`${image.path}-${index}`} 
            className="masonry-item"
          >
            <ImageCard 
              image={image} 
              onClick={() => handleImageClick(image, index)}
              isCompactMode={compactView}
              onLoad={handleImageLoad}
              isFavoritesPage={true}
            />
          </div>
        ))}
      </Masonry>
    );
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
      
      <Box sx={{ flexGrow: 1, overflow: 'auto', p: 2 }}>
        {isLoading ? (
          <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '50vh' }}>
            <CircularProgress />
          </Box>
        ) : (
          <Box>
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