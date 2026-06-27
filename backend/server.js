// ============================================================
// Stock Analyzer Backend
// 從 MinIO 下載 Parquet，用 DuckDB 查詢，回傳 JSON 給前端
// ============================================================

const express = require("express");
const cors = require("cors");
const Minio = require("minio");
const duckdb = require("duckdb");
const fs = require("fs");
const path = require("path");
const os = require("os");

const app = express();
app.use(cors());

// =============================
// MinIO 連線設定
// =============================
const minioClient = new Minio.Client({
  endPoint:  process.env.MINIO_ENDPOINT  || "minio",
  port:      Number(process.env.MINIO_PORT) || 9000,
  useSSL:    false,
  accessKey: process.env.MINIO_ACCESS_KEY || "minioadmin",
  secretKey: process.env.MINIO_SECRET_KEY || "minioadmin",
});

const BUCKET = "us-stock";
const OBJECT = "stock/history/prices/gold/final_all/us_all_prices.parquet";
const TMP_PATH = path.join(os.tmpdir(), "us_all_prices.parquet");

// =============================
// 工具：從 MinIO 下載 Parquet 到暫存
// 用 ETag 比對，只有檔案變動才重新下載
// =============================
let cachedEtag = null;

async function downloadParquet() {
  try {
    const stat = await minioClient.statObject(BUCKET, OBJECT);

    if (fs.existsSync(TMP_PATH) && stat.etag === cachedEtag) {
      console.log("Parquet unchanged (ETag match), using cache.");
      return TMP_PATH;
    }

    console.log(`ETag changed (${cachedEtag} → ${stat.etag}), re-downloading...`);
    await new Promise((resolve, reject) => {
      minioClient.fGetObject(BUCKET, OBJECT, TMP_PATH, (err) => {
        if (err) reject(err);
        else resolve();
      });
    });

    cachedEtag = stat.etag;
    console.log("Download complete:", TMP_PATH);
    return TMP_PATH;

  } catch (err) {
    // statObject 失敗（MinIO 暫時不通等）→ 如果本地有舊檔就繼續用，否則拋錯
    if (fs.existsSync(TMP_PATH)) {
      console.warn("statObject failed, falling back to cached file:", err.message);
      return TMP_PATH;
    }
    throw err;
  }
}

// =============================
// 工具：用 DuckDB 執行 SQL 查詢
// =============================
function queryDuck(sql, params = []) {
  return new Promise(async (resolve, reject) => {
    try {
      const tmpPath = await downloadParquet();
      const db = new duckdb.Database(":memory:");
      const conn = db.connect();

      // 將 __FILE__ 替換為實際路徑
      const finalSql = sql.replace(/__FILE__/g, tmpPath);

      conn.all(finalSql, ...params, (err, rows) => {
        conn.close();
        db.close();
        if (err) reject(err);
        else resolve(rows);
      });
    } catch (err) {
      reject(err);
    }
  });
}

// =============================
// 工具：Date 欄位格式化 YYYY-MM-DD
// 避免 JSON 自動轉 UTC 造成日期偏移
// =============================
function formatRows(rows) {
  return rows.map((row) => {
    if (!row.Date) return row;
    const d = new Date(row.Date);
    const yyyy = d.getFullYear();
    const mm   = String(d.getMonth() + 1).padStart(2, "0");
    const dd   = String(d.getDate()).padStart(2, "0");
    return { ...row, Date: `${yyyy}-${mm}-${dd}` };
  });
}

// ===================================================
// API 1：取得所有 ticker 清單
// GET /api/tickers
// 用途：給前端 dropdown 使用
// ===================================================
app.get("/api/tickers", async (req, res) => {
  try {
    const rows = await queryDuck(`
      SELECT DISTINCT ticker
      FROM read_parquet('__FILE__')
      ORDER BY ticker
    `);
    res.json(rows);
  } catch (err) {
    console.error("Ticker API Error:", err);
    res.status(500).json({ error: "DuckDB Error" });
  }
});

// ===================================================
// API 2：取得指定 ticker + period 資料
// GET /api/stock?ticker=MSFT&period=D
// GET /api/stock/MSFT/D
// ===================================================
app.get(["/api/stock", "/api/stock/:ticker/:period"], async (req, res) => {
  const ticker = req.query.ticker || req.params.ticker;
  const period = req.query.period || req.params.period;

  if (!ticker) return res.status(400).json({ error: "Ticker required" });
  if (!period) return res.status(400).json({ error: "Period required" });

  const allowedPeriods = ["D", "W", "2W", "3W", "ME", "2ME", "3ME"];
  if (!allowedPeriods.includes(period)) {
    return res.status(400).json({ error: "Invalid period" });
  }

  try {
    const rows = await queryDuck(
      `
      SELECT *
      FROM read_parquet('__FILE__')
      WHERE ticker = ?
        AND period = ?
      ORDER BY "Date"
      `,
      [ticker, period]
    );
    res.json(formatRows(rows));
  } catch (err) {
    console.error("Stock API Error:", err);
    res.status(500).json({ error: "DuckDB Error" });
  }
});

// ===================================================
// 啟動伺服器
// ===================================================
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`Backend running on port ${PORT}`);
});