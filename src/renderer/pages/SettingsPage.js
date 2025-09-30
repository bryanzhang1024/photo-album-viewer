import React, { useState } from 'react';
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
import CHANNELS from '../../common/ipc-channels';

const electron = window.require ? window.require('electron') : null;
const ipcRenderer = electron ? electron.ipcRenderer : null;

function SettingsPage({ colorMode }) {
  const { settings, updateSetting, resetSettings } = useSettings();
  const navigate = useNavigate();
  const [error, setError] = useState('');

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
        // Save to localStorage for persistence, using the default key
        localStorage.setItem('lastRootPath_default', selectedDir);
        // Navigate to home and pass the new path in state to trigger a refresh
        navigate('/', { state: { newRootPath: selectedDir } });
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
          console.log('新实例已启动');
        } else {
          setError('启动新实例失败: ' + result.error);
        }
      }
    } catch (err) {
      setError('启动新实例时出错: ' + err.message);
    }
  };

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
              打开文件夹
            </Button>
            <Button
              variant="outlined"
              startIcon={<OpenInNewIcon />}
              onClick={handleOpenNewInstance}
            >
              在新窗口中打开
            </Button>
          </Box>
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
          <Button
            variant="contained"
            color="warning"
            onClick={clearAllCache}
          >
            清除所有缓存
          </Button>
          <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
            此操作将清除所有缩略图、相册和导航缓存。在遇到显示问题时使用。
          </Typography>
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
    </Box>
  );
}

export default SettingsPage;