# Changelog

## [0.0.4] - 2026-06-22

### 新增
- ntfy 推送通知：会话完成、需要审批/输入、异常终止时推送通知到手机
- ntfy 设置页面：启用开关、服务器地址、主题配置、测试按钮
- 文件管理器：复制/剪切/粘贴文件和目录
- 文件管理器：拖拽移动文件到目标目录
- 文件管理器：右键菜单和工具栏上传/下载文件
- 文件管理器：Ctrl+点击多选、Shift+点击范围选择
- 文件管理器：操作成功/失败 Toast 通知提示
- 文件管理器：文件树行高设置（外观设置 24-48px 滑块）
- 文件管理器：右键「在此目录新建会话」
- 文件管理器：选中图片文件时直接预览

### 修复
- Android 文件管理器长按菜单卡死：透明遮罩拦截浏览器原生长按检测
- 手机端用户回合导航混入系统消息
- 「从此回合加载」因消息截断不生效
- 手机端语音输入图标快速闪烁
- Android 切回浏览器丢失最新消息
- 页面刷新后卡在「从此回合」位置

## [0.0.3] - 2026-06-01

### Fixed
- Allow unsigned macOS desktop builds when Developer ID signing secrets are not configured.

## [0.0.2] - 2026-06-01

### Added
- Windows local installer script for testing the desktop app from a normal per-user installation.
- Claude child-process diagnostics for Windows session startup failures.

### Fixed
- Desktop startup health probe and allowed-host handling for Windows Tauri origins.

## [0.0.1] - 2026-06-01

### Added
- Disposable desktop release for validating CI artifacts, signing fallback, and release publishing.

## [0.1.0] - Unreleased

### Added
- Initial desktop app with setup wizard
- Bundled Bun runtime for running Yep Anywhere server
- Agent installation (Claude Code, Codex CLI)
- System tray with server management
- Auto-start and window state persistence
- Auto-updater support
