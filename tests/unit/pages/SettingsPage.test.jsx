import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

jest.mock('react-router-dom', () => ({
  useNavigate: jest.fn(() => jest.fn())
}));

const mockUpdateSetting = jest.fn();
const mockResetSettings = jest.fn();

jest.mock('../../../src/renderer/contexts/SettingsContext', () => ({
  useSettings: jest.fn(() => ({
    settings: {
      autoRotateVerticalImages: false,
      rotationDirection: 'right',
      showFilename: true,
      homeSortGrouping: 'mixed'
    },
    updateSetting: mockUpdateSetting,
    resetSettings: mockResetSettings
  }))
}));

jest.mock('../../../src/renderer/utils/cacheUtils', () => ({
  clearAllCache: jest.fn()
}));

jest.mock('../../../src/renderer/utils/ImageCacheManager', () => ({
  __esModule: true,
  default: {
    getStats: jest.fn(() => ({
      totalBytes: 0,
      maxBytes: 100,
      usage: '0%',
      requests: {
        totalGets: 0,
        totalHits: 0,
        totalMisses: 0,
        hitRate: '0.00%'
      }
    }))
  }
}));

const SettingsPage = require('../../../src/renderer/pages/SettingsPage').default;

describe('SettingsPage sorting preferences', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    global.electronMock.ipcRenderer.invoke.mockResolvedValue({ success: true });
  });

  test('lets users choose whether folders and albums stay before photos', async () => {
    render(
      <SettingsPage
        colorMode={{ mode: 'light', toggleColorMode: jest.fn() }}
      />
    );

    expect(screen.getByText('文件夹浏览排序')).toBeInTheDocument();
    expect(screen.getByLabelText('全部按当前排序混排')).toBeChecked();

    fireEvent.click(screen.getByLabelText('文件夹和相簿排在照片前'));

    expect(mockUpdateSetting).toHaveBeenCalledWith('homeSortGrouping', 'containersFirst');

    await waitFor(() => {
      expect(global.electronMock.ipcRenderer.invoke).toHaveBeenCalled();
    });
  });
});
