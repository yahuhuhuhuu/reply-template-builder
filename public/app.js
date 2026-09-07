const $ = (id) => document.getElementById(id);

const state = {
  template: null,
  draft: null,
};

/* ---------- 共通ユーティリティ ---------- */

function setStatus(text, isError = false) {
  const el = $("status");
  el.textContent = text;
  el.classList.toggle("error", isError);
}

function setBusy(button, noteEl, busy, label) {
  button.disabled = busy;
  noteEl.textContent = "";
  if (busy) {
    const spinner = document.createElement("span");
    spinner.className = "spinner";
    noteEl.append(spinner, label);
  }
}

function unlock(section) {
  section.classList.remove("is-locked");
  section.removeAttribute("aria-disabled");
}

async function postJSON(url, body) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `リクエストに失敗しました (${res.status})`);
  return data;
}

/** {{key}} をハイライト付きで描画する。textContent 経由なので XSS の心配がない。 */
function renderTemplateText(container, text) {
  container.textContent = "";
  const re = /\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g;
  let last = 0;
  let m;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) container.append(text.slice(last, m.index));
    const span = document.createElement("span");
    span.className = "var-token";
    span.textContent = m[1];
    span.title = `変数: ${m[1]}`;
    container.append(span);
    last = m.index + m[0].length;
  }
  if (last < text.length) container.append(text.slice(last));
}

function fillList(ul, items) {
  ul.textContent = "";
  for (const item of items ?? []) {
    const li = document.createElement("li");
    li.textContent = item;
    ul.append(li);
  }
}

async function copyToClipboard(text, button) {
  try {
    await navigator.clipboard.writeText(text);
    const original = button.textContent;
    button.textContent = "コピーしました";
    setTimeout(() => {
      button.textContent = original;
    }, 1500);
  } catch {
    setStatus("クリップボードにアクセスできませんでした。手動でコピーしてください。", true);
  }
}

/* ---------- STEP 1: サンプル入力欄 ---------- */

function labeledTextarea(labelText, className, rows, placeholder, value) {
  const label = document.createElement("label");
  label.className = "field";

  const span = document.createElement("span");
  span.className = "field-label";
  span.textContent = labelText;

  const textarea = document.createElement("textarea");
  textarea.rows = rows;
  textarea.className = className;
  textarea.placeholder = placeholder;
  textarea.value = value ?? "";

  label.append(span, textarea);
  return label;
}

function addSampleField(values = {}) {
  const wrapper = document.createElement("div");
  wrapper.className = "sample";

  const head = document.createElement("div");
  head.className = "sample-head";

  const title = document.createElement("h3");

  const remove = document.createElement("button");
  remove.type = "button";
  remove.className = "link-danger";
  remove.textContent = "削除";
  remove.addEventListener("click", () => {
    wrapper.remove();
    renumberSamples();
  });

  head.append(title, remove);

  wrapper.append(
    head,
    labeledTextarea(
      "元の問い合わせ（任意・あると精度が上がります）",
      "sample-inquiry",
      3,
      "届いた問い合わせ文",
      values.inquiry
    ),
    labeledTextarea(
      "実際に送った回答文（必須）",
      "sample-reply",
      7,
      "過去に送った回答メール本文",
      values.reply
    )
  );

  $("samples").append(wrapper);
  renumberSamples();
}

function renumberSamples() {
  document.querySelectorAll("#samples .sample h3").forEach((h, i) => {
    h.textContent = `サンプル ${i + 1}`;
  });
}

function collectSamples() {
  return [...document.querySelectorAll("#samples .sample")].map((el) => ({
    inquiry: el.querySelector(".sample-inquiry").value,
    reply: el.querySelector(".sample-reply").value,
  }));
}

/* ---------- STEP 2: テンプレ描画 ---------- */

const SOURCE_LABEL = {
  inquiry: "問い合わせから読み取る",
  sender: "送信者側の情報",
  fixed: "毎回ほぼ同じ",
  manual: "人が判断して入力",
};

function renderTemplate(template) {
  state.template = template;

  $("tpl-name").textContent = template.name;
  $("tpl-summary").textContent = template.summary;
  renderTemplateText($("tpl-text"), template.templateText);

  const blocks = $("tpl-blocks");
  blocks.textContent = "";
  for (const block of template.blocks ?? []) {
    const li = document.createElement("li");
    li.className = `k-${block.kind}`;

    const label = document.createElement("span");
    label.className = "b-label";
    label.textContent = block.label;
    li.append(label);

    if (block.kind === "conditional" && block.condition) {
      const cond = document.createElement("span");
      cond.className = "b-cond";
      cond.textContent = `条件: ${block.condition}`;
      li.append(cond);
    }

    const text = document.createElement("span");
    text.className = "b-text";
    text.textContent = block.text;
    li.append(text);

    blocks.append(li);
  }

  const vars = $("tpl-vars");
  vars.textContent = "";
  for (const v of template.variables ?? []) {
    const tr = document.createElement("tr");

    const keyCell = document.createElement("td");
    const code = document.createElement("code");
    code.textContent = `{{${v.key}}}`;
    keyCell.append(code, document.createElement("br"), v.label);

    const desc = document.createElement("td");
    desc.textContent = v.description;

    const source = document.createElement("td");
    source.textContent = SOURCE_LABEL[v.source] ?? v.source;

    const example = document.createElement("td");
    example.textContent = v.example;

    tr.append(keyCell, desc, source, example);
    vars.append(tr);
  }

  fillList($("tpl-style"), template.styleGuide);
  fillList($("tpl-notes"), template.observations);

  $("step2-empty").hidden = true;
  $("template-view").hidden = false;
  $("copy-template").hidden = false;
  unlock($("step2"));
  unlock($("step3"));
  $("generate").disabled = false;
}

