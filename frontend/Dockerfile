FROM node:22-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN corepack enable && pnpm install
COPY . .
RUN pnpm run build

FROM nginx:1.27-alpine
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 80
