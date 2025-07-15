import React, { useState, useEffect, useMemo, useRef } from 'react';
import { 
  Card, 
  CardContent, 
  Typography, 
  Box,
  Grid,
  Skeleton,
  Chip,
  IconButton
} from '@mui/material';
import ImageIcon from '@mui/icons-material/Image';
import FavoriteBorderIcon from '@mui/icons-material/FavoriteBorder';
import FavoriteIcon from '@mui/icons-material/Favorite';
import DeleteIcon from '@mui/icons-material/Delete';
import { useFavorites } from '../contexts/FavoritesContext';
// import LazyLoad from 'react-lazyload'; // 注释掉懒加载导入

// 安全地获取electron对象
const electron = window.require ? window.require('electron') : null;
const ipcRenderer = electron ? electron.ipcRenderer : null;

// 观察器实例 - 用于确定元素是否在可视区域内
const observers = new Map();

// 全局请求映射 - 防止重复请求
const thumbnailRequests = new Map();

// 相簿预览卡片组件
function AlbumCard({ album, displayPath, onClick, isCompactMode, isVisible = false, isFavoritesPage = false }) {
  const [previewUrls, setPreviewUrls] = useState([]);
  const [loading, setLoading] = useState(true);
  const cardRef = useRef(null);
  
  // 使用记忆化来缓存图片URLs
  const cacheKey = useMemo(() => {
    if (!album?.path) return '';
    return `album_preview_${album.path}`;
  }, [album?.path]);
  
  // 使用收藏上下文
  const { isAlbumFavorited, toggleAlbumFavorite } = useFavorites();
  const isFavorited = album ? isAlbumFavorited(album.path) : false;
  
  // 根据可见性加载预览图
  useEffect(() => {
    if (!album || !ipcRenderer) {
      setLoading(false);
      return;
    }
    
    // 先检查会话缓存
    const cachedUrls = sessionStorage.getItem(cacheKey);
    if (cachedUrls) {
      setPreviewUrls(JSON.parse(cachedUrls));
      setLoading(false);
      return;
    }

    // 如果不在可视区域内，暂时不加载预览图
    if (!isVisible) {
      return;
    }

    // 预览图请求的唯一标识，用于防止重复请求
    const requestId = `req_${album.path}`;
    
    // 检查是否已经发起了请求
    if (thumbnailRequests.has(requestId)) {
      return;
    }
    
    // 标记已经发起请求
    thumbnailRequests.set(requestId, true);
    
    const loadPreviewImages = async () => {
      try {
        setLoading(true);
        
        // 获取预览图路径
        const previews = album.previewImages || [];
        const imagePaths = previews.slice(0, 4).map(image => image.path);
        
        if (imagePaths.length === 0) {
          setLoading(false);
          return;
        }
        
        // 使用批量API请求预览图，优先级根据可见性决定
        const priority = isVisible ? 0 : 1;
        const results = await ipcRenderer.invoke('get-batch-thumbnails', imagePaths, priority);
        
        // 过滤有效的URL
        const validUrls = imagePaths
          .map(path => results[path])
          .filter(Boolean);
        
        // 缓存到会话存储
        try {
          sessionStorage.setItem(cacheKey, JSON.stringify(validUrls));
        } catch (e) {
          console.warn('缓存预览图失败', e);
          
          // 如果存储失败，尝试清理会话存储中的旧数据
          clearOldSessionCache();
          
          // 重试保存
          try {
            sessionStorage.setItem(cacheKey, JSON.stringify(validUrls));
          } catch (e2) {
            console.error('清理后仍无法保存缓存', e2);
          }
        }
        
        setPreviewUrls(validUrls);
      } catch (err) {
        console.error('加载预览图出错:', err);
      } finally {
        setLoading(false);
        
        // 请求完成后从映射中移除
        thumbnailRequests.delete(requestId);
      }
    };
    
    loadPreviewImages();
  }, [album, cacheKey, isVisible]);
  
  // 清理旧的会话缓存
  const clearOldSessionCache = () => {
    // 移除50%的缓存项目
    const keys = [];
    for (let i = 0; i < sessionStorage.length; i++) {
      const key = sessionStorage.key(i);
      if (key && key.startsWith('album_preview_')) {
        keys.push(key);
      }
    }
    
    // 按顺序删除一半的缓存
    const keysToRemove = keys.slice(0, Math.ceil(keys.length / 2));
    keysToRemove.forEach(key => sessionStorage.removeItem(key));
  };
  
  // 占位符组件
  const PreviewPlaceholder = () => (
    <Box sx={{ height: '100%', bgcolor: 'rgba(0,0,0,0.05)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <Skeleton variant="rectangular" width="100%" height="100%" />
    </Box>
  );
  
  // 根据预览图数量返回不同的预览布局
  const renderPreview = () => {
    if (loading) {
      return (
        <Box sx={{ height: '100%', position: 'relative' }}>
          <PreviewPlaceholder />
        </Box>
      );
    }
    
    if (previewUrls.length === 0) {
      return (
        <Box 
          sx={{ 
            height: '100%', 
            display: 'flex', 
            alignItems: 'center', 
            justifyContent: 'center',
            bgcolor: 'rgba(0,0,0,0.05)'
          }}
        >
          <ImageIcon sx={{ fontSize: 48, color: 'text.disabled' }} />
        </Box>
      );
    }
    
    if (previewUrls.length === 1) {
      return (
        <Box sx={{ height: '100%', position: 'relative' }}>
          <img 
            src={previewUrls[0]} 
            alt={album.name} 
            style={{ 
              width: '100%',
              height: '100%',
              objectFit: 'cover',
              borderRadius: isCompactMode ? '4px' : '4px 4px 0 0'
            }} 
            loading="lazy"
            onError={(e) => {
              e.target.onerror = null;
              e.target.src = '';
              e.target.style.display = 'none';
              e.target.parentNode.style.backgroundColor = 'rgba(0,0,0,0.05)';
            }}
          />
          <Box
            sx={{
              position: 'absolute',
              bottom: 0,
              right: 0,
              bgcolor: 'rgba(0,0,0,0.5)',
              color: 'white',
              padding: '2px 8px',
              borderRadius: '4px 0 0 0',
              fontSize: '0.75rem'
            }}
          >
            {album.imageCount || 0} 张
          </Box>
        </Box>
      );
    }
    
    // 新的预览布局 - 主图 + 侧边小图
    return (
      <Box sx={{ height: '100%', position: 'relative', display: 'flex' }}>
        {/* 主图 */}
        <Box sx={{ flexGrow: 3, height: '100%', position: 'relative' }}>
          <img 
            src={previewUrls[0]} 
            alt={`${album.name} 预览 1`} 
            style={{ 
              width: '100%',
              height: '100%',
              objectFit: 'cover',
              borderTopLeftRadius: '4px',
              borderBottomLeftRadius: isCompactMode ? '4px' : '0'
            }} 
            loading="lazy"
            onError={(e) => {
              e.target.onerror = null;
              e.target.src = '';
              e.target.style.display = 'none';
              e.target.parentNode.style.backgroundColor = 'rgba(0,0,0,0.05)';
            }}
          />
        </Box>
        
        {/* 侧边小图 - 使用绝对定位确保与主图对齐 */}
        <Box sx={{ flexGrow: 1, display: 'flex', flexDirection: 'column', ml: '1px', height: '100%' }}>
          {previewUrls.slice(1, 4).map((url, index) => {
            // 计算每个小图的高度和位置
            const totalSmallImages = Math.min(3, previewUrls.length - 1);
            const smallImageHeight = `${100 / totalSmallImages}%`;
            const marginBottom = index < totalSmallImages - 1 ? '1px' : 0;
            
            return (
              <Box 
                key={index} 
                sx={{ 
                  height: smallImageHeight,
                  mb: marginBottom,
                  position: 'relative'
                }}
              >
                <img 
                  src={url} 
                  alt={`预览 ${index + 2}`} 
                  style={{ 
                    width: '100%',
                    height: '100%',
                    objectFit: 'cover',
                    borderTopRightRadius: index === 0 ? '4px' : 0,
                    borderBottomRightRadius: (index === totalSmallImages - 1 && isCompactMode) ? '4px' : 0
                  }} 
                  loading="lazy"
                  onError={(e) => {
                    e.target.onerror = null;
                    e.target.src = '';
                    e.target.style.display = 'none';
                    e.target.parentNode.style.backgroundColor = 'rgba(0,0,0,0.05)';
                  }}
                />
              </Box>
            );
          })}
          
          {/* 如果预览图不足4张，添加空白占位 */}
          {previewUrls.length < 4 && Array.from({ length: Math.min(3, 4 - previewUrls.length) }).map((_, index) => {
            const totalEmptySpaces = Math.min(3, 4 - previewUrls.length);
            const emptySpaceHeight = `${100 / totalEmptySpaces}%`;
            const marginBottom = index < totalEmptySpaces - 1 ? '1px' : 0;
            
            return (
              <Box 
                key={`empty-${index}`}
                sx={{ 
                  height: emptySpaceHeight,
                  mb: marginBottom,
                  bgcolor: 'rgba(0,0,0,0.05)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  borderBottomRightRadius: (index === totalEmptySpaces - 1 && isCompactMode) ? '4px' : 0
                }}
              >
                <ImageIcon sx={{ fontSize: 16, color: 'text.disabled' }} />
              </Box>
            );
          })}
        </Box>
        
        {/* 图片计数标签 - 只显示数字 */}
        <Box
          sx={{
            position: 'absolute',
            bottom: 8,
            right: 8,
            bgcolor: 'rgba(0,0,0,0.6)',
            color: 'white',
            borderRadius: '50%',
            width: '24px',
            height: '24px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: '0.75rem',
            fontWeight: 'medium'
          }}
        >
          {album.imageCount || 0}
        </Box>
      </Box>
    );
  };
  
  // 处理收藏点击
  const handleFavoriteClick = (e) => {
    e.stopPropagation(); // 阻止事件冒泡，避免触发卡片点击
    if (album) {
      toggleAlbumFavorite(album);
    }
  };
  
  return (
    <Card 
      ref={cardRef}
      sx={{ 
        height: 'auto',
        minHeight: isCompactMode ? 'unset' : 320,
        display: 'flex',
        flexDirection: 'column',
        cursor: 'pointer',
        transition: 'all 0.2s ease-in-out',
        '&:hover': {
          transform: 'translateY(-4px)',
          boxShadow: '0 6px 12px rgba(0,0,0,0.15)'
        },
        overflow: 'hidden',
        borderRadius: 1
      }}
      onClick={onClick}
      elevation={1}
    >
      <Box sx={{ 
        height: isCompactMode ? 'auto' : 'auto',
        aspectRatio: isCompactMode ? '16/13' : '6/5',
        position: 'relative',
        minHeight: isCompactMode ? 160 : 220,
        width: '100%',
        // 保持固定比例，确保图片不会变形
        overflow: 'hidden'
      }}>
        <Box sx={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%' }}>
          {renderPreview()}
        </Box>
      </Box>
      
      {!isCompactMode && (
        <CardContent sx={{ flexGrow: 1, p: 1.5, pb: '8px !important', bgcolor: 'background.paper', minHeight: isCompactMode ? 0 : 60 }}>
          <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
            <Box sx={{ flexGrow: 1, overflow: 'hidden' }}>
              <Typography 
                variant="subtitle2" 
                component="div" 
                noWrap 
                title={album.name}
                sx={{ fontWeight: 'medium' }}
              >
                {album.name}
              </Typography>
              
              <Typography 
                variant="caption" 
                color="text.secondary" 
                noWrap 
                title={displayPath}
                sx={{ display: 'block', mt: 0.5, fontSize: '0.7rem' }}
              >
                {displayPath}
              </Typography>
            </Box>
            
            <IconButton 
              size="small" 
              sx={{ 
                ml: 0.5, 
                p: 0.5,
                color: isFavoritesPage ? 'error.main' : (isFavorited ? 'error.main' : 'primary.main'),
                '&:hover': {
                  color: 'error.main'
                }
              }}
              onClick={handleFavoriteClick}
              aria-label={isFavoritesPage ? "取消收藏" : (isFavorited ? "取消收藏" : "添加收藏")}
            >
              {isFavoritesPage ? 
                <DeleteIcon fontSize="small" /> : 
                (isFavorited ? <FavoriteIcon fontSize="small" /> : <FavoriteBorderIcon fontSize="small" />)
              }
            </IconButton>
          </Box>
        </CardContent>
      )}
    </Card>
  );
}

export default React.memo(AlbumCard); 