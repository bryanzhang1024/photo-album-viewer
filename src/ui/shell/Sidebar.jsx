import React from 'react';
import {
  FolderIcon, HeartIcon, CollectionsIcon, GridIcon, PersonIcon, PlusIcon
} from '../icons';

const NAV_GROUPS = [
  {
    title: '浏览',
    items: [
      { key: 'folder', label: '文件夹', icon: FolderIcon },
      { key: 'favorites', label: '我的收藏', icon: HeartIcon }
    ]
  },
  {
    title: 'Cos 图库',
    items: [
      { key: 'cos', label: 'Cos 图库', icon: CollectionsIcon },
      { key: 'cos-all', label: '全部作品', icon: GridIcon },
      { key: 'cos-characters', label: '按角色', icon: PersonIcon },
      { key: 'cos-cosers', label: '按署名', icon: PersonIcon }
    ]
  }
];

/** 同名来源用上级目录区分：/Volumes/Collection → 根；/Volumes/1TB/Collection → 1TB。 */
function sourceSuffix(source) {
  const segments = String(source.rootPath || '').split('/').filter(Boolean);
  const parent = segments.slice(0, -1);
  if (parent.length === 0 || (parent.length === 1 && parent[0] === 'Volumes')) return '根';
  return parent[parent.length - 1];
}

function sourceLabel(source, allSources) {
  const sameLabel = allSources.filter((item) => item.label === source.label);
  if (sameLabel.length < 2) return source.label;
  return `${source.label} · ${sourceSuffix(source)}`;
}

/**
 * 三段侧栏：浏览、Cos 图库、照片来源，底部「打开文件夹」。
 * 照片来源每行悬停出现移除入口；移除只删注册记录，不动磁盘。
 */
export default function Sidebar({
  collapsed,
  sources = [],
  sourceError = '',
  active = 'folder',
  onNavigate,
  onRequestRemoveSource
}) {
  return (
    <aside className="sidebar" data-collapsed={collapsed ? 'true' : 'false'} aria-label="侧栏">
      <div className="sidebar-scroll">
        {NAV_GROUPS.map((group) => (
          <React.Fragment key={group.title}>
            <div className="sidebar-group">{group.title}</div>
            {group.items.map((item) => {
              const Icon = item.icon;
              return (
                <button
                  key={item.key}
                  className="sidebar-item"
                  type="button"
                  aria-current={active === item.key ? 'page' : undefined}
                  onClick={(event) => onNavigate?.(item.key, event.currentTarget)}
                >
                  <Icon />
                  <span>{item.label}</span>
                </button>
              );
            })}
          </React.Fragment>
        ))}

        <div className="sidebar-group">照片来源</div>
        {sources.map((source) => (
          <div key={source.sourceId} className="sidebar-item-row">
            <button
              className="sidebar-item"
              type="button"
              aria-current={active === source.sourceId ? 'page' : undefined}
              title={source.rootPath}
              onClick={(event) => onNavigate?.(source.sourceId, event.currentTarget)}
            >
              <FolderIcon />
              <span>{sourceLabel(source, sources)}</span>
            </button>
            <button
              className="sidebar-item-remove"
              type="button"
              aria-label={`移除来源 ${sourceLabel(source, sources)}`}
              title="移除来源（不会删除磁盘文件）"
              onClick={(event) => onRequestRemoveSource?.(source, event.currentTarget)}
            >
              ×
            </button>
          </div>
        ))}
        {sourceError ? (
          <div className="sidebar-hint">{sourceError}</div>
        ) : sources.length === 0 ? (
          <div className="sidebar-hint">还没有照片来源</div>
        ) : null}
      </div>
      <div className="sidebar-bottom">
        <button
          className="sidebar-item"
          type="button"
          onClick={(event) => onNavigate?.('open-folder', event.currentTarget)}
        >
          <PlusIcon />
          <span>打开文件夹</span>
        </button>
      </div>
    </aside>
  );
}
