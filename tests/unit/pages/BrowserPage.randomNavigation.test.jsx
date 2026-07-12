import React, { useEffect } from 'react';
import {
  act,
  fireEvent,
  render,
  screen,
  within,
  waitFor
} from '@testing-library/react';
import {
  MemoryRouter,
  useLocation
} from 'react-router-dom';

jest.mock('react-virtuoso', () => {
  const ReactModule = require('react');
  return {
    Virtuoso: ({ data = [], itemContent, rangeChanged }) => {
      ReactModule.useEffect(() => {
        rangeChanged?.({ startIndex: 0, endIndex: Math.max(0, data.length - 1) });
      }, [data, rangeChanged]);

      return (
        <div data-testid="virtual-grid">
          {data.map((item, index) => (
            <div key={index}>{itemContent(index, item)}</div>
          ))}
        </div>
      );
    }
  };
});

jest.mock('../../../src/renderer/components/AlbumCard', () => (
  function AlbumCardFixture({ node }) {
    return <div data-testid={`album-card-${node.name}`}>{node.name}</div>;
  }
));

jest.mock('../../../src/renderer/components/ImageCard', () => (
  function ImageCardFixture({ image }) {
    return <div data-testid={`image-card-${image.name}`}>{image.name}</div>;
  }
));

jest.mock('../../../src/renderer/components/ImageViewer', () => (
  function ImageViewerFixture() {
    return <div data-testid="image-viewer" />;
  }
));

jest.mock('../../../src/renderer/components/BreadcrumbNavigation', () => (
  function BreadcrumbFixture({ currentPath }) {
    return <div data-testid="breadcrumb-path">{currentPath}</div>;
  }
));

jest.mock('../../../src/renderer/components/PageLayout', () => (
  function PageLayoutFixture({
    headerContent,
    subHeaderContent,
    scrollContainerRef,
    children
  }) {
    return (
      <main>
        <header>{headerContent}</header>
        <nav>{subHeaderContent}</nav>
        <div ref={scrollContainerRef} className="scroll-container">
          {children}
        </div>
      </main>
    );
  }
));

jest.mock('../../../src/renderer/hooks/useAlbumImages', () => jest.fn());

jest.mock('../../../src/renderer/hooks/useGridThumbnailPrefetch', () => {
  const actual = jest.requireActual('../../../src/renderer/hooks/useGridThumbnailPrefetch');
  return {
    __esModule: true,
    ...actual,
    default: jest.fn(() => ({ handleRangeChanged: jest.fn() }))
  };
});

const App = require('../../../src/renderer/App').default;
const useAlbumImages = require('../../../src/renderer/hooks/useAlbumImages');
const imageCache = require('../../../src/renderer/utils/ImageCacheManager').default;
const CHANNELS = require('../../../src/common/ipc-channels');
const {
  createDirectorySuccessEnvelopeV1,
  validateDirectoryEnvelopeV1
} = require('../../../src/common/contracts/directory-contract-v1');
const {
  buildRandomNavigationTargets,
  directoryRefKey
} = require('../../../src/renderer/utils/randomNavigation');

const ipcRenderer = global.electronMock.ipcRenderer;
const SOURCE_ID = 'src_11111111-1111-4111-8111-111111111111';
const ROOT_PATH = '/library';
const OBSERVED_AT = 1783785600000;

const SOURCE = {
  schemaVersion: 1,
  sourceId: SOURCE_ID,
  label: 'Library',
  rootPath: ROOT_PATH,
  sourceGeneration: 1
};

const CHILD_SPECS = {
  A: { directMediaCount: 1, childDirectoryCount: 0 },
  B: { directMediaCount: 1, childDirectoryCount: 0 },
  C: { directMediaCount: 0, childDirectoryCount: 1 },
  D: { directMediaCount: 1, childDirectoryCount: 1 }
};

function joinRelative(parent, name) {
  return parent ? `${parent}/${name}` : name;
}

function createApproximate(relativePath, directMediaCount, childDirectoryCount, coverSamples = []) {
  return {
    coverSamples,
    hasDescendantMedia: directMediaCount > 0 || coverSamples.length > 0
      ? 'yes'
      : (childDirectoryCount === 0 ? 'no' : 'unknown'),
    observedAt: OBSERVED_AT,
    truncated: childDirectoryCount > 0
  };
}

