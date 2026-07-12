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
      defaultDualPageViewer: false,
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
const CHANNELS = require('../../../src/common/ipc-channels');

const SOURCE = {
  sourceId: 'src_11111111-1111-4111-8111-111111111111',
  rootPath: '/Photos',
  label: 'Photos',
  createdAt: '2026-07-12T00:00:00.000Z',
  updatedAt: '2026-07-12T00:00:00.000Z'
};

const COMPUTER_SOURCE = {
  schemaVersion: 1,
  sourceId: 'src_22222222-2222-4222-8222-222222222222',
  rootPath: '/',
  label: '电脑',
  sourceGeneration: 1
};

describe('SettingsPage sorting preferences', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    window.electronAPI.platform = undefined;
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

  test('lets users choose whether dual-page view opens by default', async () => {
    render(
      <SettingsPage
        colorMode={{ mode: 'light', toggleColorMode: jest.fn() }}
      />
    );

    const switchControl = screen.getByLabelText('默认启用双页展示');
    expect(switchControl).not.toBeChecked();

    fireEvent.click(switchControl);

    expect(mockUpdateSetting).toHaveBeenCalledWith('defaultDualPageViewer', true);

    await waitFor(() => {
      expect(global.electronMock.ipcRenderer.invoke).toHaveBeenCalled();
    });
  });

  test('registers a selected directory as a SourceRoot without writing a legacy default path', async () => {
    localStorage.setItem('lastRootPath_default', '/Legacy');
    global.electronMock.ipcRenderer.invoke.mockImplementation((channel) => {
      if (channel === CHANNELS.SELECT_DIRECTORY) return Promise.resolve('/Photos');
      if (channel === CHANNELS.SAVE_SOURCE_ROOT_V1) {
        return Promise.resolve({ contractVersion: 1, ok: true, data: { source: SOURCE, created: true } });
      }
      return Promise.resolve({ success: true });
    });

    render(<SettingsPage colorMode={{ mode: 'light', toggleColorMode: jest.fn() }} />);
    fireEvent.click(screen.getByRole('button', { name: '注册照片来源' }));

    await waitFor(() => {
      expect(global.electronMock.ipcRenderer.invoke).toHaveBeenCalledWith(
        CHANNELS.SAVE_SOURCE_ROOT_V1,
        { contractVersion: 1, sourceId: null, rootPath: '/Photos', label: null }
      );
    });
    expect(localStorage.getItem('lastRootPath_default')).toBe('/Legacy');
  });

  test('opens a selected directory in a new window with a canonical target', async () => {
    global.electronMock.ipcRenderer.invoke.mockImplementation((channel) => {
      if (channel === CHANNELS.SELECT_DIRECTORY) return Promise.resolve('/Photos');
      if (channel === CHANNELS.SAVE_SOURCE_ROOT_V1) {
        return Promise.resolve({ contractVersion: 1, ok: true, data: { source: SOURCE, created: true } });
      }
      if (channel === CHANNELS.CREATE_NEW_INSTANCE) return Promise.resolve({ success: true });
      return Promise.resolve({ success: true });
    });

    render(<SettingsPage colorMode={{ mode: 'light', toggleColorMode: jest.fn() }} />);
    fireEvent.click(screen.getByRole('button', { name: '在新窗口中打开' }));

    await waitFor(() => {
      expect(global.electronMock.ipcRenderer.invoke).toHaveBeenCalledWith(
        CHANNELS.CREATE_NEW_INSTANCE,
        {
          contractVersion: 1,
          target: {
            sourceId: SOURCE.sourceId,
            relativePath: '',
            viewMode: 'browse',
            initialMediaRelativePath: null
          }
        }
      );
    });
  });

  test('uses the existing computer root for a selected macOS directory', async () => {
    window.electronAPI.platform = 'darwin';
    global.electronMock.ipcRenderer.invoke.mockImplementation((channel) => {
      if (channel === CHANNELS.SELECT_DIRECTORY) {
        return Promise.resolve('/Volumes/1TB/Collection/600-Cos Weibo');
      }
      if (channel === CHANNELS.LOAD_SOURCE_ROOTS_V1) {
        return Promise.resolve({
          contractVersion: 1,
          ok: true,
          data: { sources: [COMPUTER_SOURCE] }
        });
      }
      if (channel === CHANNELS.CREATE_NEW_INSTANCE) return Promise.resolve({ success: true });
      return Promise.resolve({ success: true });
    });

    render(<SettingsPage colorMode={{ mode: 'light', toggleColorMode: jest.fn() }} />);
    fireEvent.click(screen.getByRole('button', { name: '在新窗口中打开' }));

    await waitFor(() => {
      expect(global.electronMock.ipcRenderer.invoke).toHaveBeenCalledWith(
        CHANNELS.CREATE_NEW_INSTANCE,
        {
          contractVersion: 1,
          target: {
            sourceId: COMPUTER_SOURCE.sourceId,
            relativePath: 'Volumes/1TB/Collection/600-Cos Weibo',
            viewMode: 'browse',
            initialMediaRelativePath: null
          }
        }
      );
    });
    expect(global.electronMock.ipcRenderer.invoke).not.toHaveBeenCalledWith(
      CHANNELS.SAVE_SOURCE_ROOT_V1,
      expect.anything()
    );
  });
});
