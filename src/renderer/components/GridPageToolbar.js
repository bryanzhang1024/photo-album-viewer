import React, { useState, useId } from 'react';
import {
  Box,
  IconButton,
  Tooltip,
  TextField,
  InputAdornment,
  Popover,
  FormControl,
  Select,
  MenuItem,
  InputLabel,
  Typography,
  Menu,
  ListItemIcon,
  ListItemText,
  Divider,
  Button
} from '@mui/material';
import SearchIcon from '@mui/icons-material/Search';
import ClearIcon from '@mui/icons-material/Clear';
import SortIcon from '@mui/icons-material/Sort';
import TuneIcon from '@mui/icons-material/Tune';
import RefreshIcon from '@mui/icons-material/Refresh';
import CasinoIcon from '@mui/icons-material/Casino';
import ChevronLeftIcon from '@mui/icons-material/ChevronLeft';
import ChevronRightIcon from '@mui/icons-material/ChevronRight';
import FavoriteBorderIcon from '@mui/icons-material/FavoriteBorder';
import FavoriteIcon from '@mui/icons-material/Favorite';
import SettingsIcon from '@mui/icons-material/Settings';
import ArrowDropDownIcon from '@mui/icons-material/ArrowDropDown';
import CheckIcon from '@mui/icons-material/Check';

const DENSITY_OPTIONS = [
  { value: 'compact', label: '紧凑' },
  { value: 'standard', label: '标准' },
  { value: 'comfortable', label: '宽松' }
];

function SearchOverlay({
  searchQuery,
  onSearchChange,
  searchPlaceholder,
  onSearchFocusChange
}) {
  const [anchorEl, setAnchorEl] = useState(null);
  const open = Boolean(anchorEl);

  const handleOpen = (event) => {
    setAnchorEl(event.currentTarget);
  };

  const handleClose = () => {
    setAnchorEl(null);
    onSearchFocusChange?.(false);
  };

  return (
    <>
      <Tooltip title="搜索">
        <IconButton
          color="inherit"
          size="small"
          sx={{ mx: 0.5 }}
          onClick={handleOpen}
          aria-label="搜索"
          aria-expanded={open}
        >
          <SearchIcon />
        </IconButton>
      </Tooltip>
      <Popover
        open={open}
        anchorEl={anchorEl}
        onClose={handleClose}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
        transformOrigin={{ vertical: 'top', horizontal: 'right' }}
        slotProps={{
          paper: {
            sx: { width: 260, p: 1.5, mt: 0.5 }
          }
        }}
      >
        <TextField
          autoFocus
          fullWidth
          value={searchQuery}
          onChange={(event) => onSearchChange(event.target.value)}
          placeholder={searchPlaceholder}
          size="small"
          variant="outlined"
          onFocus={() => onSearchFocusChange?.(true)}
          onBlur={() => onSearchFocusChange?.(false)}
          InputProps={{
            startAdornment: (
              <InputAdornment position="start">
                <SearchIcon fontSize="small" />
              </InputAdornment>
            ),
            endAdornment: searchQuery ? (
              <InputAdornment position="end">
                <IconButton
                  size="small"
                  aria-label="清除搜索"
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => onSearchChange('')}
                >
                  <ClearIcon fontSize="small" />
                </IconButton>
              </InputAdornment>
            ) : null
          }}
          onKeyDown={(event) => {
            if (event.key === 'Escape') {
              onSearchChange('');
              handleClose();
            }
          }}
        />
      </Popover>
    </>
  );
}

function SortControls({
  sortBy,
  sortDirection,
  sortOptions,
  onSortChange,
  onSortDirectionChange,
  sortSelectId
}) {
  return (
    <>
      <FormControl
        variant="outlined"
        size="small"
        sx={{
          minWidth: { xs: 80, sm: 120 },
          mr: 1,
          bgcolor: 'rgba(0,0,0,0.05)',
          borderRadius: 1
        }}
      >
        <InputLabel id={sortSelectId} sx={{ fontSize: '0.8rem' }}>排序</InputLabel>
        <Select
          labelId={sortSelectId}
          value={sortBy}
          onChange={onSortChange}
          label="排序"
          sx={{ fontSize: '0.8rem' }}
        >
          {sortOptions.map((option) => (
            <MenuItem key={option.value} value={option.value}>
              {option.label}
            </MenuItem>
          ))}
        </Select>
      </FormControl>
      <IconButton color="inherit" onClick={onSortDirectionChange} size="small" sx={{ mx: 0.5 }}>
        <SortIcon
          sx={{
            transform: sortDirection === 'desc' ? 'rotate(180deg)' : 'none',
            transition: 'transform 0.3s'
          }}
        />
      </IconButton>
    </>
  );
}

