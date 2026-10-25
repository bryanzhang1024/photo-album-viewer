import React from 'react';

/**
 * 界面自带的图标集：全部是内联 SVG，不依赖任何图标库。
 * 尺寸通过 currentColor 与父级字号继承，统一 1.5 描边。
 */
const base = {
  width: 16,
  height: 16,
  viewBox: '0 0 16 16',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.5,
  strokeLinecap: 'round',
  strokeLinejoin: 'round'
};

export const SidebarIcon = () => (
  <svg {...base} width={15} height={15}>
    <rect x="1.75" y="2.5" width="12.5" height="11" rx="2" />
    <path d="M6.25 2.5v11" />
  </svg>
);

export const ChevronLeftIcon = () => (
  <svg {...base} width={17} height={17}>
    <path d="M9.8 3.4 5 8l4.8 4.6" />
  </svg>
);

export const ChevronRightIcon = () => (
  <svg {...base} width={17} height={17}>
    <path d="M6.2 3.4 11 8l-4.8 4.6" />
  </svg>
);

export const GridIcon = () => (
  <svg {...base} width={14} height={14}>
    <rect x="1.9" y="1.9" width="5.2" height="5.2" rx="1.1" />
    <rect x="8.9" y="1.9" width="5.2" height="5.2" rx="1.1" />
    <rect x="1.9" y="8.9" width="5.2" height="5.2" rx="1.1" />
    <rect x="8.9" y="8.9" width="5.2" height="5.2" rx="1.1" />
  </svg>
);

export const ListIcon = () => (
  <svg {...base} width={14} height={14}>
    <path d="M2 3.6h12M2 8h12M2 12.4h12" />
  </svg>
);

export const SortIcon = () => (
  <svg {...base} width={15} height={15}>
    <path d="M4.6 3v10M2.2 10.6 4.6 13l2.4-2.4M11.4 13V3M9 5.4 11.4 3 13.8 5.4" />
  </svg>
);

export const ShuffleIcon = () => (
  <svg {...base} width={15} height={15}>
    <path d="M2.2 4.4h2.6l6 7.2h2.6M11.2 3.4l2.2 1-2.2 1M2.2 11.6h2.6l2-2.4M11.2 10.6l2.2 1-2.2 1" />
  </svg>
);

export const SearchIcon = () => (
  <svg {...base} width={14} height={14}>
    <circle cx="7" cy="7" r="4.3" />
    <path d="m10.3 10.3 3.2 3.2" />
  </svg>
);

export const FolderIcon = () => (
  <svg viewBox="0 0 16 16" width={15} height={15} fill="currentColor">
    <path d="M1.5 4.2c0-.7.6-1.2 1.2-1.2h3.1c.4 0 .7.2.9.4l.8.9h5.8c.7 0 1.2.6 1.2 1.2v6.1c0 .7-.6 1.2-1.2 1.2H2.7c-.7 0-1.2-.6-1.2-1.2V4.2z" />
  </svg>
);

export const HeartIcon = () => (
  <svg viewBox="0 0 16 16" width={15} height={15} fill="currentColor">
    <path d="M8 13.6S2.2 10.2 2.2 6.4c0-1.9 1.5-3.4 3.3-3.4 1.1 0 2 .6 2.5 1.5.5-.9 1.4-1.5 2.5-1.5 1.8 0 3.3 1.5 3.3 3.4 0 3.8-5.8 7.2-5.8 7.2z" />
  </svg>
);

export const CollectionsIcon = () => (
  <svg {...base} width={15} height={15}>
    <rect x="1.9" y="3.4" width="8.2" height="9.2" rx="1.4" />
    <path d="M12.1 5.2v6.6c0 .9-.7 1.6-1.6 1.6H5.6" />
  </svg>
);

export const PersonIcon = () => (
  <svg viewBox="0 0 16 16" width={15} height={15} fill="currentColor">
    <circle cx="8" cy="5.2" r="2.9" />
    <path d="M2.6 13.6c0-2.6 2.4-4.4 5.4-4.4s5.4 1.8 5.4 4.4z" />
  </svg>
);

export const SettingsIcon = () => (
  <svg {...base} width={15} height={15}>
    <circle cx="8" cy="8" r="2.2" />
    <path d="M8 1.9v1.7M8 12.4v1.7M1.9 8h1.7M12.4 8h1.7M3.7 3.7l1.2 1.2M11.1 11.1l1.2 1.2M12.3 3.7l-1.2 1.2M4.9 11.1l-1.2 1.2" />
  </svg>
);

