# Archify 多层架构图下钻与跨层连线展开：三阶段实施计划

> **项目定位**：在已有 Archify Fork 上增加可发布、可维护的 Hierarchical Diagram Navigation（多层图导航）、Frosted-Glass Drill-down（毛玻璃下钻）与 Hierarchical Edge Expansion（层级连线展开）。
>
> **版本**：方案 v1.0 · 2026-10-12\
> **适用范围**：Architecture 优先，预留对 Workflow / Data Flow / Sequence / Lifecycle 等图类型的导航支持。\
> **前提**：未获得你的 Fork 的具体仓库地址和 commit；下面涉及的源文件位置以所核对的 Archify 上游 main 为参考，实施前须以你 Fork 当前版本再核查。\
> **关键设计变更**：你的最新要求明确指出“全图中一条粗粒度连线，可能由子图中的一条或多条实际连接组成；进入子图后，外部连接也要同步放大/展开”。因此，**关系模型和端口映射必须从第一阶段 PoC 开始验证**，不能将全部跨层关系留到第三阶段才考虑。

---

## 实施记录（2026-10-12，按后续用户决定验收）

本文件保留初始方案作为历史背景；实际产品契约以
[`archify/references/diagram-sets.md`](archify/references/diagram-sets.md) 为准。
后续要求已明确改为**共享相机的无限画布、按比例原地展开、多处同时展开、
祖先节点和边保持清晰**。不恢复毛玻璃、独立前景面板、浮动外部代理或每层独立相机。
下方勾选表示当前范围的实现已交付，不表示原始设计中被取消的行为又被实现。

| 原任务 | 最终处理 |
| --- | --- |
| I-04、II-24 的节点点击 | Canvas 入口单击/Enter 即可展开，native bridge 保留双击；普通节点 Focus 和 standalone 页面不变 |
| I-05、II-19、III-17 的模糊要求 | 用户取消；保持清晰，质量检查改为遮挡、标签重叠、路由预算和对比度 |
| I-07/I-08、III-11 的前景外部代理 | 同一 world 内的真实外部节点和边界端口替代；屏外节点可拖动画布查看 |
| II-15/II-18 的分层相机 | 完整入口 forest + focused path + 单一 camera；收起恢复入口展开前相机 |
| II-23 的 blur 降级 | 无 blur 依赖；视口裁剪、命中目标虚拟化、watch 暂停和有提示的绘制预算 |
| II-26 的毛玻璃组合导出 | 清晰祖先 + 子图 + Bridge 的当前画布 PNG；可编辑组合 SVG 仍不支持 |
| §8.5 原地撑开/重排 | 已实现节点矩形内的比例展开；自动撑开父图布局仍是明确非目标 |

实现证据：

- `archify/test/diagram-set.test.mjs`：模型、CLI、原子发布、增量缓存、
  10-fact 多对多、五类型显式映射及资源池字节恢复/体积预算。
- `archify/test/diagram-set-completion.test.mjs`：来源 current/stale/unverified、
  Git/root/origin/路径校验、定向多跳链路、路由质量和三类 authoring recipe。
- `archify/test/diagram-set-browser.test.mjs`：真实离线浏览器、展开/收起、
  历史/刷新/分享、准确端点、链路高亮、虚拟化恢复、键盘和导出。
- `archify/examples/diagram-set/repository/`：真实代码三层、13 条事实、3 条链路；
  条件分支 1→3 和类型选择 1→5 不是同时执行的五次调用。
- [`生成提示`](archify/references/diagram-set-recipes.md)、
  [`当前连续浏览器录屏`](docs/assets/archify-canvas.gif) 和
  [`PoC/验收记录`](docs/drilldown-poc-decisions.md)。

基准为 `58ab0b98d2d0def8e49dced705c7b566936723ec`；前一实现提交为
`ae58b77f51f8091fbcaad72f6a6370a889202ac0`。旧计划实施期间的全量运行与编辑重叠，
不能冒充干净上游全绿基线；单图兼容以冻结 golden 输入和最终相关检查为依据。
本次不发布 Release、不自动 commit/push、不安装或更新 live Skill。
浏览器/平台与全量验证缺口必须在验收记录中单列，不能将 skip 写成通过。

## 0. 一页执行摘要

### 0.1 我们最终要实现什么

用户打开一个独立 HTML，看到系统级别的粗粒度架构图；某些节点带有下钻标识。双击某个节点：

1. 原图**仍留在原位置**，缩放/平移状态不丢失，变成毛玻璃模糊、轻度压暗的背景。
2. 被打开节点对应的**详细子图在清晰的前景层展开**，可缩放、搜索、追踪关系；可从其中继续下钻。
3. 原图里连接该节点的粗粒度边，根据可核实的映射，展开成**从外部节点/系统边界到子图具体内部组件的多条清晰连线**。
4. 外部端点可能仍属于背景图，但应以**清晰的上下文锚点（Context Anchor / External Port）**显示在前景/边缘；避免“连线指向一团模糊背景”。
5. 返回上一层时，子图收起，父图恢复清晰；父图的画布状态、选中节点和追踪上下文恢复。浏览器前进/后退、面包屑可以导航层级。
6. 所有架构图、对应关系和交互脚本可编译为**单个离线 HTML**；原有单图功能必须保持兼容。

### 0.2 示例：粗粒度边如何展开

```text
父图（系统层）：

  [Web Frontend] ===== HTTP / Events (3) =====> [Backend] ----> [Database]
                                                ⇅ 双击进入 Backend

背景层（父图，模糊）：

  [Web Frontend] ····························· [Backend] ··· [Database]

前景层（Backend 子图，清晰）：

  外部：Web Frontend                   Backend — Detail
       │                                  ┌────────────────────────┐
       ├── HTTPS /login ────────────────> │ API Gateway ─> Auth     │
       ├── HTTPS /orders ───────────────> │ Orders API ─> Worker    │
       └── Event /upload ───────────────> │ Upload Handler          │
                                          └────────────────────────┘

原来一条父级边 -> 有依据地展开为三条具体边。
每条具体边可以反查来源；没有依据时显示“未映射”，不伪造。
```

**核心取舍**：首先做“不同图之间的分层前景/背景导航 + 基于关系事实的边展开”，而不是试图在同一张父 SVG 里直接展开所有子节点并重排整个大图。

### 0.3 三阶段交付与修订后的估算

| 阶段 | 目标 | 关系能力 | 工作量（1 名熟悉 JS/TS、SVG、该项目的工程师） |
|---|---|---|---|
| **I. 交互 PoC** | 毛玻璃下钻、清晰前景、返回、可视化跨层连线 | **手工映射**一条父边 → 多条子边；验证坐标和视觉 | **约 3–7 人天** |
| **II. 正式 Diagram Set** | Schema/Manifest、校验、CLI 打包、导航、导出、Agent 生成、多图兼容 | 稳定 ID、映射声明、端口、跨图关系索引与明确的诊断 | **额外约 10–20 人天** |
| **III. 完整多层架构语义** | 关系投影/聚合、复杂跨层链路、双向追踪、局部展开、增量一致性 | **可推导**细粒度边↔父级聚合边，跨多层保真与冲突检测 | **额外约 20–40 人天** |

> 估算是工程规划范围，并非实测。若目标包括任意图类型之间的自动语义等价、完全自动布局、复杂路径避障、交互式编辑器，第三阶段可能明显增加。建议每阶段设 Gate，先用实际图验证，再调整后续排期。

---

## 1. 需求与产品边界

### 1.1 必须具备（Must Have）