/* ---------- STEP 3: 下書き描画 ---------- */

const CONF_LABEL = { high: "高", medium: "中", low: "低" };

function renderDraft(result) {
  state.draft = result;

  $("draft-subject").textContent = result.subject;
  $("draft-body").textContent = result.draft;

  const missing = result.missing ?? [];
  $("missing-box").hidden = missing.length === 0;
  fillList(
    $("draft-missing"),
    missing.map((m) => `${m.label}（{{${m.key}}}）: ${m.question}`)
  );

  const filled = $("draft-filled");
  filled.textContent = "";
  for (const f of result.filled ?? []) {
    const tr = document.createElement("tr");

    const keyCell = document.createElement("td");
    const code = document.createElement("code");
    code.textContent = `{{${f.key}}}`;
    keyCell.append(code);

    const value = document.createElement("td");
    value.textContent = f.value;

    const conf = document.createElement("td");
    conf.className = `conf conf-${f.confidence}`;
    conf.textContent = CONF_LABEL[f.confidence] ?? f.confidence;

    const basis = document.createElement("td");
    basis.textContent = f.basis;

    tr.append(keyCell, value, conf, basis);
    filled.append(tr);
  }

  fillList($("draft-checklist"), result.checklist);

  $("draft-view").hidden = false;
  $("copy-draft").hidden = false;
}

/* ---------- イベント配線 ---------- */

$("add-sample").addEventListener("click", () => addSampleField());

$("load-demo").addEventListener("click", async () => {
  try {
    const res = await fetch("/api/demo");
    const { samples, inquiry } = await res.json();
    $("samples").textContent = "";
    samples.forEach((s) => addSampleField(s));
    $("new-inquiry").value = inquiry;
    setStatus("デモ用のサンプルを投入しました。");
  } catch {
    setStatus("サンプルの取得に失敗しました。", true);
  }
});

$("extract").addEventListener("click", async () => {
  const samples = collectSamples().filter((s) => s.reply.trim());
  if (samples.length < 2) {
    setStatus("回答文サンプルを2件以上入力してください。", true);
    return;
  }

  setStatus("");
  setBusy($("extract"), $("extract-note"), true, "共通構造を分析中…（30秒ほどかかります）");
  try {
    const { template, usage } = await postJSON("/api/extract", {
      samples,
      hint: $("hint").value,
    });
    renderTemplate(template);
    setStatus(
      `テンプレを抽出しました（変数 ${template.variables.length} 個 / ブロック ${template.blocks.length} 個・${usage.input_tokens ?? "?"}→${usage.output_tokens ?? "?"} tokens）`
    );
    $("step2").scrollIntoView({ behavior: "smooth", block: "start" });
  } catch (err) {
    setStatus(err.message, true);
  } finally {
    setBusy($("extract"), $("extract-note"), false);
  }
});

$("generate").addEventListener("click", async () => {
  if (!state.template) return;
  const inquiry = $("new-inquiry").value;
  if (!inquiry.trim()) {
    setStatus("新しい問い合わせ内容を入力してください。", true);
    return;
  }

  setStatus("");
  setBusy($("generate"), $("generate-note"), true, "下書きを生成中…");
  try {
    const { result } = await postJSON("/api/generate", {
      template: state.template,
      inquiry,
      note: $("new-note").value,
    });
    renderDraft(result);
    setStatus(
      result.missing.length
        ? `下書きを生成しました。確認が必要な項目が ${result.missing.length} 件あります。`
        : "下書きを生成しました。"
    );
  } catch (err) {
    setStatus(err.message, true);
  } finally {
    setBusy($("generate"), $("generate-note"), false);
  }
});

$("copy-template").addEventListener("click", (e) =>
  copyToClipboard(state.template?.templateText ?? "", e.currentTarget)
);
$("copy-draft").addEventListener("click", (e) =>
  copyToClipboard(state.draft?.draft ?? "", e.currentTarget)
);

/* ---------- 起動時 ---------- */

addSampleField();
addSampleField();

fetch("/api/health")
  .then((r) => r.json())
  .then((h) => {
    if (!h.apiKeyConfigured) {
      setStatus("ANTHROPIC_API_KEY が未設定です。.env を作成してサーバを再起動してください。", true);
    } else {
      setStatus(`model: ${h.model}`);
    }
  })
  .catch(() => setStatus("サーバに接続できませんでした。", true));
