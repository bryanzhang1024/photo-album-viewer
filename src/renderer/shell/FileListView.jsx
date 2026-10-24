import React from 'react';
import { Box, Typography } from '@mui/material';
import { Virtuoso } from 'react-virtuoso';

const ROW_HEIGHT = 34;

function formatBytes(bytes) {
  if (!bytes || bytes < 0) return '—';
  if (bytes >= 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024 / 1024).toFixed(1)} GB`;
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

export function formatListDate(value) {
  if (!value) return '—';
  try {
    return new Date(value).toLocaleString('zh-CN', {
      year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit'
    });
  } catch (_error) {
    return '—';
  }
}

export { formatBytes };

/**
 * 通用列表视图：列头 + 虚拟滚动的行。
 *
 * columns: [{ key, label, width, align, render: (row) => node }]
 * 宽度用 CSS grid 的固定值，第一列传 '1fr'。
 */
export default function FileListView({
  rows = [],
  columns = [],
  itemKey = (row, index) => row?.path || row?.id || index,
  onRowClick = null,
  onRowDoubleClick = null,
  customScrollParent = null,
  overscan = 480,
  endReached = null,
  emptyText = '没有内容',
  testId = 'file-list',
  isRowSelected = null,
  sortBy = null,
  sortDirection = 'asc',
  onSortChange = null,
  onToggleSortDirection = null
}) {
  const template = columns.map((column) => column.width || '1fr').join(' ');
  const alignFor = (column) => (column.align === 'right' ? 'flex-end' : 'flex-start');

  const header = (
    <Box sx={{
      display: 'grid',
      gridTemplateColumns: template,
      alignItems: 'center',
      height: 26,
      px: 2,
      fontSize: 11,
      color: 'text.secondary',
      borderBottom: 1,
      borderColor: 'divider',
      position: 'sticky',
      top: 0,
      zIndex: 2,
      bgcolor: 'background.default'
    }}>
      {columns.map((column) => {
        const sortable = Boolean(column.sortKey && onSortChange);
        const active = sortable && column.sortKey === sortBy;
        return (
          <Box key={column.key} sx={{ display: 'flex', justifyContent: alignFor(column), minWidth: 0 }}>
            <Box
              component={sortable ? 'button' : 'div'}
              onClick={sortable ? () => {
                if (active && onToggleSortDirection) onToggleSortDirection();
                else onSortChange(column.sortKey);
              } : undefined}
              sx={{
                display: 'flex',
                alignItems: 'center',
                gap: 0.5,
                border: 0,
                background: 'none',
                p: 0,
                font: 'inherit',
                cursor: sortable ? 'pointer' : 'default',
                color: active ? 'text.primary' : 'text.secondary',
                minWidth: 0,
                '&:hover': sortable ? { color: 'text.primary' } : {}
              }}
            >
              <Typography noWrap sx={{ fontSize: 11 }}>{column.label}</Typography>
              {active ? (
                <Typography component="span" sx={{ fontSize: 10 }}>{sortDirection === 'asc' ? '↑' : '↓'}</Typography>
              ) : null}
            </Box>
          </Box>
        );
      })}
    </Box>
  );

  if (!rows.length) {
    return (
      <Box data-testid={testId}>
        {header}
        <Typography sx={{ p: 4, textAlign: 'center', color: 'text.secondary', fontSize: 12.5 }}>
          {emptyText}
        </Typography>
      </Box>
    );
  }

  return (
    <Box data-testid={testId}>
      {header}
      <Virtuoso
        data={rows}
        customScrollParent={customScrollParent || undefined}
        overscan={overscan}
        endReached={endReached || undefined}
        computeItemKey={(index, row) => itemKey(row, index)}
        itemContent={(index, row) => (
          <Box
            onClick={onRowClick ? () => onRowClick(row, index) : undefined}
            onDoubleClick={onRowDoubleClick ? () => onRowDoubleClick(row, index) : undefined}
            sx={{
              display: 'grid',
              gridTemplateColumns: template,
              alignItems: 'center',
              height: ROW_HEIGHT,
              px: 2,
              fontSize: 12.5,
              borderBottom: 1,
              borderColor: 'divider',
              cursor: onRowClick || onRowDoubleClick ? 'pointer' : 'default',
              bgcolor: isRowSelected?.(row) ? 'selection' : 'transparent',
              '&:hover': { bgcolor: 'hover' }
            }}
          >
            {columns.map((column) => (
              <Box
                key={column.key}
                sx={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: alignFor(column),
                  minWidth: 0,
                  color: column.dim ? 'text.secondary' : 'text.primary',
                  pr: 1
                }}
              >
                {column.render ? column.render(row, index) : (
                  <Typography noWrap sx={{ fontSize: 12.5, minWidth: 0 }}>{row?.[column.key] || '—'}</Typography>
                )}
              </Box>
            ))}
          </Box>
        )}
      />
    </Box>
  );
}
