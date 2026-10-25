import React from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import TabBar from '../../src/ui/shell/TabBar';

const TABS = [
  { id: 'tab-1', title: '文件夹', active: true },
  { id: 'tab-2', title: '我的收藏', active: false }
];

describe('标签栏', () => {
  test('渲染多个标签并标出当前标签', () => {
    render(<TabBar tabs={TABS} />);

    expect(screen.getByRole('tablist')).toBeInTheDocument();
    expect(screen.getAllByRole('tab')).toHaveLength(2);
    expect(screen.getByRole('tab', { name: /文件夹/ })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tab', { name: /我的收藏/ })).toHaveAttribute('aria-selected', 'false');
  });

  test('点标签切换、点 × 关闭、点 + 新建，三个回调都真的接到外层', async () => {
    const onSelect = jest.fn();
    const onClose = jest.fn();
    const onNew = jest.fn();
    render(<TabBar tabs={TABS} onSelect={onSelect} onClose={onClose} onNew={onNew} />);

    await userEvent.click(screen.getByRole('tab', { name: /我的收藏/ }));
    expect(onSelect).toHaveBeenCalledWith('tab-2');

    await userEvent.click(screen.getByRole('button', { name: '关闭 文件夹' }));
    expect(onClose).toHaveBeenCalledWith('tab-1');
    // 关闭按钮不能同时触发标签切换
    expect(onSelect).toHaveBeenCalledTimes(1);

    await userEvent.click(screen.getByRole('button', { name: '新建标签页' }));
    expect(onNew).toHaveBeenCalledTimes(1);
  });
});
