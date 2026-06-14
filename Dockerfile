# 開發環境用 — hot reload，搭配 VS Code Dev Container
# 生產環境請改用 Dockerfile.prod（build 靜態檔 + Nginx）

FROM node:20-alpine

WORKDIR /app

# 安裝 live-server（熱更新工具，偵測檔案變更自動刷新瀏覽器）
RUN npm install -g live-server

EXPOSE 8080

# 啟動時監聽 /app/src 目錄，0.0.0.0 讓 container 外部可連進來
CMD ["live-server", "src", "--port=8070", "--host=0.0.0.0", "--no-browser"]