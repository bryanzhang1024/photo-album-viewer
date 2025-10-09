import React from 'react';
import { render, screen } from '@testing-library/react';
import ErrorBoundary from '../../src/renderer/components/ErrorBoundary';

const ProblemChild = () => {
  throw new Error('boom');
};

describe('ErrorBoundary', () => {
  let consoleErrorSpy;

  beforeEach(() => {
    consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    consoleErrorSpy.mockRestore();
  });

  test('renders children when no error', () => {
    render(
      <ErrorBoundary>
        <div data-testid="content">safe</div>
      </ErrorBoundary>
    );

    expect(screen.getByTestId('content')).toHaveTextContent('safe');
  });

  test('renders fallback UI when child throws', () => {
    render(
      <ErrorBoundary>
        <ProblemChild />
      </ErrorBoundary>
    );

    expect(screen.getByText('应用发生错误')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '重试' })).toBeInTheDocument();
  });
});
