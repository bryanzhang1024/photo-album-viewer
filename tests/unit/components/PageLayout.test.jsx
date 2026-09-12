import React from 'react';
import { render, screen } from '@testing-library/react';
import PageLayout from '../../../src/renderer/components/PageLayout';

describe('PageLayout', () => {
  test('shows a loading indicator instead of stale page content while loading', () => {
    render(
      <PageLayout loading={true} error="" headerContent={<span>标题</span>}>
        <span>尚未载入的内容</span>
      </PageLayout>
    );

    expect(screen.getByRole('progressbar')).toBeInTheDocument();
    expect(screen.queryByText('尚未载入的内容')).not.toBeInTheDocument();
  });
});
