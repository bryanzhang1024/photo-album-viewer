import React, { useState, useEffect, useRef } from 'react';
import { 
  Box, 
  Paper, 
  Typography, 
  CircularProgress, 
  IconButton 
} from '@mui/material';
import FavoriteBorderIcon from '@mui/icons-material/FavoriteBorder';
import FavoriteIcon from '@mui/icons-material/Favorite';
import DeleteIcon from '@mui/icons-material/Delete';
import { useFavorites } from '../contexts/FavoritesContext';
import imageCache from '../utils/ImageCacheManager';
import { getBasename } from '../utils/pathUtils';
import useIsVisible from '../hooks/useIsVisible';

// 安全地获取electron对象
const electron = window.require ? window.require('electron') : null;
const ipcRenderer = electron ? electron.ipcRenderer : null;

/**
 * 图片卡片组件
 *
 * @param {Object} props
 * @param {Object} props.image - 图片对象 {path, name, size}
 * @param {Function} props.onClick - 点击卡片的回调
 * @param {string} props.density - 显示密度 'compact' | 'standard' | 'comfortable' (优先使用)
 * @param {boolean} props.isCompactMode - 紧凑模式 (向后兼容,已废弃)
 * @param {Function} props.onLoad - 图片加载完成的回调
 * @param {string} props.albumPath - 相簿路径
 * @param {boolean} props.lazyLoad - 是否启用懒加载 (默认false)
 * @param {boolean} props.isFavoritesPage - 是否在收藏页面 (默认false)
 * @param {Function} props.onAlbumClick - 点击相册名称的回调
 * @param {boolean} props.showAlbumLink - 是否显示相册链接 (默认false)
 */
function ImageCard({
  image,
  onClick,
  density,
  isCompactMode,
  onLoad,
  isFavoritesPage = false,
  albumPath,
  onAlbumClick,
  showAlbumLink = false,
  lazyLoad = false
}) {
  const cardRef = useRef(null);
  const isVisible = useIsVisible(cardRef);
  const [imageUrl, setImageUrl] = useState('');
  const [loading, setLoading] = useState(lazyLoad); // 如果启用懒加载,初始为加载中
  const [aspectRatio, setAspectRatio] = useState(1); // 默认为1:1
  const [imageLoaded, setImageLoaded] = useState(false);
  const [imageError, setImageError] = useState(false);
  const [retryCount, setRetryCount] = useState(0);
  const maxRetries = 2; // 最大重试次数

  // 使用收藏上下文
  const { isImageFavorited, toggleImageFavorite } = useFavorites();
  const isFavorited = image ? isImageFavorited(image.path) : false;

  // 兼容旧参数: isCompactMode优先于density
  const actualDensity = density || (isCompactMode ? 'compact' : 'standard');

  useEffect(() => {
    let isMounted = true; // 组件挂载标志

    const loadImage = async () => {
      if (!image || !ipcRenderer) return;

      try {
        if (!isMounted) return; // 提前检查

        setLoading(true);
        setImageLoaded(false);
        setImageError(false);

        // 使用统一缓存管理器
        const cachedUrl = imageCache.get('thumbnail', image.path);
        if (cachedUrl) {
          if (!isMounted) return; // 组件已卸载，忽略结果
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

        if (!isMounted) return; // 组件已卸载，忽略结果

        if (!url) {
          console.error(`无法获取缩略图: ${image.path}`);
          setImageError(true);
          setLoading(false);
          return;
        }

        // 将文件路径转换为自定义协议URL
        const thumbnailUrl = `thumbnail-protocol://${getBasename(url)}`;

        // 缓存到统一缓存管理器
        imageCache.set('thumbnail', image.path, thumbnailUrl);

        setImageUrl(thumbnailUrl);
      } catch (err) {
        if (!isMounted) return; // 组件已卸载，忽略错误
        console.error('加载图片出错:', err);
        setImageError(true);
      } finally {
        if (isMounted) {
          setLoading(false);
        }
      }
    };

    if (lazyLoad) {
      if (isVisible) {
        loadImage();
      }
    } else {
      loadImage();
    }

    // Cleanup函数：组件卸载时执行
    return () => {
      isMounted = false;
    };
  }, [image, actualDensity, retryCount, isVisible, lazyLoad]);
  
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

  // 处理相册点击
  const handleAlbumClick = (e) => {
    e.stopPropagation(); // 阻止事件冒泡，避免触发卡片点击
    if (onAlbumClick && image) {
      onAlbumClick();
    }
  };

  // 处理收藏点击
  const handleFavoriteClick = (e) => {
    e.stopPropagation(); // 阻止事件冒泡，避免触发卡片点击
    if (image) {
      // 获取相簿名称
      const albumName = albumPath ? albumPath.split('/').pop() : image.albumName;
      toggleImageFavorite(image, albumPath || image.albumPath, albumName);
    }
  };
  
  return (
    <Paper
      ref={cardRef}
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
                borderRadius: actualDensity === 'compact' ? '2px' : actualDensity === 'standard' ? '4px' : '6px'
              }} 
              loading="lazy"
              onLoad={handleImageLoaded}
              onError={handleImageError}
            />
          </div>
        )}
      </Box>
      
      {actualDensity !== 'compact' && (
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
                sx={{ 
                  display: 'block', 
                  fontSize: '0.7rem',
                  cursor: showAlbumLink ? 'pointer' : 'default',
                  '&:hover': showAlbumLink ? { color: 'primary.main' } : {}
                }}
                onClick={showAlbumLink ? handleAlbumClick : undefined}
                title={showAlbumLink ? `点击跳转到相册: ${image.albumName || '未知相册'}` : ''}
              >
                {image.albumName || (image.size ? formatFileSize(image.size) : '')}
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
        </Box>
      )}
    </Paper>
  );
}

export default React.memo(ImageCard); 