import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ChevronLeftIcon, ChevronRightIcon, InfoIcon, RotateIcon, FullscreenIcon, FitIcon,
  DualPageIcon, TrashIcon, HeartIcon, CopyIcon, RevealIcon
} from '../icons';
import { localImageUrl } from '../data/album';
import { loadFavorites, isImageFavorited, toggleImageFavorite } from '../data/favorites';
import { invoke, CHANNELS } from '../data/ipc';
import useSettings from '../hooks/useSettings';
import './viewer.css';

function formatSize(bytes) {
  if (!bytes) return '—';
  if (bytes > 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${Math.round(bytes / 1024)} KB`;
}

function formatDate(value) {
  if (!value) return '—';
  const date = new Date(value);
  const pad = (n) => String(n).padStart(2, '0');
  return `${date.getFullYear()}年${date.getMonth() + 1}月${date.getDate()}日 ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/** 大图查看器：单页 / 双页、缩放、旋转、信息面板、收藏、移到废纸篓、Esc 关闭。 */
export default function ImageViewer({ images, initialIndex = 0, title, albumPath, albumName, onClose, onDeleted }) {
  const [index, setIndex] = useState(initialIndex);
  const [zoom, setZoom] = useState(1);
  const [rotation, setRotation] = useState(0);
  const [infoOpen, setInfoOpen] = useState(false);
  const settings = useSettings();
  const [dual, setDual] = useState(Boolean(settings.defaultDualPageViewer));
  const [naturalSize, setNaturalSize] = useState(null);
  const [broken, setBroken] = useState(false);
  const [barVisible, setBarVisible] = useState(false);
  const [wrapNotice, setWrapNotice] = useState('');
  const wheelRef = useRef({ delta: 0, lastFlip: 0 });
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [favorites, setFavorites] = useState(null);
  const dragRef = useRef(null);
  const current = images[index];
  const next = images[index + 1];

  useEffect(() => {
    document.body.classList.add('viewer-open');
    return () => document.body.classList.remove('viewer-open');
  }, []);

  useEffect(() => {
    loadFavorites().then(setFavorites).catch(() => setFavorites(null));
  }, []);

  const go = useCallback((delta) => {
    setBroken(false);
    setIndex((value) => {
      const step = dual ? 2 : 1;
      const total = Math.max(1, images.length);
      const target = value + delta * step;
      if (target >= total) {
        setWrapNotice('已到末尾，已回到第一张');
        return 0;
      }
      if (target < 0) {
        setWrapNotice('已到开头，已回到最后一张');
        return Math.max(0, total - step);
      }
      return target;
    });
    setZoom(1);
    setPan({ x: 0, y: 0 });
    setRotation(0);
  }, [dual, images.length]);


  useEffect(() => {
    if (!wrapNotice) return undefined;
    const timer = setTimeout(() => setWrapNotice(''), 3000);
    return () => clearTimeout(timer);
  }, [wrapNotice]);

  // 底部工具栏默认隐藏：只有鼠标进入窗口底部区域（或悬停在工具栏本身）才出现。
  const syncBarFromPointer = (event) => {
    // 查看器是 fixed 全屏，窗口底边就是查看器底边
    const viewportHeight = window.innerHeight || 0;
    setBarVisible(viewportHeight - event.clientY <= 90);
  };

  const close = useCallback(() => onClose?.(), [onClose]);

  // 旋转方向由设置决定：默认顺时针，选逆时针时整体反向。
  const rotateBy = useCallback((steps) => {
    const direction = settings.rotationDirection === 'left' ? -1 : 1;
    setRotation((value) => value + direction * 90 * steps);
  }, [settings.rotationDirection]);

  // 竖图自动旋转：图片加载后如果是竖图且方向未动过，按设置转一次。
  const onImageLoad = (event) => {
    const image = event.currentTarget;
    setBroken(false);
    if (image.naturalWidth && image.naturalHeight) {
      setNaturalSize({ width: image.naturalWidth, height: image.naturalHeight });
    }
    if (!settings.autoRotateVerticalImages) return;
    if (rotation !== 0) return;
    if (image.naturalHeight > image.naturalWidth) {
      setRotation(settings.rotationDirection === 'left' ? -90 : 90);
    }
  };

  const toggleFullscreen = useCallback(() => {
    if (document.fullscreenElement) {
      document.exitFullscreen().catch(() => {});
    } else {
      document.documentElement.requestFullscreen().catch(() => {});
    }
  }, []);

  // 旧版双模：普通滚轮翻页，⌘/Ctrl+滚轮缩放。
  // Smooze 这类平滑滚动会连续发很多小 delta，所以累计到阈值再翻页，并加冷却。
  const onWheel = (event) => {
    event.preventDefault();
    if (event.ctrlKey || event.metaKey) {
      const factor = event.deltaY > 0 ? 0.9 : 1.1;
      setZoom((value) => Math.min(8, Math.max(0.2, value * factor)));
      return;
    }
    const now = Date.now();
    const state = wheelRef.current;
    if (now - state.lastFlip < 220) {
      state.delta = 0;
      return;
    }
    state.delta += event.deltaY;
    if (Math.abs(state.delta) >= 100) {
      state.lastFlip = now;
      const direction = state.delta > 0 ? 1 : -1;
      state.delta = 0;
      go(direction);
    }
  };

  const onMouseDown = (event) => {
    dragRef.current = { x: event.clientX, y: event.clientY, px: pan.x, py: pan.y };
  };
  const onMouseMove = (event) => {
    if (!dragRef.current) return;
    setPan({
      x: dragRef.current.px + (event.clientX - dragRef.current.x),
      y: dragRef.current.py + (event.clientY - dragRef.current.y)
    });
  };
  const endDrag = () => {
    dragRef.current = null;
  };

  const favorited = current ? isImageFavorited(favorites, current.path) : false;
  const toggleFavorite = async () => {
    if (!current) return;
    try {
      await toggleImageFavorite(current, albumPath, albumName);
      const fresh = await loadFavorites();
      setFavorites(fresh);
    } catch (error) {
      console.warn('收藏失败:', error.message);
    }
  };

  const copyCurrent = useCallback(async (mode) => {
    if (!current) return;
    try {
      const result = await invoke(CHANNELS.COPY_IMAGE_TO_CLIPBOARD, current.path, mode);
      if (!result?.success) throw new Error(result?.error || '复制失败');
    } catch (error) {
      window.alert(error?.message || '复制失败');
    }
  }, [current]);

  const revealCurrent = useCallback(async () => {
    if (!current) return;
    try {
      const result = await invoke(CHANNELS.SHOW_IN_FOLDER, current.path);
      if (!result?.success) throw new Error(result?.error || '无法在 Finder 中显示');
    } catch (error) {
      window.alert(error?.message || '无法在 Finder 中显示');
    }
  }, [current]);

  useEffect(() => {
    const onKey = (event) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        if (infoOpen) {
          setInfoOpen(false);
          return;
        }
        close();
      } else if (event.key === 'ArrowRight') {
        go(1);
      } else if (event.key === 'ArrowLeft') {
        go(-1);
      } else if (event.key === 'i' || event.key === 'I') {
        setInfoOpen((value) => !value);
      } else if (event.key === '+' || event.key === '=') {
        setZoom((value) => Math.min(8, value * (1 + settings.zoomStep)));
      } else if (event.key === '-') {
        setZoom((value) => Math.max(0.2, value / (1 + settings.zoomStep)));
      } else if ((event.metaKey || event.ctrlKey) && String(event.key).toLowerCase() === 'c') {
        event.preventDefault();
        copyCurrent(event.shiftKey ? 'image' : 'file');
      } else if (!event.metaKey && !event.ctrlKey && String(event.key).toLowerCase() === 'v') {
        setDual((value) => !value);
      } else if (!event.metaKey && !event.ctrlKey && String(event.key).toLowerCase() === 'f') {
        toggleFullscreen();
      } else if (!event.metaKey && !event.ctrlKey && String(event.key).toLowerCase() === 'e') {
        rotateBy(1);
      } else if (!event.metaKey && !event.ctrlKey && String(event.key).toLowerCase() === 'r') {
        rotateBy(-1);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [close, go, infoOpen, copyCurrent, toggleFullscreen, rotateBy, settings.zoomStep]);

  useEffect(() => {
    const onZoomCommand = (event) => {
      const command = event.detail?.command;
      if (command === 'zoom-in') {
        setZoom((value) => Math.min(8, value * (1 + settings.zoomStep)));
      } else if (command === 'zoom-out') {
        setZoom((value) => Math.max(0.2, value / (1 + settings.zoomStep)));
      } else if (command === 'zoom-reset') {
        setZoom(1);
        setPan({ x: 0, y: 0 });
      }
    };
    const onCopyCommand = () => copyCurrent('file');
    window.addEventListener('pav:viewer-zoom', onZoomCommand);
    window.addEventListener('pav:copy-image', onCopyCommand);
    return () => {
      window.removeEventListener('pav:viewer-zoom', onZoomCommand);
      window.removeEventListener('pav:copy-image', onCopyCommand);
    };
  }, [copyCurrent, settings.zoomStep]);

  const deleteCurrent = async () => {
    if (!current) return;
    const confirmed = window.confirm('把这张图片移到废纸篓？');
    if (!confirmed) return;
    const result = await invoke(CHANNELS.TRASH_IMAGE, current.path);
    if (!result?.success) {
      window.alert(result?.error || '移到废纸篓失败');
      return;
    }
    onDeleted?.(current);
    if (images.length <= 1) {
      close();
      return;
    }
    setIndex((value) => Math.min(value, images.length - 2));
  };

  if (!current) return null;
  const transform = `translate(${pan.x}px, ${pan.y}px) scale(${zoom}) rotate(${rotation}deg)`;

  return (
    <div
      className="viewer"
      role="dialog"
      aria-label="大图查看器"
      onMouseMove={syncBarFromPointer}
      onMouseLeave={() => setBarVisible(false)}
      onContextMenu={(event) => {
        event.preventDefault();
        close();
      }}
    >
      <div className="viewer-top">
        <button className="icon-button" type="button" aria-label="关闭" title="关闭查看器（Esc）"
          onClick={close}><ChevronLeftIcon /></button>
        <div className="viewer-title" title={albumPath}>
          {current.name} <span>· {index + 1}{dual && next ? `–${index + 2}` : ''} / {images.length}</span>
        </div>
        <div className="viewer-top-right">
          <button className={`icon-button${infoOpen ? ' active' : ''}`} type="button" aria-label="图片信息"
            title="图片信息（i）" aria-pressed={infoOpen}
            onClick={() => setInfoOpen((value) => !value)}><InfoIcon /></button>
          <button className={`icon-button favorite-toggle${favorited ? ' favorited' : ''}`} type="button" aria-label="收藏"
            title={favorited ? '取消收藏' : '收藏这张图片'}
            aria-pressed={favorited} onClick={toggleFavorite}><HeartIcon /></button>
        </div>
      </div>

      <div
        className="viewer-stage"
        onWheel={onWheel}
        onMouseDown={onMouseDown}
        onMouseMove={onMouseMove}
        onMouseUp={endDrag}
        onMouseLeave={endDrag}
        style={{ marginRight: infoOpen ? 300 : 0 }}
      >
        {broken ? (
          <div className="viewer-broken" role="status">
            <div>这张图片无法解码。</div>
            {index < images.length - 1 ? (
              <button className="btn-primary" type="button" onClick={() => go(1)}>看下一张</button>
            ) : (
              <button className="btn-primary" type="button" onClick={close}>关闭查看器</button>
            )}
          </div>
        ) : dual ? (
          <div className="viewer-pair">
            <img src={localImageUrl(current.path)} alt={current.name} style={{ transform }}
              draggable={false} onLoad={onImageLoad} onError={() => setBroken(true)} />
            {next ? <img src={localImageUrl(next.path)} alt={next.name} style={{ transform }}
              draggable={false} onLoad={onImageLoad} onError={() => setBroken(true)} /> : null}
          </div>
        ) : (
          <img className="viewer-image" src={localImageUrl(current.path)} alt={current.name}
            style={{ transform }} draggable={false} onLoad={onImageLoad} onError={() => setBroken(true)} />
        )}
        <button className="viewer-nav left" type="button" aria-label="上一张"
          title="上一张（←，到头会回到最后一张）" onClick={() => go(-1)}>
          <ChevronLeftIcon />
        </button>
        <button className="viewer-nav right" type="button" aria-label="下一张"
          title="下一张（→，到头会回到第一张）" onClick={() => go(1)}>
          <ChevronRightIcon />
        </button>
      </div>

      {infoOpen ? (
        <aside className="viewer-info">
          <div className="vi-head">图片信息</div>
          <dl>
            <dt>文件名</dt><dd>{current.name}</dd>
            <dt>所属</dt><dd>{albumName || title || '—'}</dd>
            <dt>大小</dt><dd>{formatSize(current.size)}</dd>
            <dt>尺寸</dt><dd>{naturalSize ? `${naturalSize.width} × ${naturalSize.height}` : '—'}</dd>
            <dt>修改时间</dt><dd>{formatDate(current.lastModified || current.mtimeMs)}</dd>
            <dt>序号</dt><dd>{index + 1} / {images.length}</dd>
            <dt>位置</dt><dd className="path">{albumPath}</dd>
          </dl>
        </aside>
      ) : null}

      <div className={`viewer-bar${barVisible ? '' : ' hidden'}`}>
        <button className="icon-button" type="button" aria-label="缩小" title="缩小（- 或 ⌘滚轮）" onClick={() => setZoom((v) => Math.max(0.2, v / (1 + settings.zoomStep)))}>−</button>
        <span className="viewer-zoom">{Math.round(zoom * 100)}%</span>
        <button className="icon-button" type="button" aria-label="放大" title="放大（+ 或 ⌘滚轮）" onClick={() => setZoom((v) => Math.min(8, v * (1 + settings.zoomStep)))}>＋</button>
        <span className="viewer-sep" />
        <button className="icon-button" type="button" aria-label="旋转" title="旋转 90°（E / R）" onClick={() => rotateBy(1)}><RotateIcon /></button>
        <button className={`icon-button${dual ? ' active' : ''}`} type="button" aria-label="双页" title="双页查看（V）" aria-pressed={dual}
          onClick={() => setDual((value) => !value)}><DualPageIcon /></button>
        <button className="icon-button" type="button" aria-label="适应窗口" title="适应窗口：缩放到能看全整张（100%）"
          onClick={() => { setZoom(1); setPan({ x: 0, y: 0 }); }}><FitIcon /></button>
        <button className="icon-button" type="button" aria-label="全屏" title="进入 / 退出全屏（F）" onClick={toggleFullscreen}><FullscreenIcon /></button>
        <span className="viewer-sep" />
        <button className="icon-button" type="button" aria-label="复制文件" title="复制原始文件，可粘贴到 Finder（⌘C）" onClick={() => copyCurrent('file')}><CopyIcon /></button>
        <button className="icon-button" type="button" aria-label="复制像素" title="复制图片像素，可粘贴到聊天或文档（⌘⇧C）" onClick={() => copyCurrent('image')}><CopyIcon /></button>
        <button className="icon-button" type="button" aria-label="在 Finder 中显示" title="在访达中显示这张图" onClick={revealCurrent}><RevealIcon /></button>
        <span className="viewer-spacer" />
        <button className="icon-button danger" type="button" aria-label="移到废纸篓" title="把这张图移到废纸篓（会二次确认）" onClick={deleteCurrent}><TrashIcon /></button>
      </div>
      {wrapNotice ? <div className="viewer-toast" role="status">{wrapNotice}</div> : null}
    </div>
  );
}
