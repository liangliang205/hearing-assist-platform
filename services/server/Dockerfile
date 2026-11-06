FROM node:22-alpine
WORKDIR /app
COPY package*.json ./
RUN corepack enable && pnpm install
COPY . .
RUN pnpm exec prisma generate && pnpm run build
EXPOSE 3000
CMD ["pnpm", "run", "start"]