function TunePopover({
  userDensity,
  onDensityChange,
  onRandomAlbum,
  randomDisabled,
  randomTooltip = '随机选择相簿 (R)'
}) {
  const [anchorEl, setAnchorEl] = useState(null);
  const densitySelectId = useId();
  const open = Boolean(anchorEl);

  const handleOpen = (event) => {
    setAnchorEl(event.currentTarget);
  };

  const handleClose = () => {
    setAnchorEl(null);
  };

  const handleRandomClick = () => {
    handleClose();
    onRandomAlbum?.();
  };

  return (
    <>
      <Tooltip title="视图选项">
        <IconButton
          color="inherit"
          size="small"
          sx={{ mx: 0.5 }}
          onClick={handleOpen}
          aria-label="视图选项"
          aria-expanded={open}
        >
          <TuneIcon />
        </IconButton>
      </Tooltip>
      <Popover
        open={open}
        anchorEl={anchorEl}
        onClose={handleClose}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
        transformOrigin={{ vertical: 'top', horizontal: 'right' }}
        slotProps={{
          paper: {
            sx: { width: 220, p: 2, mt: 0.5 }
          }
        }}
      >
        <FormControl fullWidth size="small" sx={{ mb: 2 }}>
          <InputLabel id={densitySelectId}>密度</InputLabel>
          <Select
            labelId={densitySelectId}
            value={userDensity}
            onChange={(event) => onDensityChange(event.target.value)}
            label="密度"
          >
            {DENSITY_OPTIONS.map((option) => (
              <MenuItem key={option.value} value={option.value}>
                {option.label}
              </MenuItem>
            ))}
          </Select>
        </FormControl>
        <Button
          fullWidth
          variant="outlined"
          size="small"
          startIcon={<CasinoIcon />}
          onClick={handleRandomClick}
          disabled={randomDisabled}
          aria-label={randomTooltip}
        >
          随机选相簿
        </Button>
      </Popover>
    </>
  );
}

function AlbumNavigation({ navigation }) {
  if (!navigation) {
    return null;
  }

  const { prev, next, currentIndex, total, onPrev, onNext } = navigation;

  return (
    <>
      <Tooltip title={prev ? `上一个相簿: ${prev.name}` : '已是第一个相簿'}>
        <span>
          <IconButton
            color="inherit"
            onClick={onPrev}
            disabled={!prev}
            size="small"
            sx={{ mx: 0.5 }}
            aria-label="上一个相簿"
          >
            <ChevronLeftIcon />
          </IconButton>
        </span>
      </Tooltip>
      {total > 0 && (
        <Typography variant="caption" sx={{ mx: 0.5, fontSize: '0.75rem' }}>
          {currentIndex + 1}/{total}
        </Typography>
      )}
      <Tooltip title={next ? `下一个相簿: ${next.name}` : '已是最后一个相簿'}>
        <span>
          <IconButton
            color="inherit"
            onClick={onNext}
            disabled={!next}
            size="small"
            sx={{ mx: 0.5 }}
            aria-label="下一个相簿"
          >
            <ChevronRightIcon />
          </IconButton>
        </span>
      </Tooltip>
    </>
  );
}

