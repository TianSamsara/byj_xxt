# 白玉京：本地 Codex 连接版

当前版本：**0.14.3**（2026-10-16）。详细变更见 [更新日志](CHANGELOG.md)。

基于提供的 Greasy Fork 脚本 0.13.2 制作。原始文件保留在 `upstream.user.js`，修改版为 `byj.user.js`。本目录原来没有项目文件。

## 使用

1. 在油猴中用 `byj.user.js` 替换原脚本，避免两个版本同时启用。
2. 首次使用，在 PowerShell 中进入此目录，运行 `./install-bridge-launcher.ps1` 注册当前用户的 Windows 启动器，再运行 `./start-bridge.ps1 -Background`。需要 Node.js 20+ 和本机 `codex.exe`；运行时的绝对路径会保存到被 Git 忽略的 `.bridge-work/launcher.json`。
3. 在本机读取 `.bridge-token` 中随机生成的**本地连接密钥**（例如运行 `Get-Content .bridge-token`）。在脚本 AI 连接中选择“本地 Codex”，将它填入 API Key / 本地连接密钥。已有密钥继续有效。
4. 后续直接在 AI 连接中点击“启动本地桥接”，浏览器询问时允许打开启动器。桥接在后台运行，面板检测就绪后自动获取模型；也可随时点击“检测连接”或“获取模型”。选择模型和思考强度，保存设置。档位由本机 Codex 按模型返回；切换模型会重置为默认档位。浏览器第一次询问访问本机地址时允许该请求。

Windows 启动器使用固定的 `byj-codex://start` 链接，只启动本目录桥接；不接收 URL 中的命令或密钥，不注册开机自启，无需管理员权限。浏览器脚本本身不能直接执行本机程序，因此需要这一步注册。项目移动或 Node/Codex 路径更新后，需重新注册。卸载运行 `./install-bridge-launcher.ps1 -Uninstall`。非 Windows 环境可继续手动运行 `node bridge.mjs`。

默认地址：`http://127.0.0.1:17653/v1/chat/completions`。本地 Codex 模式固定此地址，避免把本地密钥发送到远程。其他服务商仍按原方式填写 API Key。

桥接通过官方 `codex app-server` 接口启动独立本地进程，使用 CLI 已保存的 ChatGPT 登录状态。**仅打开 Codex 桌面窗口不等于 CLI 已登录**；如提示未登录，在终端运行 `codex login`。桥接要求账户类型为 ChatGPT，拒绝在此模式下悄悄切换成 API Key 计费。实际额度、限流、模型权限由当前账户和服务端决定，模型列表本身不保证推理权限。

不读取、复制或向浏览器发送 Codex 登录令牌；不接管当前聊天。网页题目文本及启用视觉后的图片会通过本机 Codex 发往模型服务。本地连接密钥保存在 `.bridge-token`，不要分享或提交到仓库。丢失时停止桥接、删除该文件、重启后更新油猴配置。

`CODEX_BIN` 可在注册前指定 Codex 可执行文件绝对路径。`./start-bridge.ps1`（无 `-Background`）以前台运行，按 Ctrl+C 关闭；`-Background` 在后台运行，启动日志位于 `.bridge-work/`。重复启动不会创建第二个服务，端口被其他服务占用时会报错。更新桥接代码后需停止旧进程再启动。

## 已处理的问题

- 增加本地 Codex 入口、从本机接口动态获取模型，兼容原有文本/图片题请求和答案解析。
- 增加按模型能力提供的思考强度选项，并保存、校验和传递给 Codex。
- 简答/论述题与填空题分开处理，一个编辑器内可填写多段、多要点答案；填空题仍逐空校验。
- 合并同一富文本编辑器的注册别名和 DOM 节点，排除隐藏提交字段、工具栏和不可见控件，避免把一个编辑器识别为多个答题区。
- 排除包住已注册 UEditor 的 `.eidtDiv`、`.textDIV` 和 `contenteditable` 外层包装，修复日志中的 `editable:DIV, editor:edui…` 重复计数。
- AI 连接界面增加本地桥接启动按钮、连接状态和检测按钮；启动后自动获取模型，错误密钥和离线状态分别提示。
- 本地请求等待上限调整为 190 秒，桥接超时为 180 秒；超时和浏览器断开会结束对应进程，最多并行两个请求。
- 仅监听 IPv4 回环地址，校验 Host、网页 Origin 和随机密钥；请求体最大 12 MiB，只接受文本和内嵌图片，拒绝本地文件路径与远程图片 URL。
- 使用临时会话、只读沙箱、禁止审批，关闭 shell、多代理、网页搜索，并覆盖 MCP 配置；拒绝 app-server 发来的工具/审批回调。
- 修复获取模型期间切换服务商后旧响应覆盖新模型的问题，并限制模型列表渲染数量。
- API 地址禁止内嵌账号密码、查询参数及片段；补全 GM_info 授权。
- 缺少课程测验设置时默认不启用自动提交；已明确保存的偏好继续保留。
- 本地版本移除上游自动更新地址，避免新版本覆盖修改；后续更新需手动合并。

## 验证

运行 `npm test`，再运行 `node --check byj.user.js`。编辑器测试覆盖模拟 DOM 下的别名与祖先包装去重、隐藏字段过滤和内容同步；连接测试覆盖启动后等待、密钥错误及旧响应丢弃。`node diagnose.mjs` 检查真实 CLI 的账户类型和模型列表；`node diagnose.mjs --smoke` 额外执行一次最小模型请求，会消耗少量额度。可加 `--effort=low` 验证所选思考档位。

本次未登录学习通页面进行真实填答/提交测试。原脚本的播放器、题库、跨帧和提交逻辑主要保留，未进行完整重构；使用前请核对答案和提交设置。

## 官方接口依据

- [Codex App Server](https://developers.openai.com/codex/app-server)
- [Codex Authentication](https://developers.openai.com/codex/auth)

`upgrade.py` 可从保存的原始源码重建本地脚本。`schemas/` 为本机 Codex 生成的协议参考，不参与运行。
