import React, { useState, useEffect, useRef } from 'react';
import {
  Dialog,
  AppBar,
  Toolbar,
  IconButton,
  Typography,
  Box,
  Fade,
  Tooltip,
  CircularProgress
} from '@mui/material';
import CloseIcon from '@mui/icons-material/Close';
import ArrowBackIosNewIcon from '@mui/icons-material/ArrowBackIosNew';
import ArrowForwardIosIcon from '@mui/icons-material/ArrowForwardIos';
import ZoomInIcon from '@mui/icons-material/ZoomIn';
import ZoomOutIcon from '@mui/icons-material/ZoomOut';
import FullscreenIcon from '@mui/icons-material/Fullscreen';
import FullscreenExitIcon from '@mui/icons-material/FullscreenExit';
import FolderOpenIcon from '@mui/icons-material/FolderOpen';
import FavoriteBorderIcon from '@mui/icons-material/FavoriteBorder';
import FavoriteIcon from '@mui/icons-material/Favorite';
import ShuffleIcon from '@mui/icons-material/Shuffle';
import RotateLeftIcon from '@mui/icons-material/RotateLeft';
import RotateRightIcon from '@mui/icons-material/RotateRight';
import { useFavorites } from '../contexts/FavoritesContext';
import { useSettings } from '../contexts/SettingsContext';
const { ipcRenderer } = window.require('electron');