- [x] 一个 Diagram Set 可以包含多个 Diagram，每张图仍可单独渲染。
- [x] root 图可为 Architecture，也允许是其他 Archify 类型；节点/语义元素是否可下钻由适配器声明。
- [x] 允许 **0、1、多个层级**，同一子图可以包含进一步的可下钻节点。
- [x] 原生桥接双击下钻；Canvas 入口支持单击/Enter/触屏展开，普通节点与 standalone Focus 不变（后续 UX 替代）。
- [x] 活跃子图和祖先图均清晰且同属一个可拖动画布（用户取消毛玻璃）。
- [x] 可以关闭当前层、退回任意祖先层、一键回 root。
- [x] 下钻展示来自父级外部的连接；**一条父边对应 1..N 条底层关系**，支持方向、协议/类型/标签区分。
- [x] 若子图无足够底层关系，不可自动制造连接；提供显式 `unresolved` 提示。
- [x] 保留单一 camera、native Focus、打开 forest 与关系/链路选择；不再维护独立分层相机。
- [x] 可在无服务环境下打开最终产物；不能因文件多而退化成必须访问服务器。
- [x] 单图 golden 渲染保持一致；针对原生交互/导出的兼容验证独立记录，不等同于 Windows 全套测试全绿。

### 1.2 预期用户操作

| 操作 | 预期行为 |
|---|---|
| 单击有子图节点 | 按原 Viewer 逻辑选择/聚焦；额外展示“可查看详情”提示 |
| 双击有子图节点 | 下钻；父图进入毛玻璃背景；子图显示为清晰前景 |
| 点击父图的入边/出边（或关系徽标） | 展示此聚合边对应的具体关系列表与数量 |
| 下钻后点击一条跨层关系 | 高亮“外部端点 ↔ 子图内部具体端点”，必要时滚动/调整子图画布使两端可见 |
| 连续下钻 | 新子图清晰；上一张变模糊并继续作为下一层的上下文；更早祖先层淡化但不丢失 |
| 面包屑点击祖先 | 恢复祖先图清晰并移除其后的层 |
| Esc / 关闭按钮 | 默认退出当前层；不会意外修改数据 |
| 浏览器前进/后退 | 与层级导航栈同步（同一 HTML hash 或 history state） |
| 搜索 | 默认搜索当前图；扩展支持全 Diagram Set 范围搜索 |
| 导出 | 明确区分“当前图导出”和“当前组合视图导出”；不应导出错误的一层 |

### 1.3 不应误判为已具备

- **Boundary / wraps ≠ 子图**：现有架构图中的 Boundary 只是图内分组/边界，不能自动变成可独立导航的详细图。
- **Guided Views ≠ 子图**：焦点集合与独立数据/布局的子图是不同概念。
- **Hierarchy Tree ≠ Architecture Drill-down**：PR #888 的树形父子关系可以参考，但不足以表达一个服务对多个服务的真实跨层依赖。
- **视觉连线 ≠ 语义证据**：不能因为父图上有 A → B，就猜测子图内部一定是 A → Gateway。

---

## 2. 交互与视觉设计

### 2.1 布局：上下文保留的分层画布（Context-preserving Layered Viewer）

建议每一层都是一个独立 Scene / Viewer 实例，外围是统一的 Layer Host：

```text
┌────────────────────────────────────────────────────────────────────────┐
│ 面包屑：System / Backend / Auth    [返回] [全局] [关系] [导出]          │
├────────────────────────────────────────────────────────────────────────┤
│ Layer 0: System 图（模糊、降低饱和、仍然可辨识）                        │
│                                                                        │
│    [Frontend]  ──────────────────→ [Backend]         [DB]            │
│           ╲             清晰的边展开叠加层（Bridge Overlay）            │
│            ╲                                                           │
│      ┌──────╲──────────────────────────────────────────────────┐       │
│      │ Layer 1: Backend Detail（清晰、可交互）                  │       │
│      │  External: Frontend                                     │       │
│      │    ├──────────> Gateway ────────────────> Auth          │       │
│      │    └──────────> Orders API ────────────> Queue         │       │
│      │                                                        │       │
│      └────────────────────────────────────────────────────────┘       │
│                                                                        │
└────────────────────────────────────────────────────────────────────────┘
```

**视觉实现建议**：

- 背景 layer 用 `filter: blur(5px)` + `opacity` / `saturate`，或对背景上方增加 `backdrop-filter: blur(...)` 遮罩；不对前景和 Bridge Overlay 应用模糊。
- **跨层连线始终在模糊遮罩之上画**，保证连线清晰。
- 前景细节可以是略缩进的“浮层画布”（建议 88–94% 可用宽高，响应式）；保留一定背景边缘让用户直观看到层级上下文。
- 多层下钻时，各祖先层的模糊/不透明度逐步衰减；必要时只渲染最近一层可见背景，其余状态缓存而不同时渲染，避免过多 iframe/滤镜。
- 模糊是**上下文表现方式**，不是图数据的一部分；用户关闭子图后不应该永久污染父图样式。
- 支持 `prefers-reduced-motion`、键盘焦点、足够的对比度；移动端可降低 blur 强度以避免模糊文本与性能问题。

### 2.2 连接如何“对应放大”：两种视图

**A. Context Bridge（第一阶段起实现）**

- 从外部节点绘制到**子图内部真实目标**的清晰边。
- 背景外部节点本身因 blur 不易辨认，因此在前景图边缘呈现**外部节点代理/标签锚点**（例如 `Frontend`、`Payment Provider`），同时高亮或标注背景的来源。
- 多条边可按 `protocol/kind` 分组并给出 `×N`。点击一个组，展开为具体边。
- 子图与外部系统边的方向正确、语义标签正确。

**B. Semantic Projection（第三阶段完善）**

- 父图 A→B 不是任意作者标注，而是 `underlyingRelations` 中关系在当前抽象层上的**投影/聚合**。
- 同一条底层关系可以同时贡献到父图的抽象边及子图的具体边，但不会双重计数。
- 双击 B 后，上层聚合边可动画“分叉”到 `B/API`、`B/Auth`、`B/Worker` 等；返回时恢复为聚合边。
- 允许按协议/方向/调用链过滤并跨层追踪，保持语义一致。

### 2.3 动画规范（推荐的 MVP 数值，均可配置）

- 下钻入场：180–280 ms，透明度和轻微缩放；不要把整张 SVG 强制重算多次。
- 父图背景模糊：150–220 ms；离场恢复同等时长。
- 边展开：先出现外部代理/端口，随后淡入具体边；不要一瞬间出现密集线路。
- 多于 10 条跨层边时默认聚合为“边束”，交互后局部展开；可设置阈值。
- 减少动画模式：时长为 0，保留所有可访问的状态变化。
- 视觉性能：以中型示例（约 50–150 节点、100–300 边，最多 3 层）验证，不把 fps 作为未经环境测量的承诺。

---

## 3. 技术架构与核心决策

### 3.1 不建议直接替换 SVG DOM

Archify 的渲染链路是 Typed JSON IR → 验证/渲染 → HTML/SVG Viewer。Viewer 功能在生成的 HTML 中初始化并捕获具体 SVG 及状态。直接执行 `container.innerHTML = nextSVG`，通常会遇到初始化监听、Focus、相机状态、导出逻辑、DOM ID 冲突问题。

**建议设计**：

```text
[JSON diagrams] -----> [Archify native Renderers] ---> 独立 Diagram HTML/SVG
         |                              |
         v                              v
[Diagram Set Manifest] ---> [Bundle Compiler] ---> [Single HTML]
         |                              |
         v                              v
[Relations / Port Maps] ---> [Layer Host / Navigator / Bridge Overlay]
                                          |
                             [Active Viewer + Backdrop Viewers]
```

