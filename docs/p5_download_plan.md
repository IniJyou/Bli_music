# P5 打包工具下载清单

日期为 2026-11-07。开始 P5 的指令授权实现与验证，下载按协作规则单独确认。

用户已明确授权本批下载并继续完成打包验证。

## 内容和用途

- `electron-builder@26.18.0` 及其 npm 依赖，用于生成 Windows x64 程序和 NSIS 安装包。使用官方 npm registry。实际依赖版本固定在更新后的锁文件。
- 打包期间 electron-builder 按其固定版本下载的 NSIS、NSIS 资源和 Windows 可执行文件资源编辑工具。来源为 `github.com/electron-userland/electron-builder-binaries/releases` 的官方构建资源。
- 复用项目已有的 Electron 45.1.0 Windows x64 运行时。

## 路径

| 内容 | 保存位置 |
| --- | --- |
| 开发依赖 | `D:\aiworkspace\MyMusic\node_modules` |
| npm 缓存 | `D:\aiworkspace\MyMusic\.cache\npm` |
| NSIS 和打包工具缓存 | `D:\aiworkspace\MyMusic\.cache\electron-builder` |
| Electron 缓存 | `D:\aiworkspace\MyMusic\.cache\electron` |
| 临时目录 | `D:\aiworkspace\MyMusic\.cache\tmp` |
| 安装包和程序目录 | `D:\aiworkspace\MyMusic\release` |
| 安装和升级验证 | `D:\aiworkspace\MyMusic\.artifacts\p5` |

## 执行命令

```powershell
pwsh -NoProfile -ExecutionPolicy Bypass -File .\scripts\install-p5.ps1
node.exe scripts/run.mjs dist
```

第一条命令只安装打包依赖，关闭 npm 生命周期脚本。第二条命令构建应用并调用本地打包工具，首次运行会获取所需的 NSIS 资源。后续使用缓存重复构建和生成隔离升级验证包。

本批授权范围为以上来源、用途和 D 盘路径。Git 操作与公开发布按各自授权执行。

实际安装了 electron-builder 26.18.0 及其依赖。全项目当前已安装 355 个 npm 包，声明清单见 `p5_dependency_licenses.json`。构建获取了官方 7zip 1.0.0、NSIS 3.0.4.1 和 NSIS resources 3.4.1，并复用现有 Electron 运行时。所用缓存与临时目录均在本项目 D 盘目录内。

官方配置说明见 [electron-builder](https://www.electron.build/configuration/configuration) 和 [NSIS 配置](https://www.electron.build/v26/docs/nsis/)。
