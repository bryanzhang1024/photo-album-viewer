# Photo Album Viewer - 开发指南

## 项目简介

**项目**: 照片浏览器
**技术**: Electron + React + Material-UI
**目标**: 快速浏览大量照片，不卡顿

## 核心原则

**1. 简单直接**
- 用户点击文件夹 → 显示缩略图
- 用户点击图片 → 显示大图
- 没有复杂的"智能预测"，那是垃圾

**2. 性能三要素**
- **虚拟化**: 只渲染看得见的图片
- **缓存**: 缩略图缓存，满了就清理最旧的
- **懒加载**: 需要时才加载，不要瞎猜用户想看什么

**3. Electron 基础**
- 主进程: 文件操作
- 渲染进程: UI显示
- IPC: 两个进程通信
- 安全: 禁用 Node.js 在渲染进程

## 代码规范

### 数据结构设计
```javascript
// 核心数据结构 - 简单直接
const PhotoCache = {
  thumbnails: new Map(),    // 缩略图缓存
  fullSize: new Map(),      // 全尺寸缓存
  maxSize: 100,            // 最大缓存数量

  // 简单的LRU清理
  cleanup() {
    if (this.thumbnails.size > this.maxSize) {
      const firstKey = this.thumbnails.keys().next().value;
      this.thumbnails.delete(firstKey);
    }
  }
};
```

### Electron IPC
```javascript
// 主进程: 只做文件操作
ipcMain.handle('scan-folder', async (event, folderPath) => {
  const files = fs.readdirSync(folderPath);
  return files.filter(f => /\.(jpg|png|jpeg)$/i.test(f));
});

// 渲染进程: 调用主进程
const photos = await window.electronAPI.scanFolder(folderPath);
```

### React 性能
```javascript
// 避免过度优化 - 只在真正需要时使用 memo
const PhotoItem = ({ photo, onClick }) => (
  <img src={photo.thumbnail} onClick={onClick} />
);

// 虚拟化 - 只渲染可见部分
const PhotoGrid = ({ photos }) => {
  // 计算可见范围
  // 只渲染可见的照片
};
```

## 文件组织

```
src/
├── main.js           # Electron 主进程
├── renderer.js       # React 渲染进程入口
├── components/       # React 组件
│   ├── PhotoGrid.js  # 照片网格
│   ├── PhotoView.js  # 单张照片查看
│   └── FolderPicker.js # 文件夹选择
└── utils/
    ├── cache.js      # 缓存管理
    └── fileUtils.js  # 文件处理
```

**原则**: 扁平化，不要过度嵌套目录

## 常用命令

```bash
npm start       # 开发
npm run build   # 构建
```

**调试**: F12 打开开发者工具，console.log 是你最好的朋友

## 界面设计

**原则**: 用户想看照片，不是想看你的炫技

```javascript
// 简单的网格布局
const PhotoGrid = () => (
  <div style={{
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))',
    gap: '8px'
  }}>
    {photos.map(photo => <img key={photo.id} src={photo.thumbnail} />)}
  </div>
);
```

## 性能优化

**测量先于优化** - 不要猜性能问题在哪里

```javascript
// 缩略图生成 - Sharp 在主进程
const generateThumbnail = (imagePath) => {
  return sharp(imagePath)
    .resize(300, 300, { fit: 'cover' })
    .jpeg({ quality: 80 })
    .toBuffer();
};

// 简单缓存 - 满了就删除最旧的
class ImageCache {
  constructor(maxSize = 100) {
    this.cache = new Map();
    this.maxSize = maxSize;
  }

  set(key, value) {
    if (this.cache.size >= this.maxSize) {
      const firstKey = this.cache.keys().next().value;
      this.cache.delete(firstKey);
    }
    this.cache.set(key, value);
  }

  get(key) {
    return this.cache.get(key);
  }
}
```

## 常见错误

**不要在渲染进程使用 Node.js API**
```javascript
// 错误
const fs = require('fs');

// 正确
window.electronAPI.readFile(filePath);
```

**图片加载错误处理**
```javascript
<img
  src={photo.thumbnail}
  onError={(e) => e.target.src = 'placeholder.jpg'}
/>
```

**性能问题排查**
1. 打开开发者工具
2. 查看 Performance 标签
3. 看哪里卡了
4. 针对性优化，不要瞎优化

## 开发工作流

1. **理解问题**: 用户真正的痛点是什么？
2. **最简方案**: 用最笨但最清楚的方法解决
3. **测试验证**: 确保功能正常工作
4. **性能测试**: 开发者工具验证是否卡顿

## 注意事项

- **跨平台**: 注意文件路径分隔符 (Windows 用 `\`, Unix 用 `/`)
- **权限**: 确保有读取文件夹的权限
- **错误处理**: 文件可能不存在、损坏、权限不足
- **内存**: 大量图片会吃内存，及时清理缓存

---

**核心思想**: 让用户快速看到照片，其他都是次要的

