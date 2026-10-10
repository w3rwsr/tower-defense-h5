---
name: github-push
description: 把塔防 H5 项目的本地改动提交并推送到 GitHub main 分支。用户说"推送 GitHub""上传 GitHub""提交到远程"时使用；包含 Windows 本机 git 完整路径、PowerShell 兼容写法和 127.0.0.1:11719 代理等环境要点。不用于创建 PR 或推送其他仓库。
---

# 塔防 H5 — GitHub 推送流程

将当前工作区（`c:\Users\鸡dan\Desktop\塔防`）的改动提交并直接推送到
`https://github.com/w3rwsr/tower-defense-h5` 的 `main` 分支。
用户已确认偏好：**直接推 main，不开 PR、不建特性分支**。

## 环境要点（本机实测，必须遵守）

- **git 不在 PATH**：一律使用完整路径
  `& "C:\Program Files\Git\cmd\git.exe"`（PowerShell 调用操作符 `&`）。
- **PowerShell 5 限制**：不支持 `&&` / `||`，多命令用 `;` 分隔；
  **不支持 bash heredoc**（`<<'EOF'` 会语法错误）。多行 commit message
  必须写到临时文件后用 `git commit -F <file>`。
- **GitHub 直连不通**：github.com:443 常超时。推送必须带系统本地代理：
  `-c http.proxy=http://127.0.0.1:11719 -c https.proxy=http://127.0.0.1:11719`。
  代理地址可能变化；若该端口连接失败，用注册表
  `HKCU:\Software\Microsoft\Windows\CurrentVersion\Internet Settings`
  的 ProxyServer / ProxyEnable 重新确认，不要反复直连重试。
- 所有 git 命令通过 Shell 工具的 `cwd` 参数指定工作区，不要 `cd`。
- 工作区含中文路径，路径用双引号包裹。

## 标准流程

1. **检查状态**：`git status -sb` + `git diff --stat`。
   - 只暂存本次任务相关文件；工作区混入无关改动时，先向用户确认范围，
     禁止 `git add -A` 一锅端。
2. **写 commit message**：在 `$env:TEMP` 下建临时文件（如
   `c:\Users\鸡dan\AppData\Local\Temp\commit_msg.txt`），用 Write 工具
   写入中文 terse 标题（含版本号，见下）+ 空行 + 正文（改了什么/为什么/
   根因/验证方式）。
3. **暂存并提交**（`;` 链接，同一 Shell 调用）：
   `git add <显式文件路径>; git commit -F <临时文件路径>`
4. **代理推送**：
   `git -c http.proxy=http://127.0.0.1:11719 -c https.proxy=http://127.0.0.1:11719 push origin main`
   timeout 给 120000ms。成功输出形如 `<old>..<new>  main -> main`。
5. **清理**：用 DeleteFile 删除临时 commit message 文件。
6. 向用户报告 commit 短哈希、标题、推送区间、仓库与 Pages 地址
   （https://w3rwsr.github.io/tower-defense-h5/ 自动部署）。

## 本项目版本号约定（缓存规避）

- `index.html` 中所有 `?v=YYYYMMDDx` 引用，改动哪个文件就同步升哪个的
  版本号（当天日期 + 字母序号，如 20260921c）。`file://` 与微信 WebView
  缓存顽固，**只改代码不升版本号等于没发版**。
- style.css / js/main.js 等资源与 index.html 自身引用都要检查。

## 异常处理

- **历史分叉（拒绝推送 unrelated histories）**：先建备份分支
  `git branch backup/<sha前7位>` 保存本地提交，再 `git reset origin/main`
  对齐远程历史（工作区改动保留），重新走提交流程。**禁止 force push。**
- **推送认证失败**：不要尝试输入凭据；向用户说明需要其配置 PAT/凭据管理器。
- **代理也失败**：检查端口监听（`Test-NetConnection 127.0.0.1 -Port 11719`）
  与注册表代理设置，把诊断结果报告给用户，不要静默重试。
- 推送前如涉及方向/适配类改动，提醒用户真机用 `index.html#dbg`
  诊断面板验证。
