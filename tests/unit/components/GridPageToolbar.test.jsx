import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import GridPageToolbar from '../../../src/renderer/components/GridPageToolbar';

const defaultProps = {
  searchQuery: '',
  onSearchChange: jest.fn(),
  searchPlaceholder: '搜索当前文件夹',
  onSearchFocusChange: jest.fn(),
  sortOptions: [
    { value: 'name', label: '名称' },
    { value: 'size', label: '大小' }
  ],
  sortBy: 'name',
  sortDirection: 'asc',
  onSortChange: jest.fn(),
  onSortDirectionChange: jest.fn(),
  userDensity: 'standard',
  onDensityChange: jest.fn(),
  onRandomAlbum: jest.fn(),
  randomDisabled: false,
  onRefresh: jest.fn(),
  refreshDisabled: false,
  refreshAriaLabel: '刷新当前文件夹',
  favoriteMenuItems: [
    {
      id: 'folder',
      label: '收藏当前文件夹',
      checked: false,
      disabled: false,
      onClick: jest.fn()
    }
  ],
  openFavoritesItem: {
    label: '打开我的收藏',
    onClick: jest.fn()
  },
  onOpenSettings: jest.fn()
};

describe('GridPageToolbar', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('opens search overlay and closes on Escape', () => {
    render(<GridPageToolbar {...defaultProps} />);

    fireEvent.click(screen.getByRole('button', { name: '搜索' }));
    const searchInput = screen.getByPlaceholderText('搜索当前文件夹');
    expect(searchInput).toBeInTheDocument();

    fireEvent.keyDown(searchInput, { key: 'Escape' });
    expect(defaultProps.onSearchChange).toHaveBeenCalledWith('');
  });

  test('opens tune popover and triggers random album action', () => {
    render(<GridPageToolbar {...defaultProps} />);

    fireEvent.click(screen.getByRole('button', { name: '视图选项' }));
    fireEvent.click(screen.getByRole('button', { name: '随机选择相簿 (R)' }));

    expect(defaultProps.onRandomAlbum).toHaveBeenCalledTimes(1);
  });

  test('shows density options inside tune popover', () => {
    render(<GridPageToolbar {...defaultProps} />);

    fireEvent.click(screen.getByRole('button', { name: '视图选项' }));
    expect(screen.getByLabelText('密度')).toBeInTheDocument();
  });

  test('opens favorites menu with configured items', () => {
    render(<GridPageToolbar {...defaultProps} />);

    fireEvent.click(screen.getByRole('button', { name: '收藏菜单' }));
    expect(screen.getByText('收藏当前文件夹')).toBeInTheDocument();
    expect(screen.getByText('打开我的收藏')).toBeInTheDocument();

    fireEvent.click(screen.getByText('打开我的收藏'));
    expect(defaultProps.openFavoritesItem.onClick).toHaveBeenCalledTimes(1);
  });

  test('renders album navigation when provided', () => {
    render(
      <GridPageToolbar
        {...defaultProps}
        navigation={{
          prev: { name: 'prev-album' },
          next: { name: 'next-album' },
          currentIndex: 2,
          total: 5,
          onPrev: jest.fn(),
          onNext: jest.fn()
        }}
      />
    );

    expect(screen.getByText('3/5')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '上一个相簿' })).toBeEnabled();
    expect(screen.getByRole('button', { name: '下一个相簿' })).toBeEnabled();
  });

  test('pins favorites and settings on the right side', () => {
    render(<GridPageToolbar {...defaultProps} />);

    const settingsButton = screen.getByRole('button', { name: '设置' });
    const favoritesButton = screen.getByRole('button', { name: '收藏菜单' });
    const pinnedGroup = settingsButton.parentElement;

    expect(pinnedGroup).toContainElement(favoritesButton);
    expect(pinnedGroup).toHaveStyle({ marginLeft: 'auto' });
  });

  test('places tune button before refresh button', () => {
    render(<GridPageToolbar {...defaultProps} />);

    const refreshButton = screen.getByRole('button', { name: '刷新当前文件夹' });
    const tuneButton = screen.getByRole('button', { name: '视图选项' });
    const leftGroup = refreshButton.closest('.MuiBox-root');
    const children = Array.from(leftGroup.children);
    const refreshIndex = children.findIndex((node) => node.contains(refreshButton));
    const tuneIndex = children.findIndex((node) => node.contains(tuneButton));

    expect(refreshIndex).toBeGreaterThan(-1);
    expect(tuneIndex).toBeGreaterThan(-1);
    expect(refreshIndex).toBeGreaterThan(tuneIndex);
  });

  test('calls onOpenSettings when settings button is clicked', () => {
    render(<GridPageToolbar {...defaultProps} />);

    fireEvent.click(screen.getByRole('button', { name: '设置' }));
    expect(defaultProps.onOpenSettings).toHaveBeenCalledTimes(1);
  });
});
