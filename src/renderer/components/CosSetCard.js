import React, { useRef, useState } from 'react';
import { Box, ButtonBase, IconButton, Paper, Typography } from '@mui/material';
import FavoriteIcon from '@mui/icons-material/Favorite';
import FavoriteBorderIcon from '@mui/icons-material/FavoriteBorder';
import CHANNELS from '../../common/ipc-channels';
import { useFavorites } from '../contexts/FavoritesContext';

const genericLooks = new Set([
  '原皮', '默认', '默认服装', '公式服', '角色服装', '角色服',
  '原版角色服', '原版角色服装', '原版舞台服', '角色Cos', '角色 Cos'
]);

function values(tags = []) {
  return [...new Set(tags.filter(value => typeof value === 'string' && value.trim()).map(value => value.trim()))];
}

function coserCardText(item, currentCoser) {
  const characters = values(item.characters);
  const works = values(item.works);
  // Presentation suppression only. An omitted look does not certify default
  // costume or replace the deferred metadata review.
  const looks = values(item.looks).filter(look => !genericLooks.has(look)
    && !characters.includes(look) && !works.includes(look));
  const fullName = item.displayName || '';
  const separator = fullName.indexOf('｜');
  const prefix = separator < 0 ? '' : fullName.slice(0, separator);
  const cosers = values(item.cosers);
  const knownPrefixes = [currentCoser, ...cosers,
    cosers.join('＋'), cosers.join('、'), cosers.join(' + ')].filter(Boolean);
  let releaseName = separator >= 0 && knownPrefixes.includes(prefix)
    ? fullName.slice(separator + 1).trim() : fullName;
  if (item.type && releaseName.endsWith(`（${item.type}）`)) {
    releaseName = releaseName.slice(0, -(`（${item.type}）`.length));
  }
  const collaborators = cosers.filter(coser => coser !== currentCoser);
  return {
    title: characters.length ? [characters.join('、'), ...looks].join(' · ') : releaseName || looks.join(' · ') || fullName,
    subtitle: [...(works.length ? works : item.type ? [item.type] : []),
      ...(currentCoser && collaborators.length ? [`与 ${collaborators.join('、')} 合作`] : [])].join(' · ')
  };
}

function CosSetCard({ item, context, currentCoser, cover, metadata, onClick, onError }) {
  const { favorites, isLoading, toggleAlbumFavorite } = useFavorites();
  const [pending, setPending] = useState(false);
  const pendingRef = useRef(false);
  const targets = item.favoriteTargets || [];
  const existingFavorite = (favorites?.albums || []).find(album => (album.kind || 'photoSet') === 'photoSet'
    && targets.some(target => target.path === album.path));
  const target = targets.find(candidate => candidate.online);
  const isOffline = item.status === 'offline';
  const concise = context === 'coser';
  const text = concise ? coserCardText(item, currentCoser) : { title: item.displayName, subtitle: '' };

  const handleFavorite = async event => {
    event.stopPropagation();
    if (pendingRef.current || isLoading || (!existingFavorite && !target)) return;
    pendingRef.current = true;
    setPending(true);
    try {
      if (existingFavorite) {
        await toggleAlbumFavorite(existingFavorite);
      } else {
        const albumPath = await window.electronAPI?.invoke(CHANNELS.COS_GET_SET_ALBUM_PATH, item.id);
        if (!albumPath) throw new Error('套图所在目录当前不可用');
        const preview = targets.find(candidate => candidate.path === albumPath)?.previewImagePath;
        await toggleAlbumFavorite({
          path: albumPath, name: item.displayName, imageCount: item.imageCount,
          previewImagePath: preview || null
        });
      }
    } catch (error) {
      onError?.(error.message || '无法更新收藏');
    } finally {
      pendingRef.current = false;
      setPending(false);
    }
  };

  return (
    <Paper component="article" elevation={1} onClick={isOffline ? undefined : event => {
      // Disabled native buttons can still bubble a click through their parent.
      if (!event.target.closest('[data-cos-favorite]')) onClick?.(event);
    }}
      sx={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column',
        overflow: 'hidden', borderRadius: 2, border: '1px solid', borderColor: 'divider',
        bgcolor: 'background.paper', backgroundImage: 'none', opacity: isOffline ? 0.62 : 1,
        cursor: isOffline ? 'default' : 'pointer' }}>
      <ButtonBase disabled={isOffline} aria-label={item.displayName} title={item.displayName}
        sx={{ width: '100%', display: 'block', textAlign: 'left', color: 'text.primary',
          '&.Mui-focusVisible': { outline: '2px solid', outlineColor: 'primary.main', outlineOffset: '-2px' },
          '&:active': { transform: 'scale(0.995)' } }}>
        {cover}
        <Box sx={{ px: 1.25, pt: 0.75, pb: 0.25 }}>
          <Typography fontWeight={650} noWrap={concise} sx={concise
            ? { lineHeight: 1.8, fontSize: '0.9rem' }
            : { lineHeight: 1.35, minHeight: '2.7em', display: '-webkit-box',
              WebkitBoxOrient: 'vertical', WebkitLineClamp: 2, overflow: 'hidden' }}>
            {text.title}
          </Typography>
          {!concise ? metadata : null}
        </Box>
      </ButtonBase>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, px: 1.25, pb: 0.75,
        minHeight: 36, mt: 'auto', minWidth: 0 }}>
        {text.subtitle ? <Typography variant="caption" color="text.secondary"
          sx={{ flex: '1 1 auto', minWidth: 0, overflowWrap: 'anywhere', lineHeight: 1.6 }}>
          {text.subtitle}
        </Typography> : <Box sx={{ flexGrow: 1 }} />}
        <Typography variant="caption" color="text.secondary" sx={{ whiteSpace: 'nowrap', flexShrink: 0 }}>
          {Number(item.imageCount || 0).toLocaleString('en-US')} 张
        </Typography>
        <IconButton size="small" onClick={handleFavorite} data-cos-favorite
          aria-label={existingFavorite ? '取消收藏' : '添加收藏'}
          title={existingFavorite ? '取消收藏' : '添加收藏'}
          disabled={Boolean(isLoading || pending || (!existingFavorite && !target))}
          sx={{ flexShrink: 0, width: 28, height: 28, p: 0.5,
            color: existingFavorite ? 'secondary.main' : 'text.secondary',
            '&:active': { transform: 'scale(0.9)' } }}>
          {existingFavorite ? <FavoriteIcon sx={{ fontSize: 18 }} /> : <FavoriteBorderIcon sx={{ fontSize: 18 }} />}
        </IconButton>
      </Box>
    </Paper>
  );
}

export default React.memo(CosSetCard);