### 3.2 分层模块职责

| 模块（拟新增） | 职责 | 阶段 |
|---|---|---|
| `diagram-set/model` | Manifest 解析、图 ID、节点引用、层级声明 | I 设计 / II 正式 |
| `diagram-set/relations` | 关系 ID、端点映射、关系投影、索引 | I 示例 / II 校验 / III 推导 |
| `diagram-set/compiler` | 调用现有 renderer，嵌入多图、去重静态资源 | II |
| `viewer/diagram-host` | 管理 iframe/Scene 实例、缓存及清理 | I 起 |
| `viewer/drilldown-navigator` | 导航栈、面包屑、History、恢复状态 | I → II |
| `viewer/bridge-overlay` | 跨层清晰连线、外部端点代理、状态同步 | I 起 |
| `viewer/diagram-bridge` | 将节点点击、相机、坐标、选择状态安全传给 Host | I → II |
| `diagram-set/validator` | 关系/层级/路径/端口约束校验 | II → III |
| `diagram-set/adapters` | 不同图类型的可钻节点及关系语义适配 | II 基础 / III 扩展 |

### 3.3 运行时隔离策略：PoC 用 iframe，产品版保留更换余地

**第一、二阶段建议 `iframe` 包装原生 Archify HTML**：

- 优点：原来 JS/CSS/DOM 的状态彼此隔离；改动较少；各子图可按需加载。
- 缺点：页面大小/内存增加；Host 不能直接依赖子 iframe 内的屏幕坐标；需要约定 `postMessage` 协议；跨层连线与导出需额外实现。
- 正确做法：明确 `INIT`, `OPEN_CHILD`, `VIEW_STATE`, `GEOMETRY_CHANGED`, `FOCUS_RELATION`, `RESTORE_STATE` 消息；由 Host 做跨层协调。
- 消息安全：校验 `event.source`、受信任的图 ID 与会话 token；对 `file://` 下 `origin: null` 的场景不能盲信来源；对消息做白名单、大小与类型校验。禁止从 Manifest 无验证地拼接 HTML/JS。

**第三阶段评估**将 Viewer 重构为可多实例 mount/unmount 的 Scene Runtime；仅当性能/导出问题足以证明 iframe 不适用时才投入此改造。不要在第一阶段同时启动 Viewer 大重构。

### 3.4 坐标与连线层

对跨层边使用**独立 SVG Overlay**：

1. 子 Viewer 报告节点锚点在其画布中的矩形/路径端点。
2. 通过 `getScreenCTM()` / `DOMRect` 或 Viewer Camera 转换，换算为**相对 Host 的 CSS 像素坐标**。
3. 外部端点如位于背景 iframe，先转换背景锚点；必要时改用前景画布边缘代理端点。
4. Overlay 生成连接路径，并用正交/曲线/边束方式避让前景主体；箭头方向由关系事实决定。
5. 缩放、平移、窗口 resize、层尺寸变更后重新计算路径（`requestAnimationFrame` 合帧）；不在每个 mousemove 同步查询多个 iframe 的所有节点。
6. `pointer-events: none` 用于纯展示路径；需要点击的边添加独立的透明 hit target，避免拦截父图/子图正常交互。

**要点**：背景 blur 不应该连同 Overlay 一起 blur。坐标从两张独立图转换到同一个 Host 坐标系，是第一阶段最大风险点之一。

---

## 4. 数据模型：同时描述层级结构和真实连接

### 4.1 原则：不在第一版直接推翻 Archify Schema

现有 `architecture.schema.json` 的 `components`、`connections` 采用较严格的属性限制，并允许给连接定义稳定 `id`。建议：

- **每张 Diagram 继续保持原有合法 Archify JSON**，让上游 renderer 与旧文档不受影响。
- 新增独立 `diagram-set.json`（Manifest），只负责图集合、下钻入口、跨图事实、映射、显示策略。
- **所有被引用的连接和节点尽量使用稳定 ID**；如果某张图的作者没有给关系 ID，正式产品应提供可重复生成的迁移建议，不能把数组下标作为长期身份。
- Manifest 存储“图之间的关系”；不要复制每张图的完整数据导致维护两份真相。

### 4.2 建议的 Diagram Set Manifest（示意约定，不是现有 Archify Schema）

```json
{
  "schema_version": 1,
  "kind": "archify-diagram-set",
  "id": "payment-system",
  "root_diagram": "system",
  "diagrams": [
    {
      "id": "system",
      "type": "architecture",
      "source": "diagrams/system.json"
    },
    {
      "id": "backend-detail",
      "type": "architecture",
      "source": "diagrams/backend.json"
    },
    {
      "id": "frontend-detail",
      "type": "architecture",
      "source": "diagrams/frontend.json"
    }
  ],
  "drilldowns": [
    {
      "from": { "diagram": "system", "node": "backend" },
      "to_diagram": "backend-detail"
    },
    {
      "from": { "diagram": "system", "node": "frontend" },
      "to_diagram": "frontend-detail"
    }
  ],
  "relations": [
    {
      "id": "rel-login",
      "from": { "diagram": "frontend-detail", "node": "auth_client" },
      "to": { "diagram": "backend-detail", "node": "api_gateway" },
      "kind": "http",
      "label": "POST /login",
      "evidence": { "mode": "authored" }
    },
    {
      "id": "rel-orders",
      "from": { "diagram": "frontend-detail", "node": "order_ui" },
      "to": { "diagram": "backend-detail", "node": "orders_api" },
      "kind": "http",
      "label": "GET /orders",
      "evidence": { "mode": "authored" }
    },
    {
      "id": "rel-events",
      "from": { "diagram": "frontend-detail", "node": "upload_client" },
      "to": { "diagram": "backend-detail", "node": "upload_handler" },
      "kind": "event",
      "label": "upload event",
      "evidence": { "mode": "authored" }
    }
  ],
  "projections": [
    {
      "diagram": "system",
      "relation_id": "frontend_to_backend",
      "derived_from": ["rel-login", "rel-orders", "rel-events"],
      "status": "declared"
    }
  ],
  "viewer": {
    "transition": "frosted-glass",
    "blur_px": 6,
    "external_connections": "ports-and-links",
    "initial_relation_mode": "bundled"
  }
}
```

解释：

- 系统层 `system` 原本有节点 `frontend`, `backend` 和稳定关系 `frontend_to_backend`；详情层各有独立节点。
- 从 `frontend-detail` 的三个内部节点分别连到 `backend-detail` 的三个内部节点：**三条关系是真实或明确声明的底层事实**。
- `projections[].derived_from` 声明父级粗粒度边由这三条关系汇总而来；在第三阶段可由关系索引自动推导，并验证一致。
- 当只展开 `backend`、尚未展开 `frontend` 时，渲染器通过 `frontend-detail` 的上级 `frontend` 找到当前可见外部代表，形成三个清晰的 Context Bridges。
- `evidence.mode: "authored"` 只表示作者声明，不等于已被源码/运行记录证实；如需要来源证明，可扩展 `verified-source`、source references 或采集证据。

### 4.3 稳定身份与实体层级

每个实体（具体节点）要有可追踪的层级引用：

