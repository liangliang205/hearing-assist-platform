# HearLink 听障辅助平台

让听障用户在 PC 上按自己的双耳听力曲线获得个性化声音补偿。

**当前阶段：v0.2 —— 桌面端系统级增强可用（增益补偿 + 频率重映射），待听感标定**

---

## 1. 产品形态

| 形态 | 说明 | 状态 |
| --- | --- | --- |
| **桌面端**（主体） | 测听 → 双耳补偿配置 → 本地文件增强 → **系统级实时处理**（接管整机声音） | 已可用，含 NSIS 安装包 |
| **服务端**（可选） | 账号、档案同步、匿名统计、听力建议（调外部 LLM） | 接口已就绪，不参与离线流程 |

核心原则：**音频与听力数据永不出本机**；服务端只在用户主动登录并同意后同步「曲线与派生参数」。

系统级增强的链路（虚拟声卡方案，已实测）：

```
所有应用 → 系统默认播放设备被切到 CABLE Input
        → Rust 引擎捕获 CABLE Output → 左/右耳 DSP（增益补偿 或 频率重映射）
        → 你原来的扬声器/耳机
```

---

## 2. 目录结构

```
apps/desktop/                桌面端（React 18 + TS + Vite）
  src/audio/                 纯音播放、双耳 EQ 链、扫频与文件播放
  src/desktop/               Tauri 桥接（引擎启停/状态、桌面壳检测）
  src/store/                 本地存储抽象（接口 + 浏览器实现 + SQLite 实现 + 表结构）
  src/components/            双耳听力图 / 增益图 / 实测频响
  src/pages/                 概览、听力自测、听力档案、声音增强、设置
  src-tauri/                 Tauri 2 外壳（Rust：托盘、引擎 sidecar 启停、SQLite 桥、DB 单测）

services/server/             服务端（Next.js 15 + Prisma，可选）
  src/app/api/               REST 接口（账号、双耳档案、配置导出）
  prisma/                    服务端数据模型与迁移

packages/domain/             共享领域逻辑（听力学计算、补偿构建、方案规划）
                             桌面端与服务端共用，保证两端参数完全一致

rust/hearlink-audio/         音频引擎（cpal + 自研 DSP + 设备接管）
  src/biquad.rs              Peaking EQ、双耳处理链
  src/lowering.rs            STFT 频率重映射 + 完整处理管线（Pipeline）
  src/endpoints.rs           端点枚举、名字 → 端点 ID
  src/route.rs               IPolicyConfig 切默认设备（裸 FFI）
  src/routing.rs             接管前记录 / 退出还原 / 崩溃恢复
  src/hotswap.rs             配置热更新（无锁换链）
  src/com.rs                 最小 COM 互操作层

native/hearlink-apo/         自研 APO 原型（已放弃，见交接文档 §2.2）
samples/                     补偿配置样例（桌面端与服务端的共同契约）
scripts/                     smoke.mjs、build-sidecar.mjs、verify-*.mjs
docs/                        需求文档 v2.0、新会话交接说明、截图、研究资料
```

---

## 3. 快速开始（只跑桌面端）

桌面端是离线优先的，**不需要数据库、不需要服务端、不需要 Docker**。

### 3.1 浏览器预览（最快，只用来看界面）

```powershell
pnpm install
pnpm dev            # http://localhost:5173
```

打开后直接可用：概览 → 听力自测（双耳依次）→ 结果解读 → 听力档案 → 声音增强（试听 / 批量处理导出）。
数据存浏览器 localStorage。**浏览器里不能接管系统声音**，试听走 Web Audio，只有方案一。

听力自测流程：**音量校准 → 声道检查 → 单耳测听 → 结果解读**。
测听时只向目标声道播放纯音（测左耳只有左声道出声），避免好耳「替」坏耳听到；
键盘操作为 `空格`/`1` = 听到了、`2` = 没听到、`R` = 重听。

### 3.2 桌面版（Tauri，可接管系统所有声音）

