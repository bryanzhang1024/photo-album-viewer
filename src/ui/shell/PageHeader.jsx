import React from 'react';

/**
 * 页头两版（设计稿 2.x / 11.x）：
 * - variant="inline"：网格视图用，标题与控件同行，不显示面包屑。
 * - variant="compact"：列表与窄窗口用，面包屑、标题、数量、控件压成一行。
 */
export default function PageHeader({ variant = 'inline', crumbs = [], title, count, controls = null }) {
  if (variant === 'compact') {
    return (
      <div className="page-header page-header-compact">
        {crumbs.map((crumb, index) => (
          <React.Fragment key={`${crumb}-${index}`}>
            {index > 0 ? <span className="page-header-sep">›</span> : null}
            <span className={index === crumbs.length - 1 ? 'page-header-crumb-current' : 'page-header-crumb'}>
              {crumb}
            </span>
          </React.Fragment>
        ))}
        <span className="page-header-title-compact">{title}</span>
        {count ? <span className="page-header-count">{count}</span> : null}
        <span className="page-header-spacer" />
        {controls}
      </div>
    );
  }

  return (
    <div className="page-header">
      <h1 className="page-header-title">{title}</h1>
      {count ? <span className="page-header-count">{count}</span> : null}
      <span className="page-header-spacer" />
      {controls}
    </div>
  );
}
