import React, { createContext, useContext, useState, useEffect } from 'react';

const SettingsContext = createContext();

const DEFAULT_SETTINGS = {
  autoRotateVerticalImages: false,
  rotationDirection: 'right', // 'left' or 'right'
  zoomStep: 0.2,
  slideshowDelay: 3000,
  showFilename: true,
  theme: 'auto',
  homeSortGrouping: 'mixed'
};

export const useSettings = () => {
  const context = useContext(SettingsContext);
  if (!context) {
    throw new Error('useSettings must be used within a SettingsProvider');
  }
  return context;
};

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