- `NodeRef = { diagram, node }`；全局唯一身份是 `<diagramId>:<nodeId>`，不要只用 `node`。
- `drilldowns` 定义父级节点和整张子图的从属关系。
- 一个 parent 节点可以对应**多个内部节点**；父级节点不等于某一个内部 endpoint。
- 支持 parent 节点被其他图复用的需求需单独建模；MVP 默认每张详情图有唯一父入口，避免路径歧义。
- 后续若支持共享详情图（DAG，而非树），导航栈必须记录**进入路径**而不只是当前 diagram id。
- 链路引用与数据映射不得只依赖节点 label 或屏幕坐标。

### 4.4 端口/边界映射（第二阶段正式引入）

当细粒度边跨出当前子图，需要明确它从哪里穿过组件边界，或映射到哪些具体接入组件：

```json
{
  "diagram": "backend-detail",
  "owner": { "diagram": "system", "node": "backend" },
  "ports": [
    {
      "id": "incoming-http",
      "direction": "in",
      "kind": "http",
      "targets": ["api_gateway", "orders_api"],
      "side": "left"
    },
    {
      "id": "outgoing-events",
      "direction": "out",
      "kind": "event",
      "targets": ["event_publisher"],
      "side": "right"
    }
  ]
}
```

该结构可放在 Manifest 的 `interfaces` 字段或独立文件。**端口是边界显示和验证手段，跨图 `relations` 才是具体连线事实**；不能仅凭一个 `targets` 自动猜测外部源和目标。

### 4.5 关系证据与完整性等级

建议为每条父级聚合关系提供以下状态：

| 状态 | 含义 | Viewer 显示 |
|---|---|---|
| `resolved` | 已找到全部明确声明的底层 `relationId`，端点均可解析 | 正常展开，显示 `N links` |
| `partial` | 仅有部分底层边映射；其他已知存在但未建模 | 展开可确认部分，标明 `+ unresolved` |
| `unresolved` | 仅有父图粗粒度关系，缺少子图细节 | 不臆造内部边；保持到外部端口的边并显示待完善 |
| `conflict` | 父边方向/类型/来源与底层事实不一致 | 校验失败或醒目警告，不能静默纠正 |

当父级边 A→B 而下层发现反向 B→A 时，默认属于**冲突**，不能用“无向聚合”掩盖。父级同时表示请求和返回可用不同 `kind` 或明确双向事实。

---

## 5. 层级边投影（Hierarchical Edge Projection）的算法约束

> **设计原则**：底层关系是事实，当前画面上的线只是它在当前可见层级中的投影。越粗粒度的连接越可能是多条关系的聚合。

### 5.1 当前可见节点代表（Visible Representative）

给定活动层级栈，例如 `system → backend-detail`：

- 如果某条底层关系终点属于当前展开的 Backend 子图，则用具体节点（例如 `backend-detail:orders_api`）。
- 如果起点属于未展开的 Frontend 子图，则沿 `drilldowns` 找到可见祖先节点 `system:frontend`，或映射为活动子图边界的清晰 `ExternalAnchor:frontend`。
- 两端都不在当前上下文且无法唯一归属时，不渲染伪连接；应显示为外部依赖列表，或要求作者补齐映射。
- 如同时有多个可见祖先，优先当前导航路径的最近可见节点；同一详情图多入口时须把路径作为索引输入。

### 5.2 生成画面中展示的边（简化伪代码）

```ts
function projectRelations(diagramSet, navPath, filters) {
  const visibleNodes = resolveVisibleNodes(diagramSet, navPath);
  const projected = [];

  for (const relation of diagramSet.relations) {
    if (!matchesFilters(relation, filters)) continue;

    const source = resolveVisibleRepresentative(relation.from, visibleNodes, navPath);
    const target = resolveVisibleRepresentative(relation.to, visibleNodes, navPath);
    if (!source || !target) continue;
    if (source.key === target.key) continue; // 内部边在此抽象层被折叠

    projected.push({
      source, target,
      kind: relation.kind,
      direction: 'directed',
      sourceRelationIds: [relation.id]
    });
  }

  return bundleByEndpointsAndKind(projected);
}
```

正式实现还应处理**图内边、跨图边、显式端口、不同图类型的方向语义、重复事实、黑名单/过滤和关系来源版本**。

### 5.3 聚合规则

- 只在**同一有向端点对、兼容的 `kind/protocol` 与同一语义范围**内聚合；不同方向不能合并成一条无向边。
- 聚合后的边保存有序/去重后的 `sourceRelationIds`；`count` 应为独立底层关系数，不是可见折线条数。
- **同一底层 relation 只能计一次**；跨越多级父图时可以投影到多个层级，但每层统计应独立计算。
- 区分 `request`, `response`, `data-flow`, `control`, `event` 等不同关系语义；不允许把 Sequence 的消息时序直接当作与 Architecture 调用关系等价。
- 人工作者可以声明父图有其他语义的“概念关系”，此时应把 `projectionPolicy` 设为 `manual`，不能要求所有概念边都能还原为一组底层网络调用。

### 5.4 核心不变量（必须自动测试）

1. **身份不变量**：每条关系的 `id` 在所属关系命名空间内唯一且稳定。
2. **投影不变量**：`project(relation, level)` 所用端点一定是关系原端点或其合法的当前可见祖先/代理。
3. **来源不变量**：每条投影边都能追溯到实际关系 ID；`unresolved` 例外必须显式标记。
4. **方向不变量**：父图投影不反转底层关系方向。
5. **守恒不变量**：同一画面里的聚合展开不凭空新增/重复计算底层关系。
6. **还原不变量**：展开再返回，父级聚合边、相机、选择状态恢复一致。
7. **单图兼容不变量**：没有 Manifest 的原始 Archify HTML 行为不变。

---

## 6. 阶段 I：视觉与关系展开 PoC（3–7 人天）

### 6.1 目标 / Scope

验证以下三件最难、最容易反复返工的事：

1. 原生 Archify HTML 能否在父/子 Viewer 中同时存在，**父图毛玻璃、子图清晰**，不破坏原生查看体验。
2. 双击父节点后能进入子图，子图清晰前景完整交互，退出能恢复父图相机状态。
3. **父级一条关系可显示为多条细粒度连接**，外部节点代理、跨 iframe 坐标和透明/模糊图层正确。

### 6.2 示例 Fixture（先定义，再动代码）

准备最少两张、最好三张真实 Archify 图：

- `system.json`：Frontend、Backend、Database；Frontend→Backend 至少一条粗粒度关系。
- `backend.json`：Gateway、Auth、Orders、Upload、Queue；多条从外部进入 Backend 的关系。
- 可选 `auth.json`：Gateway 下钻到 Auth，验证第三层时叠层和返回。

手工准备 PoC Map：

```json
{
  "drilldown": { "system:backend": "backend" },
  "edge_expansions": {
    "system:frontend_to_backend": [
      { "from": "system:frontend", "to": "backend:gateway", "label": "POST /login" },
      { "from": "system:frontend", "to": "backend:orders", "label": "GET /orders" }
    ]
  }
}
```

这是**仅供 PoC 使用的显式映射**；阶段 II 会迁移到正式 Manifest + `relations`，阶段 III 才自动投影，避免 PoC 被复杂 Schema 设计拖住。

### 6.3 任务清单（I-01 至 I-12）

