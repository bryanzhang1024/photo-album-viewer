import React from 'react';
import { Box, Typography, Button } from '@mui/material';
import { useNavigate } from 'react-router-dom';

function TestPage({ colorMode }) {
  const navigate = useNavigate();

  return (
    <Box sx={{ p: 3 }}>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
        <Typography variant="h4">测试页面</Typography>
      </Box>
      <Typography paragraph>
        这是一个测试页面，用于测试路由和组件功能。
      </Typography>
      <Button variant="contained" onClick={() => navigate('/')}>
        返回首页
      </Button>
    </Box>
  );
}

export default TestPage; 