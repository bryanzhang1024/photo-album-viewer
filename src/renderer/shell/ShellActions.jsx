import React, { createContext, useCallback, useContext, useMemo, useState } from 'react';

const EMPTY_ACTIONS = {
  title: '照片相簿浏览器',
  canGoBack: false,
  canGoForward: false,
  goBack: null,
  goForward: null
};

const ShellActionsContext = createContext({
  actions: EMPTY_ACTIONS,
  register: () => {}
});

/**
 * 页面把自身的导航能力注册到窗口工具栏。
 * 工具栏在窗口层，页面在路由层，注册式接口避免把页面状态提升到 App。
 */
export function ShellActionsProvider({ children }) {
  const [actions, setActions] = useState(EMPTY_ACTIONS);

  const register = useCallback((next) => {
    setActions((prev) => {
      const merged = { ...prev, ...next };
      const unchanged = Object.keys(merged).every((key) => merged[key] === prev[key]);
      return unchanged ? prev : merged;
    });
  }, []);

  const value = useMemo(() => ({ actions, register }), [actions, register]);
  return <ShellActionsContext.Provider value={value}>{children}</ShellActionsContext.Provider>;
}

export function useShellActions() {
  return useContext(ShellActionsContext);
}

/** 页面侧：注册导航能力，返回稳定的 register 函数。 */
export function useShellActionsRegister() {
  return useContext(ShellActionsContext).register;
}
