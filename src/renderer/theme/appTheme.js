import { createTheme } from '@mui/material/styles';
import { getPalette, radii, spacing, typography } from './tokens';

/**
 * 生成 MUI 主题：暗色与浅色共用同一套语义 token。
 * 视觉目标是 macOS 原生观感——分层底色加细线分隔，不用阴影表达层级。
 */
export function createAppTheme(mode = 'dark') {
  const palette = getPalette(mode);
  const isDark = mode === 'dark';

  return createTheme({
    palette: {
      mode,
      primary: { main: palette.accent, contrastText: palette.accentText },
      secondary: { main: palette.accent },
      background: {
        default: palette.background,
        paper: palette.panel
      },
      text: {
        primary: palette.text,
        secondary: palette.textDim,
        disabled: palette.textDimmer
      },
      divider: palette.separator,
      error: { main: palette.danger },
      chrome: palette.chrome,
      sidebar: palette.sidebar,
      canvas: palette.canvas,
      selection: palette.selection,
      hover: palette.hover,
      dimmer: palette.textDimmer
    },
    shape: {
      borderRadius: radii.control
    },
    typography: {
      fontFamily: typography.fontFamily,
      fontSize: typography.body,
      h1: { fontSize: typography.title, fontWeight: 700, letterSpacing: '-0.01em' },
      h2: { fontSize: 17, fontWeight: 700 },
      h3: { fontSize: 15, fontWeight: 650 },
      body1: { fontSize: typography.body },
      body2: { fontSize: typography.caption },
      caption: { fontSize: typography.caption },
      button: { fontSize: typography.body, textTransform: 'none' }
    },
    components: {
      MuiCssBaseline: {
        styleOverrides: {
          body: {
            backgroundColor: palette.background,
            color: palette.text
          }
        }
      },
      MuiPaper: {
        styleOverrides: {
          root: {
            backgroundImage: 'none'
          }
        }
      },
      MuiCard: {
        styleOverrides: {
          root: {
            backgroundColor: palette.panel,
            backgroundImage: 'none',
            boxShadow: 'none',
            border: `1px solid ${palette.separator}`
          }
        }
      },
      MuiAppBar: {
        styleOverrides: {
          root: {
            backgroundColor: palette.chrome,
            backgroundImage: 'none',
            boxShadow: 'none',
            borderBottom: `1px solid ${palette.separator}`
          }
        }
      },
      MuiToolbar: {
        styleOverrides: {
          dense: {
            minHeight: spacing.tabBarHeight
          }
        }
      },
      MuiButton: {
        defaultProps: { disableElevation: true },
        styleOverrides: {
          root: {
            textTransform: 'none',
            borderRadius: radii.control,
            fontSize: typography.body
          }
        }
      },
      MuiIconButton: {
        styleOverrides: {
          root: {
            borderRadius: radii.control,
            '&:hover': { backgroundColor: palette.hover }
          }
        }
      },
      MuiTab: {
        styleOverrides: {
          root: {
            textTransform: 'none',
            minHeight: spacing.tabBarHeight,
            fontSize: typography.caption,
            color: palette.textDim,
            '&.Mui-selected': { color: palette.text }
          }
        }
      },
      MuiTabs: {
        styleOverrides: {
          indicator: { transition: 'none' }
        }
      },
      MuiOutlinedInput: {
        styleOverrides: {
          root: {
            borderRadius: radii.control,
            fontSize: typography.body
          },
          notchedOutline: {
            borderColor: palette.separator
          }
        }
      },
      MuiInputBase: {
        styleOverrides: {
          input: { fontSize: typography.body }
        }
      },
      MuiMenu: {
        styleOverrides: {
          paper: {
            backgroundColor: isDark ? '#2c2c2e' : '#ffffff',
            border: `1px solid ${palette.separator}`,
            boxShadow: isDark ? '0 12px 32px rgba(0,0,0,0.55)' : '0 12px 32px rgba(0,0,0,0.18)'
          }
        }
      },
      MuiMenuItem: {
        styleOverrides: {
          root: {
            fontSize: typography.body,
            minHeight: 28,
            '&:hover': { backgroundColor: palette.hover }
          }
        }
      },
      MuiTooltip: {
        styleOverrides: {
          tooltip: {
            backgroundColor: isDark ? '#3a3a3c' : '#2c2c2e',
            fontSize: typography.caption,
            borderRadius: radii.control
          }
        }
      },
      MuiChip: {
        styleOverrides: {
          root: {
            borderRadius: radii.control,
            fontSize: typography.caption
          }
        }
      },
      MuiDivider: {
        styleOverrides: {
          root: { borderColor: palette.separator }
        }
      },
      MuiSnackbarContent: {
        styleOverrides: {
          root: { fontSize: typography.body }
        }
      }
    }
  });
}
