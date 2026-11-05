# HearLink 听障辅助平台

让听力受损的用户在 PC 上按自己的听力曲线获得个性化声音补偿。

**最终目标**：用户完成听力自测 → 得到听力曲线与补偿参数 → Windows 所有声音经虚拟声卡/系统级处理 → 按参数增强后播放。

**当前进度**：v0.1 已完成「听力自测 → 生成补偿配置 → 浏览器内增强与 AB 对比」的完整闭环，系统级实时处理（虚拟声卡/APO）列为 v0.2。

---

## 1. 已实现（v0.1）

| 模块 | 内容 | 状态 |
| --- | --- | --- |
| 账号体系 | 注册 / 登录 / 登出 / 会话校验，bcrypt 哈希 + JWT（httpOnly Cookie，7 天） | ✅ |
| 听力自测 | 左右耳分别测听：6 个倍频程频点（250～8000 Hz）自适应阶梯法，纯音由 Web Audio 实时生成 | ✅ |
| 听力学计算 | 逐耳听阈、逐耳 PTA（500/1k/2k/4k）、WHO 2021 分级、半增益补偿曲线；整体分级取较好耳 | ✅ |
| 听力档案 | 每用户每耳一份，持久化到 PostgreSQL，支持按自测记录重建 | ✅ |
| 可视化 | 双耳听力图（右耳红圈 / 左耳蓝方）、双耳增益对比、**实测**双耳频响（BiquadFilter 实测） | ✅ |
| 增强预览 | 立体声按声道拆分：左声道走左耳参数、右声道走右耳参数；原音↔增强即时 AB | ✅ |
| 配置导出 | `GET /api/hearing/profile/config`，双耳配置，供后续桌面端消费的稳定契约 | ✅ |
| 质量保障 | 29 个领域逻辑单元测试 + 18 项端到端冒烟检查 | ✅ |

### 明确尚未实现

- 系统级音频接管（WASAPI 回环 / APO / 虚拟声卡驱动）——v0.2
- 频率搬移 / 频率压缩（frequency lowering）——配置里已预留 `df / fmin / fmax`，v0.2 落实
- AI 字幕、视频处理、实验评估模块——沿用原课题计划
- 声学校准：浏览器无法标定 dB SPL，当前阈值为**相对值**，非临床结果

---

## 2. 项目结构

```
frontend/                  React 18 + Vite + Ant Design + ECharts
  src/audio/               Web Audio：纯音播放、双耳 EQ 处理链、扫频与文件播放
  src/components/charts.tsx 双耳听力图 / 双耳增益图 / 实测双耳频响
  src/pages/               登录、工作台、听力自测、听力档案、增强预览
backend/                   Next.js 15 Route Handlers + Prisma
  src/lib/audiogram.ts     听力学核心（纯函数，可单测、可移植到桌面端）
  src/lib/profile.ts       左右耳档案读取与双耳配置合成
  src/lib/auth.ts          密码哈希、JWT 会话
  src/app/api/             REST 接口
  prisma/schema.prisma     8 个数据模型（含 Ear 耳别维度）
ai-service/                FastAPI（当前仅健康检查，后续接 ASR 与离线 DSP）
scripts/smoke.mjs          端到端冒烟测试（含双耳独立性与单侧场景）
samples/                   双耳补偿配置样例（桌面端对接参考）
```

---

## 3. 快速开始

### 3.1 环境要求

- Node.js ≥ 20、pnpm 9（`corepack enable`）
- Docker（用于 PostgreSQL / Redis）
- Python 3.10+（仅 AI 服务需要，v0.1 可跳过）

### 3.2 启动步骤

```powershell
# 1. 配置环境变量（只需根目录一份，后端脚本会读取它）
Copy-Item .env.example .env
# 生成并填入 JWT_SECRET（至少 32 字符）
node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"

# 2. 启动基础设施
docker compose up -d postgres redis

# 3. 安装依赖
pnpm install

# 4. 初始化数据库
pnpm db:generate
pnpm db:migrate

# 5. 启动前后端（两个终端）
pnpm dev:backend     # http://localhost:3000
pnpm dev:frontend    # http://localhost:5173
```

打开 <http://localhost:5173>，注册账号 → 听力自测 → 查看档案 → 增强预览。

### 3.3 验证

```powershell
pnpm typecheck    # 前后端类型检查
pnpm test         # 听力学领域逻辑单元测试（22 项）
pnpm build        # 前后端生产构建
pnpm smoke        # 端到端冒烟（需后端已启动，13 项检查）
```

`pnpm smoke` 会自动注册临时账号、跑完整测听流程、导出配置到 `samples/compensation-config.sample.json`，并校验未授权访问返回 401。

---

## 4. API 一览

