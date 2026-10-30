# Bli Music

个人使用的 Windows 音乐播放器，以 B站未登录可访问内容作为在线音源。当前 P0 开发与技术自动验证已完成，待用户试听；尚未达到完整音乐软件阶段。

## 当前演示范围

输入 BV/AV 编号或 B站完整视频链接，读取分 P、选择独立音轨，验证播放、暂停和跳转。使用独立匿名会话，不读取浏览器账号，不提供个人 Cookie 输入。

已将用户认可的第二版视觉接入播放器：无人物的雨窗、漂流、日光三套全窗口场景，保留纸感与留白；透明播放控制、本次分段列表与沉浸模式均连接真实音源。切换场景、展开列表或进入沉浸模式不打断播放，按 Escape 关闭列表或返回聆听页。歌词尚未接入，界面明确显示当前状态。

短链、搜索、资料库、歌词和外部歌单将在后续阶段实现。无独立音轨、需要权限或访问受限的内容明确提示，不保证所有视频都可以匿名播放。

## 安装前

下载和 Git 提交需要用户明确授权，见 `AGENTS.md`。具体依赖、来源、D 盘路径及安装命令见 `docs/p0_download_plan.md`。不要以“开始开发”作为自动下载授权。

## 下载获授权并安装依赖后

```powershell
npm.cmd run typecheck
npm.cmd test
npm.cmd run build
npm.cmd run smoke:p0
npm.cmd run start
```

日常打开演示可以运行 `start-p0.cmd`，它只调用已安装的本地构建工具与运行环境，不自动安装依赖。

`smoke:p0` 会在隐藏窗口中对真实公开样例执行静音播放、分 P、暂停、跳转、Range、列表操作和切页连续性检查，当前 16 项通过。结果保存到 `.artifacts/p0`，新版界面截图保存到 `.artifacts/ui-v2`。声音效果仍需真实设备试听。

## 不需要安装项目依赖的检查

当前 Node.js 24 可以直接执行这些本地 TypeScript 检查：

```powershell
node.exe --test tests/source.test.ts
node.exe scripts/probe-p0.ts
```

第一条使用独立测试数据验证解析和异常逻辑；第二条访问真实 B站元信息接口并生成记录，不请求音轨文件字节。两者都不能替代 Electron 的实际播放检查。

## 文档

- `project_plan.md`：产品范围和进度。
- `docs/development_environment.md`：开发前环境检查记录。
- `docs/p0_download_plan.md`：本批已获授权的下载清单与实际安装记录。
- `docs/p0_validation.md`：P0 验证范围、结果与人工试听步骤。
- `docs/ui_v1.md`：第一版界面改动、视觉来源及验证记录。
- `docs/ui_v2.md`：当前第二版运行界面、操作与验证记录。
- `docs/p0_licenses.md`：依赖及参考项目许可记录。

## 许可状态

项目最终开源许可证尚待用户决定，目前 `package.json` 的 `UNLICENSED` 为开发期占位，不表示已完成公开发行准备。P0 业务代码自行实现，第三方依赖按各自许可证使用；未复制 BiliMusic 未明确获许可的代码或素材。
