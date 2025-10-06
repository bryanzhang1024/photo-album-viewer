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
import { useTheme } from '@mui/material/styles';
import ImageIcon from '@mui/icons-material/Image';
import FolderIcon from '@mui/icons-material/Folder';
import FavoriteBorderIcon from '@mui/icons-material/FavoriteBorder';
import FavoriteIcon from '@mui/icons-material/Favorite';
import DeleteIcon from '@mui/icons-material/Delete';
import { useFavorites } from '../contexts/FavoritesContext';
import imageCache from '../utils/ImageCacheManager';
// import LazyLoad from 'react-lazyload'; // 注释掉懒加载导入

// 安全地获取electron对象
let electron = null;
let ipcRenderer = null;

try {
  electron = window.require ? window.require('electron') : null;
  ipcRenderer = electron ? electron.ipcRenderer : null;
  console.log('Electron模块加载成功');
} catch (error) {
  console.error('无法加载Electron模块:', error);
}

import useIsVisible from '../hooks/useIsVisible';
import CHANNELS from '../../common/ipc-channels';

// 观察器已移除 - 使用isVisible属性替代

// 全局请求映射 - 防止重复请求
const thumbnailRequests = new Map();

// 相簿/文件夹预览卡片组件 - 重构版本
function AlbumCard({ 
  node,           // 新的导航节点数据
  album,          // 兼容性：旧的相册数据 
  displayPath, 
  onClick, 
  isCompactMode, 
  isFavoritesPage = false 
}) {
  const [previewUrls, setPreviewUrls] = useState([]);
  const [loading, setLoading] = useState(true);
  const cardRef = useRef(null);
  const theme = useTheme();
  const isVisible = useIsVisible(cardRef); // 使用新的Hook
  
  // 数据兼容性处理：优先使用新的node数据，回退到旧的album数据
  const cardData = useMemo(() => {
    if (node) {
      return {
        path: node.path,
        name: node.name,
        type: node.type,
        imageCount: node.imageCount,
        samples: node.samples || node.previewSamples || [],
        hasImages: node.hasImages,
        childFolders: node.childFolders,
        estimatedImages: node.estimatedImages
      };
    } else if (album) {
      return {
        path: album.path,
        name: album.name,
        type: 'album',
        imageCount: album.imageCount,
        samples: album.previewImages?.map(img => img.path) || [],
        hasImages: true,
        childFolders: 0,
        estimatedImages: 0
      };
    }
    return null;
  }, [node, album]);
  
  // 使用统一缓存管理器的缓存键
  const cacheKey = useMemo(() => {
    if (!cardData?.path) return '';
    return cardData.path;
  }, [cardData?.path]);
  
  // 使用收藏上下文
  const { isAlbumFavorited, toggleAlbumFavorite } = useFavorites();
  const isFavorited = cardData ? isAlbumFavorited(cardData.path) : false;
  
  // 如果没有有效数据，返回空组件
  if (!cardData) {
    return null;
  }
  
  // 根据可见性加载预览图
  useEffect(() => {
    if (!cardData || !ipcRenderer) {
      setLoading(false);
      return;
    }
    
    // 使用统一缓存管理器
    const cachedUrls = imageCache.get('preview', cacheKey);
    if (cachedUrls) {
      setPreviewUrls(cachedUrls);
      setLoading(false);
      return;
    }

    // 如果不在可视区域内，暂时不加载预览图
    if (!isVisible) {
      return;
    }

    // 预览图请求的唯一标识，用于防止重复请求
    const requestId = `req_${cardData.path}`;
    
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
        const imagePaths = cardData.samples ? cardData.samples.slice(0, 4) : [];
        
        if (imagePaths.length === 0) {
          setLoading(false);
          return;
        }
        
        // 使用批量API请求预览图，优先级根据可见性决定
        const priority = isVisible ? 0 : 1;
        const results = await ipcRenderer.invoke(CHANNELS.GET_BATCH_THUMBNAILS, imagePaths, priority);
        
        // 过滤有效的URL
        const validUrls = imagePaths
          .map(path => results[path])
          .filter(Boolean);
        
        // 缓存到统一缓存管理器
        imageCache.set('preview', cacheKey, validUrls);
        
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
  }, [cardData, cacheKey, isVisible]);
  
  // 清理旧的会话缓存（兼容性保留）
  const clearOldSessionCache = () => {
    // 统一缓存管理器会自动处理LRU淘汰
    console.log('使用统一缓存管理器，无需手动清理');
  };
  
  // 占位符组件
  const PreviewPlaceholder = () => (
    <Box sx={{ height: '100%', bgcolor: 'rgba(0,0,0,0.05)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <Skeleton variant="rectangular" width="100%" height="100%" />
    </Box>
  );

  // 文件夹预览渲染
  const renderFolderPreview = () => {
    const hasPreviewImages = previewUrls.length > 0;
    
    return (
      <Box sx={{ height: '100%', position: 'relative', display: 'flex', flexDirection: 'column' }}>
        {/* 主要内容区域 */}
        <Box sx={{ 
          flex: 1, 
          display: 'flex', 
          alignItems: 'center', 
          justifyContent: 'center',
          bgcolor: hasPreviewImages ? 'transparent' : 'rgba(0,0,0,0.03)'
        }}>
          {hasPreviewImages ? (
            // 有预览图时的网格布局
            <Box sx={{ 
              width: '100%', 
              height: '100%',
              display: 'grid',
              gridTemplateColumns: previewUrls.length === 1 ? '1fr' : '1fr 1fr',
              gridTemplateRows: previewUrls.length <= 2 ? '1fr' : '1fr 1fr',
              gap: '2px',
              p: 1
            }}>
              {previewUrls.slice(0, 4).map((url, index) => (
                <Box
                  key={index}
                  sx={{
                    bgcolor: 'rgba(0,0,0,0.05)',
                    borderRadius: '4px',
                    overflow: 'hidden',
                    position: 'relative'
                  }}
                >
                  <img
                    src={url}
                    alt={`预览 ${index + 1}`}
                    style={{
                      width: '100%',
                      height: '100%',
                      objectFit: 'cover'
                    }}
                    onError={(e) => {
                      e.target.style.display = 'none';
                      e.target.parentNode.style.backgroundColor = 'rgba(0,0,0,0.05)';
                    }}
                  />
                </Box>
              ))}
            </Box>
          ) : (
            // 无预览图时的文件夹图标
            <FolderIcon sx={{ 
              fontSize: 64, 
              color: 'primary.main',
              opacity: 0.6
            }} />
          )}
        </Box>

        {/* 文件夹统计信息 */}
        <Box
          sx={{
            position: 'absolute',
            top: 8,
            right: 8,
            bgcolor: 'rgba(0,0,0,0.7)',
            color: 'white',
            borderRadius: '12px',
            px: 1,
            py: 0.5,
            fontSize: '0.7rem',
            fontWeight: 'medium',
            display: 'flex',
            alignItems: 'center',
            gap: 0.5
          }}
        >
          <FolderIcon sx={{ fontSize: '0.8rem' }} />
          {cardData.childFolders || 0}
        </Box>

        {/* 图片数量标签（如果有的话） */}
        {cardData.estimatedImages > 0 && (
          <Box
            sx={{
              position: 'absolute',
              bottom: 8,
              right: 8,
              bgcolor: 'rgba(25, 118, 210, 0.8)', // primary.main with opacity
              color: 'white',
              borderRadius: '12px',
              px: 1,
              py: 0.5,
              fontSize: '0.7rem',
              fontWeight: 'medium'
            }}
          >
            ~{cardData.estimatedImages} 张
          </Box>
        )}
      </Box>
    );
  };
  
  // 根据节点类型和预览图数量返回不同的预览布局
  const renderPreview = () => {
    if (!cardData) return null;

    const isFolder = cardData.type === 'folder';
    
    if (loading) {
      return (
        <Box sx={{ height: '100%', position: 'relative' }}>
          <PreviewPlaceholder />
        </Box>
      );
    }
    
    // 文件夹类型的特殊渲染
    if (isFolder) {
      return renderFolderPreview();
    }
    
    // 相册类型的原有逻辑
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
            alt={cardData.name} 
            style={{
              width: '100%',
              height: '100%',
              objectFit: 'cover',
              borderRadius: isCompactMode ? '4px' : '4px 4px 0 0'
            }}
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
            {cardData.imageCount || 0} 张
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
            alt={`${cardData.name} 预览 1`} 
            style={{ 
              width: '100%',
              height: '100%',
              objectFit: 'cover',
              borderTopLeftRadius: '4px',
              borderBottomLeftRadius: isCompactMode ? '4px' : '0'
            }}
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
          {cardData.imageCount || 0}
        </Box>
      </Box>
    );
  };
  
  // 处理收藏点击
  const handleFavoriteClick = (e) => {
    e.stopPropagation(); // 阻止事件冒泡，避免触发卡片点击
    if (cardData) {
      // 为了兼容性，构造album格式
      const albumForFavorite = {
        path: cardData.path,
        name: cardData.name,
        imageCount: cardData.imageCount
      };
      toggleAlbumFavorite(albumForFavorite);
    }
  };

  // 处理在新窗口中打开
  const handleOpenInNewWindow = (e) => {
    e.stopPropagation(); // 阻止事件冒泡
    if (!ipcRenderer) return;
    
    ipcRenderer.invoke(CHANNELS.CREATE_NEW_WINDOW, cardData.path)
      .then(result => {
        if (result.success) {
          console.log('新窗口已创建');
        }
      })
      .catch(error => {
        console.error('创建新窗口失败:', error);
      });
  };

  // 处理右键菜单
  const handleContextMenu = (e) => {
    console.log('右键事件触发', e);
    e.preventDefault();
    e.stopPropagation();
    
    if (!cardData || !cardData.path) {
      console.error('卡片数据不完整');
      return;
    }

    console.log('右键菜单触发:', cardData.name, cardData.path);

    if (!ipcRenderer) {
      console.error('ipcRenderer 不可用');
      return;
    }

    // 创建自定义右键菜单
    const createContextMenu = () => {
      // 创建菜单元素
      const menu = document.createElement('div');
      menu.style.cssText = `
        position: fixed;
        background: ${theme.palette.background.paper};
        border: 1px solid ${theme.palette.divider};
        border-radius: 4px;
        box-shadow: ${theme.shadows[4]};
        z-index: 10000;
        min-width: 180px;
        font-size: 14px;
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Roboto', sans-serif;
        color: ${theme.palette.text.primary};
      `;

      const items = [
        { text: cardData.type === 'folder' ? '在新实例中查看此文件夹' : '在新实例中查看此相册', action: handleNewInstance },
        { text: isFavorited ? '取消收藏' : '收藏', action: () => handleFavoriteClick({ stopPropagation: () => {} }) },
        { text: '在文件管理器中打开', action: handleShowInFolder }
      ];

      items.forEach((item, index) => {
        const menuItem = document.createElement('div');
        menuItem.textContent = item.text;
        menuItem.style.cssText = `
          padding: 10px 14px;
          cursor: pointer;
          ${index < items.length - 1 ? `border-bottom: 1px solid ${theme.palette.divider};` : ''}
          color: ${theme.palette.text.primary};
          transition: background-color 0.2s;
        `;
        menuItem.onmouseover = () => menuItem.style.backgroundColor = theme.palette.action.hover;
        menuItem.onmouseout = () => menuItem.style.backgroundColor = 'transparent';
        menuItem.onclick = () => {
          item.action();
          document.body.removeChild(menu);
        };
        menu.appendChild(menuItem);
      });

      // 定位菜单
      menu.style.left = `${e.clientX}px`;
      menu.style.top = `${e.clientY}px`;

      // 确保菜单在视口内
      const rect = menu.getBoundingClientRect();
      if (rect.right > window.innerWidth) {
        menu.style.left = `${window.innerWidth - rect.width - 10}px`;
      }
      if (rect.bottom > window.innerHeight) {
        menu.style.top = `${window.innerHeight - rect.height - 10}px`;
      }

      document.body.appendChild(menu);

      // 点击其他地方关闭菜单
      const closeMenu = (event) => {
        if (menu && menu.parentNode && !menu.contains(event.target)) {
          try {
            document.body.removeChild(menu);
          } catch (error) {
            // 菜单已经被移除，忽略错误
            console.warn('菜单已被移除:', error);
          }
          document.removeEventListener('click', closeMenu);
        }
      };
      setTimeout(() => document.addEventListener('click', closeMenu), 0);
      
      // 添加ESC键关闭菜单
      const handleEsc = (event) => {
        if (event.key === 'Escape') {
          if (menu && menu.parentNode) {
            try {
              document.body.removeChild(menu);
            } catch (error) {
              console.warn('菜单已被移除:', error);
            }
          }
          document.removeEventListener('keydown', handleEsc);
          document.removeEventListener('click', closeMenu);
        }
      };
      document.addEventListener('keydown', handleEsc);
    };

    createContextMenu();
  };

  // 处理在新实例中查看
  const handleNewInstance = async () => {
    if (!ipcRenderer) {
      alert('无法访问系统功能');
      return;
    }
    
    try {
      console.log('创建新实例:', cardData.path);
      const result = await ipcRenderer.invoke('create-new-instance', cardData.path);
      console.log('创建结果:', result);
      if (!result.success) {
        alert(`创建失败: ${result.error}`);
      }
    } catch (error) {
      console.error('创建新实例失败:', error);
      alert(`创建失败: ${error.message}`);
    }
  };

  // 处理在文件夹中显示
  const handleShowInFolder = async () => {
    if (!ipcRenderer) {
      alert('无法访问系统功能');
      return;
    }
    
    try {
      console.log('显示文件夹:', cardData.path);
      const result = await ipcRenderer.invoke('show-in-folder', cardData.path);
      console.log('显示结果:', result);
      if (!result.success) {
        alert(`显示失败: ${result.error}`);
      }
    } catch (error) {
      console.error('显示文件夹失败:', error);
      alert(`显示失败: ${error.message}`);
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
      onContextMenu={handleContextMenu}
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
                title={cardData.name}
                sx={{ fontWeight: 'medium' }}
              >
                {cardData.name}
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