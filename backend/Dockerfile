# 開發環境用 — Node.js backend，支援 nodemon 熱重載
# 改用 debian base，因為 duckdb 需要 glibc（alpine 不支援）

FROM node:20-slim

WORKDIR /app

# 先複製 package.json 安裝依賴（利用 Docker cache）
COPY package.json .
RUN npm install

# 複製程式碼
COPY server.js .

EXPOSE 5000

# 開發時用 nodemon（改 server.js 自動重啟）
CMD ["npm", "run", "dev"]