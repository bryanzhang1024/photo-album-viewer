import React, { useEffect, useState } from 'react';
import {
  loadSettings, saveSettings, applyTheme, getCacheStats, clearThumbnailCache, formatBytes
} from '../../data/settings';
import { getStatus, refresh } from '../../data/cos';
import './settings.css';

const TABS = ['通用', '浏览', '缓存', '图库'];

function Row({ label, children, hint }) {
  return (
    <div className="set-row">
      <span className="set-label">{label}</span>
      {children}
      {hint ? <span className="set-hint">{hint}</span> : null}
    </div>
  );
}

function Segmented({ value, options, onChange }) {
  return (
    <span className="seg-sm">
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          className={value === option.value ? 'on' : ''}
          onClick={() => onChange(option.value)}
        >{option.label}</button>
      ))}
    </span>
  );
}

function Switch({ checked, onChange }) {
  return (
    <button
      type="button"
      className={`switch${checked ? ' on' : ''}`}
      aria-pressed={checked}
      onClick={() => onChange(!checked)}
    ><i /></button>
  );
}

/** 独立的设置窗口（760×560），四个标签，读写与旧界面同一份设置。 */
export default function SettingsPage() {
  const [tab, setTab] = useState(0);
  const [settings, setSettings] = useState(() => loadSettings());
  const [cache, setCache] = useState(null);
  const [cosStatus, setCosStatus] = useState(null);

  const update = (key, value) => {
    const next = { ...settings, [key]: value };
    setSettings(next);
    saveSettings(next);
    if (key === 'theme') applyTheme(value);
  };

  useEffect(() => {
    const api = window.electronAPI;
    if (typeof api?.on !== 'function') return undefined;
    const onCommand = (payload) => {
      const command = payload?.command;
      if (command === 'close-window' || command === 'close-tab') window.close();
    };
    const off = api.on('menu-command', onCommand);
    return () => {
      if (typeof off === 'function') off();
      else api.removeListener?.('menu-command', onCommand);
    };
  }, []);

  useEffect(() => {
    applyTheme(settings.theme);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const loadCache = () => {
    getCacheStats().then(setCache).catch(() => setCache(null));
  };

  useEffect(() => {
    if (tab === 2) loadCache();
    if (tab === 3) getStatus().then(setCosStatus).catch(() => setCosStatus(null));
  }, [tab]);

  const disk = cache?.thumbnailService?.disk;

  return (
    <div className="settings-window">
      <header className="settings-title">设置</header>
      <div className="settings-tabs">
        {TABS.map((label, index) => (
          <button
            key={label}
            type="button"
            className={`settings-tab${tab === index ? ' on' : ''}`}
            onClick={() => setTab(index)}
          >{label}</button>
        ))}
      </div>
      <div className="settings-body">
        {tab === 0 ? (
          <>
            <div className="set-title">外观</div>
            <Row label="主题">
              <Segmented
                value={settings.theme}
                options={[{ value: 'auto', label: '跟随系统' }, { value: 'dark', label: '暗色' }, { value: 'light', label: '浅色' }]}
                onChange={(value) => update('theme', value)}
              />
            </Row>
            <Row label="默认视图">
              <Segmented
                value={settings.defaultViewMode}
                options={[{ value: 'grid', label: '网格' }, { value: 'list', label: '列表' }]}
                onChange={(value) => update('defaultViewMode', value)}
              />
            </Row>
            <Row label="显示文件名">
              <Switch checked={settings.showFilename} onChange={(value) => update('showFilename', value)} />
            </Row>
            <div className="set-title" style={{ marginTop: 18 }}>查看器</div>
            <Row label="默认双页查看">
              <Switch checked={settings.defaultDualPageViewer} onChange={(value) => update('defaultDualPageViewer', value)} />
            </Row>
            <Row label="自动旋转竖图">
              <Switch checked={settings.autoRotateVerticalImages} onChange={(value) => update('autoRotateVerticalImages', value)} />
            </Row>
            {settings.autoRotateVerticalImages ? (
              <Row label="旋转方向">
                <Segmented
                  value={settings.rotationDirection}
                  options={[{ value: 'right', label: '向右' }, { value: 'left', label: '向左' }]}
                  onChange={(value) => update('rotationDirection', value)}
                />
              </Row>
            ) : null}
          </>
        ) : null}

        {tab === 1 ? (
          <>
            <div className="set-title">文件夹浏览</div>
            <Row label="排序方式" hint="文件夹置顶时文件夹始终在前；混排只在按名称/日期排序时生效">
              <select
                className="ctrl-select"
                value={settings.homeSortGrouping}
                onChange={(event) => update('homeSortGrouping', event.target.value)}
              >
                <option value="grouped">文件夹置顶</option>
                <option value="mixed">按名称混排</option>
              </select>
            </Row>
            <Row label="封面">
              <select
                className="ctrl-select"
                value={settings.folderCoverMode}
                onChange={(event) => update('folderCoverMode', event.target.value)}
              >
                <option value="auto">自动（容器拼贴，相册单图）</option>
                <option value="collage">总是拼贴</option>
                <option value="single">总是单图</option>
              </select>
            </Row>
            <div className="set-row block">
              <span>每个文件夹分别记住视图与排序</span>
              <div className="set-sub">默认开启；在页面里切换视图或排序会自动记住。</div>
            </div>
          </>
        ) : null}

        {tab === 2 ? (
          <>
            <div className="set-title">缓存</div>
            <Row label="缩略图缓存" hint="主进程">
              <span className="set-value">
                {disk ? `${formatBytes(disk.size)} · ${Number(disk.count).toLocaleString('zh-CN')} 项` : '读取中…'}
              </span>
            </Row>
            <Row label="清理缓存">
              <button
                className="btn-ghost"
                type="button"
                onClick={async () => {
                  await clearThumbnailCache().catch(() => {});
                  loadCache();
                }}
              >清除缩略图缓存</button>
            </Row>
            <Row label="刷新统计">
              <button className="btn-ghost" type="button" onClick={loadCache}>重新读取</button>
            </Row>
            <div className="set-row block">
              <span>清理缓存不会影响收藏与 Cos 索引。</span>
            </div>
          </>
        ) : null}

        {tab === 3 ? (
          <>
            <div className="set-title">Cos 索引</div>
            <Row label="索引状态" hint="10 分钟前建立的索引也可以照常浏览">
              <span className="set-value">
                {cosStatus?.summary
                  ? `${Number(cosStatus.summary.setCount).toLocaleString('zh-CN')} 套 · ${Number(cosStatus.summary.characterCount).toLocaleString('zh-CN')} 角色 · ${Number(cosStatus.summary.coserCount).toLocaleString('zh-CN')} 署名`
                  : '读取中…'}
              </span>
            </Row>
            <Row label="刷新索引">
              <button
                className="btn-ghost"
                type="button"
                onClick={async () => {
                  await refresh().catch(() => {});
                  getStatus().then(setCosStatus).catch(() => {});
                }}
              >重建索引（后台进行）</button>
            </Row>
            <div className="set-title" style={{ marginTop: 18 }}>根目录</div>
            {(cosStatus?.roots || []).map((root) => (
              <Row key={root.id} label={root.label}>
                <span className={`set-value ${root.status === 'online' ? 'ok' : 'offline'}`}>
                  {root.status === 'online' ? '在线' : '离线'}
                </span>
              </Row>
            ))}
            <div className="set-row block">
              <span>根目录的增删在 Cos 图库总览页。</span>
              <div className="set-sub">设置只负责查看状态与刷新索引。</div>
            </div>
          </>
        ) : null}
      </div>
    </div>
  );
}
