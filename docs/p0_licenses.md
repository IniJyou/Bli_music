# P0 来源与许可记录

日期：2026-10-30。状态：直接依赖元信息已核对，已安装的 86 个直接及传递包已生成许可声明清单；Electron 随运行环境提供的许可与 Chromium 声明文件均存在。完整公开发行审核仍留待发布阶段。

## P0 业务代码

本项目的输入解析、B站接口封装、受控流转发、界面和验证脚本自行编写，没有复制两个参考项目的实现代码或界面素材。接口地址及参数用于互操作，不等同于使用参考项目的源码许可。

项目开源许可证尚待用户决定。当前 `package.json` 使用 `UNLICENSED` 防止把未决定的许可误写为已确定许可，公开发行前需要补全。

## 直接依赖元信息

| 包 | 版本 | npm 声明许可 |
| --- | --- | --- |
| electron | 45.1.0 | MIT；其内含 Chromium、Node.js 等组件另有许可与声明，需保留随运行环境提供的声明 |
| react、react-dom | 19.3.1 | MIT |
| electron-vite | 5.0.0 | MIT |
| vite | 7.3.1 | MIT |
| @vitejs/plugin-react | 5.0.4 | MIT |
| typescript | 5.9.3 | Apache-2.0 |
| @types/node | 24.10.0 | MIT |
| @types/react、@types/react-dom | 19.3.0 | MIT |

以上是元信息核对，不能代替完整的发行许可审核。已根据锁文件检查实际安装的依赖；公开发行前仍需收集需要保留的许可证与第三方声明。

## 已安装依赖清单

运行 `node.exe scripts/collect-licenses.mjs` 生成 `p0_dependency_licenses.json`，包含锁文件摘要、实际包版本、来源、声明许可和可发现的许可文件名。

- 已安装包：86 个；没有缺少许可元信息声明的包。
- 声明分布：MIT 74、ISC 7、Apache-2.0 3、CC-BY-4.0 1、BSD-3-Clause 1。
- 与当前 Windows 平台无关而未安装的锁文件条目单独记录，不误报为已安装。
- 已确认 `node_modules/electron/dist/LICENSE` 和 `LICENSES.chromium.html` 存在，后续分发保留这些文件。
- 此清单不等于对捆绑代码及全部资源完成法律审核，也不替代项目最终开源许可证的选择。

## 参考项目

- BiliMusic：此前未发现明确代码许可证，P0 不复用其代码或素材。
- BBPlayer：此前核对为 MIT；P0 参考功能方向，没有复制其业务实现。以后若复用其模块，另行记录来源并保留声明。

运行验证期间按需显示 B站返回的公开视频标题、UP 主和封面，并流式播放样例。音视频和封面不随项目源码分发；本项目代码许可证也不授予第三方内容的权利。

## 主要对照来源

- [Electron](https://github.com/electron/electron)
- [React](https://github.com/facebook/react)
- [TypeScript](https://github.com/microsoft/TypeScript)
- [electron-vite](https://electron-vite.org/guide/)
- [BBPlayer LICENSE](https://github.com/bbplayer-app/BBPlayer/blob/dev/LICENSE)
