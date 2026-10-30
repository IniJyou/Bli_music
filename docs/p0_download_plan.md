# P0 下载清单与授权范围

日期：2026-10-30。状态：用户已明确授权本批下载，依赖与 Electron 运行环境已安装，P0 构建和实际音轨自动验证通过。

## 用途

建立并运行最小 Windows 播放演示，验证 B站未登录可访问音轨、分 P 选择、暂停、跳转与错误处理。

## 下载内容与来源

| 内容 | 固定版本 | 来源 |
| --- | --- | --- |
| Electron npm 包与 Windows x64 运行环境 | 45.1.0 | 官方 npm；运行环境来自 Electron 官方 GitHub Release |
| React、React DOM | 19.3.1 | 官方 npm |
| electron-vite | 5.0.0 | 官方 npm |
| Vite | 7.3.1 | 官方 npm |
| React 构建插件 | @vitejs/plugin-react 5.0.4 | 官方 npm |
| TypeScript | 5.9.3 | 官方 npm |
| 类型声明 | @types/node 24.10.0、@types/react 19.3.0、@types/react-dom 19.3.0 | 官方 npm |
| 上述包所需依赖及 Windows 预编译工具包 | 由安装生成的锁文件固定 | 官方 npm，包含必要的 esbuild/Rollup 平台依赖 |

官方 npm 指 `https://registry.npmjs.org`，命令仅对本次安装指定该来源，不修改全局 npm 配置。

Electron 运行环境预期来自：

`https://github.com/electron/electron/releases/download/v45.1.0/electron-v45.1.0-win32-x64.zip`

安装器也会读取该版本的校验信息。这里使用 HTTPS 下载发布归档，不执行 Git 远程操作。P0 暂不安装 SQLite、打包工具、歌词库或其他阶段的依赖。

## 保存路径

- 项目依赖：`D:\aiworkspace\MyMusic\node_modules`
- npm 缓存：`D:\aiworkspace\MyMusic\.cache\npm`
- Electron 下载缓存：`D:\aiworkspace\MyMusic\.cache\electron`
- 下载解压临时目录：`D:\aiworkspace\MyMusic\.cache\tmp`
- 演示运行数据：`D:\aiworkspace\MyMusic\.cache\runtime`
- 本地构建输出：`D:\aiworkspace\MyMusic\out`
- 验证结果与截图：`D:\aiworkspace\MyMusic\.artifacts\p0`
- npm 锁文件：`D:\aiworkspace\MyMusic\package-lock.json`

## 拟执行命令

工作目录：`D:\aiworkspace\MyMusic`

```powershell
pwsh -NoProfile -ExecutionPolicy Bypass -File .\scripts\install-p0.ps1
```

脚本使用进程范围内的 D 盘缓存与临时目录，先执行 `npm.cmd install --ignore-scripts --no-audit --no-fund --registry=https://registry.npmjs.org`，再只运行 Electron 官方安装脚本下载运行环境。Electron 45.1.0 实际读取 `electron_config_cache`，脚本已同时设置该变量及兼容旧工具的 `ELECTRON_CACHE`。脚本结束后恢复原进程环境，不改全局配置。

安装后计划执行本地类型检查、测试、构建与 Electron 演示；音频验证会向 B站请求公开样例的元信息并流式读取音轨，不保存为音频下载文件，不使用个人账号 Cookie。

样例：单曲 `BV1GJ411x7h7` 与多分 P `BV17x411w7KC`。播放和跳转会产生网络流量，验证结束即停止播放。

授权范围不包含额外软件或工具链安装，也不包含 Git 初始化、提交、推送或公开发布。如果所列方案之外还需要下载其他软件，会另行说明。

## 实际执行记录

- Windows 沙箱内 npm 安装遇到 `EPERM`，在自动审批允许后于沙箱外执行同批脚本；共安装 86 个包，没有增加清单外的直接依赖。
- 首次 Electron 安装发现新版本忽略旧缓存变量，归档落到默认 C 盘位置。已修正变量，并处理跨盘移动后的加密属性问题，在 D 盘重新获取同一个已授权版本；原 C 盘归档已移除，未清理其他缓存。
- 最终归档位于 `D:\aiworkspace\MyMusic\.cache\electron\aaf6f0d50457ca990261d018944055084f99ff44386590983c0cfac6a979c69d\electron-v45.1.0-win32-x64.zip`，大小 158224448 字节。
- SHA256 为 `55eaba17abff7b5bba6c3bbc85068967379024fe742fe9c7fdba9118922ccbe2`，与 Electron 包内的官方校验信息一致；记录见 `.artifacts/p0/electron-cache.json`。
- 依赖版本由 `package-lock.json` 固定，实际依赖许可清单见 `p0_dependency_licenses.json`。
- 静音播放验证仅流式请求样例，没有保存为音频下载文件。没有执行 Git 初始化、提交或推送。
