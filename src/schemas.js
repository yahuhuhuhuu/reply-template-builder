import { z } from "zod";

/**
 * テンプレ抽出結果のスキーマ。
 * Claude の Structured Outputs (output_config.format) にそのまま渡すため、
 * 「LLM に何を出させたいか」の定義がそのまま型定義になっている。
 */
export const TemplateSchema = z.object({
  name: z.string().describe("テンプレの名前（例: 見積依頼への回答）"),
  summary: z.string().describe("どんな問い合わせに使うテンプレかの1〜2文の説明"),
  styleGuide: z
    .array(z.string())
    .describe("サンプル群に共通する文体ルール（敬語レベル、段落構成、署名の扱いなど）"),
  variables: z
    .array(
      z.object({
        key: z
          .string()
          .describe("テンプレ本文の {{key}} と一致する識別子。半角英小文字とアンダースコアのみ"),
        label: z.string().describe("画面表示用の日本語ラベル"),
        description: z.string().describe("この変数に何を入れるかの説明"),
        example: z.string().describe("サンプルから取れた実際の値の例"),
        source: z
          .enum(["inquiry", "sender", "fixed", "manual"])
          .describe(
            "値の入手元。inquiry=問い合わせ文から読み取る / sender=送信者側の情報 / fixed=毎回ほぼ同じ / manual=人が判断して入力"
          ),
      })
    )
    .describe("テンプレ内の可変部分の一覧"),
  blocks: z
    .array(
      z.object({
        label: z.string().describe("このブロックの役割（例: 宛名、お礼、本題の回答、締め）"),
        kind: z
          .enum(["fixed", "variable", "conditional"])
          .describe(
            "fixed=全サンプルでほぼ同一の定型文 / variable=毎回書き換わる / conditional=一部のサンプルにのみ存在"
          ),
        text: z.string().describe("そのブロックのテンプレ文。可変箇所は {{key}} で表す"),
        condition: z
          .string()
          .describe("kind が conditional のとき、どんな場合に入れるか。それ以外は空文字"),
      })
    )
    .describe("回答文を構成するブロックを出現順に並べたもの"),
  templateText: z
    .string()
    .describe("blocks を連結した完成テンプレ全文。可変箇所は {{key}} 形式"),
  observations: z
    .array(z.string())
    .describe("サンプル間で揺れていた点や、テンプレ化にあたって統一した判断のメモ"),
});

/**
 * 下書き生成結果のスキーマ。
 * 「埋められなかった変数」を明示的に返させることで、
 * LLM が事実をでっち上げずに人間へエスカレーションできるようにしている。
 */
export const DraftSchema = z.object({
  subject: z.string().describe("メール件名の案"),
  draft: z.string().describe("テンプレに沿って生成した回答本文の下書き"),
  filled: z
    .array(
      z.object({
        key: z.string().describe("埋めた変数のキー"),
        value: z.string().describe("実際に埋めた値"),
        confidence: z
          .enum(["high", "medium", "low"])
          .describe("high=問い合わせ文に明記 / medium=文脈から妥当に推測 / low=仮置き"),
        basis: z.string().describe("その値にした根拠（問い合わせ文の該当箇所など）"),
      })
    )
    .describe("埋めた変数の一覧"),
  missing: z
    .array(
      z.object({
        key: z.string().describe("埋められなかった変数のキー"),
        label: z.string().describe("画面表示用ラベル"),
        question: z.string().describe("送信前に確認すべき内容を質問形式で"),
      })
    )
    .describe("情報が足りず埋められなかった変数。ここが空でなければ人間の確認が必要"),
  checklist: z.array(z.string()).describe("送信前に目視確認したい点"),
});
