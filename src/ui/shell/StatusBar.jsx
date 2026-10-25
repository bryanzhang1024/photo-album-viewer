import React from 'react';

/** 底部状态栏：左边当前范围与数量，右边可用快捷键。 */
export default function StatusBar({ left = '', right = '' }) {
  return (
    <footer className="statusbar">
      <span>{left}</span>
      <span>{right}</span>
    </footer>
  );
}
