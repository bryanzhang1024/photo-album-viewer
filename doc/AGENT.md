# Sub-Agents Configuration

## 概述

本项目已成功配置了7个专业化的sub-agents，它们位于 `.claude/agents/` 目录下，遵循Claude Code的标准格式。

## 已配置的Sub-Agents

### 1. electron-specialist
- **专业领域**: Electron应用开发、跨平台桌面应用、主进程/渲染进程架构
- **使用场景**: 构建Electron应用或解决桌面应用问题时自动激活

### 2. image-processing-architect
- **专业领域**: 图像处理算法、计算机视觉、照片优化、视觉数据管道
- **使用场景**: 照片应用、图像处理工作流或视觉数据系统时自动激活

### 3. ui-performance-engineer
- **专业领域**: UI性能优化、前端指标、用户体验增强
- **使用场景**: 优化Web应用性能或修复UI相关问题时自动激活

### 4. caching-strategist
- **专业领域**: 缓存策略、性能优化、高效数据访问模式
- **使用场景**: 处理性能问题、高流量应用或数据密集型系统时自动激活

### 5. file-system-optimizer
- **专业领域**: 文件系统优化、存储策略、I/O性能、跨平台文件处理
- **使用场景**: 处理文件密集型应用或存储性能问题时自动激活

### 6. desktop-experience-designer
- **专业领域**: 桌面应用用户体验、原生UI模式、跨平台设计一致性
- **使用场景**: 设计桌面应用或改进桌面UX时自动激活

### 7. cross-platform-specialist
- **专业领域**: 跨平台开发、平台特定API、文件系统差异、UI适配
- **使用场景**: 开发针对多个平台的桌面应用时自动激活

## 使用方法

### 自动使用
Claude Code会根据任务描述自动选择合适的sub-agent：
```
优化这个照片应用的性能 → 自动激活 image-processing-architect 和 ui-performance-engineer
构建一个Electron应用 → 自动激活 electron-specialist
设计桌面应用界面 → 自动激活 desktop-experience-designer
```

### 手动使用
明确指定使用某个sub-agent：
```
Use the caching-strategist to optimize the data access patterns
Use the electron-specialist to troubleshoot the main process issue
Use the image-processing-architect to implement the photo filter
```

### 查看所有可用agents
运行Claude Code的 `/agents` 命令查看所有可用的sub-agents。

## 配置验证

项目包含了一个测试脚本 `test-sub-agents.js` 用于验证sub-agent配置：
```bash
node test-sub-agents.js
```

## 技术细节

### 文件格式
每个sub-agent都使用标准的Claude Code格式：
- YAML frontmatter包含 `name` 和 `description` 字段
- `name` 必须与文件名匹配
- `description` 包含 "PROACTIVELY" 关键词以启用自动委托

### 位置
- 项目级sub-agents: `.claude/agents/`
- 用户级sub-agents: `~/.claude/agents/`

### 优先级
项目级sub-agents优先于用户级sub-agents。

## 维护

- 添加新的sub-agent时，确保遵循标准格式
- 更新sub-agent描述时，保持专业性并包含触发关键词
- 定期验证配置是否正确