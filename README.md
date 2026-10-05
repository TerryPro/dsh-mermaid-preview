# dsh-mermaid-preview

一个 DeepSeek Harness（dsh）插件：把 **Mermaid 文件的渲染 + 编辑** 作为**右侧面板**里的一等能力。
它**不是**一个自带启动入口的独立页面，而是一个**按文件地址驱动的查看/编辑器**——
当你在文件浏览器（或聊天里的文件链接、产物卡片）里点开一个 `.mmd` / `.mermaid` 文件时，
右侧面板就用这个插件打开它：左边编辑源码，右边实时渲染 Mermaid 图，保存写回原文件。

> 定位：对齐 dsh 原生右侧栏的资源路由模型（`ui-sidebar-right` 的 `ctx.sidebarRightTabs` +
> `sidebar.right.pane.tab` 槽位，与内置 `ui-sidebar-documentpreview` 同一套 `dsh-resource://file/…`
> 认领机制）；交互借鉴 VS Code 插件 `vscode-mermaid-preview` 的「源码 / 预览分栏 + 缩放 + 导出」。

---

## 工作方式

1. 在右侧栏的 **Files** 面板里点开一个 `.mmd` / `.mermaid` 文件（或点击聊天里指向它的文件链接）。
2. 右侧栏打开一个以该文件命名的 Mermaid 标签页：左编辑器、右实时预览（防抖 350ms）。
3. 编辑后点 **保存**，写回原文件；**重新载入** 从磁盘再读一次；**Ctrl/Cmd+S** 也可保存。
4. 视图可切 **分栏 / 仅代码 / 仅预览**；分栏可**拖动分隔条**调整比例（记忆）；预览支持缩放；可 **导出 SVG / PNG**；有 7 种图模板可插入。
5. 编辑器带**行号栏**与**轻量语法高亮**（注释/关键字/箭头/字符串，覆盖层与 textarea 同步滚动，Chromium 不换行以保证对齐）。
6. 主题跟随应用明/暗自动切换；Mermaid 库离线打包内置，不依赖 CDN。

没有 guide 页胶囊入口——插件的存在方式就是「点开 Mermaid 文件时接管渲染与编辑」。

---

## 安装（本地 link 方式）

```powershell
cd F:\deepseek_harness_workspace\dsh-mermaid-preview
npm install          # 安装 mermaid + esbuild；prepare 钩子自动 npm run build
npm run build        # （可选）显式重新生成 lib/mermaid-runtime.js

# Web 版
dsh plugin --profile web add "F:\deepseek_harness_workspace\dsh-mermaid-preview"
# 桌面版：把 web 换成 desktop
```

移除：`dsh plugin --profile web remove dsh-mermaid-preview`。安装后重启应用即可。

> `dsh plugin add` 会写 profile 的 `dependencies`、把本包加入 `dsh.profile.bundles`，并应用
> `cordis.patch.yml`（插入 `dsh-mermaid-preview` 行，其 `name` 为裸包名，客户端模块系统据此
> 把 `./client` bundle 作为浏览器半挂上）。

---

## 关键实现

- **文件如何被打开**：Files 面板调用 `tabActions.openResource(fileAddressFor(sessionId, root, path))`，
  得到形如 `dsh-resource://file/session/<id>/<相对路径>` 的地址；右侧栏注册表按 `patterns` + `priority`
  认领。本插件用 `patterns: ['*.mmd','*.mermaid']`，默认落在 `extension` 优先级带，
  **高于**内置文档预览的 `fallback`，于是这些文件路由到本插件（`.md` 等仍由内置预览处理）。
- **地址→路径**：浏览器半把 tab 的 `navigation.address`（即上面的资源地址）原样发给宿主；
  宿主用 `lib/address.js` 解析，并用 `ctx.sessions.get(id).header.cwd` 把 session 相对路径解析成
  绝对路径（与内置 workspace-files 解析方式一致）。客户端从不自己拼文件系统路径。
- **读写边界**：读放开（任意被链接文件都能预览，等同内置预览）；**写限制在会话工作区根内**
  （`isUnderDir` 判定），根之外 / `absolute` 地址打开为只读，保存被拒并给出明确提示。

```
dsh-mermaid-preview/
├── index.js               # 宿主：注册 read/write/state 路由 + Mermaid 运行时静态路由（inject: ['webServer','sessions']）
├── lib/
│   ├── http.js            # JSON 信封 / 错误写出 / loopback 信任围栏
│   ├── address.js         # dsh-resource://file/… 解析 + 解析到绝对路径 + isUnderDir（写限制）
│   ├── files.js           # 绝对路径 readFileAt / writeFileAt + MpError（大小上限、文本嗅探）
│   ├── routes.js          # /api/dsh-mermaid-preview/{state,read,write}
│   └── mermaid-runtime.js # 【构建产物】esbuild 打包的 Mermaid（ESM）
├── client/client.js       # 浏览器半：资源驱动的 Mermaid 查看/编辑 tab（手写 __ModuleLoader__ CJS 工厂）
├── src/mermaid-runtime.js # 运行时打包入口
├── scripts/build.mjs      # esbuild 构建脚本
├── tools/                 # node:test（地址/IO + 端到端 HTTP + 客户端工厂）
└── cordis.patch.yml       # bundle 补丁行
```

---

## 安全模型

- 文件路由都过 **loopback 围栏**：本机回环直接放行，其余来源交给 shell 的 `connection` 围栏（缺失则默认拒绝）。
- 客户端只能引用 shell 交给某个 tab 的资源地址；宿主把它解析成路径后，读放开、**写仅允许落在会话工作区根内**。
- 单文件读写上限 2 MiB；含 NUL 的二进制拒绝读取。

---

## 开发与测试

```powershell
npm run check            # 语法检查全部源文件
npm test                 # node:test：地址解析 / IO / 写限制 / 端到端 HTTP / 客户端契约 / 运行时 bundle / 高亮（25 项）
npm run build            # 重新生成 Mermaid 运行时 bundle
```

> `npm test` 里的一项会加载**已构建**的 `lib/mermaid-runtime.js`，所以测试前需先 `npm run build`
> （`prepare` 钩子在 `npm install` 时已自动构建）。CI 里显式按 `ci → build → check → test` 跑，
> 覆盖 ubuntu/windows × node 20/22（见 `.github/workflows/ci.yml`）。
> 该 bundle 测试只验证「产物可加载、导出正确的 mermaid API」，不验证实际出图——happy-dom
> 下 Mermaid 没有排版引擎（文本测量拿不到尺寸），出图保真属浏览器侧，需在 dsh 实例中确认。

浏览器半为手写模块，改 `client/client.js` 保存后重启应用即可生效；改 `src/mermaid-runtime.js`
依赖版本后需 `npm run build`。

## 已知限制

- 仅接管 `.mmd` / `.mermaid`；`securityLevel: 'strict'`，含 HTML 标签的写法会被转义。
- 工作区根之外（或 `absolute` 地址）的文件为只读预览，不能在此保存。
- 需在 dsh 实例里实际打开文件做可视化确认（宿主侧与纯逻辑已由自动化测试覆盖）。

## 许可

MIT
