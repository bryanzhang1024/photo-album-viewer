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
  CircularProgress,
  Alert,
  Button,
  Tooltip,
  useMediaQuery,
  useTheme,
  FormControl,
  Select,
  MenuItem,
  InputLabel,
  Badge
} from '@mui/material';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import HomeIcon from '@mui/icons-material/Home';
import SortIcon from '@mui/icons-material/Sort';
import RefreshIcon from '@mui/icons-material/Refresh';
import Brightness4Icon from '@mui/icons-material/Brightness4';
import Brightness7Icon from '@mui/icons-material/Brightness7';
import FavoriteIcon from '@mui/icons-material/Favorite';
import CasinoIcon from '@mui/icons-material/Casino';
import { useFavorites } from '../contexts/FavoritesContext';
import ImageViewer from '../components/ImageViewer';
import AlbumCard from '../components/AlbumCard';
import ImageCard from '../components/ImageCard';
import Masonry from 'react-masonry-css';
import { ScrollPositionContext } from '../App';
import './AlbumPage.css';

// 统一的布局配置 - 与HomePage和AlbumPage保持一致
const DENSITY_CONFIG = {
  compact: { baseWidth: 180, spacing: 8 },
  standard: { baseWidth: 220, spacing: 10 },
  comfortable: { baseWidth: 280, spacing: 12 }
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
  const [viewerOpen, setViewerOpen] = useState(false);
  const [selectedImageIndex, setSelectedImageIndex] = useState(0);
  const [viewerImages, setViewerImages] = useState([]);
  const [userDensity, setUserDensity] = useState('standard');
  const [windowWidth, setWindowWidth] = useState(window.innerWidth);
  const [refreshCounter, setRefreshCounter] = useState(0);
  const scrollContainerRef = useRef(null);
  
  // 使用收藏上下文
  const { favorites, isLoading, toggleAlbumFavorite, toggleImageFavorite } = useFavorites();
  
  // 获取滚动位置上下文
  const scrollContext = useContext(ScrollPositionContext);

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

  // 处理标签页切换
  const handleTabChange = (event, newValue) => {
    setTabValue(newValue);
  };
  
  // 处理返回
  const handleBack = () => {
    navigate(-1);
  };

  // 处理返回首页
  const handleHome = () => {
    if (scrollContainerRef.current) {
      scrollContext.savePosition(location.pathname, scrollContainerRef.current.scrollTop);
    }
    navigate('/');
  };

  // 处理排序方式变化
  const handleSortChange = (event) => {
    setSortBy(event.target.value);
  };

  // 处理排序方向变化
  const handleDirectionChange = () => {
    setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc');
  };

  // 处理密度变化
  const handleDensityChange = (event) => {
    const newDensity = event.target.value;
    setUserDensity(newDensity);
    localStorage.setItem('userDensity', newDensity);
  };

  // 处理相簿点击
  const handleAlbumClick = (albumPath) => {
    if (scrollContainerRef.current) {
      scrollContext.savePosition(location.pathname, scrollContainerRef.current.scrollTop);
    }
    navigate(`/album/${encodeURIComponent(albumPath)}`);
  };

  // 处理图片点击
  const handleImageClick = (image, index) => {
    if (scrollContainerRef.current) {
      scrollContext.savePosition(location.pathname, scrollContainerRef.current.scrollTop);
    }
    
    const images = sortedImages().map(img => ({
      path: img.path,
      name: img.name,
      url: img.thumbnailUrl || ''
    }));
    
    setViewerImages(images);
    setSelectedImageIndex(index);
    setViewerOpen(true);
  };

  // 处理导航到相册
  const handleNavigateToAlbum = (albumPath) => {
    if (scrollContainerRef.current) {
      scrollContext.savePosition(location.pathname, scrollContainerRef.current.scrollTop);
    }
    navigate(`/album/${encodeURIComponent(albumPath)}`);
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

  // 优化的响应式瀑布流布局 - 更精确的空间计算
  const getMasonryBreakpoints = useCallback(() => {
    const config = DENSITY_CONFIG[userDensity];
    const containerPadding = isSmallScreen ? 8 : 12;
    const scrollbarWidth = 2;
    const availableWidth = Math.max(0, windowWidth - containerPadding * 2 - scrollbarWidth);
    
    const columnWidth = config.baseWidth + config.spacing;
    const columns = Math.max(1, Math.floor((availableWidth + config.spacing) / columnWidth));
    
    return columns;
  }, [windowWidth, isSmallScreen, userDensity]);

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
      <Masonry
        key={`albums-masonry-${userDensity}-${windowWidth}`}
        breakpointCols={getMasonryBreakpoints()}
        className="masonry-grid"
        columnClassName="masonry-grid_column"
      >
        {albums.map((album) => (
          <div key={album.path} style={{ marginBottom: `${DENSITY_CONFIG[userDensity].spacing}px` }}>
            <AlbumCard
              album={album}
              displayPath={album.path}
              onClick={() => handleAlbumClick(album.path)}
              isCompactMode={userDensity === 'compact'}
            />
          </div>
        ))}
      </Masonry>
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
        key={`images-masonry-${userDensity}-${windowWidth}`}
        breakpointCols={getMasonryBreakpoints()}
        className="masonry-grid"
        columnClassName="masonry-grid_column"
      >
        {images.map((image, index) => (
          <div key={image.path} style={{ marginBottom: `${DENSITY_CONFIG[userDensity].spacing}px` }}>
            <ImageCard
              image={image}
              onClick={() => handleImageClick(image, index)}
              onAlbumClick={() => handleNavigateToAlbum(image.albumPath)}
              density={userDensity}
              showAlbumLink={true}
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
          
          <Typography variant="h6" component="div" sx={{ flexGrow: 1, fontSize: { xs: '0.9rem', sm: '1.25rem' } }}>
            我的收藏
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
                <MenuItem value="date">添加时间</MenuItem>
                <MenuItem value="count">数量</MenuItem>
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

            <IconButton 
              color="inherit" 
              onClick={() => setRefreshCounter(prev => prev + 1)} 
              size="small"
            >
              <RefreshIcon sx={{ fontSize: '1.2rem' }} />
            </IconButton>
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
        className="scroll-container"
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
            <Box sx={{ mb: 1 }}>
              <Typography variant="subtitle2" sx={{ fontSize: '0.8rem' }}>
                {tabValue === 0 
                  ? `共 ${favorites.albums.length} 个收藏的相簿` 
                  : `共 ${favorites.images.length} 张收藏的图片`
                }
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