import React from 'react';
import { createRoot } from 'react-dom/client';
import { HashRouter } from 'react-router-dom';
import App from './App';
import ErrorBoundary from './components/ErrorBoundary';
import './index.css';

// 添加一些调试信息
console.log('React应用开始加载');

const container = document.getElementById('root');

if (!container) {
  console.error('找不到root DOM节点');
} else {
  console.log('找到root DOM节点，创建React根');
  const root = createRoot(container);
  
  // 添加错误边界处理
  try {
    root.render(
      <React.StrictMode>
        <ErrorBoundary>
          <HashRouter>
            <App />
          </HashRouter>
        </ErrorBoundary>
      </React.StrictMode>
    );
    console.log('React应用渲染完成');
  } catch (error) {
    console.error('React渲染错误:', error);
    container.innerHTML = `
      <div style="padding: 20px; font-family: Arial, sans-serif;">
        <h1>应用加载错误</h1>
        <p>错误信息: ${error.message}</p>
        <pre>${error.stack}</pre>
      </div>
    `;
  }
} 