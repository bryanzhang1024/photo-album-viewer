import React from 'react';
import { createRoot } from 'react-dom/client';
import { HashRouter } from 'react-router-dom';
import App from './App';
import './index.css';

// 添加一些调试信息
console.log('React应用开始加载');

const container = document.getElementById('root');

if (!container) {
  console.error('找不到root DOM节点');
} else {
  console.log('找到root DOM节点，创建React根');
  const root = createRoot(container);
  
  root.render(
    <React.StrictMode>
      <HashRouter>
        <App />
      </HashRouter>
    </React.StrictMode>
  );
  
  console.log('React应用渲染完成');
} 