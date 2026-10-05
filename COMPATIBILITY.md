# 契约兼容矩阵 (Compatibility)

本插件依赖 DeepSeek Harness（dsh）右侧栏的**内部客户端契约**与宿主服务。这些包在 `0.2.0-rc.x`
阶段仍可能演进，本文列出**每一处依赖点、其权威来源、我们如何使用、以及破坏性变更的应对**，
便于升级 dsh 时逐项核对。

**当前验证版本：dsh `v0.2.0-rc.2`**（源码 `packages/client/ui-sidebar-right`、`packages/api/workspace-files` 等）。

---

## 1. 客户端契约（`client/client.js`）

| # | 依赖点 | 权威来源（rc.2） | 我们的用法 | 若变更的风险/对策 |
|---|---|---|---|---|
| C1 | `ctx.sidebarRightTabs.register(def)` | `packages/client/ui-sidebar-right/src/client/tab-registry.ts` | 注册资源型 tab 类型：`def = { id, kind, patterns, priority?, canOpen, title(address), keepMounted }` | `def` 字段改名/语义变化会导致认领失效。核对 `SidebarRightTabDefinition`。 |
| C2 | `def.priority` 三带排序 `extension>builtin>fallback` | 同上 `RANKS` | 不写 `priority` → 默认 `extension`，赢过内置 `ui-sidebar-documentpreview` 的 `fallback` 文本预览 | 若内置预览改用 `extension`，同址认领会冲突。届时显式设更高优先级或改后缀认领策略。 |
| C3 | `def.guide[].icon` 必须是组件 | `tab-registry.ts` `SidebarRightGuideEntry.icon?: ComponentType<IconProps>`；`GuideBody.tsx` `<Icon size/>` | 本插件**不使用** guide 胶囊（文件驱动），此项对本插件无影响，仅备查 | 若将来加入口，icon 必须是函数组件，不能是 spec 对象（历史踩坑）。 |
| C4 | `ctx.slots.inject('sidebar.right.pane.tab', () => ctx.slots.register({name,key}, Body))` | `ui-sidebar-right/src/client/index.ts`（seat 声明 + `tabInfoFactory` 注入） | 两阶段注册的第二阶段：把 body 挂到 keyed 槽位，key = `id` | 槽位名 `sidebar.right.pane.tab` 改名 → 需同步。 |
| C5 | Body 收到 `props.useTabInfo()` → `{ tab }` | `ui-sidebar-right/src/client/contract/slots.ts` `SidebarRightTabInfo` | 读 `tab.navigation.address`（文件资源地址）、`tab.visible`（暂停后台轮询） | hook 名 `useTabInfo` 或 `tab.navigation.address` 结构变化 → 读不到文件。核对 `SidebarRightTabNavigation`。 |
| C6 | `ctx.locale.register/bind` | `packages/client/locale` | 注册 `dsh-mermaid-preview` 文案命名空间（best-effort，缺则内置兜底） | 弱依赖，已 try/catch 降级。 |
| C7 | `window.__ModuleLoader__.load({id, factory})` | 客户端模块系统（`dsh-client-modules`） | 手写 CJS 工厂注册浏览器半；`require('react')` 由平台 seed 提供 | 加载器契约变化需改封装；与 `dsh-photo` 同构，社区插件通用。 |

## 2. 宿主契约（`index.js` + `lib/`）

| # | 依赖点 | 权威来源（rc.2） | 我们的用法 | 风险/对策 |
|---|---|---|---|---|
| H1 | `ctx.webServer.register({kind:'exact',path,handler(req,res)})` | `packages/host` webserver | 挂 `/api/dsh-mermaid-preview/{state,read,write,stat}` 与运行时静态路由 | `kind`/handler 签名变化需调整。 |
| H2 | `ctx.sessions.get(id)?.header?.cwd` | `packages/api/workspace-files`（`dsh-api-workspace-files` 用同一式样解析 workspaceRoot） | 把 session 相对资源地址解析成绝对路径；缺失则拒绝相对读写 | 若改 `sessions.get` 返回结构或 cwd 位置，解析失效。已 try/catch 返回 undefined（拒绝而非崩溃）。 |
| H3 | `ctx.connection.requestRejection({headers})`（可选） | shell 连接围栏 | 非 loopback 来源的鉴权（loopback 直接放行） | 缺服务时路由默认拒绝，安全侧倾斜。 |

## 3. 资源地址语法

| 依赖点 | 权威来源 | 说明 |
|---|---|---|
| `dsh-resource://file/session/<id>/<path>`、`dsh-resource://file/absolute/<path>` | `packages/util/workspace-path/src/file-address.ts`（`parseFileAddress`/`fileAddressFor`） | 客户端**不 import** 该内部包（link 插件解析不到），改为把地址原样发给宿主，由 `lib/address.js` 复刻同一语法解析。二者需保持语义一致。 |
| Files 面板打开：`tabActions.openResource(fileAddressFor(sessionId, root, path))` | `packages/client/ui-sidebar-files/src/client/FilesBody.tsx` | 我们靠 `patterns:['*.mmd','*.mermaid']` 认领这些地址。 |

## 4. 依赖的第三方库（构建期）

| 库 | 版本（rc.2 验证） | 用途 |
|---|---|---|
| `mermaid` | `11.17.0` | esbuild 打包进 `lib/mermaid-runtime.js`，浏览器运行时动态 `import`。升级 mermaid 后需 `npm run build` 并重测认领/渲染。 |
| `esbuild` | `0.28.2` | 仅构建期。 |
| `happy-dom` | `^20.11.6` | 仅测试期（bundle 可加载性冒烟）。 |

---

## 5. 升级 dsh 时的核对清单

1. 对照 `tab-registry.ts` 的 `SidebarRightTabDefinition` / `SidebarRightGuideEntry`，确认 C1–C5 字段未改名。
2. 对照 `ui-sidebar-right/src/client/index.ts`，确认槽位名与 `tabInfo` hook 注入未变（C4/C5）。
3. 对照 `dsh-api-workspace-files`，确认 `ctx.sessions.get(id).header.cwd` 仍是解析工作区根的方式（H2）。
4. 对照 `file-address.ts`，确认 `lib/address.js` 的解析与 `parseFileAddress` 一致（第 3 节）。
5. 跑 `npm run check && npm run build && npm test`，再在 dsh 实例里点开一个 `.mmd` 做可视化确认。

## 6. 已知的健壮性兜底

- `apply` 内所有服务访问都 `ctx.slots === undefined` 等前置判空：**绝不从 apply 抛异常**（否则整个 shell 启动失败）。
- 地址解析失败 / 工作区根缺失 / 剪贴板不可用 → 一律降级为**面板内提示**，不 reject、不崩。
- 主题、分栏比例、未保存草稿都存 `localStorage`，且读写全包 try/catch（隐私模式/配额满也不炸）。
