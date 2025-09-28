import { useState, useCallback } from 'react';

function useSorting(initialSortBy = 'name', initialSortDirection = 'asc') {
  const [sortBy, setSortBy] = useState(initialSortBy);
  const [sortDirection, setSortDirection] = useState(initialSortDirection);

  const handleSortChange = useCallback((event) => {
    setSortBy(event.target.value);
  }, []);

  const handleDirectionChange = useCallback(() => {
    setSortDirection(prev => (prev === 'asc' ? 'desc' : 'asc'));
  }, []);

  return {
    sortBy,
    sortDirection,
    handleSortChange,
    handleDirectionChange
  };
}

export default useSorting;
