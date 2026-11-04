# 零依赖项目，不需要 npm install
FROM node:22-alpine

WORKDIR /app

COPY server.mjs ./
COPY public ./public

# 数据目录（用户、地图、头像）。部署时请挂载持久化磁盘到这个路径，
# 否则容器重启数据会丢失。
RUN mkdir -p /app/data/avatars

ENV PORT=8080
EXPOSE 8080

VOLUME ["/app/data"]

CMD ["node", "server.mjs"]