export const CloseIcon = () => (
  <svg {...base} width={10} height={10}>
    <path d="m4 4 8 8M12 4l-8 8" />
  </svg>
);

export const PlusIcon = () => (
  <svg {...base} width={14} height={14}>
    <path d="M8 3v10M3 8h10" />
  </svg>
);

export const InfoIcon = () => (
  <svg {...base} width={16} height={16}>
    <circle cx="8" cy="8" r="6.2" />
    <circle cx="8" cy="5.1" r=".95" fill="currentColor" stroke="none" />
    <rect x="7.25" y="7" width="1.5" height="4.6" rx=".75" fill="currentColor" stroke="none" />
  </svg>
);

export const RotateIcon = () => (
  <svg {...base} width={17} height={17}>
    <path d="M3.2 8.4A4.9 4.9 0 1 0 5 4.2" />
    <path d="M2.6 2.6v3.2h3.2" />
  </svg>
);

export const FullscreenIcon = () => (
  <svg {...base} width={16} height={16}>
    <path d="M2.4 6V2.6H6M10 2.6h3.6V6M13.6 10v3.4H10M6 13.4H2.4V10" />
  </svg>
);

export const DualPageIcon = () => (
  <svg {...base} width={16} height={16}>
    <rect x="1.6" y="3" width="5.6" height="10" rx="1.2" />
    <rect x="8.8" y="3" width="5.6" height="10" rx="1.2" />
  </svg>
);

export const TrashIcon = () => (
  <svg {...base} width={16} height={16}>
    <path d="M2.8 4.4h10.4M6.2 4.4V2.9c0-.5.4-.9.9-.9h1.8c.5 0 .9.4.9.9v1.5" />
    <path d="M4 4.4l.7 8.4c.1.8.7 1.4 1.5 1.4h3.6c.8 0 1.4-.6 1.5-1.4l.7-8.4" />
  </svg>
);

export const FitIcon = () => (
  <svg {...base} width={15} height={15}>
    <rect x="2" y="3" width="12" height="10" rx="1.6" />
    <path d="M5.2 8h5.6M6.4 6.6 5 8l1.4 1.4M9.6 6.6 11 8l-1.4 1.4" />
  </svg>
);

export const VideoIcon = () => (
  <svg {...base} width={15} height={15}>
    <rect x="1.5" y="3" width="13" height="10" rx="2" />
    <path d="M6.6 6.1v3.8l3.4-1.9z" fill="currentColor" stroke="none" />
  </svg>
);

export const ArchiveIcon = () => (
  <svg {...base} width={15} height={15}>
    <rect x="2" y="2.6" width="12" height="10.8" rx="1.6" />
    <path d="M8 2.6v3.2M8 8v1.4" />
  </svg>
);

export const DocumentIcon = () => (
  <svg {...base} width={15} height={15}>
    <path d="M3.4 2.5h6l3.2 3.2v7.8H3.4z" />
    <path d="M9.2 2.6v3.2h3.2M5.4 8.2h5.2M5.4 10.6h5.2" />
  </svg>
);

export const AudioIcon = () => (
  <svg {...base} width={15} height={15}>
    <path d="M6.2 11.4V4.2l5.6-1.4v7" />
    <circle cx="4.6" cy="11.6" r="1.6" />
    <circle cx="10.2" cy="10.2" r="1.6" />
  </svg>
);

export const InstallerIcon = () => (
  <svg {...base} width={15} height={15}>
    <rect x="2" y="2.6" width="12" height="10.8" rx="1.6" />
    <path d="M8 5v4M6.2 7.4 8 9.2l1.8-1.8" />
  </svg>
);

export const FileIcon = () => (
  <svg {...base} width={15} height={15}>
    <path d="M3.4 2.5h6l3.2 3.2v7.8H3.4z" />
    <path d="M9.2 2.6v3.2h3.2" />
  </svg>
);

export const SortAscIcon = () => (
  <svg {...base} width={15} height={15}>
    <path d="M4.6 13V3M2.2 5.4 4.6 3l2.4 2.4M11.4 13V3M9 5.4 11.4 3l2.4 2.4" />
  </svg>
);

export const SortDescIcon = () => (
  <svg {...base} width={15} height={15}>
    <path d="M4.6 3v10M2.2 10.6 4.6 13l2.4-2.4M11.4 3v10M9 10.6l2.4 2.4 2.4-2.4" />
  </svg>
);
