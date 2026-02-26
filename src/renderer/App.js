import React, { useState, useEffect, useMemo, createContext } from 'react';
import { Routes, Route } from 'react-router-dom';
import { ThemeProvider, createTheme } from '@mui/material/styles';
import CssBaseline from '@mui/material/CssBaseline';
import useMediaQuery from '@mui/material/useMediaQuery';
import BrowserPage from './pages/BrowserPage';
import FavoritesPage from './pages/FavoritesPage';
import TestPage from './pages/TestPage';
import SettingsPage from './pages/SettingsPage';
import { FavoritesProvider } from './contexts/FavoritesContext';
import { SettingsProvider } from './contexts/SettingsContext';
import CHANNELS from '../common/ipc-channels';

const electron = window.require ? window.require('electron') : null;
const ipcRenderer = electron ? electron.ipcRenderer : null;
const PERFORMANCE_SETTINGS_KEY = 'performance_settings';

function sanitizePerformanceSettings(settings) {
  if (!settings || typeof settings !== 'object') {
    return null;
  }

  const sanitized = {};

  if (typeof settings.concurrentTasks !== 'undefined') {
    const numeric = Number(settings.concurrentTasks);
    if (Number.isFinite(numeric)) {
      sanitized.concurrentTasks = Math.max(1, Math.min(8, Math.floor(numeric)));
    }
  }

  if (typeof settings.preloadDistance !== 'undefined') {
    const numeric = Number(settings.preloadDistance);
    if (Number.isFinite(numeric)) {
      sanitized.preloadDistance = Math.max(0, Math.min(20, Math.floor(numeric)));
    }
  }

  if (typeof settings.cacheTimeout !== 'undefined') {
    const numeric = Number(settings.cacheTimeout);
    if (Number.isFinite(numeric)) {
      sanitized.cacheTimeout = Math.max(1, Math.min(24 * 60, Math.floor(numeric)));
    }
  }

  if (typeof settings.cacheEnabled === 'boolean') {
    sanitized.cacheEnabled = settings.cacheEnabled;
  }

  if (typeof settings.thumbnailResolution !== 'undefined') {
    const numeric = Number(settings.thumbnailResolution);
    if (Number.isFinite(numeric)) {
      sanitized.thumbnailResolution = Math.max(100, Math.min(3000, Math.floor(numeric)));
    }
  }

  return Object.keys(sanitized).length > 0 ? sanitized : null;
}

// 创建一个上下文来保存滚动位置
export const ScrollPositionContext = createContext({
  positions: {},
  savePosition: () => {},
  getPosition: () => 0
});

function App() {
  // 检测系统偏好的颜色方案
  const prefersDarkMode = useMediaQuery('(prefers-color-scheme: dark)');

  // 从本地存储获取用户设置的主题模式
  const [mode, setMode] = useState(() => {
    const savedMode = localStorage.getItem('themeMode');
    return savedMode || (prefersDarkMode ? 'dark' : 'light');
  });

  // 保存滚动位置的状态
  const [scrollPositions, setScrollPositions] = useState({});

  // 动态设置CSS变量以支持主题切换的滚动条样式
  useEffect(() => {
    const root = document.documentElement;
    if (mode === 'dark') {
      root.style.setProperty('--scrollbar-track', '#2a2a2a');
      root.style.setProperty('--scrollbar-thumb', '#555555');
      root.style.setProperty('--scrollbar-thumb-hover', '#777777');
    } else {
      root.style.setProperty('--scrollbar-track', '#f1f1f1');
      root.style.setProperty('--scrollbar-thumb', '#c1c1c1');
      root.style.setProperty('--scrollbar-thumb-hover', '#a8a8a8');
    }
  }, [mode]);

  useEffect(() => {
    if (!ipcRenderer) return;

    const raw = localStorage.getItem(PERFORMANCE_SETTINGS_KEY);
    if (!raw) return;

    try {
      const parsed = JSON.parse(raw);
      const sanitized = sanitizePerformanceSettings(parsed);
      if (!sanitized) return;

      ipcRenderer.invoke(CHANNELS.UPDATE_PERFORMANCE_SETTINGS, sanitized)
        .catch((err) => {
          console.warn('同步性能设置到主进程失败:', err);
        });
    } catch (error) {
      console.warn('解析性能设置失败，已忽略:', error);
    }
  }, []);
  
  // 当系统偏好变化时更新主题（如果用户没有明确设置）
  useEffect(() => {
    if (!localStorage.getItem('themeMode')) {
      setMode(prefersDarkMode ? 'dark' : 'light');
    }
  }, [prefersDarkMode]);
  
  // 切换主题模式的函数
  const toggleColorMode = () => {
    const newMode = mode === 'light' ? 'dark' : 'light';
    setMode(newMode);
    localStorage.setItem('themeMode', newMode);
  };
  
  // 创建主题对象
  const theme = useMemo(() => createTheme({
    palette: {
      mode,
      primary: {
        main: mode === 'dark' ? '#90caf9' : '#3f51b5',
      },
      secondary: {
        main: mode === 'dark' ? '#f48fb1' : '#f50057',
      },
      background: {
        default: mode === 'dark' ? '#121212' : '#f5f5f5',
        paper: mode === 'dark' ? '#1e1e1e' : '#ffffff',
      },
    },
    typography: {
      fontFamily: [
        '-apple-system',
        'BlinkMacSystemFont',
        '"Segoe UI"',
        'Roboto',
        '"Helvetica Neue"',
        'Arial',
        'sans-serif',
      ].join(','),
    },
    components: {
      MuiCard: {
        styleOverrides: {
          root: {
            transition: 'all 0.3s ease-in-out',
            '&:hover': {
              transform: 'translateY(-4px)',
              boxShadow: mode === 'dark' 
                ? '0 12px 20px -10px rgba(0,0,0,0.6)' 
                : '0 12px 20px -10px rgba(0,0,0,0.2)',
            },
          },
        },
      },
    },
  }), [mode]);
  
  // 提供主题上下文
  const colorMode = useMemo(() => ({
    toggleColorMode,
    mode
  }), [mode]);
  
  // 滚动位置上下文
  const scrollContext = useMemo(() => ({
    positions: scrollPositions,
    savePosition: (path, position) => {
      setScrollPositions(prev => ({
        ...prev,
        [path]: position
      }));
    },
    getPosition: (path) => scrollPositions[path] || 0
  }), [scrollPositions]);

  return (
    <ThemeProvider theme={theme}>
      <CssBaseline />
      <SettingsProvider>
        <FavoritesProvider>
          <ScrollPositionContext.Provider value={scrollContext}>
            <Routes>
              <Route path="/" element={<BrowserPage colorMode={colorMode} />} />
              <Route path="/browse/*" element={<BrowserPage colorMode={colorMode} />} />
              <Route path="/test" element={<TestPage colorMode={colorMode} />} />
              <Route path="/favorites" element={<FavoritesPage colorMode={colorMode} />} />
              <Route path="/settings" element={<SettingsPage colorMode={colorMode} />} />
              {/* 兼容性路由 - 重定向旧的相册URL */}
              <Route path="/album/:albumPath" element={<BrowserPage colorMode={colorMode} redirectFromOldRoute={true} />} />
              <Route path="/album" element={<BrowserPage colorMode={colorMode} redirectFromOldRoute={true} />} />
            </Routes>
          </ScrollPositionContext.Provider>
        </FavoritesProvider>
      </SettingsProvider>
    </ThemeProvider>
  );
}

export default App; 
