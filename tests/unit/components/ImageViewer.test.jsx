import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import ImageViewer from '../../../src/renderer/components/ImageViewer';
import CHANNELS from '../../../src/common/ipc-channels';

jest.mock('../../../src/renderer/contexts/FavoritesContext', () => ({
  useFavorites: jest.fn(() => ({
    isImageFavorited: jest.fn(() => false),
    toggleImageFavorite: jest.fn()
  }))
}));

jest.mock('../../../src/renderer/contexts/SettingsContext', () => ({
  useSettings: jest.fn(() => ({
    settings: {
      autoRotateVerticalImages: false,
      rotationDirection: 'right',
      defaultDualPageViewer: false
    }
  }))
}));

const { useSettings } = require('../../../src/renderer/contexts/SettingsContext');

const images = [
  {
    path: '/photos/trip/IMG_0001.jpg',
    name: 'IMG_0001.jpg',
    size: 1536,
    lastModified: '2026-05-18T12:30:00.000Z'
  },
  {
    path: '/photos/trip/IMG_0002.jpg',
    name: 'IMG_0002.jpg',
    size: 2048,
    lastModified: '2026-05-18T12:31:00.000Z'
  }
];

function renderViewer(overrides = {}) {
  const props = {
    images,
    currentIndex: 0,
    onClose: jest.fn(),
    onIndexChange: jest.fn(),
    ...overrides
  };

  render(<ImageViewer {...props} />);
  return props;
}

describe('ImageViewer image info panel', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('renders a dual-page mode toggle in the viewer toolbar', () => {
    renderViewer();

    expect(screen.getByRole('button', { name: /双页展示/i })).toBeInTheDocument();
  });

  test('toggles dual-page mode from the toolbar button', () => {
    renderViewer();

    const button = screen.getByRole('button', { name: /双页展示/i });
    expect(button).toHaveAttribute('aria-pressed', 'false');

    fireEvent.click(button);
    expect(screen.getByRole('button', { name: /退出双页展示/i })).toHaveAttribute('aria-pressed', 'true');
  });

  test('uses the default dual-page setting when opening the viewer', () => {
    useSettings.mockReturnValueOnce({
      settings: {
        autoRotateVerticalImages: false,
        rotationDirection: 'right',
        defaultDualPageViewer: true
      }
    });

    renderViewer();

    expect(screen.getByRole('button', { name: /退出双页展示/i })).toHaveAttribute('aria-pressed', 'true');
  });

  test('renders an image info button in the viewer toolbar', () => {
    renderViewer();

    expect(screen.getByRole('button', { name: /图片信息/i })).toBeInTheDocument();
  });

  test('shows basic file information after clicking the info button', () => {
    renderViewer();

    fireEvent.click(screen.getByRole('button', { name: /图片信息/i }));

    expect(screen.getByRole('heading', { name: '图片信息' })).toBeInTheDocument();
    expect(screen.getByText('IMG_0001.jpg')).toBeInTheDocument();
    expect(screen.getByText('/photos/trip/IMG_0001.jpg')).toBeInTheDocument();
    expect(screen.getByText('/photos/trip')).toBeInTheDocument();
    expect(screen.getByText('1.5 KB')).toBeInTheDocument();
  });

  test('shows natural image dimensions after the current image loads', async () => {
    renderViewer();

    const image = screen.getByAltText('IMG_0001.jpg');
    Object.defineProperty(image, 'naturalWidth', { configurable: true, value: 4032 });
    Object.defineProperty(image, 'naturalHeight', { configurable: true, value: 3024 });
    fireEvent.load(image);

    fireEvent.click(screen.getByRole('button', { name: /图片信息/i }));

    await waitFor(() => {
      expect(screen.getByText('4032 x 3024')).toBeInTheDocument();
    });
  });

  test('toggles the image info panel with the i key', () => {
    renderViewer();

    fireEvent.keyDown(window, { key: 'i' });
    expect(screen.getByRole('heading', { name: '图片信息' })).toBeInTheDocument();

    fireEvent.keyDown(window, { key: 'I' });
    expect(screen.queryByRole('heading', { name: '图片信息' })).not.toBeInTheDocument();
  });

  test('closes the info panel before closing the viewer on Escape', () => {
    const props = renderViewer();

    fireEvent.keyDown(window, { key: 'i' });
    fireEvent.keyDown(window, { key: 'Escape' });

    expect(props.onClose).not.toHaveBeenCalled();
    expect(screen.queryByRole('heading', { name: '图片信息' })).not.toBeInTheDocument();

    fireEvent.keyDown(window, { key: 'Escape' });
    expect(props.onClose).toHaveBeenCalledTimes(1);
  });
});

