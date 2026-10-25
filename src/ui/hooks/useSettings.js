import { useEffect, useState } from 'react';
import { loadSettings } from '../data/settings';

/** 读取设置并在设置窗口改动后同步刷新（localStorage + 同窗口自定义事件）。 */
export default function useSettings() {
  const [settings, setSettings] = useState(loadSettings);

  useEffect(() => {
    const sync = () => setSettings(loadSettings());
    window.addEventListener('storage', sync);
    window.addEventListener('pav:settings-changed', sync);
    return () => {
      window.removeEventListener('storage', sync);
      window.removeEventListener('pav:settings-changed', sync);
    };
  }, []);

  return settings;
}