function createMedia(relativePath) {
  const name = relativePath.split('/').pop();
  return {
    relativePath,
    name,
    size: 1024,
    mtimeMs: OBSERVED_AT
  };
}

function createChild(relativePath, { directMediaCount, childDirectoryCount }) {
  const name = relativePath.split('/').pop();
  const coverSamples = directMediaCount > 0
    ? [joinRelative(relativePath, `${name.toLowerCase()}.jpg`)]
    : [];
  return {
    ref: { sourceId: SOURCE_ID, relativePath },
    name,
    status: 'ready',
    completeness: { directMedia: 'complete', children: 'complete' },
    facts: { directMediaCount, childDirectoryCount },
    approximate: createApproximate(
      relativePath,
      directMediaCount,
      childDirectoryCount,
      coverSamples
    )
  };
}

function createSnapshot(relativePath, { directMedia = [], children = [] }) {
  const name = relativePath ? relativePath.split('/').pop() : 'Library';
  const facts = {
    directMediaCount: directMedia.length,
    childDirectoryCount: children.length
  };
  return {
    contractVersion: 1,
    ref: { sourceId: SOURCE_ID, relativePath },
    locator: { absolutePath: relativePath ? `${ROOT_PATH}/${relativePath}` : ROOT_PATH },
    name,
    status: 'ready',
    observedAt: OBSERVED_AT,
    revision: `rev-${relativePath || 'root'}`,
    completeness: { entries: 'complete', directMedia: 'complete', children: 'complete' },
    facts,
    directMedia,
    children,
    approximate: createApproximate(
      relativePath,
      facts.directMediaCount,
      facts.childDirectoryCount,
      directMedia.slice(0, 4).map((media) => media.relativePath)
    )
  };
}

const ROOT_SNAPSHOT = createSnapshot('', {
  directMedia: [createMedia('root-direct.jpg')],
  children: Object.entries(CHILD_SPECS).map(([name, spec]) => createChild(name, spec))
});

const TARGET_SNAPSHOTS = {
  A: createSnapshot('A', { directMedia: [createMedia('A/a.jpg')] }),
  B: createSnapshot('B', { directMedia: [createMedia('B/b.jpg')] }),
  C: createSnapshot('C', {
    children: [createChild('C/Nested', { directMediaCount: 1, childDirectoryCount: 0 })]
  }),
  D: createSnapshot('D', {
    directMedia: [createMedia('D/d.jpg')],
    children: [createChild('D/Nested', { directMediaCount: 1, childDirectoryCount: 0 })]
  })
};

function createCanonicalEnvelope(snapshot) {
  const envelope = createDirectorySuccessEnvelopeV1(snapshot);
  const validation = validateDirectoryEnvelopeV1(envelope);
  if (!validation.valid) {
    throw new Error(`Invalid DirectorySnapshot fixture: ${JSON.stringify(validation.issues)}`);
  }
  return envelope;
}

function createLegacyNode(name, { directMediaCount, childDirectoryCount }, parentPath = ROOT_PATH) {
  return {
    type: directMediaCount > 0 ? 'album' : 'folder',
    path: `${parentPath}/${name}`,
    name,
    imageCount: directMediaCount,
    directImageCount: directMediaCount,
    childFolders: childDirectoryCount,
    canViewAsPhotoSet: directMediaCount > 0,
    canBrowseChildren: childDirectoryCount > 0,
    samples: directMediaCount > 0 ? [`${parentPath}/${name}/${name.toLowerCase()}.jpg`] : []
  };
}

function createLegacyScan(path) {
  if (path === ROOT_PATH) {
    return {
      success: true,
      currentPath: ROOT_PATH,
      nodes: Object.entries(CHILD_SPECS).map(([name, spec]) => createLegacyNode(name, spec)),
      directImages: [{
        path: `${ROOT_PATH}/root-direct.jpg`,
        name: 'root-direct.jpg',
        size: 1024,
        lastModified: OBSERVED_AT
      }],
      breadcrumbs: [{ name: 'Library', path: ROOT_PATH }],
      metadata: {
        folderCount: 1,
        albumCount: 3,
        totalNodes: 4,
        directImageCount: 1
      }
    };
  }

  const name = path.split('/').pop();
  const spec = CHILD_SPECS[name] || { directMediaCount: 0, childDirectoryCount: 0 };
  const nodes = spec.childDirectoryCount > 0
    ? [createLegacyNode('Nested', { directMediaCount: 1, childDirectoryCount: 0 }, path)]
    : [];
  const directImages = spec.directMediaCount > 0
    ? [{
      path: `${path}/${name.toLowerCase()}.jpg`,
      name: `${name.toLowerCase()}.jpg`,
      size: 1024,
      lastModified: OBSERVED_AT
    }]
    : [];
  return {
    success: true,
    currentPath: path,
    nodes,
    directImages,
    breadcrumbs: [{ name, path }],
    metadata: {
      folderCount: nodes.length,
      albumCount: nodes.filter((node) => node.canViewAsPhotoSet).length,
      totalNodes: nodes.length,
      directImageCount: directImages.length
    }
  };
}

