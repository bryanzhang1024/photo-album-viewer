import React, { useState, useEffect } from 'react';
import {
  Box,
  Typography,
  Switch,
  FormControlLabel,
  FormControl,
  FormLabel,
  RadioGroup,
  Radio,
  Paper,
  Button,
  Divider,
  Container,
  IconButton,
  AppBar,
  Toolbar,
  Snackbar,
  Alert,
} from '@mui/material';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import Brightness4Icon from '@mui/icons-material/Brightness4';
import Brightness7Icon from '@mui/icons-material/Brightness7';
import FolderOpenIcon from '@mui/icons-material/FolderOpen';
import OpenInNewIcon from '@mui/icons-material/OpenInNew';
import { useNavigate } from 'react-router-dom';
import { useSettings } from '../contexts/SettingsContext';
import { clearAllCache } from '../utils/cacheUtils';
import imageCache from '../utils/ImageCacheManager';
import CHANNELS from '../../common/ipc-channels';

const electron = window.require ? window.require('electron') : null;
const ipcRenderer = electron ? electron.ipcRenderer : null;

const formatBytes = (bytes = 0) => {
  const numeric = Number(bytes);
  if (!Number.isFinite(numeric) || numeric <= 0) return '0 B';

  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let value = numeric;
  let unitIndex = 0;

  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }

  return `${value.toFixed(unitIndex === 0 ? 0 : 2)} ${units[unitIndex]}`;
};

