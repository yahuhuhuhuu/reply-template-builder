import Anthropic, {
  APIConnectionError,
  APIError,
  AuthenticationError,
  BadRequestError,
  RateLimitError,
} from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";

import { TemplateSchema, DraftSchema } from "./schemas.js";
import {
  EXTRACT_SYSTEM,
  GENERATE_SYSTEM,
  buildExtractUserMessage,
  buildGenerateUserMessage,
} from "./prompts.js";

const MODEL = process.env.ANTHROPIC_MODEL || "claude-opus-5";
const MAX_TOKENS = 16000;

let client = null;

/** APIキーが無い状態でもサーバ自体は起動できるよう、クライアントは遅延生成する。 */
function getClient() {
  if (!process.env.ANTHROPIC_API_KEY) {
    const err = new Error(
      "ANTHROPIC_API_KEY が設定されていません。.env.example をコピーして .env を作成してください。"
    );
    err.status = 503;
    throw err;
  }
  client ??= new Anthropic();
  return client;
}

export function isConfigured() {
  return Boolean(process.env.ANTHROPIC_API_KEY);
}

export function modelName() {
  return MODEL;
}

/** parse() が JSON を返せなかった場合に備えたガード。 */
function requireParsed(message, what) {
  if (!message.parsed_output) {
    const err = new Error(`${what}の構造化出力を解釈できませんでした。もう一度お試しください。`);
    err.status = 502;
    throw err;
  }
  return message.parsed_output;
}

function usageOf(message) {
  return {
    input_tokens: message.usage?.input_tokens ?? null,
    output_tokens: message.usage?.output_tokens ?? null,
  };
}

const PLACEHOLDER_RE = /\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g;

/**
 * 変数表とテンプレ本文のずれを検出して補正する。
 * スキーマは各フィールドの型しか保証しないため、
 * 「variables にあるのに本文に出てこない」といった不整合は通ってしまう。
 * 黙って直すと利用者が気付けないので、必ず observations に記録する。
 */
export function reconcileTemplate(template) {
  const usedKeys = new Set(
    [...String(template.templateText ?? "").matchAll(PLACEHOLDER_RE)].map((m) => m[1])
  );
  const declared = Array.isArray(template.variables) ? template.variables : [];
  const declaredKeys = new Set(declared.map((v) => v.key));

  const orphaned = declared.filter((v) => !usedKeys.has(v.key));
  const undeclared = [...usedKeys].filter((k) => !declaredKeys.has(k));

  const notes = [...(template.observations ?? [])];
  if (orphaned.length) {
    notes.push(
      `テンプレ本文に出現しない変数を一覧から除外しました: ${orphaned.map((v) => `{{${v.key}}}`).join(", ")}`
    );
  }
  if (undeclared.length) {
    notes.push(
      `本文にあるが説明のない変数があります: ${undeclared.map((k) => `{{${k}}}`).join(", ")}`
    );
  }

  return {
    ...template,
    variables: declared.filter((v) => usedKeys.has(v.key)),
    observations: notes,
  };
}

/** 複数サンプルから共通構造を抽出してテンプレ化する。 */
export async function extractTemplate({ samples, hint }) {
  const message = await getClient().messages.parse({
    model: MODEL,
    max_tokens: MAX_TOKENS,
    thinking: { type: "adaptive" },
    system: EXTRACT_SYSTEM,
    messages: [{ role: "user", content: buildExtractUserMessage(samples, hint) }],
    output_config: { format: zodOutputFormat(TemplateSchema) },
  });

  return {
    template: reconcileTemplate(requireParsed(message, "テンプレ抽出")),
    usage: usageOf(message),
  };
}

/** 確定したテンプレに沿って新しい問い合わせへの下書きを作る。 */
export async function generateDraft({ template, inquiry, note }) {
  const message = await getClient().messages.parse({
    model: MODEL,
    max_tokens: MAX_TOKENS,
    thinking: { type: "adaptive" },
    system: GENERATE_SYSTEM,
    messages: [
      { role: "user", content: buildGenerateUserMessage(template, inquiry, note) },
    ],
    output_config: { format: zodOutputFormat(DraftSchema) },
  });

  return { result: requireParsed(message, "下書き生成"), usage: usageOf(message) };
}

/** APIが返したエラー本文から、人間が読むべき一文だけを取り出す。 */
function apiMessage(err) {
  return err?.error?.error?.message || err?.message || "";
}

/** SDK の型付き例外を HTTP ステータス + 日本語メッセージに落とす。 */
export function toHttpError(err) {
  if (err instanceof AuthenticationError) {
    return { status: 401, message: "APIキーが無効です。ANTHROPIC_API_KEY を確認してください。" };
  }
  if (err instanceof RateLimitError) {
    return { status: 429, message: "APIのレート制限に達しました。少し待ってから再試行してください。" };
  }
  if (err instanceof BadRequestError) {
    const detail = apiMessage(err);
    // クレジット残高不足は 400 で返るが、原因も対処も他の 400 とはまったく別物なので分けて案内する
    if (/credit balance/i.test(detail)) {
      return {
        status: 402,
        message:
          "Anthropic APIのクレジット残高が不足しています。https://console.anthropic.com/settings/billing でクレジットを購入してください（Claude Pro/Maxのサブスクリプションとは別会計です）。",
      };
    }
    return { status: 400, message: `リクエストがAPIに拒否されました: ${detail}` };
  }
  if (err instanceof APIConnectionError) {
    return { status: 502, message: "Anthropic APIに接続できませんでした。ネットワークを確認してください。" };
  }
  if (err instanceof APIError) {
    return { status: err.status ?? 502, message: `APIエラー (${err.status}): ${apiMessage(err)}` };
  }
  return { status: err.status ?? 500, message: err.message || "サーバ内部エラーが発生しました。" };
}