- [x] **I-01 基线锁定**：记录 Fork 对应上游 commit；跑现有 validator、renderer、viewer 检查与 smoke 测试；保存对比截图。
- [x] **I-02 场景选型**：从真实业务整理至少 1→3、1→N 的边展开用例；明确内部端点和外部端点均来自数据，而非视觉猜测。
- [x] **I-03 外层 Host**：用独立测试 HTML 容器承载两个生成的原生 Archify HTML（优先 iframe/srcdoc）；完成打开、关闭、切换。
- [x] **I-04 Drill 事件桥**：监听双击父节点；原有单击行为不变；建立 `OPEN_CHILD` 消息与基本 `selectedNode` 状态。
- [x] **I-05 Frosted Glass（被替代）**：用户取消 blur/dim/saturation；祖先与子图保持清晰、完全不透明。
- [x] **I-06 三级试验**：验证 `root → backend → auth` 的入栈/出栈；缓存父图相机状态（少量样例即可）。
- [x] **I-07 外部锚点（被替代）**：使用同一 world 中真实 Frontend 节点和显式边界端口；不制造浮动代理。
- [x] **I-08 Bridge Overlay**：从真实外部节点连接具体内部节点；保留方向、来源 ID，使用避障路由与关系列表。
- [x] **I-09 相机同步**：改变前景缩放/平移、窗口尺寸后，跨层边端点不会停留在旧坐标。
- [x] **I-10 交互冲突**：双击不误触触发两次 Focus、不会让原 Viewer 的滚轮缩放/拖拽失效；Esc 返回行为清晰。
- [x] **I-11 导出冒烟测试**：现有单张子图导出仍有效；组合叠层导出若尚未实现，显式禁用而非错误导出。
- [x] **I-12 Demo + 复盘**：录制演示、记录浏览器/硬件、性能和 iframe 硬伤；决定第二阶段是否坚持 iframe。

### 6.4 允许的技术债

- 关系映射可以手工写在固定 JSON 中；**不允许假设未声明的关系**。
- 只需要 Architecture → Architecture 下钻；不强求其他图类型通用化。
- 可只在 Chrome/Edge 最新稳定版正式验证，但明确记录 Safari/Firefox 风险。
- 先做返回按钮 + 简单面包屑，复杂的持久 URL 留给阶段 II。
- 只渲染已经打开的 2–3 层，内存管理暂时使用直接销毁 iframe。

### 6.5 阶段验收 Gate I

- [x] 点击/双击 Backend：父图保留且清晰，Backend 原地展开；**不存在整页跳转/闪白**。
- [x] 父图 `Frontend → Backend` 被确实展示为 `Frontend → Gateway`、`Frontend → Orders` 两条具体关系，方向/标签无误。
- [x] 跨层连接在 3 次缩放、3 次拖动、窗口 resize 后，端点仍能正确对齐（可用截图/人工验证）。
- [x] 连续两层下钻后可逐级回到 root，父图相机状态恢复；原 Viewer 单图基本功能不退化。
- [x] 交付 packaged `canvas.html`（替代旧 `poc.html`）、Fixture JSON、自动 smoke、当前录屏与 PoC 决策文档；继续 iframe，明确内存/浏览器边界。

---

## 7. 阶段 II：正式支持 Diagram Set + 可发布 HTML（额外 10–20 人天）

### 7.1 目标 / Scope

把 PoC 变成**真正可以交付给别人、可以自动生成与校验的产品特性**：多张独立 Archify IR → Schema/Manifest → 可重复编译的单文件 HTML → 可多级下钻与跨层连线展示。

### 7.2 数据与校验（II-01 至 II-08）

- [x] **II-01 Manifest Schema**：新增 `diagram-set.schema.json`（或同名专用 schema），定义 `diagrams`、`root_diagram`、`drilldowns`、`relations`、`projections`、`viewer`、`interfaces`。
- [x] **II-02 严格路径约束**：限制 source 为项目内相对路径，拒绝 `../` 逃逸、绝对路径、URL/远程代码、空路径；可按上游安全约束引入大小与文件数上限。
- [x] **II-03 稳定 ID**：校验 diagram ID、nodeRef、relation ID；禁止冲突；为错误提供 `code + path + hint`，让 Agent 可修复。
- [x] **II-04 可达性校验**：检查 root 存在，子图可达；缺失/孤儿图给予清晰诊断。
- [x] **II-05 环/共享图策略**：MVP **禁用 drilldown 环**，避免无限递归；共享子图是可选扩展，默认要求每张子图唯一父节点。
- [x] **II-06 端点存在性**：每个关系端点必须存在于其图对应的有效节点集合；与图类型适配器联动。
- [x] **II-07 映射完整性**：父级 `projection` 指向存在的已声明关系；重复来源、反向映射、父子归属矛盾给出明确诊断。
- [x] **II-08 未解析状态**：规范 `resolved/partial/unresolved/conflict` 的产生条件，Validator 不应把未知细节伪装成已验证事实。

### 7.3 生成器/CLI/打包（II-09 至 II-14）

- [x] **II-09 新增命令**：拟议 `archify validate-set set.json --json`、`archify bundle set.json output.html --json`。命令名称以 Fork CLI 风格为准。
- [x] **II-10 原渲染器复用**：每张子图复用现有 renderer；禁止为多图特性复制整个 Architecture Renderer。
- [x] **II-11 单 HTML 封装**：将所有必需的子图资产、渲染结果、关系索引打包到单文件；避免依赖本地目录层次或 CDN；重复 JS/CSS 后续可做去重。
- [x] **II-12 懒初始化**：只初始化当前层和必要的邻近层，缓解层数较多时的内存压力；保留可恢复 state。
- [x] **II-13 可重复输出**：稳定排序、明确 ID、确定性编译；相同输入和版本得到可比较结果（对非确定性时间/随机字段作规范化）。
- [x] **II-14 失败原子性**：Manifest 或子图任何一步验证不通过，不应覆盖上一个可用 HTML（沿用 Archify last-good 的原则）。

### 7.4 Viewer / 毛玻璃 / 导航（II-15 至 II-24）

- [x] **II-15 正式导航状态**：完整入口 forest、focused path、共享 camera；保留 native selection/relationFocus 和入口收起前 camera。
- [x] **II-16 面包屑/关闭/回全图**：包含键盘可访问性和 touch 替代入口。
- [x] **II-17 URL 深链接**：支持刷新后直接定位到多级子图；URI 中必须编码完整路径，不能只保存最后一个 diagramId。
- [x] **II-18 画布恢复**：收起恢复共享相机，native Focus 可恢复；不存在每层互相独立的缩放视角。
- [x] **II-19 背景可见性控制**：保留所有已打开祖先和兄弟图，保持清晰；隐藏被替代入口与 incident native edges，避免重复连线。
- [x] **II-20 关系索引**：在 Host 侧为任意 NodeRef、RelationId 构建入边/出边查找结构；不依赖 SVG label 文本。
- [x] **II-21 边束/展开**：多条外连边默认聚合 `×N`，点击可展开/收起到真实关系；支持选择指定类型。
- [x] **II-22 Bridge 路由**：窗口、缩放、平移后重算，优先提供稳定可理解的布局；遮挡严重时提供边缘端口和关系列表的替代视图。
- [x] **II-23 性能与降级**：视口裁剪、256-group 预算、优先 trace、屏外命中目标虚拟化与 watch 暂停；完整列表和预算警告，不依赖 blur。
- [x] **II-24 Viewer 事件隔离**：单击 Focus、双击下钻、节点搜索、Esc 关闭、多层键盘焦点不冲突。

### 7.5 导出（II-25 至 II-28）

- [x] **II-25 导出当前 Diagram**：默认获得**当前子图干净完整的图**，而非父图的模糊截图。
- [x] **II-26 导出组合视图**：Host API 导出“清晰祖先 + 子图 + Bridge”当前画布 PNG；不恢复无关工具栏，可编辑组合 SVG 明确不支持。
- [x] **II-27 分享状态**：HTML + hash 可以复制包含导航路径的链接；本地 `file://` 中分享给别人时应说明 HTML 文件本体也须可访问。
- [x] **II-28 兼容性**：原单图的 PNG/SVG/其他导出行为不变；新增多图模式不影响上游单图 export 清理逻辑。