统一响应体：`{ code, message, data, traceId }`，`code = 0` 表示成功。

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/api/health` | 服务健康检查 |
| POST | `/api/auth/register` | 注册并自动登录 |
| POST | `/api/auth/login` | 登录 |
| POST | `/api/auth/logout` | 退出（清除会话 Cookie） |
| GET | `/api/auth/me` | 当前用户 |
| POST | `/api/hearing/tests` | 开启自测会话，**必须传 `ear`（`LEFT`/`RIGHT`）** |
| GET | `/api/hearing/tests` | 我的自测记录（最近 20 条），支持 `?ear=LEFT` 过滤 |
| GET | `/api/hearing/tests/:id` | 自测详情 |
| PATCH | `/api/hearing/tests/:id` | 提交结果；`complete=true` 时汇总**该耳**听阈并更新对应耳别档案 |
| GET | `/api/hearing/profile` | 读取双耳档案与合计配置，返回 `{ profiles: { LEFT, RIGHT }, config }` |
| PUT | `/api/hearing/profile` | 需传 `ear`；按 `sourceTestId` 重建该耳配置，或保存自定义配置 |
| GET | `/api/hearing/profile/config` | 导出**双耳**补偿配置 JSON（桌面端契约） |

错误码：`E1xxx` 认证与账号，`E2xxx`/`E1xxx` 参数与业务校验，`E9xxx` 系统级错误。

---

## 5. 补偿配置契约（v1，双耳）

字段定义见 `backend/src/lib/audiogram.ts` 的 `CompensationConfig` / `EarCompensation`，样例见 `samples/compensation-config.sample.json`。

```jsonc
{
  "version": 1,
  "ears": {
    "LEFT": {
      "ear": "LEFT",
      "sourceTestId": "…",
      "audiogram": [{ "frequency": 1000, "thresholdDbHl": 20 }],
      "ptaDbHl": 25,
      "grade": { "key": "mild", "label": "轻度听力损失" },
      "eqBands": [{ "frequency": 1000, "gainDb": 0, "q": 1, "type": "peaking" }],
      "preGainDb": 0,
      "compressor": { "thresholdDb": -24, "kneeDb": 12, "ratio": 2, "attackMs": 10, "releaseMs": 250 },
      "limiter": { "thresholdDb": -3, "ratio": 20, "attackMs": 3, "releaseMs": 120 }
    },
    "RIGHT": { "…": "同上结构，右侧独立计算" }
  },
  "overallGrade": { "key": "mild", "label": "轻度听力损失" },
  "frequencyLowering": { "enabled": false, "shiftHz": null, "fmin": 1600, "fmax": 8000 }
}
```

要点：

- `ears.LEFT` / `ears.RIGHT` **可能为 `null`**（该侧未测听），消费方应对该声道直通处理；
- `overallGrade` 取**较好耳**分级，符合「以好耳定级」的通行做法；
- 双耳共用一组压缩/限幅参数，但**增益曲线各自独立**；
- **这是浏览器预览与后续桌面端共用的同一份契约**，避免两套参数逻辑漂移；
- `frequencyLowering` 的参数形式沿用 openMHA 的 `shift / fmin / fmax` 约定，v0.2 由系统级处理端执行。

---

## 6. 听力学口径

- **测听流程**：左右耳各自独立一次会话；每个频点从 40 dB HL 起，听到则降 10 dB、未听到则升 5 dB；当出现「未听到→听到」的 5 dB 包夹，或越界、重复、超过 16 次时终止，取最低「听到」强度为听阈。
- **分级**：WHO 2021，逐耳 PTA（500/1k/2k/4k），未测出频点按 95 dB 计入；**整体分级取较好耳**。
- **增益**：逐耳简化半增益规则 `gain = clamp((threshold − 20) × 0.5, 0, 24)`，按 5 dB 量化；最大增益 > 12 dB 时预留 −6 dB 前置增益，配合限幅器防削波。
- **立体声处理**：左声道只走左耳参数、右声道只走右耳参数；单声道素材同时送入两条链，便于听出双耳差异。
- **边界**：本平台是辅助聆听工具，测听结果不等同于医院纯音测听，不作为医疗诊断依据。

---

## 7. 版本路线图

| 版本 | 目标 | 关键工作 |
| --- | --- | --- |
| **v0.1（已完成）** | 双耳听力自测 → 双耳补偿配置 → 浏览器内立体声预览 | 认证、双耳测听、逐耳听力学计算、双耳可视化、立体声 AB 对比、配置导出 |
| **v0.2** | 系统级实时处理 | WASAPI 环回或 APO 客户端；读取同一份配置 JSON；频率搬移（STFT / 滤波器组）；端到端延迟实测目标 < 30 ms |
| **v0.3** | AI 字幕与视频 | faster-whisper 字幕、字幕时间轴、非语音信息标注 |
| **v1.0** | 可交付产品 | 安装包、虚拟声卡方案落地、多设备配置、实验评估报告 |

### v0.2 的技术取舍（已论证）

- 运算不是瓶颈：48 kHz 下 STFT（n_fft=1024）仅占单核 <0.1%；
- 真正的约束是**延迟**：STFT 固有 21～35 ms，IIR 方案接近 0，因此实时层优先用 IIR/滤波器组，STFT 用于离线精修；
- 系统级接管优先选 **WASAPI 环回**（纯用户态、无需驱动签名），APO 作为进阶方案；
- 不用生成式音频大模型做频谱变换：它会改写内容与音色、不可复现、无法写测试用例。

---

## 8. 约定

- 依赖统一用 pnpm 管理，提交 `pnpm-lock.yaml`。
- 业务 API 统一 `/api` 前缀，响应保持 `{ code, message, data, traceId }`。
- 环境变量只有根目录一份 `.env`；后端脚本通过 `dotenv -e ../.env` 读取。
- `@types/react` 通过根 `package.json` 的 `pnpm.overrides` 锁定为 18，避免工作区内 18/19 双版本导致的 JSX 类型冲突。
- 长耗时处理走异步任务（`AiTask` + `taskId`），不在请求内同步跑模型推理。
- 听力自测仅用于辅助筛查与个性化参数采集，不作为医疗诊断。
