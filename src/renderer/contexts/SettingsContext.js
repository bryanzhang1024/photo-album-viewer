import React, { createContext, useContext, useState, useEffect } from 'react';

const SettingsContext = createContext();

const DEFAULT_SETTINGS = {
  autoRotateVerticalImages: false,
  rotationDirection: 'right', // 'left' or 'right'
  zoomStep: 0.2,
  showFilename: true,
  defaultDualPageViewer: false,
  theme: 'auto',
  homeSortGrouping: 'mixed',
  // 文件夹封面：auto = 含子文件夹时拼贴、否则单图；collage = 总是拼贴；single = 总是单图
  folderCoverMode: 'auto',
  // 默认视图：grid = 图标，list = 列表
  defaultViewMode: 'grid'
};

export const useSettings = () => {
  const context = useContext(SettingsContext);
  if (!context) {
    throw new Error('useSettings must be used within a SettingsProvider');
  }
  return context;
};

/** 可选读取：不在 Provider 内时返回 null，供可独立渲染的组件使用。 */
export const useSettingsOptional = () => useContext(SettingsContext);

export const SettingsProvider = ({ children }) => {
  const [settings, setSettings] = useState(() => {
    const savedSettings = localStorage.getItem('photoViewerSettings');
    return savedSettings
      ? { ...DEFAULT_SETTINGS, ...JSON.parse(savedSettings) }
      : DEFAULT_SETTINGS;
  });

  useEffect(() => {
    localStorage.setItem('photoViewerSettings', JSON.stringify(settings));
  }, [settings]);

  const updateSetting = (key, value) => {
    setSettings(prev => ({
      ...prev,
      [key]: value
    }));
  };

  const resetSettings = () => {
    setSettings(DEFAULT_SETTINGS);
  };

  return (
    <SettingsContext.Provider value={{
      settings,
      updateSetting,
      resetSettings
    }}>
      {children}
    </SettingsContext.Provider>
  );
};
