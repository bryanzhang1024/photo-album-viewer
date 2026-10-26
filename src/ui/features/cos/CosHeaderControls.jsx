import React from 'react';
import { SortAscIcon, SortDescIcon } from '../../icons';
import { defaultSortDirection } from '../../data/prefs';

/**
 * Cos 页页头控件：排序（下拉 + 升降序）+ 缩略图密度。
 * 与文件夹页用同一套 class、同一套 aria-label，外观与操作保持一致；
 * extra 用来放本页自己的按钮（收藏、设置、完整显示、上一套/下一套）。
 */
export default function CosHeaderControls({
  sortFields = [],
  sort = null,
  onSortChange,
  density,
  onDensityChange,
  extra = null
}) {
  return (
    <>
      {extra}
      {sort && sortFields.length > 0 ? (
        <>
          <select
            className="ctrl-select"
            aria-label="排序"
            value={sort.field}
            onChange={(event) => {
              const field = event.target.value;
              onSortChange?.({ field, direction: defaultSortDirection(field) });
            }}
          >
            {sortFields.map((field) => (
              <option key={field.key} value={field.key}>{field.label}</option>
            ))}
          </select>
          <button
            className="icon-button"
            type="button"
            aria-label={sort.direction === 'asc' ? '升序，点击改为降序' : '降序，点击改为升序'}
            aria-pressed={sort.direction === 'desc'}
            onClick={() => onSortChange?.({
              ...sort,
              direction: sort.direction === 'asc' ? 'desc' : 'asc'
            })}
          >
            {sort.direction === 'asc' ? <SortAscIcon /> : <SortDescIcon />}
          </button>
        </>
      ) : null}
      <input
        className="ctrl-range"
        type="range"
        min="0"
        max="2"
        step="1"
        value={density}
        aria-label="缩略图大小"
        onChange={(event) => onDensityChange?.(Number(event.target.value))}
      />
    </>
  );
}
