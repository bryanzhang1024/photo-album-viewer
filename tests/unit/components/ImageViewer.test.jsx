import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import ImageViewer from '../../../src/renderer/components/ImageViewer';

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
      rotationDirection: 'right'
    }
  }))
}));

const images = [
  {
    path: '/photos/trip/IMG_0001.jpg',
    name: 'IMG_0001.jpg',
    size: 1536,
    lastModified: '2026-05-18T12:30:00.000Z'
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