function ImageViewer({ images, currentIndex, onClose, onIndexChange }) {
  const [zoomLevel, setZoomLevel] = useState(1);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [dragStart, setDragStart] = useState(null);
  const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const [toolbarVisible, setToolbarVisible] = useState(true);
  const [mousePosition, setMousePosition] = useState({ x: 0, y: 0 });
  const [imageDimensions, setImageDimensions] = useState({ width: 0, height: 0 });
  const [isVertical, setIsVertical] = useState(false);
  const [manualRotation, setManualRotation] = useState(0);
  const [imageLoaded, setImageLoaded] = useState(false);
  const [currentImageUrl, setCurrentImageUrl] = useState('');
  const [prevImageDimensions, setPrevImageDimensions] = useState({ width: 0, height: 0 });
  const [prevRotation, setPrevRotation] = useState(0);
  const [isTransitioning, setIsTransitioning] = useState(false);
  
  const toolbarRef = useRef(null);
  const mouseInactivityTimer = useRef(null);
  const imgRef = useRef(null);
  
  const currentImage = images[currentIndex];
  
  // 使用收藏上下文和设置上下文
  const { isImageFavorited, toggleImageFavorite } = useFavorites();
  const { settings } = useSettings();
  
  // 预加载图片并平滑过渡
  useEffect(() => {
    if (!currentImage) return;

    setIsTransitioning(true);
    setImageLoaded(false);
    
    // 创建新的图片对象进行预加载
    const img = new Image();
    img.onload = () => {
      detectImageOrientation(img);
      setIsTransitioning(false);
    };
    img.onerror = () => {
      setImageLoaded(true);
      setIsTransitioning(false);
    };
    img.src = `file://${currentImage.path}`;
    
    return () => {
      img.onload = null;
      img.onerror = null;
    };
  }, [currentImage]);

  // 预加载相邻图片
  useEffect(() => {
    if (!currentImage || images.length <= 1) return;

    const preloadImages = () => {
      const preloadIndices = [
        (currentIndex - 1 + images.length) % images.length,
        (currentIndex + 1) % images.length
      ];

      preloadIndices.forEach(index => {
        if (images[index]) {
          const img = new Image();
          img.src = `file://${images[index].path}`;
        }
      });
    };

    preloadImages();
  }, [currentIndex, images]);

  // 添加键盘导航支持
  useEffect(() => {
    const handleKeyDown = (e) => {
      switch (e.key) {
        case 'ArrowLeft':
        case 'a':
        case 'A':
          handleNavigate('prev');
          break;
        case 'ArrowRight':
        case 'd':
        case 'D':
          handleNavigate('next');
          break;
        case 'Escape':
          onClose();
          break;
        case '+':
        case '=':  // 支持不按 Shift 的 = 键
          handleZoom(1.2);
          break;
        case '-':
        case '_':  // 支持按 Shift 的 - 键
          handleZoom(0.8);
          break;
        case 'f':
          toggleFullscreen();
          break;
        case 't':
          setToolbarVisible(prev => !prev);
          break;
        case 'o':
          handleShowInFolder();
          break;
        case 'c':
          handleToggleFavorite();
          break;
        case 'r':
          handleRandomImage();
          break;
        case 'q':
          handleManualRotate('left');
          break;
        case 'e':
          handleManualRotate('right');
          break;
        default:
          break;
      }
    };
    
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [currentIndex, images.length]);
  
  // 监听全屏变化
  useEffect(() => {
    const handleFullscreenChange = () => {
      setIsFullscreen(!!document.fullscreenElement);
    };
    
    document.addEventListener('fullscreenchange', handleFullscreenChange);
    return () => document.removeEventListener('fullscreenchange', handleFullscreenChange);
  }, []);
  
  // 监听鼠标移动，控制工具栏显示
  useEffect(() => {
    const handleMouseMove = (e) => {
      // 更新鼠标位置
      setMousePosition({ x: e.clientX, y: e.clientY });
      
      // 清除之前的定时器
      if (mouseInactivityTimer.current) {
        clearTimeout(mouseInactivityTimer.current);
      }
      
      // 检查鼠标是否在工具栏附近（顶部80px区域，提前检测）
      if (e.clientY < 80) {
        setToolbarVisible(true);
      } else {
        // 如果鼠标不在工具栏附近，设置定时器在1秒后隐藏工具栏
        mouseInactivityTimer.current = setTimeout(() => {
          setToolbarVisible(false);
        }, 1000);
      }
    };
    
    // 初始隐藏工具栏
    setToolbarVisible(false);
    
    window.addEventListener('mousemove', handleMouseMove);
    
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      if (mouseInactivityTimer.current) {
        clearTimeout(mouseInactivityTimer.current);
      }
      // 清理滚轮定时器
      if (wheelStateRef.current.resetTimer) {
        clearTimeout(wheelStateRef.current.resetTimer);
      }
    };
  }, []);
  
  // 处理缩放
  const handleZoom = (factor) => {
    setZoomLevel(prev => {
      const newZoom = prev * factor;
      // 限制缩放范围
      return Math.min(Math.max(newZoom, 0.1), 5);
    });
    // 重置拖动偏移
    if (factor === 1) {
      setDragOffset({ x: 0, y: 0 });
    }
  };
  
  // 切换全屏
  const toggleFullscreen = () => {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen().then(() => {
        setIsFullscreen(true);
      }).catch(err => {
        console.error('无法进入全屏模式:', err);
      });
    } else {
      if (document.exitFullscreen) {
        document.exitFullscreen();
        setIsFullscreen(false);
      }
    }
  };
  
  // 检测图片是否为竖屏
  const detectImageOrientation = (img) => {
    if (img && img.naturalWidth && img.naturalHeight) {
      const isVerticalImg = img.naturalHeight > img.naturalWidth;
      setIsVertical(isVerticalImg);
      setImageDimensions({
        width: img.naturalWidth,
        height: img.naturalHeight
      });
      setImageLoaded(true);
    }
  };

  // 计算旋转后的图片尺寸，使其填满屏幕
  const calculateRotatedDimensions = () => {
    const rotation = calculateRotation();
    const isRotated = Math.abs(rotation) % 180 !== 0;
    
    if (!isRotated) {
      return {
        width: `${zoomLevel * 100}%`,
        height: `${zoomLevel * 100}%`,
        objectFit: 'contain'
      };
    }
    
    // 旋转90度后，需要交换宽高比例
    return {
      width: `${zoomLevel * 100}vh`,
      height: `${zoomLevel * 100}vw`,
      objectFit: 'cover',
      maxWidth: '100vh',
      maxHeight: '100vw'
    };
  };

  // 计算旋转角度
  const calculateRotation = () => {
    let rotation = manualRotation;
    
    if (settings.autoRotateVerticalImages && isVertical) {
      const autoRotation = settings.rotationDirection === 'right' ? 90 : -90;
      rotation += autoRotation;
    }
    
    return rotation;
  };

  // 导航到上一张/下一张图片
  const handleNavigate = (direction) => {
    let newIndex;
    if (direction === 'prev') {
      newIndex = currentIndex === 0 ? images.length - 1 : currentIndex - 1;
    } else {
      newIndex = currentIndex === images.length - 1 ? 0 : currentIndex + 1;
    }
    
    onIndexChange(newIndex);
  };

  // 手动旋转图片
  const handleManualRotate = (direction) => {
    const rotationAmount = direction === 'right' ? 90 : -90;
    setManualRotation(prev => prev + rotationAmount);
  };

  // 随机选择一张图片
  const handleRandomImage = () => {
    if (images.length <= 1) return;
    
    let randomIndex;
    do {
      randomIndex = Math.floor(Math.random() * images.length);
    } while (randomIndex === currentIndex);
    
    onIndexChange(randomIndex);
  };
  
  // 处理鼠标拖动开始
  const handleMouseDown = (e) => {
    // 中键点击关闭窗口
    if (e.button === 1) {
      e.preventDefault();
      onClose();
      return;
    }
    
    // 如果放大了，则开始拖动（左键拖动）
    if (e.button === 0 && zoomLevel > 1) {
      setDragStart({ x: e.clientX, y: e.clientY });
      setIsDragging(true);
    }
  };
  
  // 处理鼠标拖动
  const handleMouseMove = (e) => {
    if (dragStart && isDragging && zoomLevel > 1) {
      const deltaX = e.clientX - dragStart.x;
      const deltaY = e.clientY - dragStart.y;
      
      setDragOffset(prev => ({
        x: prev.x + deltaX,
        y: prev.y + deltaY
      }));
      
      setDragStart({ x: e.clientX, y: e.clientY });
    }
  };
  
  // 处理鼠标拖动结束
  const handleMouseUp = () => {
    setDragStart(null);
    setIsDragging(false);
  };
  
  // 处理鼠标离开
  const handleMouseLeave = () => {
    if (isDragging) {
      setIsDragging(false);
      setDragStart(null);
    }
  };
  
  // 处理右键点击 - 关闭图片
  const handleContextMenu = (e) => {
    e.preventDefault();
    onClose();
  };

  
  // 处理左键单击：界面分区导航（移除点击空白关闭）
  const handleClick = (e) => {
    // 左键单击直接执行导航，不再等待延时检测
    if (e.button === 0 && zoomLevel === 1) { // 左键点击且未缩放状态
      const rect = e.currentTarget.getBoundingClientRect();
      const clickX = e.clientX - rect.left;
      const containerWidth = rect.width;
      
      // 左侧50%区域：上一张，右侧50%区域：下一张
      if (clickX < containerWidth / 2) {
        handleNavigate('prev');
      } else {
        handleNavigate('next');
      }
    }
  };
  
  
  // 滚轮导航状态
  const wheelStateRef = useRef({
    deltaSum: 0,
    lastDirection: 0,
    resetTimer: null
  });

  // 处理鼠标滚轮：ctrl+滚轮缩放，普通滚轮翻页
  const handleWheel = (e) => {
    e.preventDefault();

    if (e.ctrlKey) {
      // ctrl+滚轮：缩放，使用简单防抖
      const zoomFactor = e.deltaY > 0 ? 0.9 : 1.1;
      handleZoom(zoomFactor);
      return;
    }

    // 普通滚轮：翻页，使用累积防抖
    const delta = e.deltaY;
    const currentDirection = Math.sign(delta);
    const wheelState = wheelStateRef.current;

    // 方向改变时立即重置累积值
    if (currentDirection !== 0 && currentDirection !== wheelState.lastDirection) {
      wheelState.deltaSum = 0;
      wheelState.lastDirection = currentDirection;
    }

    // 累积滚动量
    wheelState.deltaSum += Math.abs(delta);

    // 达到阈值时触发翻页
    if (wheelState.deltaSum >= 100) {
      const direction = currentDirection > 0 ? 'next' : 'prev';
      handleNavigate(direction);
      wheelState.deltaSum = 0; // 立即重置
    }

    // 设置重置定时器（150ms后自动清零，防止长时间累积）
    if (wheelState.resetTimer) {
      clearTimeout(wheelState.resetTimer);
    }
    wheelState.resetTimer = setTimeout(() => {
      wheelState.deltaSum = 0;
    }, 150);
  };
  
  // 在文件管理器中显示图片
  const handleShowInFolder = () => {
    if (currentImage) {
      ipcRenderer.invoke('show-in-folder', currentImage.path)
        .catch(error => console.error('在文件管理器中显示失败:', error));
    }
  };

  // 处理图片收藏切换
  const handleToggleFavorite = () => {
    if (currentImage) {
      // 获取当前相簿路径和名称
      const currentPath = currentImage.path;
      const pathParts = currentPath.split('/');
      const albumPath = pathParts.slice(0, -1).join('/');
      const albumName = pathParts[pathParts.length - 2] || '未知相簿';
      
      toggleImageFavorite(currentImage, albumPath, albumName);
    }
  };

  // 检查当前图片是否已收藏
  const isCurrentImageFavorited = currentImage ? isImageFavorited(currentImage.path) : false;
  
  return (
    <Dialog
      fullScreen
      open={true}
      onClose={onClose}
      TransitionComponent={Fade}
      transitionDuration={300}
      sx={{ 
        '& .MuiDialog-paper': { 
          bgcolor: theme => theme.palette.mode === 'dark' ? '#000' : '#121212',
          backgroundImage: theme => theme.palette.mode === 'dark' 
            ? 'linear-gradient(rgba(50,50,50,0.2) 1px, transparent 1px), linear-gradient(90deg, rgba(50,50,50,0.2) 1px, transparent 1px)'
            : 'linear-gradient(rgba(30,30,30,0.2) 1px, transparent 1px), linear-gradient(90deg, rgba(30,30,30,0.2) 1px, transparent 1px)',
          backgroundSize: '20px 20px'
        }
      }}
    >
      <AppBar 
        ref={toolbarRef}
        position="absolute" 
        sx={{ 
          bgcolor: theme => theme.palette.mode === 'dark' ? 'rgba(0,0,0,0.8)' : 'rgba(0,0,0,0.7)',
          top: 0,
          zIndex: 1100,
          transition: 'opacity 0.2s ease-in-out, transform 0.2s ease-in-out',
          opacity: toolbarVisible ? 1 : 0,
          transform: toolbarVisible ? 'translateY(0)' : 'translateY(-100%)',
          pointerEvents: toolbarVisible ? 'auto' : 'none',
          backdropFilter: 'blur(5px)',
          WebkitBackdropFilter: 'blur(5px)'
        }}
      >
        <Toolbar variant="dense" sx={{ minHeight: '40px' }}>
          <IconButton 
            edge="start" 
            color="inherit" 
            onClick={onClose}
            size="small"
          >
            <CloseIcon />
          </IconButton>
          <Typography variant="subtitle1" sx={{ ml: 2, flexGrow: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {currentImage?.name} ({currentIndex + 1} / {images.length})
          </Typography>
          <Tooltip title="随机图片 (R)">
            <IconButton 
              color="inherit" 
              onClick={handleRandomImage} 
              size="small"
              sx={{ mr: 1 }}
            >
              <ShuffleIcon />
            </IconButton>
          </Tooltip>
          <Tooltip title={isCurrentImageFavorited ? "取消收藏" : "收藏图片"}>
            <IconButton 
              color="inherit" 
              onClick={handleToggleFavorite} 
              size="small"
              sx={{ mr: 1 }}
            >
              {isCurrentImageFavorited ? <FavoriteIcon sx={{ color: '#ff5252' }} /> : <FavoriteBorderIcon />}
            </IconButton>
          </Tooltip>
          <Tooltip title="在文件管理器中显示 (O)">
            <IconButton 
              color="inherit" 
              onClick={handleShowInFolder} 
              size="small"
              sx={{ mr: 1 }}
            >
              <FolderOpenIcon />
            </IconButton>
          </Tooltip>
          <Tooltip title="缩小 (Ctrl+滚轮向下)">
            <IconButton 
              color="inherit" 
              onClick={() => handleZoom(0.8)} 
              size="small"
              sx={{ mr: 0.5 }}
            >
              <ZoomOutIcon />
            </IconButton>
          </Tooltip>
          <Tooltip title="重置缩放">
            <IconButton 
              color="inherit" 
              onClick={() => {
                setZoomLevel(1);
                setDragOffset({ x: 0, y: 0 });
              }} 
              size="small"
              sx={{ mr: 0.5 }}
            >
              <Typography variant="caption" sx={{ fontWeight: 'bold' }}>
                {Math.round(zoomLevel * 100)}%
              </Typography>
            </IconButton>
          </Tooltip>
          <Tooltip title="放大 (Ctrl+滚轮向上)">
            <IconButton 
              color="inherit" 
              onClick={() => handleZoom(1.2)} 
              size="small"
              sx={{ mr: 0.5 }}
            >
              <ZoomInIcon />
            </IconButton>
          </Tooltip>
          <Tooltip title="向左旋转 (Q)">
            <IconButton 
              color="inherit" 
              onClick={() => handleManualRotate('left')} 
              size="small"
              sx={{ mr: 0.5 }}
            >
              <RotateLeftIcon />
            </IconButton>
          </Tooltip>
          <Tooltip title="向右旋转 (E)">
            <IconButton 
              color="inherit" 
              onClick={() => handleManualRotate('right')} 
              size="small"
              sx={{ mr: 1 }}
            >
              <RotateRightIcon />
            </IconButton>
          </Tooltip>
          <Tooltip title={isFullscreen ? "退出全屏 (F)" : "全屏 (F)"}>
            <IconButton 
              color="inherit" 
              onClick={toggleFullscreen} 
              size="small"
            >
              {isFullscreen ? <FullscreenExitIcon /> : <FullscreenIcon />}
            </IconButton>
          </Tooltip>
        </Toolbar>
      </AppBar>
      
      <Box sx={{ 
        height: '100%',
        width: '100%',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        position: 'relative',
        overflow: 'hidden'
      }}
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      onMouseLeave={handleMouseLeave}
      onWheel={handleWheel}
      onContextMenu={handleContextMenu}
      onClick={handleClick}
      >
        {currentImage && (
          <img 
            ref={imgRef}
            src={`file://${currentImage.path}`}
            alt={currentImage.name}
            onLoad={(e) => detectImageOrientation(e.target)}
            style={{ 
              ...calculateRotatedDimensions(),
              transition: 'none',
              cursor: zoomLevel > 1 ? 'move' : 'default',
              transform: `translate(${dragOffset.x}px, ${dragOffset.y}px) rotate(${calculateRotation()}deg)`,
              userSelect: 'none',
              position: 'absolute',
              opacity: imageLoaded ? 1 : 0,
              visibility: imageLoaded ? 'visible' : 'hidden'
            }}
            draggable={false}
          />
        )}
        
        {(!imageLoaded || isTransitioning) && currentImage && (
          <Box sx={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            flexDirection: 'column',
            color: 'rgba(255, 255, 255, 0.7)',
            gap: 2
          }}>
            <CircularProgress size={40} thickness={4} sx={{ color: 'rgba(255, 255, 255, 0.5)' }} />
            <Typography variant="body2" sx={{ 
              fontSize: '0.9rem',
              color: 'rgba(255, 255, 255, 0.6)',
              fontWeight: 300
            }}>
              正在加载...
            </Typography>
          </Box>
        )}
      </Box>
    </Dialog>
  );
}

export default ImageViewer; 