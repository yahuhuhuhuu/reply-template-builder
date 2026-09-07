import path from "node:path";
import { fileURLToPath } from "node:url";

import express from "express";

// .env があれば読み込む（依存パッケージ不要 / Node 20.6+）
try {
  process.loadEnvFile();
} catch {
  // .env が無くても環境変数が直接設定されていれば動く
}

const { extractTemplate, generateDraft, isConfigured, modelName, toHttpError } =
  await import("./claude.js");
const { DEMO_SAMPLES, DEMO_INQUIRY } = await import("./samples.js");

const here = path.dirname(fileURLToPath(import.meta.url));
const app = express();

app.use(express.json({ limit: "1mb" }));
app.use(express.static(path.join(here, "..", "public")));

const MAX_SAMPLES = 5;
const MAX_CHARS = 8000;

/** リクエストボディの検証はサーバ側で完結させる（フロントの検証は UX のためのもの）。 */
function badRequest(message) {
  const err = new Error(message);
  err.status = 400;
  return err;
}

function validateSamples(raw) {
  if (!Array.isArray(raw)) throw badRequest("samples は配列で送ってください。");

  const samples = raw
    .map((s) => ({
      inquiry: typeof s?.inquiry === "string" ? s.inquiry.trim() : "",
      reply: typeof s?.reply === "string" ? s.reply.trim() : "",
    }))
    .filter((s) => s.reply.length > 0);

  if (samples.length < 2) {
    throw badRequest("共通構造を抽出するには、回答文サンプルが2件以上必要です。");
  }
  if (samples.length > MAX_SAMPLES) {
    throw badRequest(`サンプルは最大${MAX_SAMPLES}件までです。`);
  }
  for (const s of samples) {
    if (s.reply.length > MAX_CHARS || s.inquiry.length > MAX_CHARS) {
      throw badRequest(`1件あたり${MAX_CHARS}文字以内にしてください。`);
    }
  }
  return samples;
}

app.get("/api/health", (_req, res) => {
  res.json({ ok: true, apiKeyConfigured: isConfigured(), model: modelName() });
});

app.get("/api/demo", (_req, res) => {
  res.json({ samples: DEMO_SAMPLES, inquiry: DEMO_INQUIRY });
});

// 1) 過去サンプル -> テンプレ（共通構造の抽出）
app.post("/api/extract", async (req, res, next) => {
  try {
    const samples = validateSamples(req.body?.samples);
    const hint = typeof req.body?.hint === "string" ? req.body.hint : "";
    res.json(await extractTemplate({ samples, hint }));
  } catch (err) {
    next(err);
  }
});

// 2) テンプレ + 新規問い合わせ -> 回答下書き
app.post("/api/generate", async (req, res, next) => {
  try {
    const { template, inquiry, note } = req.body ?? {};
    if (!template || typeof template !== "object" || !Array.isArray(template.blocks)) {
      throw badRequest("template が不正です。先にテンプレを抽出してください。");
    }
    if (typeof inquiry !== "string" || inquiry.trim().length === 0) {
      throw badRequest("新しい問い合わせ内容を入力してください。");
    }
    if (inquiry.length > MAX_CHARS) {
      throw badRequest(`問い合わせは${MAX_CHARS}文字以内にしてください。`);
    }
    res.json(
      await generateDraft({
        template,
        inquiry,
        note: typeof note === "string" ? note : "",
      })
    );
  } catch (err) {
    next(err);
  }
});

// eslint-disable-next-line no-unused-vars -- Express のエラーハンドラは4引数必須
app.use((err, _req, res, _next) => {
  const { status, message } = toHttpError(err);
  if (status >= 500) console.error(err);
  res.status(status).json({ error: message });
});

const port = Number(process.env.PORT) || 3000;
app.listen(port, () => {
  console.log(`reply-template-builder listening on http://localhost:${port}`);
  console.log(`  model: ${modelName()}`);
  if (!isConfigured()) {
    console.warn("  [warn] ANTHROPIC_API_KEY が未設定です。.env を作成してください。");
  }
});