describe('ImageViewer delete image flow', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('renders a delete button in the viewer toolbar', () => {
    renderViewer();

    expect(screen.getByRole('button', { name: /删除图片/i })).toBeInTheDocument();
  });

  test('opens delete confirmation with the current image path from the Delete key', () => {
    renderViewer();

    fireEvent.keyDown(window, { key: 'Delete' });

    expect(screen.getByRole('heading', { name: '删除图片' })).toBeInTheDocument();
    expect(screen.getByText('/photos/trip/IMG_0001.jpg')).toBeInTheDocument();
    expect(screen.getByText('移到系统废纸篓')).toBeInTheDocument();
  });

  test('cancels delete confirmation without invoking IPC', () => {
    renderViewer();

    fireEvent.click(screen.getByRole('button', { name: /删除图片/i }));
    fireEvent.click(screen.getByRole('button', { name: '取消' }));

    expect(global.electronMock.ipcRenderer.invoke).not.toHaveBeenCalledWith(
      CHANNELS.TRASH_IMAGE,
      expect.any(String)
    );
    expect(screen.queryByRole('heading', { name: '删除图片' })).not.toBeInTheDocument();
  });

  test('moves the current image to trash and notifies the parent when confirmed', async () => {
    global.electronMock.ipcRenderer.invoke.mockResolvedValueOnce({ success: true });
    const props = renderViewer({ onImageDeleted: jest.fn() });

    fireEvent.click(screen.getByRole('button', { name: /删除图片/i }));
    fireEvent.click(screen.getByRole('button', { name: '移到废纸篓' }));

    await waitFor(() => {
      expect(global.electronMock.ipcRenderer.invoke).toHaveBeenCalledWith(
        CHANNELS.TRASH_IMAGE,
        '/photos/trip/IMG_0001.jpg'
      );
      expect(props.onImageDeleted).toHaveBeenCalledWith('/photos/trip/IMG_0001.jpg');
    });
    expect(props.onClose).not.toHaveBeenCalled();
  });

  test('closes the viewer after deleting the only image', async () => {
    global.electronMock.ipcRenderer.invoke.mockResolvedValueOnce({ success: true });
    const props = renderViewer({
      images: [images[0]],
      onImageDeleted: jest.fn()
    });

    fireEvent.click(screen.getByRole('button', { name: /删除图片/i }));
    fireEvent.click(screen.getByRole('button', { name: '移到废纸篓' }));

    await waitFor(() => {
      expect(props.onImageDeleted).toHaveBeenCalledWith('/photos/trip/IMG_0001.jpg');
      expect(props.onClose).toHaveBeenCalledTimes(1);
    });
  });

  test('shows delete failure and keeps the viewer open', async () => {
    global.electronMock.ipcRenderer.invoke.mockResolvedValueOnce({
      success: false,
      error: '移动到废纸篓失败'
    });
    const props = renderViewer({ onImageDeleted: jest.fn() });

    fireEvent.click(screen.getByRole('button', { name: /删除图片/i }));
    fireEvent.click(screen.getByRole('button', { name: '移到废纸篓' }));

    expect(await screen.findByText('移动到废纸篓失败')).toBeInTheDocument();
    expect(props.onImageDeleted).not.toHaveBeenCalled();
    expect(props.onClose).not.toHaveBeenCalled();
  });
});