### 7.6 Agent 生成规则（II-29 至 II-34）

- [x] **II-29 更新 `archify/SKILL.md`**：根据请求判断是否需要 Diagram Set；先确定粗细粒度与可下钻节点。
- [x] **II-30 两阶段生成法**：先生成“系统实体与关系清单 + 细节图划分 + 关系 ID”，后分别生成各个 Diagram 的位置与外观。
- [x] **II-31 关系来源约束**：Agent 在生成细节图时，跨层连线必须来自输入事实/代码证据/用户明示假设；否则标注待映射。
- [x] **II-32 生成顺序**：默认底层事实优先，父级聚合从真实底层事实归纳；当用户只提供粗粒度信息，保留 `unresolved`，不要臆造 N 条关系。
- [x] **II-33 校验修复循环**：Agent 调用 `validate-set`，按稳定 rule code 修正，直到所有不可发布错误消除；不通过不 deliver。
- [x] **II-34 示例和提示词**：提供代码仓库生成三层架构、从单图增量添加子图、为一条父边补全 N 个详细关系等示例。

### 7.7 阶段验收 Gate II

- [x] CLI 以 1 份 Manifest + 3 张原生 Archify 图生成可离线打开的**单 HTML**。
- [x] 在系统层的一条聚合边可按 Manifest 显示为 3 条明确对应的子图连线；不一致会报错或标记。
- [x] 三层连续下钻、返回、浏览器后退/前进、刷新后恢复页面正确。
- [x] 所有子图在共享 canvas 内均可缩放、查询、Focus；祖先清晰、统一命中目标，不存在前景/模糊层焦点争抢。
- [x] 修改任意一个 diagram 重新 bundle，不必手动更新其他层 SVG；关系映射失效可被 Validator 检出。
- [x] **广泛本地回归完成**：隔离 Linux 的 `npm test` 完整运行 2638 项，2619 通过、0 失败、19 个平台/能力跳过；必需浏览器 Gate 296 项全部通过、无跳过。Windows 的 102 项相关检查、64 项原生浏览器兼容及解压包冒烟通过；Windows 全套历史失败、macOS 与远端 CI 未冒充全绿，详见 PoC 验收记录。
- [x] 交付 `bundle` / `validate-set`、文档、端到端浏览器测试、至少 2 套含不同规模关系的示例。

---

## 8. 阶段 III：完整跨层语义、自动聚合与复杂关系（额外 20–40 人天）

### 8.1 目标 / Scope

不只是“作者填好哪些线就显示哪些线”，而是系统能依据全局关系图**自动计算：某一层需要展示什么关系、从何展开、如何折叠、如何关联代码或证据**。

### 8.2 语义与索引（III-01 至 III-09）

- [x] **III-01 Canonical Relation Graph**：建立统一、独立于 SVG 的底层事实图；保存 `relationId`, `from`, `to`, `kind`, `direction`, `evidence`, `scope`, `provenance`。
- [x] **III-02 祖先映射索引**：预计算每个节点在所有合法导航路径下的上级实体，减少运行时遍历；多父共享图需包含路径上下文。
- [x] **III-03 自动投影算法**：根据当前层级将底层关系映射成可见代表端点，聚合兼容边并保存来源列表。
- [x] **III-04 双向追踪**：点击父级边可看到其所有实际底层关系；点击子图具体边可反查父图上的聚合关系。
- [x] **III-05 一对多/多对一/多对多**：支持多个内部接入点、多个外部模块，以及 Backend 子图 ↔ Database 子图间的跨图细粒度关系。
- [x] **III-06 多跳传播的边界**：区分“直接关系”与“经中间组件的路径”，不要把 A→B→C 的路径自动伪装成直接的 A→C 边。
- [x] **III-07 类型/方向严格性**：请求与响应、同步调用与事件投递、数据流与控制流分别处理；若归并会丢失关键含义则保留多种边。
- [x] **III-08 Provenance / Evidence**：链接 Git commit、文件/行号或其他用户输入证据；来源改变后提示需更新映射。
- [x] **III-09 增量重算**：只修改某张子图或若干关系时，重算受影响祖先关系和对应桥接边，而非全量重建所有图。

### 8.3 高级交互（III-10 至 III-17）

- [x] **III-10 聚合↔细节形态转换**：父级边束在下钻动画中拆分，返回时合并；动画始终由同一组关系 ID 驱动。
- [x] **III-11 多外部端点上下文（被替代）**：使用多个真实 world 端点，按入/出/内部及层级分组；拖动画布查看，不生成前景代理。
- [x] **III-12 跨层链路高亮**：从顶层一次选择某链路，可以逐层查看每个实际接入点与传递关系。
- [x] **III-13 不完整信息提示**：已解析与未解析部分分开视觉编码，不因动画漂亮而掩盖模型缺口。
- [x] **III-14 搜索与节点定位**：跨全局图/子图检索某节点，可自动生成导航路径并聚焦；支持搜索 `relationId`。
- [x] **III-15 性能策略**：边束聚合、路径缓存、虚拟化旧层、节流重绘、按需加载细节层；数据集扩大时评估是否替换 iframe。
- [x] **III-16 可访问性与键盘体验**：可经键盘查看边详情、聚合数量、当前层级及出入连接的文字替代。
- [x] **III-17 美学与质量规则**：无毛玻璃；复用 native 避障路由、caption 避让、3:1 非文字对比度、可测质量 diagnostics 和独立 inspector。

### 8.4 跨类型图语义（III-18 至 III-22）

导航机制可以先对全部 Diagram 类型开放，但**连线语义需要按图类型区别**：

- [x] **III-18 Architecture ↔ Architecture**：优先支持完整端点映射与自动聚合，作为主要完成标准。
- [x] **III-19 Architecture → Data Flow**：允许下钻展示数据流；显式声明 Architecture 边与 Data Flow flow 的语义关系，不能靠名称自动匹配。
- [x] **III-20 Architecture → Workflow**：可以打开并导航；跨层关系仅在存在明确语义适配器时才展开，默认保留边界代理，不生成错误的业务执行边。
- [x] **III-21 Architecture → Sequence**：可作为行为详图下钻，但 Sequence 消息属于按时间排序的交互，不应无条件等价于架构静态关系。
- [x] **III-22 Lifecycle → 其他**：导航可以支持；transitions 的语义映射由插件/adapter 显式控制。

### 8.5 可选项：同一画布局部原地展开

如果后续还想让一个节点**在父 SVG 原地膨胀、撑开附近节点**，需要单独立项：

- 重新计算父图节点布局和 Boundary；
- 父级边的锚点重映射与重新路由；
- 展开/收起期间邻接节点避让；
- 多处同时展开时的边束分组；
- 视觉与语义一致性验证。

这与本计划的“前景子图 + 毛玻璃父图”是**另一种布局机制**。不要混进本轮三个阶段作为隐性验收范围。

### 8.6 阶段验收 Gate III

- [x] 当两张细节图有 10 条底层跨图关系时，可依据层级自动投影到父图聚合边，并从聚合边反查到对应 10 条关系；无重复计数、无反向歧义。
- [x] 同一组关系在 `system`、`backend-detail`、更深层 `auth-detail` 有一致的来源与投影解释。
- [x] 父级关系来源不完整时 Viewer 明确标出未解析部分；不能自行补齐虚构调用。
- [x] 节点/关系增量变更后，只更新相关投影，其他层保持稳定。
- [x] 有端到端回归测试覆盖“外部进来、子图内部处理、再从子图出去、不同细节图相互调用”。
- [x] 明确记录每种 Diagram 类型能否做自动关系展开，而不是使用单个全局开关掩盖差异。