function FavoritesMenu({ favoriteMenuItems = [], openFavoritesItem }) {
  const [anchorEl, setAnchorEl] = useState(null);
  const open = Boolean(anchorEl);
  const hasChecked = favoriteMenuItems.some((item) => item.checked);

  const handleOpen = (event) => {
    setAnchorEl(event.currentTarget);
  };

  const handleClose = () => {
    setAnchorEl(null);
  };

  const handleItemClick = (item) => {
    if (item.disabled) {
      return;
    }
    handleClose();
    item.onClick?.();
  };

  const handleOpenFavorites = () => {
    handleClose();
    openFavoritesItem?.onClick?.();
  };

  return (
    <>
      <Tooltip title="收藏">
        <IconButton
          color="inherit"
          size="small"
          sx={{ mx: 0.5 }}
          onClick={handleOpen}
          aria-label="收藏菜单"
          aria-expanded={open}
          aria-haspopup="true"
        >
          {hasChecked ? (
            <FavoriteIcon sx={{ color: '#ff5252' }} />
          ) : (
            <FavoriteBorderIcon />
          )}
          <ArrowDropDownIcon sx={{ fontSize: '1rem', ml: -0.25 }} />
        </IconButton>
      </Tooltip>
      <Menu
        anchorEl={anchorEl}
        open={open}
        onClose={handleClose}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
        transformOrigin={{ vertical: 'top', horizontal: 'right' }}
      >
        {favoriteMenuItems.map((item) => (
          <MenuItem
            key={item.id}
            disabled={item.disabled}
            onClick={() => handleItemClick(item)}
          >
            <ListItemIcon sx={{ minWidth: 32 }}>
              {item.checked ? <CheckIcon fontSize="small" color="error" /> : null}
            </ListItemIcon>
            <ListItemText primary={item.label} />
          </MenuItem>
        ))}
        {openFavoritesItem ? (
          [
            <Divider key="divider" />,
            <MenuItem key="open-favorites" onClick={handleOpenFavorites}>
              <ListItemText primary={openFavoritesItem.label} />
            </MenuItem>
          ]
        ) : null}
      </Menu>
    </>
  );
}

function GridPageToolbar({
  searchQuery,
  onSearchChange,
  searchPlaceholder,
  onSearchFocusChange,
  sortBy,
  sortDirection,
  sortOptions,
  onSortChange,
  onSortDirectionChange,
  userDensity,
  onDensityChange,
  onRandomAlbum,
  randomDisabled = false,
  randomTooltip,
  onRefresh,
  refreshDisabled = false,
  refreshAriaLabel,
  navigation = null,
  favoriteMenuItems = [],
  openFavoritesItem,
  onOpenSettings
}) {
  const sortSelectId = useId();

  return (
    <Box
      data-testid="grid-page-toolbar"
      sx={{
        display: 'flex',
        alignItems: 'center',
        flexShrink: 0,
        ml: 2,
        gap: 1,
        flex: 1,
        minWidth: 0,
        justifyContent: 'flex-end',
        flexWrap: { xs: 'wrap', sm: 'nowrap' }
      }}
    >
      <Tooltip title={refreshAriaLabel}>
        <span>
          <IconButton
            color="inherit"
            onClick={onRefresh}
            size="small"
            sx={{ mx: 0.5 }}
            aria-label={refreshAriaLabel}
            disabled={refreshDisabled}
          >
            <RefreshIcon />
          </IconButton>
        </span>
      </Tooltip>
      <SearchOverlay
        searchQuery={searchQuery}
        onSearchChange={onSearchChange}
        searchPlaceholder={searchPlaceholder}
        onSearchFocusChange={onSearchFocusChange}
      />
      <SortControls
        sortBy={sortBy}
        sortDirection={sortDirection}
        sortOptions={sortOptions}
        onSortChange={onSortChange}
        onSortDirectionChange={onSortDirectionChange}
        sortSelectId={sortSelectId}
      />
      <TunePopover
        userDensity={userDensity}
        onDensityChange={onDensityChange}
        onRandomAlbum={onRandomAlbum}
        randomDisabled={randomDisabled}
        randomTooltip={randomTooltip}
      />
      <AlbumNavigation navigation={navigation} />
      <FavoritesMenu
        favoriteMenuItems={favoriteMenuItems}
        openFavoritesItem={openFavoritesItem}
      />
      <Tooltip title="设置">
        <IconButton
          color="inherit"
          onClick={onOpenSettings}
          size="small"
          sx={{ mx: 0.5 }}
          aria-label="设置"
        >
          <SettingsIcon />
        </IconButton>
      </Tooltip>
    </Box>
  );
}

export default GridPageToolbar;
