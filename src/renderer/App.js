import React, { useState, useEffect, useMemo, createContext } from 'react';
import { Routes, Route } from 'react-router-dom';
import { ThemeProvider, createTheme } from '@mui/material/styles';
import CssBaseline from '@mui/material/CssBaseline';
import useMediaQuery from '@mui/material/useMediaQuery';
import HomePage from './pages/HomePage';
import AlbumPage from './pages/AlbumPage';
import FavoritesPage from './pages/FavoritesPage';
import TestPage from './pages/TestPage';
import SettingsPage from './pages/SettingsPage';
import { FavoritesProvider } from './contexts/FavoritesContext';
import { SettingsProvider } from './contexts/SettingsContext';

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
              <Route path="/" element={<HomePage colorMode={colorMode} />} />
              <Route path="/test" element={<TestPage colorMode={colorMode} />} />
              <Route path="/album/:albumPath" element={<AlbumPage colorMode={colorMode} />} />
              <Route path="/favorites" element={<FavoritesPage colorMode={colorMode} />} />
              <Route path="/settings" element={<SettingsPage colorMode={colorMode} />} />
            </Routes>
          </ScrollPositionContext.Provider>
        </FavoritesProvider>
      </SettingsProvider>
    </ThemeProvider>
  );
}

export default App; 