function SettingsPage({ colorMode }) {
  const { settings, updateSetting, resetSettings } = useSettings();
  const navigate = useNavigate();
  const [error, setError] = useState('');
  const [successMessage, setSuccessMessage] = useState('');
  const [cacheStatsLoading, setCacheStatsLoading] = useState(false);
  const [cacheStats, setCacheStats] = useState({
    renderer: null,
    main: null
  });

  const handleToggle = (key) => (event) => {
    updateSetting(key, event.target.checked);
  };

  const handleRadioChange = (key) => (event) => {
    updateSetting(key, event.target.value);
  };

  const handleSelectDirectory = async () => {
    if (!ipcRenderer) return;
    try {
      const selectedDir = await ipcRenderer.invoke(CHANNELS.SELECT_DIRECTORY);
      if (selectedDir) {
        // 仅更新默认目录，不触发导航，避免打断标签页会话
        localStorage.setItem('lastRootPath_default', selectedDir);
        setSuccessMessage('默认启动目录已更新。浏览文件夹请在主界面标签栏使用“打开文件夹”。');
      }
    } catch (err) {
      setError('选择文件夹时出错: ' + err.message);
    }
  };

  const handleOpenNewInstance = async () => {
    if (!ipcRenderer) return;
    try {
      const selectedDir = await ipcRenderer.invoke(CHANNELS.SELECT_DIRECTORY);
      if (selectedDir) {
        const result = await ipcRenderer.invoke(CHANNELS.CREATE_NEW_INSTANCE, selectedDir);
        if (result.success) {
          setSuccessMessage('已在新窗口打开所选文件夹。');
        } else {
          setError('启动新实例失败: ' + result.error);
        }
      }
    } catch (err) {
      setError('启动新实例时出错: ' + err.message);
    }
  };

  const loadCacheStats = async () => {
    setCacheStatsLoading(true);
    try {
      const rendererStats = imageCache.getStats();
      let mainStats = null;

      if (ipcRenderer) {
        const response = await ipcRenderer.invoke(CHANNELS.GET_CACHE_STATS);
        if (response?.success) {
          mainStats = response;
        }
      }

      setCacheStats({
        renderer: rendererStats,
        main: mainStats
      });
    } catch (err) {
      console.error('加载缓存统计失败:', err);
      setError('加载缓存统计失败: ' + err.message);
    } finally {
      setCacheStatsLoading(false);
    }
  };

  const handleClearCache = () => {
    clearAllCache();
    setTimeout(() => {
      loadCacheStats();
    }, 300);
  };

  useEffect(() => {
    loadCacheStats();
  }, []);

  return (
    <Box sx={{ height: '100vh', display: 'flex', flexDirection: 'column' }}>
      <AppBar position="static" elevation={0}>
        <Toolbar>
          <IconButton
            edge="start"
            color="inherit"
            onClick={() => navigate(-1)}
            sx={{ mr: 2 }}
          >
            <ArrowBackIcon />
          </IconButton>
          <Typography variant="h6" component="div" sx={{ flexGrow: 1 }}>
            设置
          </Typography>
        </Toolbar>
      </AppBar>

      <Container maxWidth="md" sx={{ py: 4, flexGrow: 1, overflowY: 'auto' }}>

        <Paper elevation={1} sx={{ p: 3, mb: 3 }}>
          <Typography variant="h6" gutterBottom>
            数据源
          </Typography>
          <Box sx={{ display: 'flex', gap: 2, mt: 2 }}>
            <Button
              variant="contained"
              startIcon={<FolderOpenIcon />}
              onClick={handleSelectDirectory}
            >
              设置默认目录
            </Button>
            <Button
              variant="outlined"
              startIcon={<OpenInNewIcon />}
              onClick={handleOpenNewInstance}
            >
              在新窗口中打开
            </Button>
          </Box>
          <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
            这里用于设置默认启动目录。日常浏览建议在主界面标签栏使用“打开文件夹”，可选择在当前标签、新标签或新窗口打开。
          </Typography>
        </Paper>

        <Paper elevation={1} sx={{ p: 3, mb: 3 }}>
          <Typography variant="h6" gutterBottom>
            图片查看器
          </Typography>
        
        <Box sx={{ mb: 3 }}>
          <FormControlLabel
            control={
              <Switch
                checked={settings.autoRotateVerticalImages}
                onChange={handleToggle('autoRotateVerticalImages')}
              />
            }
            label="竖屏图片自动横屏显示"
            sx={{ mb: 2 }}
          />
          
          {settings.autoRotateVerticalImages && (
            <Box sx={{ ml: 4, mt: 2 }}>
              <FormControl component="fieldset">
                <FormLabel component="legend">旋转方向</FormLabel>
                <RadioGroup
                  value={settings.rotationDirection}
                  onChange={handleRadioChange('rotationDirection')}
                  row
                >
                  <FormControlLabel 
                    value="right" 
                    control={<Radio />} 
                    label="向右旋转（顺时针）" 
                  />
                  <FormControlLabel 
                    value="left" 
                    control={<Radio />} 
                    label="向左旋转（逆时针）" 
                  />
                </RadioGroup>
              </FormControl>
            </Box>
          )}
        </Box>

        <Divider sx={{ my: 2 }} />

        <Box sx={{ mb: 3 }}>
          <Typography variant="h6" gutterBottom>
            主题设置
          </Typography>

          <FormControlLabel
            control={
              <Switch
                checked={colorMode.mode === 'dark'}
                onChange={colorMode.toggleColorMode}
                icon={<Brightness7Icon />}
                checkedIcon={<Brightness4Icon />}
              />
            }
            label={colorMode.mode === 'dark' ? '深色模式' : '浅色模式'}
            sx={{ mb: 2 }}
          />
        </Box>

        <Divider sx={{ my: 2 }} />

        <Box sx={{ mb: 3 }}>
          <Typography variant="h6" gutterBottom>
            其他设置
          </Typography>

          <FormControlLabel
            control={
              <Switch
                checked={settings.showFilename}
                onChange={handleToggle('showFilename')}
              />
            }
            label="显示文件名"
            sx={{ mb: 2 }}
          />
        </Box>

        <Divider sx={{ my: 2 }} />

        <Box sx={{ mb: 3 }}>
          <Typography variant="h6" gutterBottom>
            缓存管理
          </Typography>
          <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
            <Button
              variant="contained"
              color="warning"
              onClick={handleClearCache}
            >
              清除所有缓存
            </Button>
            <Button
              variant="outlined"
              onClick={loadCacheStats}
              disabled={cacheStatsLoading}
            >
              {cacheStatsLoading ? '刷新中...' : '刷新缓存统计'}
            </Button>
          </Box>
          <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
            此操作将清除所有缩略图、相册和导航缓存。在遇到显示问题时使用。
          </Typography>

          {cacheStats.renderer && (
            <Box sx={{ mt: 2 }}>
              <Typography variant="subtitle2">渲染进程内存缓存</Typography>
              <Typography variant="body2" color="text.secondary">
                占用: {formatBytes(cacheStats.renderer.totalBytes)} / {formatBytes(cacheStats.renderer.maxBytes)}（{cacheStats.renderer.usage}）
              </Typography>
              <Typography variant="body2" color="text.secondary">
                请求: {cacheStats.renderer.requests?.totalGets ?? 0}，命中: {cacheStats.renderer.requests?.totalHits ?? 0}，未命中: {cacheStats.renderer.requests?.totalMisses ?? 0}，命中率: {cacheStats.renderer.requests?.hitRate ?? '0.00%'}
              </Typography>
            </Box>
          )}

          {cacheStats.main?.thumbnailService?.disk && (
            <Box sx={{ mt: 2 }}>
              <Typography variant="subtitle2">主进程缩略图缓存</Typography>
              <Typography variant="body2" color="text.secondary">
                磁盘占用: {formatBytes(cacheStats.main.thumbnailService.disk.size)} / {formatBytes(cacheStats.main.thumbnailService.disk.maxSize)}（{cacheStats.main.thumbnailService.disk.usage}）
              </Typography>
              <Typography variant="body2" color="text.secondary">
                服务请求: {cacheStats.main.thumbnailService.runtime.requestCount}，命中率: {cacheStats.main.thumbnailService.runtime.hitRate}%，去重命中: {cacheStats.main.thumbnailService.runtime.dedupHits}
              </Typography>
              <Typography variant="body2" color="text.secondary">
                协议命中率: {cacheStats.main.protocol.hitRate}%（请求 {cacheStats.main.protocol.requestCount}，命中 {cacheStats.main.protocol.hitCount}，未命中 {cacheStats.main.protocol.missCount}）
              </Typography>
            </Box>
          )}
        </Box>

        <Divider sx={{ my: 2 }} />

        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <Typography variant="body2" color="text.secondary">
            所有设置将自动保存
          </Typography>
          <Button 
            variant="outlined" 
            color="error"
            onClick={resetSettings}
          >
            重置所有设置
          </Button>
        </Box>
      </Paper>
    </Container>

    <Snackbar
      open={!!successMessage}
      autoHideDuration={3500}
      onClose={() => setSuccessMessage('')}
      anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
    >
      <Alert onClose={() => setSuccessMessage('')} severity="success" sx={{ width: '100%' }}>
        {successMessage}
      </Alert>
    </Snackbar>

    <Snackbar
      open={!!error}
      autoHideDuration={5000}
      onClose={() => setError('')}
      anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
    >
      <Alert onClose={() => setError('')} severity="error" sx={{ width: '100%' }}>
        {error}
      </Alert>
    </Snackbar>
    </Box>
  );
}

export default SettingsPage;
