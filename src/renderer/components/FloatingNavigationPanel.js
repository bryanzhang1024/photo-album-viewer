import React, { useState, useEffect, useRef, useCallback } from 'react';
import { getBasename, getRelativePath } from '../utils/pathUtils';
import {
  Box,
  Paper,
  IconButton,
  Typography,
  List,
  ListItem,
  ListItemIcon,
  ListItemText,
  ListItemButton,
  Collapse,
  Tooltip,
  useTheme,
  Divider,
  Chip,
  Button
} from '@mui/material';
import {
  Menu as MenuIcon,
  Folder as FolderIcon,
  FolderOpen as FolderOpenIcon,
  Image as ImageIcon,
  ChevronLeft as ChevronLeftIcon,
  ExpandMore as ExpandMoreIcon,
  ExpandLess as ExpandLessIcon,
  Home as HomeIcon,
  ArrowUpward as ArrowUpwardIcon,
  ArrowBack as ArrowBackIcon
} from '@mui/icons-material';

const FloatingNavigationPanel = ({ 
  currentPath, 
  onNavigate, 
  rootPath,
  isVisible: propIsVisible = true,
  browsingPath = null,
  onReturnToRoot = null,
  onGoToParent = null,
  onOpenAlbum = null // 新增：处理相册打开的回调
}) => {
  const theme = useTheme();
  const [isExpanded, setIsExpanded] = useState(false);
  const [isHovered, setIsHovered] = useState(false);
  const [directoryTree, setDirectoryTree] = useState([]);
  const [expandedFolders, setExpandedFolders] = useState(new Set());
  const [loading, setLoading] = useState(false);
  const panelRef = useRef(null);
  const hoverTimeoutRef = useRef(null);
  
  // 获取electron对象
  const electron = window.require ? window.require('electron') : null;
  const ipcRenderer = electron ? electron.ipcRenderer : null;

  // 自动展开/收起的延迟时间
  const HOVER_DELAY = 300;
  const LEAVE_DELAY = 500;

  // 面板可见性逻辑
  const shouldShowPanel = isExpanded || isHovered;

  // 构建目录树
  const buildDirectoryTree = useCallback(async (path) => {
    if (!ipcRenderer || !path) return [];
    
    try {
      setLoading(true);
      const result = await ipcRenderer.invoke('scan-directory-tree', path);
      setLoading(false);
      return result || [];
    } catch (error) {
      console.error('扫描目录树失败:', error);
      setLoading(false);
      return [];
    }
  }, [ipcRenderer]);

  // 初始化目录树
  useEffect(() => {
    if (rootPath) {
      buildDirectoryTree(rootPath).then(setDirectoryTree);
    }
  }, [rootPath, buildDirectoryTree]);

  // 鼠标进入处理
  const handleMouseEnter = useCallback(() => {
    if (hoverTimeoutRef.current) {
      clearTimeout(hoverTimeoutRef.current);
    }
    
    hoverTimeoutRef.current = setTimeout(() => {
      setIsHovered(true);
    }, HOVER_DELAY);
  }, []);

  // 鼠标离开处理
  const handleMouseLeave = useCallback(() => {
    if (hoverTimeoutRef.current) {
      clearTimeout(hoverTimeoutRef.current);
    }
    
    hoverTimeoutRef.current = setTimeout(() => {
      setIsHovered(false);
    }, LEAVE_DELAY);
  }, []);

  // 切换展开状态
  const toggleExpanded = useCallback(() => {
    setIsExpanded(prev => !prev);
    // 手动点击时清除悬停状态
    setIsHovered(false);
  }, []);

  // 切换文件夹展开状态
  const toggleFolderExpanded = useCallback((folderPath) => {
    setExpandedFolders(prev => {
      const newSet = new Set(prev);
      if (newSet.has(folderPath)) {
        newSet.delete(folderPath);
      } else {
        newSet.add(folderPath);
      }
      return newSet;
    });
  }, []);

  // 处理文件夹点击
  const handleFolderClick = useCallback((folderPath) => {
    if (onNavigate) {
      onNavigate(folderPath);
    }
  }, [onNavigate]);

  // 处理相册点击 - 直接打开相册页面
  const handleAlbumClick = useCallback((albumPath, albumName) => {
    if (onOpenAlbum) {
      onOpenAlbum(albumPath, albumName);
    } else {
      // 回退到导航模式
      handleFolderClick(albumPath);
    }
  }, [onOpenAlbum, handleFolderClick]);

  // 渲染目录树项
  const renderTreeItem = useCallback((item, depth = 0) => {
    const isFolder = item.type === 'folder';
    const isExpanded = expandedFolders.has(item.path);
    const isCurrentPath = currentPath === item.path;
    const hasChildren = item.children && item.children.length > 0;
    const isAlbum = isFolder && item.hasImages && !hasChildren; // 纯相册：有图片但无子目录

    return (
      <React.Fragment key={item.path}>
        <ListItemButton
          onClick={() => {
            if (isFolder) {
              if (hasChildren) {
                toggleFolderExpanded(item.path);
              }
              
              // 判断是相册还是文件夹
              if (isAlbum) {
                // 纯相册：直接打开相册页面
                handleAlbumClick(item.path, item.name);
              } else {
                // 普通文件夹：导航到文件夹视图
                handleFolderClick(item.path);
              }
            }
          }}
          selected={isCurrentPath}
          sx={{
            pl: 1 + depth * 2,
            py: 0.5,
            minHeight: 32,
            borderRadius: 1,
            mx: 0.5,
            '&.Mui-selected': {
              bgcolor: theme.palette.primary.main + '20',
              '&:hover': {
                bgcolor: theme.palette.primary.main + '30',
              }
            }
          }}
        >
          <ListItemIcon sx={{ minWidth: 32 }}>
            {isAlbum ? (
              // 纯相册：使用图片图标
              <ImageIcon fontSize="small" color="primary" />
            ) : isFolder ? (
              hasChildren ? (
                isExpanded ? <FolderOpenIcon fontSize="small" /> : <FolderIcon fontSize="small" />
              ) : (
                <FolderIcon fontSize="small" />
              )
            ) : (
              <ImageIcon fontSize="small" />
            )}
          </ListItemIcon>
          <ListItemText 
            primary={item.name}
            primaryTypographyProps={{
              variant: 'body2',
              sx: {
                fontSize: '0.8rem',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap'
              }
            }}
          />
          {isFolder && hasChildren && (
            <IconButton size="small" sx={{ p: 0.25 }}>
              {isExpanded ? <ExpandLessIcon fontSize="small" /> : <ExpandMoreIcon fontSize="small" />}
            </IconButton>
          )}
        </ListItemButton>
        
        {isFolder && hasChildren && (
          <Collapse in={isExpanded} timeout="auto" unmountOnExit>
            <List component="div" disablePadding>
              {item.children.map(child => renderTreeItem(child, depth + 1))}
            </List>
          </Collapse>
        )}
      </React.Fragment>
    );
  }, [expandedFolders, currentPath, toggleFolderExpanded, handleFolderClick, theme.palette.primary.main]);

  // 不显示面板时返回null
  if (!propIsVisible) return null;

  return (
    <>
      {/* 汉堡菜单按钮 - 始终显示 */}
      <Tooltip title={isExpanded ? "收起导航" : "展开导航"} placement="right">
        <IconButton
          onClick={toggleExpanded}
          onMouseEnter={handleMouseEnter}
          sx={{
            position: 'fixed',
            top: theme.spacing(8),
            left: theme.spacing(1),
            zIndex: theme.zIndex.drawer + 2,
            bgcolor: theme.palette.background.paper,
            boxShadow: theme.shadows[3],
            '&:hover': {
              bgcolor: theme.palette.primary.main + '10',
              boxShadow: theme.shadows[6],
            },
            transition: 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
            width: 40,
            height: 40,
          }}
        >
          {shouldShowPanel ? <ChevronLeftIcon /> : <MenuIcon />}
        </IconButton>
      </Tooltip>

      {/* 浮动导航面板 */}
      <Paper
        ref={panelRef}
        onMouseEnter={handleMouseEnter}
        onMouseLeave={handleMouseLeave}
        elevation={8}
        sx={{
          position: 'fixed',
          top: theme.spacing(8),
          left: shouldShowPanel ? theme.spacing(6) : theme.spacing(-35),
          width: 280,
          maxHeight: 'calc(100vh - 120px)',
          zIndex: theme.zIndex.drawer + 1,
          transition: 'left 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
          overflow: 'hidden',
          display: 'flex',
          flexDirection: 'column',
          bgcolor: theme.palette.background.paper,
          border: `1px solid ${theme.palette.divider}`,
        }}
      >
        {/* 头部 - 浏览路径和导航控制 */}
        <Box sx={{ 
          p: 1.5, 
          borderBottom: `1px solid ${theme.palette.divider}`,
          display: 'flex',
          flexDirection: 'column',
          gap: 1
        }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <HomeIcon fontSize="small" color="primary" />
            <Typography variant="subtitle2" sx={{ fontWeight: 600 }}>
              文件夹导航
            </Typography>
          </Box>
          
          {/* 浏览路径显示和导航控制 */}
          {browsingPath && browsingPath !== rootPath && (
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                <Chip 
                  label={
                    <Typography variant="caption" sx={{ fontSize: '0.7rem' }}>
                      {getRelativePath(rootPath, browsingPath) || browsingPath}
                    </Typography>
                  }
                  size="small"
                  color="primary"
                  sx={{ height: 24 }}
                />
              </Box>
              
              {/* 导航按钮组 */}
              <Box sx={{ display: 'flex', gap: 0.5 }}>
                {onReturnToRoot && (
                  <Tooltip title="返回根目录">
                    <IconButton 
                      size="small" 
                      onClick={onReturnToRoot}
                      sx={{ p: 0.5 }}
                    >
                      <HomeIcon fontSize="small" />
                    </IconButton>
                  </Tooltip>
                )}
                {onGoToParent && (
                  <Tooltip title="返回上级目录">
                    <IconButton 
                      size="small" 
                      onClick={onGoToParent}
                      sx={{ p: 0.5 }}
                    >
                      <ArrowUpwardIcon fontSize="small" />
                    </IconButton>
                  </Tooltip>
                )}
              </Box>
            </Box>
          )}
        </Box>

        {/* 根路径显示 */}
        {rootPath && (
          <Box sx={{ 
            px: 1.5, 
            py: 1, 
            bgcolor: theme.palette.grey[theme.palette.mode === 'dark' ? 800 : 100],
            borderBottom: `1px solid ${theme.palette.divider}`
          }}>
            <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
              根目录:
            </Typography>
            <Typography 
              variant="body2" 
              sx={{ 
                fontSize: '0.75rem',
                wordBreak: 'break-all',
                lineHeight: 1.2
              }}
            >
              {getBasename(rootPath)}
            </Typography>
          </Box>
        )}

        {/* 目录树列表 */}
        <Box sx={{ 
          flexGrow: 1, 
          overflow: 'auto',
          '&::-webkit-scrollbar': {
            width: '6px',
          },
          '&::-webkit-scrollbar-track': {
            background: theme.palette.background.default,
          },
          '&::-webkit-scrollbar-thumb': {
            background: theme.palette.grey[400],
            borderRadius: '3px',
          },
          '&::-webkit-scrollbar-thumb:hover': {
            background: theme.palette.grey[600],
          },
        }}>
          {loading ? (
            <Box sx={{ p: 2, textAlign: 'center' }}>
              <Typography variant="body2" color="text.secondary">
                加载中...
              </Typography>
            </Box>
          ) : directoryTree.length === 0 ? (
            <Box sx={{ p: 2, textAlign: 'center' }}>
              <Typography variant="body2" color="text.secondary">
                暂无可用目录
              </Typography>
            </Box>
          ) : (
            <List dense sx={{ py: 0.5 }}>
              {directoryTree.map(item => renderTreeItem(item))}
            </List>
          )}
        </Box>

        {/* 底部提示 */}
        <Divider />
        <Box sx={{ 
          px: 1.5, 
          py: 1,
          bgcolor: theme.palette.grey[theme.palette.mode === 'dark' ? 900 : 50]
        }}>
          <Typography variant="caption" color="text.secondary" sx={{ fontSize: '0.7rem' }}>
            提示: 鼠标悬停自动展开，点击文件夹可导航
          </Typography>
        </Box>
      </Paper>

      {/* 遮罩层 - 防止意外关闭 */}
      {shouldShowPanel && (
        <Box
          sx={{
            position: 'fixed',
            top: 0,
            left: 0,
            width: 320,
            height: '100vh',
            zIndex: theme.zIndex.drawer,
            pointerEvents: 'none',
          }}
        />
      )}
    </>
  );
};

export default FloatingNavigationPanel;