---

## 9. 对现有 Archify Fork 的修改地图

以下是**建议修改位置 / 新增路径**。新路径是规划名称，**并非宣称上游已经存在**。

| 现有位置（核对上游） | 建议改动 | 涉及阶段 |
|---|---|---|
| `archify/schemas/architecture.schema.json` | 暂不大改；使用现有节点 ID、可选关系 ID。仅当语义适配必须时再做可选扩展 | II/III |
| `archify/schemas/README.md` | 补 Diagram Set Schema、跨图关系规则、示例 | II |
| `viewer/template.source.html` | 增加 Host/Bridge 的插槽或包装型 Viewer Template | I/II |
| `viewer/focus.js` | 提供可下钻节点的双击事件接口；和原有 Focus 单击区分 | I/II |
| `viewer/viewer-camera.js` | 相机/坐标变化事件，支持同步跨层 Overlay | I/II |
| `viewer/export.js` | 明确当前图和组合视图的导出边界；兼容单图导出 | II |
| `scripts/generate-viewer.mjs` | 按现有 marker/fragment 生成方式接入新增 Host 模块，避免手改产物 | II |
| `archify/bin/archify.mjs` | 增加 `validate-set`、`bundle` 入口或分离模块 | II |
| `archify/SKILL.md` | 多图生成、关系优先、校验修复工作流 | II |
| **新增** `archify/schemas/diagram-set.schema.json` | Diagram Set 规范 | II |
| **新增** `archify/diagram-set/*`（示意） | Manifest/Validator/Relation Index/Compiler | II/III |
| **新增** `viewer/drilldown-*.js`（示意） | Host、Navigator、Bridge Overlay、通信协议 | I/II |
| **新增** `examples/diagram-set/` | 三层图、三条展开关系的演示与端到端 Fixture | I–III |
| **新增** `tests/diagram-set-*`（以 Fork 测试目录为准） | 校验、UI、打包与回归测试 | I–III |

### 9.1 不要直接编辑生成产物

上游 `scripts/generate-viewer.mjs` 将 `viewer/template.source.html` 与 `viewer/*.js/css` 的片段内联，生成 `archify/assets/template.html`。提交修改时先改源文件，再运行现有生成/检查流程，并按上游要求提交需要跟踪的生成文件；不要只 patch `archify/assets/template.html`。

### 9.2 Fork 和上游同步策略

- 将新功能集中在独立模块和 Manifest，尽量减少对现有五个 Renderer 的侵入。
- 单图入口默认无新特性开销；`diagram-set` 是显式 opt-in。
- 给关键修改加 feature flag（例如 `diagram_set_enabled`）；便于回归和上游同步。
- 每阶段拆成小 PR，保证能独立测试，不要堆成一个长期无法 review 的大 PR。
- 如合并上游 PR #888，只把它当额外树形图类型，不把它的 `parent` 字段直接挪作 Architecture 的跨层关系定义。

---

## 10. 建议的 PR / Issue 拆分

### 第一阶段（4 个 PR）

1. `feat(viewer): add drilldown layer host PoC` — 双 iframe/Scene、父子层可视化与最简下钻。
2. `feat(viewer): frosted-glass transitions and navigation` — 毛玻璃、入栈/出栈、基础面包屑。
3. `feat(viewer): bridge overlay for cross-level edges` — 手工两条详细边、外部锚点、坐标同步。
4. `test(examples): drilldown PoC fixture and smoke tests` — 三张图示例、演示与回归。

### 第二阶段（建议 6–8 个 PR）

1. `feat(schema): introduce diagram-set manifest`
2. `feat(validate): add cross-diagram references and relation checks`
3. `feat(cli): compile and bundle diagram sets into standalone HTML`
4. `feat(viewer): navigation history, breadcrumbs and state restoration`
5. `feat(viewer): relation bundles, context ports and external anchors`
6. `feat(viewer): multi-diagram export behavior`
7. `docs(skill): teach agents to author and validate diagram sets`
8. `test(e2e): offline multi-level drilldown coverage`

### 第三阶段（建议 5–7 个 PR）

1. `feat(graph): canonical relation facts and entity hierarchy`
2. `feat(graph): projection and aggregation engine`
3. `feat(graph): provenance, conflicts and unresolved relations`
4. `feat(viewer): bidirectional relation tracing across levels`
5. `feat(adapters): typed semantic drilldowns across diagram kinds`
6. `perf(viewer): virtualized layers and geometry cache`
7. `test(contracts): aggregation invariants and visual regression`

---

## 11. 测试矩阵（建议自动化）

### 11.1 数据模型与关系

| Case | 输入 | 预期 |
|---|---|---|
| 1→1 | 父边映射到一条底层关系 | 出现一条具体边 |
| 1→3 | 父边映射三条详细关系 | 展开三条，父级 `×3` |
| N→1 | 多个外部组件连到一个内部端点 | 每个来源被正确标识，不合并不同来源 |
| N→M | 两个子图内部节点互连 | 关系端点与图 ID 全局解析 |
| 多级 | Root → Backend → Auth | 各级投影保持一致，返回恢复 |
| 双向 | A→B 与 B→A | 不错误合并成单向或无向 |
| 缺映射 | 父边存在但无底层证据 | 标为 `unresolved` |
| 部分映射 | 三条已知只有两条被描述 | 标为 `partial`，不声称完整 |
| 错端点 | 引用不存在的 node | Validator 阻止 bundle |
| 循环 | A→B→A drilldown | Validator 拒绝/按策略处理 |
| 同名节点 | 两图都含 `api` ID | 由 `diagram:node` 区分 |
| 重复关系 | 同 relation ID 被重复引用 | 去重或报告冲突，不双重计数 |

### 11.2 UI / 浏览器

- [x] Edge overlay 在放大 50%、100%、200%，拖动、浏览器 resize 后锚点正确。
- [x] 父/子图和跨层边保持清晰；模糊要求已由后续用户决定取消。
- [x] 双击只触发一次下钻；单击保留原有 Focus；双击普通节点不下钻。
- [x] Ctrl/Meta+F、Archify 自带搜索、全屏、滚轮、拖拽、触屏点击互不冲突。
- [x] 单图导出不受多图代码影响；当前图 PNG 与组合视图 PNG 不混淆。
- [x] 离线 `file://` 直接打开、浏览器重新加载、前进后退均可用。
- [x] Reduced motion 使动画立即完成；无毛玻璃依赖，不需要伪造模糊降级。
- [x] 相关 HTML 注入/XSS 防护；Bundle 不执行任意外部远程代码；`postMessage` 白名单检查。

### 11.3 视觉对比基准

至少保留 5 种截图基准：

1. Root 图纯净状态。
2. 下钻一层：父图毛玻璃、子图清晰。
3. 外部粗粒度边 `×3` 的展开状态。
4. 下钻第二层，并能辨认外部上下文。
5. 返回 Root 后与状态 1 对比（除瞬时选中效果外一致）。

建议使用 Playwright 进行交互和截图回归；无需为了截图而把 Archify 主 Renderer 改成浏览器式布局器。

---

## 12. 风险与决策清单

