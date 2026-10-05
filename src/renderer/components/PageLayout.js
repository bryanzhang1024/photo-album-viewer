import React from 'react';
import {
  Box,
  AppBar,
  Toolbar,
  CircularProgress,
  Alert,
  Container
} from '@mui/material';

function PageLayout({ loading, error, headerContent, subHeaderContent = null, children, scrollContainerRef }) {
  return (
    <Box sx={{ flexGrow: 1, height: 'calc(100vh - var(--app-chrome-height, 0px))', display: 'flex', flexDirection: 'column' }}>
      <AppBar position="static" color="default" elevation={0} sx={{ borderBottom: 1, borderColor: 'divider' }}>
        <Toolbar variant="dense" sx={{ flexWrap: 'wrap', gap: 0.5, rowGap: 1.5, pt: 1.5, pb: 0.5 }}>
          {headerContent}
        </Toolbar>
        {subHeaderContent ? (
          <Box sx={{ borderTop: 1, borderColor: 'divider', px: { xs: 0.5, sm: 1 }, py: 0.5 }}>
            {subHeaderContent}
          </Box>
        ) : null}
      </AppBar>

      <Box
        ref={scrollContainerRef}
        sx={{ flexGrow: 1, minHeight: 0, overflow: 'auto', py: 2, px: { xs: 1, sm: 2, md: 3 } }}
        className="scroll-container"
      >
        {error ? (
          <Container maxWidth="md">
            <Alert severity="error" sx={{ mt: 2 }}>{error}</Alert>
          </Container>
        ) : loading ? (
          <Box sx={{ minHeight: 240, display: 'grid', placeItems: 'center' }}>
            <CircularProgress />
          </Box>
        ) : (
          children
        )}
      </Box>
    </Box>
  );
}

export default PageLayout;
