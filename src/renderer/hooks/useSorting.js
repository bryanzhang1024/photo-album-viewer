import { useState, useCallback } from 'react';

function useSorting(initialSortBy = 'name', initialSortDirection = 'asc') {
  const [sortBy, setSortBy] = useState(() => localStorage.getItem('sortBy') || initialSortBy);
  const [sortDirection, setSortDirection] = useState(() => localStorage.getItem('sortDirection') || initialSortDirection);

  const handleSortChange = useCallback((event) => {
    const newSortBy = event.target.value;
    localStorage.setItem('sortBy', newSortBy);
    setSortBy(newSortBy);
  }, []);

  const handleDirectionChange = useCallback(() => {
    setSortDirection(prev => {
      const newDirection = prev === 'asc' ? 'desc' : 'asc';
      localStorage.setItem('sortDirection', newDirection);
      return newDirection;
    });
  }, []);

  return {
    sortBy,
    sortDirection,
    handleSortChange,
    handleDirectionChange
  };
}

export default useSorting;
