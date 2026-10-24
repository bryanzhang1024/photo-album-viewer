import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { ThemeProvider, createTheme } from '@mui/material/styles';
import FileListView from '../../../src/renderer/shell/FileListView';

jest.mock('react-virtuoso', () => {
  const React = require('react');
  return {
    Virtuoso: ({ data = [], itemContent, endReached }) => {
      React.useEffect(() => { endReached?.(); }, [endReached]);
      return <div data-testid="virtuoso">{data.map((row, index) => itemContent(index, row))}</div>;
    }
  };
});

const rows = [
  { path: '/a', name: 'a.jpg', size: 2048, lastModified: 1700000000000 },
  { path: '/b', name: 'b.jpg', size: 1048576, lastModified: 1700000001000 }
];

const renderList = (props = {}) => render(
  <ThemeProvider theme={createTheme()}>
    <FileListView
      rows={rows}
      columns={[{ key: 'name', label: '名称', width: '1fr' }, { key: 'size', label: '大小', width: '90px' }]}
      {...props}
    />
  </ThemeProvider>
);

describe('FileListView', () => {
  test('渲染列头与每一行', () => {
    renderList();
    expect(screen.getByText('名称')).toBeInTheDocument();
    expect(screen.getByText('大小')).toBeInTheDocument();
    expect(screen.getByText('a.jpg')).toBeInTheDocument();
    expect(screen.getByText('b.jpg')).toBeInTheDocument();
  });

  test('点击与双击分别回调', () => {
    const onClick = jest.fn();
    const onDouble = jest.fn();
    renderList({ onRowClick: onClick, onRowDoubleClick: onDouble });
    const row = screen.getByText('a.jpg').closest('div[class*="MuiBox-root"]');
    fireEvent.click(row);
    fireEvent.doubleClick(row);
    expect(onClick).toHaveBeenCalledTimes(1);
    expect(onDouble).toHaveBeenCalledTimes(1);
  });

  test('空列表显示占位文案', () => {
    renderList({ rows: [], emptyText: '没有内容' });
    expect(screen.getByText('没有内容')).toBeInTheDocument();
  });
});
