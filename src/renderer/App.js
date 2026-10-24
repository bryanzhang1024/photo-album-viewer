import React, { useState, useEffect, useMemo, useRef, createContext } from 'react';
import { Routes, Route } from 'react-router-dom';
import { ThemeProvider } from '@mui/material/styles';
import CssBaseline from '@mui/material/CssBaseline';
import useMediaQuery from '@mui/material/useMediaQuery';
import BrowserPage from './pages/BrowserPage';
import SettingsPage from './pages/SettingsPage';
import CosLibraryPage from './pages/CosLibraryPage';
import { FavoritesProvider } from './contexts/FavoritesContext';
import { SettingsProvider } from './contexts/SettingsContext';
import CHANNELS from '../common/ipc-channels';
import Box from '@mui/material/Box';
import AppTitleBar from './components/AppTitleBar';
import { MAC_TITLEBAR_HEIGHT } from '../common/window-chrome';
import { createAppTheme } from './theme/appTheme';
import { paletteByMode } from './theme/tokens';

const ipcRenderer = window.electronAPI || null;
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
  const cosViewStates = useRef(new Map());

  // 滚动条颜色跟随主题 token
  useEffect(() => {
    const root = document.documentElement;
    const palette = paletteByMode[mode] || paletteByMode.dark;
    root.style.setProperty('--scrollbar-track', palette.scrollbarTrack);
    root.style.setProperty('--scrollbar-thumb', palette.scrollbarThumb);
    root.style.setProperty('--scrollbar-thumb-hover', palette.scrollbarThumbHover);
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
  
  // 创建主题对象（暗色为默认观感，浅色共用同一套语义 token）
  const theme = useMemo(() => createAppTheme(mode), [mode]);
  
  // 提供主题上下文
  const colorMode = useMemo(() => ({
    toggleColorMode,
    mode
  }), [mode]);
  
  // 滚动位置上下文
  const scrollContext = useMemo(() => ({
    positions: scrollPositions,
    cosViewStates: cosViewStates.current,
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
            <Box sx={{ height: '100vh', display: 'flex', flexDirection: 'column',
              '--app-chrome-height': window.electronAPI?.platform === 'darwin' ? `${MAC_TITLEBAR_HEIGHT}px` : '36px' }}>
            <AppTitleBar />
            <Box sx={{ flex: 1, minHeight: 0 }}>
            <Routes>
              <Route path="/" element={<BrowserPage colorMode={colorMode} scrollContext={scrollContext} />} />
              <Route path="/browse/*" element={<BrowserPage colorMode={colorMode} scrollContext={scrollContext} />} />
              <Route path="/favorites" element={<BrowserPage colorMode={colorMode} scrollContext={scrollContext} />} />
              <Route path="/settings" element={<SettingsPage colorMode={colorMode} />} />
              <Route path="/cos/*" element={<CosLibraryPage colorMode={colorMode} />} />
            </Routes>
            </Box>
            </Box>
          </ScrollPositionContext.Provider>
        </FavoritesProvider>
      </SettingsProvider>
    </ThemeProvider>
  );
}

export default App; 
