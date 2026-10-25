import React from 'react';

/**
 * 页头：面包屑 + 标题 + 数量 + 控件，网格与列表共用同一套结构（4.1 起统一）。
 * variant 只影响样式密度，不再影响是否出现面包屑。
 *
 * crumbs 支持字符串或 { label, clickable }，最后一段视为当前位置，不可点。
 * onCrumbClick(index) 在点击可点层级时回调。
 */
export default function PageHeader({
  variant = 'inline',
  crumbs = [],
  title,
  count,
  controls = null,
  onCrumbClick
}) {
  const normalized = crumbs.map((crumb, index) => (
    typeof crumb === 'string'
      ? { label: crumb, clickable: index !== crumbs.length - 1 }
      : { label: crumb.label, clickable: crumb.clickable !== undefined ? crumb.clickable : index !== crumbs.length - 1 }
  ));

  // 超过 4 段时截断中间，保留首段、末段与当前层。
  const visible = normalized.length > 4
    ? [normalized[0], { label: '…', clickable: false, ellipsis: true }, ...normalized.slice(-2)]
    : normalized;

  const crumbNodes = visible.map((crumb, index) => (
    <React.Fragment key={`${crumb.label}-${index}`}>
      {index > 0 ? <span className="page-header-sep">›</span> : null}
      {crumb.ellipsis ? (
        <span className="page-header-crumb-ellipsis">{crumb.label}</span>
      ) : crumb.clickable ? (
        <button
          className="page-header-crumb"
          type="button"
          onClick={() => onCrumbClick?.(index)}
        >
          {crumb.label}
        </button>
      ) : (
        <span className="page-header-crumb-current">{crumb.label}</span>
      )}
    </React.Fragment>
  ));

  return (
    <div className={`page-header page-header-compact page-header-${variant}`}>
      <nav className="page-header-crumbs" aria-label="面包屑">
        {crumbNodes}
        {title ? <span className="page-header-sep">›</span> : null}
        {title ? <span className="page-header-title-compact">{title}</span> : null}
      </nav>
      {count ? <span className="page-header-count">{count}</span> : null}
      <span className="page-header-spacer" />
      {controls}
    </div>
  );
}
