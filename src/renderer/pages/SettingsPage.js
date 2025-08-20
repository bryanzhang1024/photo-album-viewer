import React from 'react';
import {
  Box,
  Typography,
  Switch,
  FormControlLabel,
  FormControl,
  FormLabel,
  RadioGroup,
  Radio,
  Paper,
  Button,
  Divider,
  Container
} from '@mui/material';
import { useSettings } from '../contexts/SettingsContext';

function SettingsPage() {
  const { settings, updateSetting, resetSettings } = useSettings();

  const handleToggle = (key) => (event) => {
    updateSetting(key, event.target.checked);
  };

  const handleRadioChange = (key) => (event) => {
    updateSetting(key, event.target.value);
  };

  return (
    <Container maxWidth="md" sx={{ py: 4 }}>
      <Typography variant="h4" gutterBottom>
        设置
      </Typography>
      
      <Paper elevation={1} sx={{ p: 3, mb: 3 }}>
        <Typography variant="h6" gutterBottom>
          图片查看器
        </Typography>
        
        <Box sx={{ mb: 3 }}>
          <FormControlLabel
            control={
              <Switch
                checked={settings.autoRotateVerticalImages}
                onChange={handleToggle('autoRotateVerticalImages')}
              />
            }
            label="竖屏图片自动横屏显示"
            sx={{ mb: 2 }}
          />
          
          {settings.autoRotateVerticalImages && (
            <Box sx={{ ml: 4, mt: 2 }}>
              <FormControl component="fieldset">
                <FormLabel component="legend">旋转方向</FormLabel>
                <RadioGroup
                  value={settings.rotationDirection}
                  onChange={handleRadioChange('rotationDirection')}
                  row
                >
                  <FormControlLabel 
                    value="right" 
                    control={<Radio />} 
                    label="向右旋转（顺时针）" 
                  />
                  <FormControlLabel 
                    value="left" 
                    control={<Radio />} 
                    label="向左旋转（逆时针）" 
                  />
                </RadioGroup>
              </FormControl>
            </Box>
          )}
        </Box>

        <Divider sx={{ my: 2 }} />

        <Box sx={{ mb: 3 }}>
          <Typography variant="h6" gutterBottom>
            其他设置
          </Typography>
          
          <FormControlLabel
            control={
              <Switch
                checked={settings.showFilename}
                onChange={handleToggle('showFilename')}
              />
            }
            label="显示文件名"
            sx={{ mb: 2 }}
          />
        </Box>

        <Divider sx={{ my: 2 }} />

        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <Typography variant="body2" color="text.secondary">
            所有设置将自动保存
          </Typography>
          <Button 
            variant="outlined" 
            color="error"
            onClick={resetSettings}
          >
            重置所有设置
          </Button>
        </Box>
      </Paper>
    </Container>
  );
}

export default SettingsPage;