| 风险 | 后果 | 缓解方案 |
|---|---|---|
| 不同 iframe 的 SVG 坐标系 | 跨层线端点漂移 | 统一到 Host CSS 坐标；监听 camera/resize；截图验证 |
| 模糊使外部来源看不清 | 用户无法理解“这条边来自哪里” | 前景边缘显示清晰 External Anchor + 名称 + 原图高亮提示 |
| 多层嵌套导致占屏太小 | 第 3 层无法阅读 | 前景保持固定比例，祖先只留可见窄边；可切换专注模式 |
| 底层关系数据不完整 | 生成虚假的架构连接 | `unresolved/partial`，保留来源/人工校验；禁止自动造边 |
| 不同类型图的边语义不同 | 误把流程时序当静态依赖 | Diagram Adapter，默认仅导航不自动关系投影 |
| 关系很多导致视觉杂乱 | 跨层线互相遮挡 | 边束、过滤、端口、选中时局部展开 |
| iframe / `file://` 安全与导出 | 浏览器差异、消息注入或图片失败 | 受控 srcdoc、消息校验、统一资产内联、浏览器矩阵 |
| 上游 Viewer 经常变化 | Fork rebase 冲突 | Host/Schema 独立模块化；减少对现有脚本侵入 |
| 自动聚合与人工父图不一致 | 架构信息失真 | 保留 authored/derived 区分，冲突校验和人工确认 |
| 第三阶段范围膨胀 | 排期失控 | 明确“原地展开父图重新布局”与“所有图类型语义自动转换”为独立可选项 |

### 12.1 开工前需要确认的产品决策（带建议默认值）

1. **前景子图形态**：建议 90% 画布浮层，父图可见一圈模糊背景；不直接覆盖整个窗口。
2. **外部关系展示**：建议“默认按来源/协议聚合成边束，点击展开”，只有少量关系（≤5）默认展开。
3. **外部端点位置**：建议优先放前景边缘，避免必须精确穿过模糊背景中的每个原节点；同时保留背景来源高亮可选功能。
4. **跨层关系来源**：建议 `relations` 为独立事实，父图 `connections` 可以引用其集合；不可在没有证据时自动细化。
5. **子图导航触发**：建议双击 + 显式详情按钮（支持触屏/键盘），单击沿用原图语义。
6. **无子图节点**：完全不显示可下钻 affordance。
7. **是否允许共享子图**：建议 II 阶段不允许，III 阶段按需支持路径依赖的 DAG。
8. **跨类型语义**：II 阶段全部支持“导航”，但关系自动展开先限制 Architecture ↔ Architecture。
9. **组合视图导出**：II 阶段先完成 PNG 截图与“当前图”导出；跨 iframe 的可编辑 SVG 属后续优化。

---

## 13. 推荐实际开发顺序（减少返工）

建议首周先按以下最小闭环推进，而不是先把全部 Schema 和 CLI 写完：

```text
固定真实案例与关系事实
  ↓
准备 system/backend/auth 三张原生图（IR）
  ↓
外层 Layer Host + iframe 双图
  ↓
双击/返回 + 父层 blur + 子层清晰
  ↓
外部代理 Anchor + 两条真实细节 Bridge
  ↓
缩放/平移/resize 仍然准确
  ↓
冻结 PoC 行为，确定正式 Manifest
  ↓
编译/校验/打包 → Agent SKILL
  ↓
底层关系投影/聚合引擎 → 跨层追踪
```

**最重要的工程判断**：只要第一阶段验证了“保持模糊父图上下文的同时，跨层边能连接到清晰子图里的真实内部节点”，第二阶段就可以把这一机制正式产品化；第三阶段再让这些映射更多由底层事实自动推导。若第一阶段连接的坐标/视觉无法让人理解，应先修正 Viewer 分层方案，而不是继续投入复杂 Schema。

---

## 14. 交付文件清单

### Gate I

- `examples/diagram-set-poc/system.json`
- `examples/diagram-set-poc/backend.json`
- `examples/diagram-set-poc/auth.json`
- `examples/diagram-set-poc/edge-mapping.poc.json`
- `examples/diagram-set-poc/poc.html`
- `docs/drilldown-poc-decisions.md`
- 浏览器交互冒烟测试与 5 张关键截图

### Gate II

- `archify/schemas/diagram-set.schema.json`
- `archify/diagram-set/{model,validator,compiler,relations}.*`（实际名称按源码架构选择）
- `viewer/{diagram-host,drilldown-navigator,bridge-overlay,diagram-bridge}.*`
- `examples/diagram-set/`
- CLI、SKILL 文档与端到端测试
- `output.html`：单文件可分享交付物

### Gate III

- `archify/diagram-set/{projection,provenance,ancestor-index}.*`
- 关系不变量测试集、跨图追踪 demo、性能报告
- 各图类型的 Adapter 声明及其能力矩阵
- 如有必要，新的多实例 Scene Runtime PoC 与替换决策

---

## 15. 来源、术语和注意事项

### 已核对的上游参考

- [Archify GitHub 主仓库](https://github.com/tt-a1i/archify)
- [Architecture Schema](https://github.com/tt-a1i/archify/blob/main/archify/schemas/architecture.schema.json)（含 `components`、`connections`、可选关系 `id`；严格 Schema）
- [Schema README](https://github.com/tt-a1i/archify/blob/main/archify/schemas/README.md)（多种图类型关系集合、关系 `id`、独立校验器）
- [Viewer Focus](https://github.com/tt-a1i/archify/blob/main/viewer/focus.js)
- [Viewer Template](https://github.com/tt-a1i/archify/blob/main/viewer/template.source.html)
- [Viewer Export](https://github.com/tt-a1i/archify/blob/main/viewer/export.js)
- [Viewer 生成器](https://github.com/tt-a1i/archify/blob/main/scripts/generate-viewer.mjs)（把 source/template 及 JS/CSS 片段组成生成产物）
- [Archify CLI](https://github.com/tt-a1i/archify/blob/main/archify/bin/archify.mjs)
- [Archify SKILL](https://github.com/tt-a1i/archify/blob/main/archify/SKILL.md)
- [PR #888 — Hierarchy Diagram](https://github.com/tt-a1i/archify/pull/888)（相关，但不是本方案的多图语义实现）

### 名词对照

| 中文 | 英文 | 含义 |
|---|---|---|
| 节点下钻 | Node Drill-down | 点击模块深入某张独立详情图 |
| 多图集合 | Diagram Set | 多张图与关系映射组成的单个交付单元 |
| 毛玻璃下钻 | Frosted-Glass Drill-down | 父图模糊保留，子图在前景清晰展开 |
| 跨层连接 | Cross-Level Connection / Context Bridge | 外部模块与当前子图内部节点之间的联系 |
| 层级连线展开 | Hierarchical Edge Expansion | 一条父级抽象边展开为多条具体底层边 |
| 层级关系投影 | Hierarchical Edge Projection | 依据当前层级，把底层关系映射到可见节点 |
| 边聚合 | Edge Aggregation / Edge Bundling | 多条兼容底层关系显示为一条父级边束 |
| 外部锚点 | External Anchor / Boundary Port | 子图前景用来标识外部节点/系统的可视端点 |
| 关系溯源 | Relationship Provenance | 说明可见边来自哪些底层关系和证据 |

### 方案性质声明

本计划是**改造设计方案**而非代码完成报告。所有 `diagram-set` 相关 JSON 字段、模块名、CLI 子命令均为建议 API，需要按 Fork 当前实现完成 Schema/CLI 设计与测试后才能作为正式契约。上述用户体验示意是目标行为，不意味着 Archify 上游当前具备此能力。

---

**建议最终项目特性名称**：**Archify Hierarchical Drill-down & Edge Expansion**。
