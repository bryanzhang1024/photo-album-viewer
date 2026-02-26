import React, { useState, useEffect, useContext, useRef, useMemo } from 'react';
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
import FavoriteIcon from '@mui/icons-material/Favorite';
import CasinoIcon from '@mui/icons-material/Casino';
import SettingsIcon from '@mui/icons-material/Settings';
import { useFavorites } from '../contexts/FavoritesContext';
import ImageViewer from '../components/ImageViewer';
import AlbumCard from '../components/AlbumCard';
import ImageCard from '../components/ImageCard';
import { ScrollPositionContext } from '../App';
import { Virtuoso } from 'react-virtuoso';
import { GRID_CONFIG, DEFAULT_DENSITY, computeGridColumns, chunkIntoRows } from '../utils/virtualGrid';
import { navigateToBrowsePath } from '../utils/navigation';

// 收藏页面组件
function FavoritesPage({ colorMode }) {
  const navigate = useNavigate();
  const location = useLocation();
  const theme = useTheme();
  const isSmallScreen = useMediaQuery(theme.breakpoints.down('sm'));
  const [tabValue, setTabValue] = useState(0);
  const [sortBy, setSortBy] = useState('date');
  const [sortDirection, setSortDirection] = useState('asc');
  const [viewerOpen, setViewerOpen] = useState(false);
  const [selectedImageIndex, setSelectedImageIndex] = useState(0);
  const [viewerImages, setViewerImages] = useState([]);
  const [userDensity, setUserDensity] = useState(() => {
    const savedDensity = localStorage.getItem('userDensity');
    return (savedDensity && GRID_CONFIG[savedDensity]) ? savedDensity : DEFAULT_DENSITY;
  });
  const [windowWidth, setWindowWidth] = useState(window.innerWidth);
  const [windowHeight, setWindowHeight] = useState(window.innerHeight);
  const scrollContainerRef = useRef(null);
  const [virtualScrollParent, setVirtualScrollParent] = useState(null);
  
  // 使用收藏上下文
  const { favorites, isLoading, toggleAlbumFavorite, toggleImageFavorite } = useFavorites();
  
  // 获取滚动位置上下文
  const scrollContext = useContext(ScrollPositionContext);

  // 监听窗口大小变化
  useEffect(() => {
    const handleResize = () => {
      setWindowWidth(window.innerWidth);
      setWindowHeight(window.innerHeight);
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
    navigateToBrowsePath(navigate, albumPath, { viewMode: 'album' });
  };

  // 处理图片点击
  const handleImageClick = (index) => {
    if (scrollContainerRef.current) {
      scrollContext.savePosition(location.pathname, scrollContainerRef.current.scrollTop);
    }

    const images = sortedImages.map(img => ({
      path: img.path,
      name: img.name,
      url: img.path // 使用原始图片路径，ImageViewer会处理缩略图加载
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
    navigateToBrowsePath(navigate, albumPath, { viewMode: 'album' });
  };

  // 关闭查看器
  const handleCloseViewer = () => {
    setViewerOpen(false);
  };

  // 排序收藏的相簿
  const sortedAlbums = useMemo(() => {
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
  const sortedImages = useMemo(() => {
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

  const columnsCount = useMemo(
    () => computeGridColumns(windowWidth, userDensity, { isSmallScreen }),
    [windowWidth, userDensity, isSmallScreen]
  );

  const albumRows = useMemo(
    () => chunkIntoRows(sortedAlbums, columnsCount),
    [sortedAlbums, columnsCount]
  );

  const imageRows = useMemo(
    () => chunkIntoRows(sortedImages, columnsCount),
    [sortedImages, columnsCount]
  );

  const densityConfig = useMemo(
    () => GRID_CONFIG[userDensity] || GRID_CONFIG[DEFAULT_DENSITY],
    [userDensity]
  );

  const albumRowHeight = useMemo(() => {
    const baseHeight = densityConfig.itemWidth;
    return Math.round(baseHeight + densityConfig.gap);
  }, [densityConfig]);

  const imageRowHeight = useMemo(() => {
    const baseHeight = (densityConfig.itemWidth * 3) / 2;
    return Math.round(baseHeight + densityConfig.gap);
  }, [densityConfig]);

  const tabStyles = useMemo(() => ({
    flex: 1,
    minWidth: 0,
    minHeight: 36,
    px: { xs: 1.5, sm: 2 },
    py: 0.5,
    borderRadius: '999px',
    textTransform: 'none',
    fontWeight: 600,
    fontSize: { xs: '0.75rem', sm: '0.85rem' },
    lineHeight: 1.2,
    color: 'rgba(255,255,255,0.72)',
    border: '1px solid rgba(255,255,255,0.16)',
    transition: 'background-color 0.25s ease, color 0.25s ease, border-color 0.25s ease',
    '&.Mui-selected': {
      color: '#ffffff',
      backgroundColor: 'rgba(255,255,255,0.28)',
      borderColor: 'transparent',
      boxShadow: '0 4px 12px rgba(0,0,0,0.25)'
    },
    '&:hover': {
      backgroundColor: 'rgba(255,255,255,0.16)'
    },
    '&.Mui-focusVisible': {
      outline: '2px solid rgba(255,255,255,0.5)',
      outlineOffset: 2
    }
  }), []);

  const overscanConfig = useMemo(() => {
    const usableHeight = Math.max(windowHeight, 600);
    return {
      top: Math.round(usableHeight * 0.75),
      bottom: Math.round(usableHeight * 1.25)
    };
  }, [windowHeight]);

  const renderAlbums = () => {
    if (!sortedAlbums.length) {
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

    const rows = albumRows.length > 0 ? albumRows : [sortedAlbums];
    const effectiveColumns = Math.max(columnsCount, 1);

    return (
      <Virtuoso
        key={`favorites-albums-${userDensity}-${effectiveColumns}`}
        data={rows}
        customScrollParent={virtualScrollParent || undefined}
        overscan={Math.max(overscanConfig.top, overscanConfig.bottom)}
        increaseViewportBy={overscanConfig}
        computeItemKey={(rowIndex, row) => {
          const firstAlbum = Array.isArray(row) ? row[0] : null;
          return firstAlbum?.path ? `favorites-album-${firstAlbum.path}` : `favorites-album-${rowIndex}`;
        }}
        itemContent={(rowIndex, row) => (
          <Box
            sx={{
              display: 'grid',
              gridTemplateColumns: `repeat(${effectiveColumns}, minmax(0, 1fr))`,
              gap: `${densityConfig.gap}px`,
              mb: `${densityConfig.gap}px`,
              px: { xs: 1, sm: 2, md: 3 },
              minHeight: `${albumRowHeight}px`
            }}
          >
            {row.map((album, colIndex) => {
              const key = album?.path || `${rowIndex}-${colIndex}`;
              return (
                <Box key={key} sx={{ width: '100%' }}>
                  <AlbumCard
                    album={album}
                    displayPath={album.path}
                    onClick={() => handleAlbumClick(album.path)}
                    isCompactMode={userDensity === 'compact'}
                    isFavoritesPage={true}
                    isVisible={true}
                  />
                </Box>
              );
            })}
          </Box>
        )}
      />
    );
  };

  const renderImages = () => {
    if (!sortedImages.length) {
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

    const rows = imageRows.length > 0 ? imageRows : [sortedImages];
    const effectiveColumns = Math.max(columnsCount, 1);

    return (
      <Virtuoso
        key={`favorites-images-${userDensity}-${effectiveColumns}`}
        data={rows}
        customScrollParent={virtualScrollParent || undefined}
        overscan={Math.max(overscanConfig.top, overscanConfig.bottom)}
        increaseViewportBy={overscanConfig}
        computeItemKey={(rowIndex, row) => {
          const firstImage = Array.isArray(row) ? row[0] : null;
          return firstImage?.path ? `favorites-image-${firstImage.path}` : `favorites-image-${rowIndex}`;
        }}
        itemContent={(rowIndex, row) => (
          <Box
            sx={{
              display: 'grid',
              gridTemplateColumns: `repeat(${effectiveColumns}, minmax(0, 1fr))`,
              gap: `${densityConfig.gap}px`,
              mb: `${densityConfig.gap}px`,
              px: { xs: 1, sm: 2, md: 3 },
              minHeight: `${imageRowHeight}px`
            }}
          >
            {row.map((image, colIndex) => {
              const key = image?.path || `${rowIndex}-${colIndex}`;
              const actualIndex = rowIndex * effectiveColumns + colIndex;
              return (
                <Box key={key} sx={{ width: '100%' }}>
                  <ImageCard
                    image={image}
                    onClick={() => handleImageClick(actualIndex)}
                    onAlbumClick={() => handleNavigateToAlbum(image.albumPath)}
                    isCompactMode={userDensity === 'compact'}
                    showAlbumLink={true}
                    isFavoritesPage={true}
                  />
                </Box>
              );
            })}
          </Box>
        )}
      />
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
        
        <Box
          sx={{
            mx: { xs: 1, sm: 2, md: 3 },
            mt: { xs: 0.5, sm: 1 },
            mb: { xs: 0.5, sm: 1 },
            bgcolor: 'rgba(255,255,255,0.08)',
            borderRadius: '999px',
            border: '1px solid rgba(255,255,255,0.12)',
            backdropFilter: 'blur(6px)',
            p: { xs: 0.5, sm: 0.75 }
          }}
        >
          <Tabs
            value={tabValue}
            onChange={handleTabChange}
            textColor="inherit"
            variant="fullWidth"
            aria-label="收藏内容标签页"
            TabIndicatorProps={{ sx: { display: 'none' } }}
            sx={{
              minHeight: 'auto',
              '& .MuiTabs-flexContainer': {
                gap: 0.5
              }
            }}
          >
            <Tab
              label={`相簿 (${favorites.albums.length})`}
              disableRipple
              sx={tabStyles}
            />
            <Tab
              label={`图片 (${favorites.images.length})`}
              disableRipple
              sx={tabStyles}
            />
          </Tabs>
        </Box>
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