前置：已安装 [VB-CABLE](https://vb-audio.com/Cable/) 虚拟声卡（输出侧出现 `CABLE Input`，输入侧 `CABLE Output`）。

```powershell
pnpm install
pnpm sidecar        # 构建 Rust 引擎并复制成 Tauri sidecar（改了引擎后要重跑）
pnpm tauri:dev      # 开发模式启动桌面端

# 打安装包（NSIS）
pnpm tauri:build
# 产物：apps/desktop/src-tauri/target/release/bundle/nsis/HearLink_0.1.0_x64-setup.exe
```

开启方式：**「声音增强」页顶部的一键开关**、**托盘菜单**、启动参数 `--engine-autostart`。

页面上能做的事：

- **方案选择**（「增强方案」卡片）：方案一 增益补偿 / 方案二 频率重映射，**两者互斥**，系统级只生效一个
- **原音 / 增强**：同时作用于系统全局——原音时引擎整条链直通（A/B 对比用），增强时按当前方案处理
- **系统全局开关**：一键接管 / 还原系统默认播放设备

运行期行为：

- 切换默认设备前把原设备写进 `%APPDATA%\HearLink\routing.json`；关闭、退出、崩溃后下次启动都会还原
- 换档案 / 换方案 / 切原音，都会写 `%APPDATA%\HearLink\profile.json`，引擎 **1 秒内热更新**，不用重启
- 数据存 SQLite：`%APPDATA%\HearLink\hearlink.db`（首次启动把浏览器预览数据迁移进来，原数据保留作备份）
- 引擎日志：`%APPDATA%\HearLink\engine.log`
- 关窗口 = 退出程序并还原设备；想常驻请用最小化，托盘可随时开关

### 3.3 环境要求（桌面版）

| 组件 | 版本 / 说明 |
| --- | --- |
| Node.js + pnpm | Node ≥ 20，pnpm 9 |
| Rust | `stable-x86_64-pc-windows-msvc` —— **必须是 MSVC 工具链**，GNU 工具链跑不了 Tauri |
| VS Build Tools 2022 | 勾选「使用 C++ 的桌面开发」，自带 MSVC v143 + Windows SDK |
| WebView2 运行时 | Windows 10/11 通常已自带 |
| VB-CABLE | 系统级增强必需（2ch 48 kHz 即可） |

```powershell
rustup toolchain install stable-x86_64-pc-windows-msvc
rustup default stable-x86_64-pc-windows-msvc
```

当前开发机已验证：Tauri 2.12（CLI 2.12.4 / crate 2.12.5）、MSVC 14.44.35207 + Windows SDK 10.0.26100 + WebView2 156。

---

## 4. 可选：启动服务端

仅在需要账号 / 同步 / 深度分析时使用。

```powershell
# PostgreSQL 挂在 server profile 下，默认不启动
docker compose --profile server up -d

pnpm db:generate
pnpm db:migrate
pnpm dev:server     # http://localhost:3000
```

服务端环境变量只有根目录一份 `.env`，脚本通过 `dotenv -e ../../.env` 读取。

---

## 5. 验证

```powershell
pnpm typecheck      # domain + desktop + server
pnpm test           # 领域逻辑单元测试（90 项）
pnpm build          # 桌面端 + 服务端构建
pnpm smoke          # 服务端端到端冒烟（18 项，需服务端运行）
pnpm test:rust      # Rust 音频引擎单元测试（27 项）
cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml   # Tauri 外壳 / SQLite 桥（5 项）
```

引擎离线自测（不需要声卡）：

```powershell
cargo run --manifest-path rust\hearlink-audio\Cargo.toml -- selftest  --profile rust\hearlink-audio\sample-profile.json
cargo run --manifest-path rust\hearlink-audio\Cargo.toml -- lowering-test --profile rust\hearlink-audio\sample-profile-lowering.json --tone 6000
```

### 5.1 实测数据（2026-11-06，开发机）

| 项 | 结果 |
|---|---|
| 实时链路（增益补偿，release，48 kHz / 256 帧） | 回调平均 19–22 µs，最大 96–150 µs（预算 5333 µs） |
| 实时链路（频率重映射，release） | 回调平均 41 µs，最大 96 µs |
| 欠载 / 丢弃 | 欠载 96 帧（启动瞬间，0.03%），丢弃 0 |
| 频率重映射自测 | 6000 Hz 测试音搬移到 3984 Hz，−3.1 dB，底噪 −81 dB |
| 配置热更新 | 改 `profile.json` → 1 秒内 `配置 v0 → v1`，无欠载新增 |
| 设备接管 / 还原 | 正常退出、强制结束、崩溃恢复三条路径均实测还原成功 |
| SQLite | 实测写入：1 份档案、3 条测听会话、3 条设置；重启后数据仍在 |
| 安装包 | `HearLink_0.1.0_x64-setup.exe`（NSIS，2.53 MiB） |

---

## 6. Rust 音频引擎

用于「捕获 → 双耳 DSP → 输出」这条系统级链路，可独立于桌面端运行（排障用）。

```powershell
$cargo = "$env:USERPROFILE\.cargo\bin\cargo.exe"

# 列出音频设备（cpal 视角：通道数、采样率）
& $cargo run --manifest-path rust/hearlink-audio/Cargo.toml -- devices

# 列出系统端点（Windows 视角：端点 ID + 默认设备标记）
& $cargo run --manifest-path rust/hearlink-audio/Cargo.toml -- endpoints

# 名字 → 端点 ID（只输出 ID，便于脚本解析）
& $cargo run --manifest-path rust/hearlink-audio/Cargo.toml -- resolve "CABLE Input"

# 切换默认播放设备 / 手动还原 / 查看接管状态
& $cargo run --manifest-path rust/hearlink-audio/Cargo.toml -- route --name "CABLE Input"
& $cargo run --manifest-path rust/hearlink-audio/Cargo.toml -- restore
& $cargo run --manifest-path rust/hearlink-audio/Cargo.toml -- routing

# 离线验证 DSP / 方案二
& $cargo run --manifest-path rust/hearlink-audio/Cargo.toml -- selftest --profile rust/hearlink-audio/sample-profile.json
& $cargo run --manifest-path rust/hearlink-audio/Cargo.toml -- lowering-test --profile rust/hearlink-audio/sample-profile-lowering.json --tone 6000

# 实时链路；--takeover 接管系统默认播放设备，退出时自动还原
& $cargo run --manifest-path rust/hearlink-audio/Cargo.toml -- run `
    --profile rust/hearlink-audio/sample-profile-lowering.json `
    --input "CABLE Output" --output default --takeover "CABLE Input" --seconds 0
```

`run` 的关键参数：

| 参数 | 作用 |
|---|---|
| `--output default` | 输出到接管前的系统默认播放设备（桌面端用，不用猜设备名） |
| `--takeover <名字\|ID>` | 接管系统默认播放设备，退出/崩溃后还原 |
| `--stop-file <path>` | 该文件一出现就按正常流程退出并还原（桌面端退出时用） |
| `--seconds 0` | 一直运行，直到 Ctrl+C |
| `--no-watch` | 关闭配置热更新 |

已实现：Peaking EQ（RBJ 公式，与 Web Audio 一致）、双耳独立处理、环形缓冲、欠载统计、
STFT 频率重映射（1024 点、sqrt-Hann、50% 重叠）、设备枚举与接管/还原、配置热更新、原音直通。
待补：时钟漂移补偿、搬移量的听感标定。

### 6.1 两个处理方案（互斥）

| | 方案一 · 增益补偿 | 方案二 · 频率重映射 |
|---|---|---|
| 做法 | 多段 Peaking EQ + 前置增益 | STFT 把 `[fmin, fmax]` 的复数 bin 下移 `shiftHz`，副本 −3 dB |
| 参数 | 按听力图求解频带增益（见 §6.2） | `fmin` = 听力较差侧第一个 >40 dB HL 的频点，`fmax` = 8000 Hz，`shiftHz` 默认半带宽 |
| 延迟 | 可忽略 | 额外一个 FFT 帧 ≈ 21 ms |
| 适用 | 各频段都有残余听力 | 高频损失重、放大也听不到辅音 |

引擎里 `Pipeline` 只执行其中一条；`bypass: true` 时整条链直通（原音对比）。桌面端「原音/增强」开关
就是切这个字段，热更新 1 秒内生效。

### 6.2 听力与补偿口径

- **测听**：标准 6 点 / 精细 9 点，单耳独立会话；按临床顺序从 1000 Hz 起测，再测高频、最后测低频。
- **音型**：判阈用脉冲纯音（250 ms 通断，50 ms 升降沿），复验用连续纯音与啭音（±5%、5 Hz）各确认一次；
  任一复验没通过就自动提高 5 dB 重测。
- **阶梯法**：听到降 10 dB、未听到升 5 dB，上升后同一强度确认两次才判定听阈。
- **处方**：软拐点半增益——听阈 ≤ 50 dB 时按半增益，超过后斜率降到 0.35，单频上限 30 dB。
- **频带求解**：相邻 peaking 频带的响应会叠加（dB 相加），直接把处方值当频带增益会整体超标
  （实测可达 70 dB 以上）。因此用线性方程组求解 + 真实响应残差修正，让「合成响应 ≈ 处方目标」。
- **展示口径**：表格与图表展示**有效增益**（整条链在该频点的实际响应，含叠加与前置增益），
  不是单个频带的标称值。旧档案可在「听力档案」页点「重算补偿参数」按新规则刷新。
- **边界**：不是临床处方（非 NAL-NL2），未做声学校准，仅用于个性化补偿与前后对比。

---

## 7. 数据与隐私

- 默认**游客模式**，不登录、不联网，全部功能可用；
- 本地数据：
  - 桌面版：`%APPDATA%\HearLink\hearlink.db`（SQLite，可导出 JSON、可删除）
  - 浏览器预览：localStorage
- 桌面版首次启动会把浏览器预览在 `localhost:5173` 下的数据迁移进 SQLite，并保留 localStorage 作备份；
- 服务端只在用户主动登录并明确同意后接收数据，且只收「听力曲线与派生参数」，不收音频、不收设备标识。

### 账号与同步（可选）

- 桌面端顶栏「登录 / 注册」进入账号页；**不登录也能完整使用本地功能**；
- 登录后**自动同步**：测听完成、重算补偿、新建档案等任何写入都会静默上传，无需手动操作；
  窗口重新聚焦和每分钟兜底会补同步；
- 登录后**自动双向合并**：逐耳比较 `generatedAt`，云端更新则导入本机，本地更新则上传；
- **首次同步前必须勾选隐私同意**：未同意时一个字节都不上传（`setSyncEnabled` 直接短路）；
- 可在「设置 → 账号与隐私」随时**撤回同意**：立即停止上传，并调用 `DELETE /api/hearing/profile` 删除云端档案；
- 会话用 httpOnly Cookie（`hl_session`，7 天有效），前端不接触令牌明文；
- 开发时桌面端通过 Vite 代理 `/api` 访问服务端（同源，无需 CORS）；打包后可用
  `VITE_API_BASE_URL` 指向独立服务端，并在服务端用 `CORS_ORIGINS` 放行来源；
- 验证：`pnpm verify:auth`（9 项）、`pnpm verify:consent`（4 项）。

---

## 8. 已移除 / 已放弃的内容

| 项 | 原因 |
| --- | --- |
| 自研 APO（`native/hearlink-apo/`） | Win11 25H2 上引擎创建对象后一个方法都不调用就丢弃，路线走不通（复盘见交接文档 §2.2） |
| Equalizer APO 配置导出（`packages/domain/src/apo.ts` + 界面卡片） | 系统级增强已有虚拟声卡 + Rust 引擎的真实现，不再需要只读导出兜底 |
| `ai-service/`（FastAPI） | 服务端不跑模型；ASR 改由桌面端 `whisper-rs` 承担 |
| Redis / 对象存储 | 无代码引用，MVP 用本地文件 |
| 一次性脚本与 `doc_extract/` | 文档提取产物，可随时重新生成 |

---

## 9. 已知限制

- **托盘菜单未人工点验**：页面开关、引擎启停、设备接管/还原、SQLite 写入都已实测，托盘菜单本身没点过。
- **安装包未做安装/卸载验证**：`HearLink_0.1.0_x64-setup.exe` 已生成，未在干净环境装过。
- **开机自启未注册**：`--engine-autostart` 已支持，缺少系统登录项注册。
- **实时链路需做时钟漂移补偿**：跨设备（虚拟声卡 ↔ 真实输出）时钟不同步，长时间运行会累积欠载。
- **Ctrl+C 还原路径未实测**：已注册控制台事件处理，但无窗口进程收不到事件；有 `routing.json` 兜底。
- **换配置瞬间可能有极短瞬态**：换链时滤波器状态归零，后续可做交叉淡化。
- **频率重映射未做主观听感验证**：离线自测能证明能量被搬到目标频点；音质（phasiness）与
  「搬多少最合适」需要真人试听标定。浏览器试听仍只做增益补偿。
- **搬移量规则偏简单**：默认半带宽是固定值，未按听力图做处方式标定；低于搬移量的频段没有落点（不复制）。
- **测听未做声学校准**：结果为相对听阈，仅用于个性化补偿与前后对比。

---

## 10. 路线图

| 版本 | 内容 | 状态 |
| --- | --- | --- |
| **v0.1** | 桌面端离线 MVP：测听、多档案、增益补偿试听、本地文件处理、Tauri 打包 | 已完成 |
| **v0.2** | 系统级增强：VB-CABLE 接管、Rust DSP、频率重映射、配置热更新、原音对比 | 引擎已完成，待听感标定 |
| v0.3 | 开机自启、SQLite（已提前完成）、延迟优化、托盘体验 | 部分完成 |
| v0.4 | 账号同步、隐私同意、深度分析（服务端 LLM） | 接口已就绪 |
| v1.0 | 自动更新、安装包签名、跨机迁移、视频字幕（whisper-rs） | 未开始 |

详细需求与选型论证见 [项目需求文档 v2.0](<docs/项目需求文档_v2.0_桌面端优先.md>)，
当前进度与踩坑记录见 [新会话交接说明](docs/新会话交接说明.md)。

---

## 11. 约定

- 依赖统一用 pnpm 管理，提交 `pnpm-lock.yaml`。
- 领域逻辑只写在 `packages/domain/`，桌面端与服务端都不要复制一份。
- 接口响应保持 `{ code, message, data, traceId }`。
- 环境变量只有根目录一份 `.env`。
- 改了 Rust 引擎后要跑 `pnpm sidecar`，否则桌面端用的还是旧二进制。
- `@types/react` 通过根 `package.json` 的 `pnpm.overrides` 锁定为 18，避免工作区内双版本冲突。
- 听力自测仅用于辅助筛查与个性化参数采集，不作为医疗诊断。
