import React from 'react';
import { Box, Typography, Button, IconButton } from '@mui/material';
import Brightness4Icon from '@mui/icons-material/Brightness4';
import Brightness7Icon from '@mui/icons-material/Brightness7';
import { useNavigate } from 'react-router-dom';

function TestPage({ colorMode }) {
  const navigate = useNavigate();
  
  return (
    <Box sx={{ p: 3 }}>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
        <Typography variant="h4">测试页面</Typography>
        <IconButton 
          onClick={colorMode.toggleColorMode} 
          color="inherit"
          title={colorMode.mode === 'dark' ? "切换到浅色模式" : "切换到深色模式"}
        >
          {colorMode.mode === 'dark' ? <Brightness7Icon /> : <Brightness4Icon />}
        </IconButton>
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