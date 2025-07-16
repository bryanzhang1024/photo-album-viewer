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
import Masonry from 'react-masonry-css';
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
  
  
  // 使用收藏上下文
  const { favorites, isLoading, toggleAlbumFavorite, toggleImageFavorite } = useFavorites();
  
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
  
  // 处理排序方式变化
  const handleSortChange = (event) => {
    setSortBy(event.target.value);
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

  // 简化的响应式布局 - 流体计算无最大限制
  const getColumnsPerRow = useCallback(() => {
    const config = DENSITY_CONFIG[userDensity];
    const containerPadding = isSmallScreen ? 16 : 32;
    const scrollbarWidth = 8;
    const availableWidth = Math.max(0, windowWidth - containerPadding - scrollbarWidth);
    
    // 流体计算，无最大列数限制，充分利用空间
    const columns = Math.max(1, Math.floor((availableWidth + config.spacing) / (config.baseWidth + config.spacing)));
    
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
  
  // 计算瀑布流的断点 - 使用密度配置
  const getMasonryBreakpoints = useCallback(() => {
    const densityConfig = DENSITY_CONFIG[userDensity];
    const containerPadding = isSmallScreen ? 16 : 32; // 响应式内边距
    const availableWidth = windowWidth - containerPadding;
    
    // 使用密度配置计算每行可容纳的列数
    const cardWidth = densityConfig.baseWidth;
    const cardSpacing = densityConfig.spacing;
    const maxColumns = Math.floor((availableWidth + cardSpacing) / (cardWidth + cardSpacing));
    
    // 确保至少有1列
    const columnsCount = Math.max(1, maxColumns);
    
    // 自定义断点配置，根据实际卡片宽度设置
    const breakpointCols = {
      default: columnsCount
    };
    
    return breakpointCols;
  }, [windowWidth, userDensity, compactView, isSmallScreen]);
  
  // 记录图片加载完成后的高度
  const handleImageLoad = (imagePath, height) => {
    setImageHeights(prev => ({
      ...prev,
      [imagePath]: height
    }));
  };
  
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

  // 渲染相簿列表 - 使用简化网格布局
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
    
    const columnsPerRow = getColumnsPerRow();
    
    return (
      <Grid container spacing={2}>
        {albums.map(album => {
          // 为了兼容AlbumCard组件的格式，转换收藏的相簿数据
          const albumForCard = {
            ...album,
            previewImages: album.previewImagePath ? [{ path: album.previewImagePath }] : []
          };
          
          return (
            <Grid item xs={12} sm={6} md={4} lg={3} key={album.id}>
              <AlbumCard
                album={albumForCard}
                displayPath={album.path}
                onClick={() => handleAlbumClick(album.path)}
                isCompactMode={userDensity === 'compact'}
                isVisible={true}
                isFavoritesPage={true}
              />
            </Grid>
          );
        })}
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
        className={`masonry-grid ${userDensity === 'compact' || compactView ? 'compact-view' : userDensity === 'standard' ? 'standard-view' : 'comfortable-view'}`}
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
              isCompactMode={userDensity === 'compact' || compactView}
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