function buildRootUrl() {
  const params = new URLSearchParams({
    sourceId: SOURCE_ID,
    relativePath: '',
    view: 'folder'
  });
  return `/browse?${params.toString()}`;
}

function LocationProbe({ onVisit }) {
  const location = useLocation();

  useEffect(() => {
    onVisit({ pathname: location.pathname, search: location.search });
  }, [location.pathname, location.search, onVisit]);

  return <output data-testid="router-location">{location.pathname}{location.search}</output>;
}

function renderBrowser(onVisit = () => {}) {
  return render(
    <MemoryRouter
      initialEntries={[buildRootUrl()]}
      future={{ v7_startTransition: true, v7_relativeSplatPath: true }}
    >
      <LocationProbe onVisit={onVisit} />
      <App />
    </MemoryRouter>
  );
}

function readCanonicalRoute() {
  const value = screen.getByTestId('router-location').textContent;
  const [pathname, search = ''] = value.split('?');
  const params = new URLSearchParams(search);
  return {
    pathname,
    relativePath: params.get('relativePath'),
    view: params.get('view')
  };
}

function readActiveSessionTarget() {
  const session = JSON.parse(localStorage.getItem('browser_tabs_session_v2'));
  return session.tabs.find((tab) => tab.id === session.activeTabId).location.target;
}

async function clickRandomBrowse() {
  fireEvent.click(screen.getByRole('button', { name: '视图选项' }));
  const randomButton = await screen.findByRole('button', { name: '随机当前文件夹 (E)' });
  expect(randomButton).toBeEnabled();
  await act(async () => {
    fireEvent.click(randomButton);
    await Promise.resolve();
    await Promise.resolve();
  });
}

async function pressBackspace() {
  await act(async () => {
    fireEvent.keyDown(window, { key: 'Backspace' });
    await Promise.resolve();
  });
}

async function pressArrowRight() {
  await act(async () => {
    fireEvent.keyDown(window, { key: 'ArrowRight' });
    await Promise.resolve();
  });
}

async function pressArrowLeft() {
  await act(async () => {
    fireEvent.keyDown(window, { key: 'ArrowLeft' });
    await Promise.resolve();
  });
}

async function waitForHydratedHome() {
  await waitFor(() => {
    expect(screen.getByText('共 3 个相簿, 1 张照片')).toBeInTheDocument();
  });
  await waitFor(() => {
    expect(localStorage.getItem('browser_tabs_session_v2')).not.toBeNull();
  });
}

