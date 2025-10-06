import React, { useState, useEffect, useMemo, useRef } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import HomePage from './HomePage';
import AlbumPage from './AlbumPage';
import { normalizeTargetPath, navigateToBrowsePath } from '../utils/navigation';

const parseURLPath = (pathname, search) => {
  const searchParams = new URLSearchParams(search);
  const view = searchParams.get('view');
  const image = searchParams.get('image');

  // 处理不同的路由模式
  if (pathname === '/') {
    return {
      targetPath: '',
      viewMode: 'folder',
      initialImage: null,
      isRoot: true
    };
  }

  if (pathname.startsWith('/browse/')) {
    // 新路由模式: /browse/path?view=album&image=xxx
    const pathPart = pathname.replace('/browse/', '');
    const decodedPath = pathPart ? normalizeTargetPath(decodeURIComponent(pathPart)) : '';

    return {
      targetPath: decodedPath,
      viewMode: view || 'folder',
      initialImage: image ? decodeURIComponent(image) : null,
      isRoot: !decodedPath
    };
  }

  // 处理根路径
  return {
    targetPath: '',
    viewMode: 'folder',
    initialImage: null,
    isRoot: true
  };
};

function BrowserPage({ colorMode, redirectFromOldRoute = false }) {
  const location = useLocation();
  const navigate = useNavigate();
  const params = useParams();
  const hasRestoredSession = useRef(false);

  // 解析URL状态
  const urlState = useMemo(() =>
    parseURLPath(location.pathname, location.search),
    [location.pathname, location.search]
  );

  // 处理旧路由的重定向
  useEffect(() => {
    if (redirectFromOldRoute) {
      const { albumPath } = params;
      const searchParams = new URLSearchParams(location.search);
      const image = searchParams.get('image');

      if (albumPath) {
        const targetPath = decodeURIComponent(albumPath);
        const imagePath = image ? decodeURIComponent(image) : null;
        navigateToBrowsePath(navigate, targetPath, {
          viewMode: 'album',
          initialImage: imagePath,
          replace: true,
          state: location.state
        });
      } else {
        navigate('/', { replace: true, state: location.state });
      }
    }
  }, [redirectFromOldRoute, params, location, navigate]);

  // 启动时恢复会话
  useEffect(() => {
    if (hasRestoredSession.current) {
      return;
    }

    // 已经有明确的目标路径或处于旧路由重定向流程时，不做会话恢复
    if (redirectFromOldRoute || urlState.targetPath) {
      return;
    }

    const searchParams = new URLSearchParams(location.search);
    const commandLinePath = searchParams.get('initialPath');

    if (commandLinePath) {
      hasRestoredSession.current = true;
      // 优先处理命令行传入的路径
      navigateToPath(decodeURIComponent(commandLinePath), 'folder', null, true);
      return;
    }

    const lastPath = localStorage.getItem('lastPath');
    if (lastPath) {
      hasRestoredSession.current = true;
      // 恢复上次会话的路径
      navigateToPath(lastPath, 'folder', null, true);
    }
  }, []); // 空依赖数组确保只在挂载时运行一次

  // 路径变化时保存会话
  useEffect(() => {
    if (urlState.targetPath && !urlState.isRoot) {
      localStorage.setItem('lastPath', urlState.targetPath);
    } else if (urlState.isRoot) {
      // 如果返回到根目录，可以选择清除lastPath，以便下次打开是主页
      // localStorage.removeItem('lastPath');
    }
  }, [urlState.targetPath, urlState.isRoot]);


  // 导航函数 - 供子组件使用
  const navigateToPath = (targetPath, viewMode = 'folder', initialImage = null, replace = false) => {
    navigateToBrowsePath(navigate, targetPath, { viewMode, initialImage, replace });
  };

  // 面包屑导航函数
  const navigateToBreadcrumb = (targetPath) => {
    // 根据路径类型自动判断视图模式
    // 这里可以加入路径类型检测逻辑
    navigateToPath(targetPath, 'folder');
  };

  // 相册点击处理
  const handleAlbumClick = (albumPath, albumName = null, initialImage = null) => {
    navigateToPath(albumPath, 'album', initialImage);
  };

  // 文件夹点击处理
  const handleFolderClick = (folderPath) => {
    navigateToPath(folderPath, 'folder');
  };

  // 返回处理
  const handleGoBack = () => {
    // 根据当前路径计算父路径
    if (!urlState.targetPath || urlState.isRoot) {
      return; // 已经在根目录
    }

    const parentPath = urlState.targetPath.substring(0, urlState.targetPath.lastIndexOf('/'));
    navigateToPath(parentPath, 'folder');
  };

  // 如果是重定向，不渲染内容
  if (redirectFromOldRoute) {
    return null;
  }

  // 根据视图模式渲染不同组件
  if (urlState.viewMode === 'album') {
    // 相册视图 - 增强的AlbumPage，支持URL导航
    return (
      <AlbumPage
        colorMode={colorMode}
        // 通过props传递URL状态，而不是依赖路由参数
        albumPath={urlState.targetPath}
        initialImage={urlState.initialImage}
        onNavigate={navigateToPath}
        onBreadcrumbNavigate={navigateToBreadcrumb}
        onAlbumClick={handleAlbumClick}
        onGoBack={handleGoBack}
        // 保持兼容性
        urlMode={true}
      />
    );
  } else {
    // 文件夹视图 - 增强的HomePage，支持URL导航
    return (
      <HomePage
        colorMode={colorMode}
        // 通过props传递URL状态
        currentPath={urlState.targetPath}
        onNavigate={navigateToPath}
        onBreadcrumbNavigate={navigateToBreadcrumb}
        onAlbumClick={handleAlbumClick}
        onFolderClick={handleFolderClick}
        // 保持兼容性
        urlMode={true}
      />
    );
  }
}

export default BrowserPage;
