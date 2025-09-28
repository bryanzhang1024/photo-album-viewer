import React, { useState, useEffect, useMemo } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import HomePage from './HomePage';
import AlbumPage from './AlbumPage';

// URL工具函数
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
    const decodedPath = pathPart ? decodeURIComponent(pathPart) : '';

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

// 生成新的URL
const generateURL = (targetPath, viewMode = 'folder', initialImage = null) => {
  const basePath = targetPath ? `/browse/${encodeURIComponent(targetPath)}` : '/browse';
  const params = new URLSearchParams();

  if (viewMode !== 'folder') {
    params.set('view', viewMode);
  }

  if (initialImage) {
    params.set('image', encodeURIComponent(initialImage));
  }

  const queryString = params.toString();
  return queryString ? `${basePath}?${queryString}` : basePath;
};

function BrowserPage({ colorMode, redirectFromOldRoute = false }) {
  const location = useLocation();
  const navigate = useNavigate();
  const params = useParams();

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
        // 重定向到新的URL格式
        const newURL = generateURL(
          decodeURIComponent(albumPath),
          'album',
          image ? decodeURIComponent(image) : null
        );
        navigate(newURL, { replace: true, state: location.state });
      } else {
        // 空的相册路径，重定向到根目录
        navigate('/', { replace: true, state: location.state });
      }
      return;
    }
  }, [redirectFromOldRoute, params, location, navigate]);

  // 导航函数 - 供子组件使用
  const navigateToPath = (targetPath, viewMode = 'folder', initialImage = null) => {
    const newURL = generateURL(targetPath, viewMode, initialImage);
    navigate(newURL);
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