describe('BrowserPage real random-navigation integration', () => {
  let canonicalRequests;

  beforeEach(() => {
    jest.clearAllMocks();
    localStorage.clear();
    imageCache.clearAll();
    canonicalRequests = [];

    useAlbumImages.mockReturnValue({
      images: [{
        path: `${ROOT_PATH}/fixture.jpg`,
        name: 'fixture.jpg',
        size: 1024,
        lastModified: OBSERVED_AT
      }],
      totalCount: 1,
      hasMore: false,
      loading: false,
      loadingMore: false,
      error: '',
      queryKey: 'stable-album-query',
      loadImages: jest.fn(() => Promise.resolve([])),
      loadMore: jest.fn(() => Promise.resolve([])),
      ensureImageLoaded: jest.fn(() => Promise.resolve({
        images: [], globalIndex: -1, offset: 0
      })),
      refresh: jest.fn(() => Promise.resolve([])),
      removeImage: jest.fn()
    });

    ipcRenderer.invoke.mockImplementation((channel, ...args) => {
      if (channel === CHANNELS.LOAD_SOURCE_ROOTS_V1) {
        return Promise.resolve({
          contractVersion: 1,
          ok: true,
          data: { sources: [SOURCE] }
        });
      }
      if (channel === CHANNELS.SCAN_NAVIGATION_LEVEL) {
        return Promise.resolve(createLegacyScan(args[0]));
      }
      if (channel === CHANNELS.GET_DIRECTORY_LEVEL_V1) {
        const request = args[0];
        canonicalRequests.push(request);
        const snapshot = request.ref.relativePath === ''
          ? ROOT_SNAPSHOT
          : TARGET_SNAPSHOTS[request.ref.relativePath];
        if (!snapshot) {
          throw new Error(`Unexpected canonical scan: ${request.ref.relativePath}`);
        }
        return Promise.resolve(createCanonicalEnvelope(snapshot));
      }
      return Promise.resolve(undefined);
    });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test('keeps one canonical round across real pages and preserves folder/hybrid view modes', async () => {
    const visits = [];
    renderBrowser((visit) => visits.push(visit));
    await waitForHydratedHome();
    jest.spyOn(Math, 'random').mockReturnValue(0.999);

    await clickRandomBrowse();
    await waitFor(() => {
      expect(readCanonicalRoute()).toEqual({
        pathname: '/browse',
        relativePath: 'A',
        view: 'album'
      });
    });
    expect(screen.getByText('共 1 张照片')).toBeInTheDocument();

    await clickRandomBrowse();
    await waitFor(() => {
      expect(readCanonicalRoute()).toEqual({
        pathname: '/browse',
        relativePath: 'B',
        view: 'album'
      });
    });

    await clickRandomBrowse();
    await waitFor(() => {
      expect(readCanonicalRoute()).toEqual({
        pathname: '/browse',
        relativePath: 'C',
        view: 'folder'
      });
      expect(readActiveSessionTarget()).toMatchObject({
        relativePath: 'C',
        viewMode: 'browse'
      });
    });
    expect(screen.getByText('共 1 个相簿, 0 张照片')).toBeInTheDocument();

    await pressBackspace();
    await waitFor(() => {
      expect(readCanonicalRoute()).toEqual({
        pathname: '/browse',
        relativePath: '',
        view: 'folder'
      });
    });

    await clickRandomBrowse();
    await waitFor(() => {
      expect(readCanonicalRoute()).toEqual({
        pathname: '/browse',
        relativePath: 'D',
        view: 'album'
      });
      expect(readActiveSessionTarget()).toMatchObject({
        relativePath: 'D',
        viewMode: 'photoSet'
      });
    });
    expect(screen.getByText('该目录还有 1 个子文件夹')).toBeInTheDocument();

    const directImageKey = directoryRefKey({
      sourceId: SOURCE_ID,
      relativePath: 'root-direct.jpg'
    });
    const candidateKeys = buildRandomNavigationTargets(ROOT_SNAPSHOT)
      .map((target) => target.candidateKey);
    expect(candidateKeys).not.toContain(directImageKey);
    expect(candidateKeys.filter((candidateKey) => candidateKey === directoryRefKey({
      sourceId: SOURCE_ID,
      relativePath: 'D'
    }))).toHaveLength(1);
    expect(canonicalRequests.map((request) => request.ref.relativePath))
      .toEqual(['', 'A', 'B', 'C', 'D']);
    expect(visits.map((visit) => new URLSearchParams(visit.search).get('relativePath')))
      .toEqual(['', 'A', 'B', 'C', '', 'D']);
  });

  test('keeps the remaining canonical queue when Home search and display sort change', async () => {
    renderBrowser();
    await waitForHydratedHome();
    jest.spyOn(Math, 'random').mockReturnValue(0.999);

    await clickRandomBrowse();
    await waitFor(() => {
      expect(readCanonicalRoute().relativePath).toBe('A');
    });

    await pressBackspace();
    await waitFor(() => {
      expect(readCanonicalRoute()).toEqual({
        pathname: '/browse',
        relativePath: '',
        view: 'folder'
      });
    });

    fireEvent.click(screen.getByRole('button', { name: '搜索' }));
    const searchInput = await screen.findByPlaceholderText('搜索当前文件夹');
    fireEvent.change(searchInput, { target: { value: 'D' } });
    await waitFor(() => {
      expect(screen.getByTestId('album-card-D')).toBeInTheDocument();
      expect(screen.queryByTestId('album-card-B')).not.toBeInTheDocument();
    });
    const searchBackdrop = document.querySelector('.MuiBackdrop-root');
    expect(searchBackdrop).not.toBeNull();
    fireEvent.click(searchBackdrop);
    await waitFor(() => {
      expect(screen.queryByPlaceholderText('搜索当前文件夹')).not.toBeInTheDocument();
    });

    fireEvent.mouseDown(screen.getByLabelText('排序'));
    fireEvent.click(await screen.findByRole('option', { name: '照片数量' }));
    await waitFor(() => {
      expect(screen.queryByRole('listbox', { name: '排序' })).not.toBeInTheDocument();
      expect(screen.getByLabelText('排序')).toHaveTextContent('照片数量');
    });

    await clickRandomBrowse();
    await waitFor(() => {
      expect(readCanonicalRoute()).toEqual({
        pathname: '/browse',
        relativePath: 'B',
        view: 'album'
      });
    });

    await pressBackspace();
    await waitFor(() => expect(readCanonicalRoute().relativePath).toBe(''));
    await clickRandomBrowse();
    await waitFor(() => {
      expect(readCanonicalRoute()).toEqual({
        pathname: '/browse',
        relativePath: 'C',
        view: 'folder'
      });
    });

    await pressBackspace();
    await waitFor(() => expect(readCanonicalRoute().relativePath).toBe(''));
    await clickRandomBrowse();
    await waitFor(() => {
      expect(readCanonicalRoute()).toEqual({
        pathname: '/browse',
        relativePath: 'D',
        view: 'album'
      });
    });

    expect(canonicalRequests.map((request) => request.ref.relativePath))
      .toEqual(['', 'A', 'B', 'C', 'D']);
  });

  test('keeps adjacent navigation photo-only while Album random can enter a folder', async () => {
    const visits = [];
    renderBrowser((visit) => visits.push(visit));
    await waitForHydratedHome();
    jest.spyOn(Math, 'random').mockReturnValue(0.999);

    await clickRandomBrowse();
    await waitFor(() => {
      expect(readCanonicalRoute().relativePath).toBe('A');
      expect(screen.getByRole('button', { name: '下一个相簿' })).toBeEnabled();
    });
    expect(screen.getByRole('button', { name: '上一个相簿' })).toBeDisabled();

    await pressArrowRight();
    await waitFor(() => {
      expect(readCanonicalRoute().relativePath).toBe('B');
      expect(screen.getByRole('button', { name: '上一个相簿' })).toBeEnabled();
      expect(screen.getByRole('button', { name: '下一个相簿' })).toBeEnabled();
    });

    await pressArrowLeft();
    await waitFor(() => {
      expect(readCanonicalRoute().relativePath).toBe('A');
    });
    await pressArrowRight();
    await waitFor(() => {
      expect(readCanonicalRoute().relativePath).toBe('B');
    });
    await pressArrowRight();
    await waitFor(() => {
      expect(readCanonicalRoute()).toEqual({
        pathname: '/browse',
        relativePath: 'D',
        view: 'album'
      });
    });

    await clickRandomBrowse();
    await waitFor(() => {
      expect(readCanonicalRoute().relativePath).toBe('B');
    });
    await clickRandomBrowse();
    await waitFor(() => {
      expect(readCanonicalRoute()).toEqual({
        pathname: '/browse',
        relativePath: 'C',
        view: 'folder'
      });
    });

    expect(visits.map((visit) => new URLSearchParams(visit.search).get('relativePath')))
      .toEqual(['', 'A', 'B', 'A', 'B', 'D', 'B', 'C']);
    expect(canonicalRequests.map((request) => request.ref.relativePath))
      .toEqual(['', 'A', 'B', 'C']);
  });

  test('isolates same-path tab queues and starts fresh after close and reopen', async () => {
    localStorage.setItem('lastRootPath_default', ROOT_PATH);
    renderBrowser();
    await waitForHydratedHome();
    jest.spyOn(Math, 'random').mockReturnValue(0.999);

    await clickRandomBrowse();
    await waitFor(() => expect(readCanonicalRoute().relativePath).toBe('A'));
    await pressBackspace();
    await waitFor(() => expect(readCanonicalRoute().relativePath).toBe(''));

    fireEvent.click(screen.getByRole('button', { name: '新建标签页' }));
    await waitFor(() => {
      const tabs = screen.getAllByRole('tab');
      expect(tabs).toHaveLength(2);
      expect(tabs[1]).toHaveAttribute('aria-selected', 'true');
    });
    await waitFor(() => {
      const session = JSON.parse(localStorage.getItem('browser_tabs_session_v2'));
      expect(new Set(session.tabs.map((tab) => tab.id)).size).toBe(2);
      expect(session.tabs.map((tab) => tab.location.target.relativePath)).toEqual(['', '']);
    });
    const closedTabId = JSON.parse(localStorage.getItem('browser_tabs_session_v2')).tabs[1].id;

    await clickRandomBrowse();
    await waitFor(() => expect(readCanonicalRoute().relativePath).toBe('A'));
    await pressBackspace();
    await waitFor(() => expect(readCanonicalRoute().relativePath).toBe(''));

    fireEvent.click(screen.getAllByRole('tab')[0]);
    await waitFor(() => {
      expect(screen.getAllByRole('tab')[0]).toHaveAttribute('aria-selected', 'true');
    });
    await clickRandomBrowse();
    await waitFor(() => expect(readCanonicalRoute().relativePath).toBe('B'));
    await pressBackspace();
    await waitFor(() => expect(readCanonicalRoute().relativePath).toBe(''));

    fireEvent.click(screen.getAllByRole('tab')[1]);
    await waitFor(() => {
      expect(screen.getAllByRole('tab')[1]).toHaveAttribute('aria-selected', 'true');
    });
    await clickRandomBrowse();
    await waitFor(() => expect(readCanonicalRoute().relativePath).toBe('B'));
    await pressBackspace();
    await waitFor(() => expect(readCanonicalRoute().relativePath).toBe(''));

    const activeSecondTab = screen.getAllByRole('tab')[1];
    fireEvent.click(within(activeSecondTab).getByRole('button', { name: /关闭标签页/ }));
    await waitFor(() => expect(screen.getAllByRole('tab')).toHaveLength(1));

    fireEvent.click(screen.getByRole('button', { name: '新建标签页' }));
    await waitFor(() => expect(screen.getAllByRole('tab')).toHaveLength(2));
    await clickRandomBrowse();
    await waitFor(() => expect(readCanonicalRoute().relativePath).toBe('A'));

    await waitFor(() => {
      const session = JSON.parse(localStorage.getItem('browser_tabs_session_v2'));
      expect(session.tabs.map((tab) => tab.id)).not.toContain(closedTabId);
      expect(session.tabs[1].location.target.relativePath).toBe('A');
    });
    expect(canonicalRequests.map((request) => request.ref.relativePath))
      .toEqual(['', 'A', '', 'A', 'B', 'B', '', 'A']);
  });

  test('clears prior random state when a saved tab snapshot is restored', async () => {
    renderBrowser();
    await waitForHydratedHome();
    jest.spyOn(Math, 'random').mockReturnValue(0.999);

    fireEvent.click(screen.getByRole('button', { name: '标签页列表' }));
    fireEvent.click(await screen.findByRole('menuitem', { name: '保存当前标签组' }));
    await waitFor(() => {
      expect(localStorage.getItem('browser_tabs_snapshot_v2')).not.toBeNull();
      expect(screen.getByText('已保存 1 个标签页')).toBeInTheDocument();
    });

    await clickRandomBrowse();
    await waitFor(() => expect(readCanonicalRoute().relativePath).toBe('A'));
    await pressBackspace();
    await waitFor(() => expect(readCanonicalRoute().relativePath).toBe(''));

    fireEvent.click(screen.getByRole('button', { name: '标签页列表' }));
    const restoreItem = await screen.findByRole('menuitem', { name: '恢复已保存标签组' });
    expect(restoreItem).toBeEnabled();
    fireEvent.click(restoreItem);
    await waitFor(() => {
      expect(readCanonicalRoute().relativePath).toBe('');
      expect(screen.queryByRole('menuitem', { name: '恢复已保存标签组' }))
        .not.toBeInTheDocument();
    });

    await clickRandomBrowse();
    await waitFor(() => expect(readCanonicalRoute().relativePath).toBe('A'));

    expect(canonicalRequests.map((request) => request.ref.relativePath))
      .toEqual(['', 'A', '', 'A']);
  });
});
