import React from 'react';
import {
  Box,
  AppBar,
  Toolbar,
  CircularProgress,
  Alert,
  Container
} from '@mui/material';

function PageLayout({ loading, error, headerContent, children, scrollContainerRef }) {
  return (
    <Box sx={{ flexGrow: 1, height: '100vh', display: 'flex', flexDirection: 'column' }}>
      <AppBar position="static" color="default" elevation={0} sx={{ borderBottom: 1, borderColor: 'divider' }}>
        <Toolbar variant="dense">
          {headerContent}
        </Toolbar>
      </AppBar>

      <Box
        ref={scrollContainerRef}
        sx={{ flexGrow: 1, overflow: 'auto', py: 2, px: { xs: 1, sm: 2, md: 3 } }}
        className="scroll-container"
      >
        {loading ? (
          <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '50vh' }}>
            <CircularProgress />
          </Box>
        ) : error ? (
          <Container maxWidth="md">
            <Alert severity="error" sx={{ mt: 2 }}>{error}</Alert>
          </Container>
        ) : (
          children
        )}
      </Box>
    </Box>
  );
}

export default PageLayout;
