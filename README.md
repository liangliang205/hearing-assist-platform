# 听障辅助平台

基于 React + TypeScript、Next.js、FastAPI 的听障辅助平台毕业设计项目。

## 项目结构

- `frontend/`：React 18 + Vite 前端
- `backend/`：Next.js 业务后端、Prisma 数据模型
- `ai-service/`：FastAPI AI 微服务
- `docker-compose.yml`：PostgreSQL、Redis、S3 兼容对象存储基础设施（SeaweedFS）

## 初始化运行

1. 复制根目录的 `.env.example` 为 `.env`，按需修改密钥。后端 Prisma 命令会统一读取此根目录环境文件：

   ```powershell
   Copy-Item .env.example .env
   ```
2. 启动基础设施：

   ```bash
   docker compose up -d
   ```

3. 安装依赖：

   ```bash
   corepack enable
   pnpm install
   python -m venv .venv
   .venv\Scripts\activate
   pip install -r ai-service\requirements.txt
   ```

4. 初始化数据库：

   ```bash
   pnpm db:generate
   pnpm db:migrate
   ```

   若 `.env` 尚未创建，Prisma 会提示 `Environment variable not found: DATABASE_URL`。

5. 启动服务：

   ```bash
   pnpm dev:frontend
   pnpm dev:backend
   pnpm dev:ai
   ```

前端默认地址为 `http://localhost:5173`，业务后端为 `http://localhost:3000`，AI 服务为
`http://localhost:8000`。对象存储 S3 API 位于 `http://localhost:9000`，SeaweedFS 管理界面位于
`http://localhost:9001`。当前初始化阶段提供首页、服务健康检查、Prisma 数据模型和 AI 服务健康检查。

> MinIO 官方镜像当前无法拉取，因此开发环境使用 SeaweedFS 提供兼容的 S3 API。现有
> `MINIO_ENDPOINT`、`MINIO_ACCESS_KEY` 与 `MINIO_SECRET_KEY` 配置键会保留，待业务后端接入
> S3 客户端时作为统一对象存储配置使用。

## 约定

- Node.js 依赖统一使用 pnpm 管理；根目录的 `pnpm-workspace.yaml` 包含前端与后端工作区，提交生成的 `pnpm-lock.yaml`。
- 业务 API 统一使用 `/api` 前缀，错误响应保持 `{ code, message, data }` 结构。
- 长耗时字幕和音频处理通过异步任务返回 `taskId`，不在请求中同步执行模型推理。
- 听力自测仅用于辅助筛查和个性化参数采集，不作为医疗诊断。
