import React, { useEffect, useState } from 'react';
import Toolbar from './shell/Toolbar';
import TabBar from './shell/TabBar';
import Sidebar from './shell/Sidebar';
import PageHeader from './shell/PageHeader';
import StatusBar from './shell/StatusBar';
import useBreakpoint from './hooks/useBreakpoint';
import { listSourceRoots } from './data/sources';

const STATUS_HINTS = '⌘[ 后退　⌘] 前进　⌘↑ 上一级　⌘F 搜索　⌘, 设置　⌘W 关闭标签';

/**
 * 4.0 外壳。S0 只搭骨架并验证数据层：侧栏的照片来源来自真实 IPC。
 * 页面内容从 S1 起按设计稿逐屏接入。
 */
export default function App() {
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [sources, setSources] = useState([]);
  const [sourceError, setSourceError] = useState('');
  const breakpoint = useBreakpoint();

  useEffect(() => {
    if (breakpoint === 'medium' || breakpoint === 'small') {
      setSidebarCollapsed(true);
    }
  }, [breakpoint]);

  useEffect(() => {
    let alive = true;
    listSourceRoots()
      .then((roots) => {
        if (alive) setSources(roots);
      })
      .catch((error) => {
        if (alive) setSourceError(error?.message || '来源加载失败');
      });
    return () => {
      alive = false;
    };
  }, []);

  return (
    <div className="app">
      <Toolbar
        title="文件夹"
        sidebarCollapsed={sidebarCollapsed}
        onToggleSidebar={() => setSidebarCollapsed((value) => !value)}
      />
      <TabBar tabs={[{ id: 'folder', title: '文件夹', active: true }]} />
      <div className="body">
        <Sidebar collapsed={sidebarCollapsed} sources={sources} sourceError={sourceError} active="folder" />
        <main className="main">
          <PageHeader title="照片来源" count="S0 · 地基" />
          <div className="content">
            <div className="s0-note">
              <h2>4.0 界面重写 · S0</h2>
              <p>
                新外壳已经跑起来：侧栏、工具栏、标签栏、页头、状态栏都来自设计稿；
                照片来源列表读的是真实 IPC。S1 开始接文件夹浏览的网格与列表。
              </p>
            </div>
          </div>
          <StatusBar
            left={sources.length > 0 ? `${sources.length} 个来源` : '未加载来源'}
            right={STATUS_HINTS}
          />
        </main>
      </div>
    </div>
  );
}
