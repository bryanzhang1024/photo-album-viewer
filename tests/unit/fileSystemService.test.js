/** @jest-environment node */

const {
  createErrorResponse,
  SUPPORTED_FORMATS
} = require('../../src/main/services/FileSystemService');

describe('FileSystemService helpers', () => {
  test('createErrorResponse produces uniform payload', () => {
    const response = createErrorResponse('fail', '/tmp/photos');

    expect(response).toMatchObject({
      success: false,
      nodes: [],
      currentPath: '/tmp/photos',
      parentPath: '',
      breadcrumbs: [],
      error: {
        message: 'fail'
      },
      metadata: null
    });
    expect(typeof response.error.timestamp).toBe('number');
  });

  test('SUPPORTED_FORMATS lists common image extensions', () => {
    expect(SUPPORTED_FORMATS).toEqual(
      expect.arrayContaining(['.jpg', '.jpeg', '.png', '.gif', '.bmp', '.webp'])
    );
  });
});
