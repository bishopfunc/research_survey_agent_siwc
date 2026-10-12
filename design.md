# Survey Studio デザインシステム

## 方針

Hallmarkによるstudied-DNAのapp設計。[ResearchRabbit](https://www.researchrabbit.ai/)を参考にした探索型の画面で、白い作業面・パステルの種類色・丸いカード・ピル型の操作・青の主操作を使う。原サイトのロゴ、文章、画像は複製しない。詳細は [0009](docs/design/0009-researchrabbit-ui.md)。

## 画面の構成

- アプリ：Workbench（column browser）。左にコレクション（調査・branch）、上に時計アイコンの版の履歴（JSTの日時）とサンプル・新規調査・フォーク、中央にタブのコンテンツ（チュートリアル・課題・手法・論文・ナレッジ。「課題と手法」の表は2026-10-12に削除）、右に「詳細」と「チャット」のタブを持つパネル（詳細はつながり図と詳細、未選択時は課題ツリー。チャットはCodexへの依頼と結果の履歴とChatGPT風の最低限の経過表示。変更案は要約（3行）・「N件の変更」・破棄・保存だけを出し、変更の一覧は閉じた状態から種類別にたどる。チャット・下書き・実行中や保存前の調査はコレクションごとに持ち、混ぜない。下に入力欄が1つで、空の調査は新規調査、それ以外は追加調査のPromptを使う）。検索欄は置かない。空の調査（新規調査）では、中央に入力欄と候補の依頼3つを出す。左のコレクション欄と右パネルは折りたためる。入力欄の下に「保存済みの論文を使う」スイッチ。課題ツリーの末尾に種類の凡例。境目をドラッグ（または矢印キー）で幅を変え、ダブルクリックで元に戻す。幅はこのブラウザに保存し、中央は420px以上を保つ。右パネルは全高の白い面で、区切りは左の1本の線だけ。
- 参入者向けの表示（[0014](docs/design/0014-expert-catch-up-survey.md)）：課題はカードと詳細に論文での英語表現と「達成度」（状態のチップ＋数値の一文）。手法タブは「手法ツリー」、課題タブは「課題ツリー」と一覧の切り替え。どちらも年を左から右、行ごとに系統、基→派生の矢印（同じ行で右へは直線、行をまたぐ・複数の系統は曲線）（[0022](docs/design/0022-timeline-trees.md)）。論文タブは「すべて」と「代表論文」の切り替え。要点の下に原文の出典。ナレッジは8分類すべてを出し、空は「見つからず」。論文の詳細は理解に必要な順（どんなもの→要点→理解に重要なFig（arXivの図）→アルゴリズム・数式（KaTeX）→代表Fig→アブストラクトの和訳と原文→主張と根拠→ナレッジ→書誌）。ナレッジは8分類の見出し、SOTAは時点つき。論文タブの上に「引用数を更新」（OpenAlex、取得元と日付つき）。チャットの末尾に追加調査の候補3つ（押すと入力欄へ）。空の状態は「未調査」「要点 未作成」「未分類」の短いラベルで示す。
- 画面に説明文（使い方・読み方の解説、キャッチコピー、補足の注記）や件数のチップを置かない。状態（過去の版、エラー）は短いラベルで示し、解説はLabと文書に置く。版はタイムスタンプで表す。
- Lab：同じtokensを使い、Agent PromptとDSLの仕組みを説明する画面。長い説明は段落に分け、一覧は題を先に見せて詳細は開いて読む。UIの説明は置かない。
- 操作・保存・認証・DSL契約はデザイン変更と切り離す。機能を削除しない。

## 文字・色・操作

見出し・ブランド・数値はPlus Jakarta Sans（600〜800）、本文と操作はIBM Plex Sans。日本語は端末のゴシックへフォールバックする。フォントは `@fontsource` でローカル配信する。

色はOKLCH。主操作と選択は青（accent）、面は白と淡い青灰。情報の種類はパステルで区別する：課題=peach、手法=turquoise、論文=lavender、主張=green、根拠=yellow、分野=sky。濃い文字を淡い色の上に置き、パステルを文字色に使わない。色だけで意味を伝えず、ラベルや凡例を添える。色・font-familyは必ずtokensを参照する。

カードは丸角14px・大きな面は20px、ボタン・タブ・チップはピル型。影は弱く、hoverで少し強める。選択はaccentの枠と淡い輪。hover・focus・disabled・errorを区別し、focusリングは即時に出す。動きはtransformと色の短い遷移だけ。`prefers-reduced-motion` で止める。

閉じる・削除は共通の `CloseIcon`（24pxグリッドに丸端の線2本の×）を、丸いhover面のアイコンボタンで出す。文字の「×」は使わない。削除はhoverでerrorの淡い面、暗い通知の上では白の半透明の面。Codexの取消は停止アイコンだけの丸いボタン（文字なし、読み上げ名は「取消」）で、経過の文の1行目と中心を揃える。押したときは少し縮める。

320/375/414/768pxで横溢れを確認する。表・系譜図だけが領域内で横スクロールする。狭い画面ではサイドバーを上部の横並びにし、詳細は一覧の下へ回す。

## Exports

### tokens.css

```css
/* Hallmark · genre: playful · macrostructure: Workbench (column browser) · designed-as-app
 * theme: studied-DNA (source: https://www.researchrabbit.ai/) · studied: yes · DNA-source: url
 * observed-fonts: Plus Jakarta Sans + Open Sans · observed-accent: #2962ff · pastel lavender/turquoise/green/peach
 * build: Plus Jakarta Sans + IBM Plex Sans · paper oklch(97.8% .006 255) · accent oklch(52% .22 266)
 * nav: N3 side-rail (collections) · trail: version history · footer: none · enrichment: connection map from survey data
 * pre-emit critique: P4 H4 E4 S4 R4 V4 · design-system: design.md
 */
:root {
  --color-paper: oklch(97.8% .006 255);
  --color-surface: oklch(100% 0 0);
  --color-ink: oklch(22% .012 265);
  --color-muted: oklch(48% .025 255);
  --color-faint: oklch(56% .02 255);
  --color-line: oklch(92.5% .012 255);
  --color-line-strong: oklch(80% .02 255);
  --color-accent: oklch(52% .22 266);
  --color-accent-hover: oklch(44% .19 264);
  --color-accent-soft: oklch(95.5% .025 268);
  --color-accent-ink: oklch(100% 0 0);
  --color-brand: var(--color-accent);
  --color-brand-soft: var(--color-accent-soft);
  --color-lavender: oklch(72% .09 288);
  --color-lavender-soft: oklch(94% .022 288);
  --color-turquoise: oklch(82% .1 200);
  --color-turquoise-soft: oklch(95.5% .03 200);
  --color-green: oklch(82% .13 145);
  --color-green-soft: oklch(95.5% .035 145);
  --color-peach: oklch(78% .11 55);
  --color-peach-soft: oklch(95% .03 55);
  --color-yellow: oklch(87% .14 88);
  --color-yellow-soft: oklch(96.5% .045 92);
  --color-rose: oklch(80% .09 10);
  --color-rose-soft: oklch(95.5% .025 10);
  --color-sky: oklch(82% .07 268);
  --color-sky-soft: oklch(95% .02 268);
  --color-dot-ring: oklch(22% .012 265 / .28);
  --color-code: oklch(24% .015 265);
  --color-code-ink: oklch(95% .006 255);
  --color-success: oklch(42% .09 150);
  --color-success-soft: oklch(95.5% .035 145);
  --color-error: oklch(46% .15 28);
  --color-error-soft: oklch(96% .025 28);
  --color-shadow: oklch(22% .012 265 / .07);
  --color-shadow-strong: oklch(22% .012 265 / .14);
  --color-backdrop: oklch(22% .012 265 / .32);
  --color-on-dark-hover: oklch(100% 0 0 / .12);
  --color-transparent: transparent;
  --gradient-brand: linear-gradient(135deg, var(--color-lavender-soft) 15%, var(--color-turquoise-soft) 55%, var(--color-green-soft));
  --font-display: 'Plus Jakarta Sans', 'Hiragino Sans', 'Hiragino Kaku Gothic ProN', 'Noto Sans JP', sans-serif;
  --font-body: 'IBM Plex Sans', 'Hiragino Sans', 'Hiragino Kaku Gothic ProN', 'Noto Sans JP', sans-serif;
  --font-prose: var(--font-body);
  --font-code: ui-monospace, SFMono-Regular, monospace;
  --space-1: 4px;
  --space-2: 8px;
  --space-3: 12px;
  --space-4: 16px;
  --space-5: 24px;
  --space-6: 32px;
  --space-7: 48px;
  --space-8: 72px;
  --space-sm: var(--space-4);
  --space-md: var(--space-5);
  --space-lg: var(--space-6);
  --space-xl: var(--space-7);
  --text-small: 12px;
  --text-caption: 13px;
  --text-body: 14px;
  --text-heading: 20px;
  --text-display: clamp(24px, 2.4vw, 32px);
  --radius-small: 8px;
  --radius-panel: 14px;
  --radius-large: 20px;
  --radius-pill: 999px;
  --rule-width: 1px;
  --shadow-card: 0 1px 2px var(--color-shadow), 0 4px 14px var(--color-shadow);
  --shadow-raised: 0 2px 5px var(--color-shadow-strong), 0 10px 30px var(--color-shadow);
  --ease-out: cubic-bezier(.16,1,.3,1);
  --ease-in: cubic-bezier(.4,0,1,1);
  --ease-in-out: cubic-bezier(.4,0,.2,1);
  --ease-standard: var(--ease-out);
  --dur-fast: 120ms;
}
```

### Tailwind v4 @theme

```css
@theme {
  --color-paper: oklch(97.8% .006 255);
  --color-surface: oklch(100% 0 0);
  --color-ink: oklch(22% .012 265);
  --color-muted: oklch(48% .025 255);
  --color-faint: oklch(56% .02 255);
  --color-line: oklch(92.5% .012 255);
  --color-line-strong: oklch(80% .02 255);
  --color-accent: oklch(52% .22 266);
  --color-accent-hover: oklch(44% .19 264);
  --color-accent-soft: oklch(95.5% .025 268);
  --color-accent-ink: oklch(100% 0 0);
  --color-brand: var(--color-accent);
  --color-brand-soft: var(--color-accent-soft);
  --color-lavender: oklch(72% .09 288);
  --color-lavender-soft: oklch(94% .022 288);
  --color-turquoise: oklch(82% .1 200);
  --color-turquoise-soft: oklch(95.5% .03 200);
  --color-green: oklch(82% .13 145);
  --color-green-soft: oklch(95.5% .035 145);
  --color-peach: oklch(78% .11 55);
  --color-peach-soft: oklch(95% .03 55);
  --color-yellow: oklch(87% .14 88);
  --color-yellow-soft: oklch(96.5% .045 92);
  --color-rose: oklch(80% .09 10);
  --color-rose-soft: oklch(95.5% .025 10);
  --color-sky: oklch(82% .07 268);
  --color-sky-soft: oklch(95% .02 268);
  --color-dot-ring: oklch(22% .012 265 / .28);
  --color-code: oklch(24% .015 265);
  --color-code-ink: oklch(95% .006 255);
  --color-success: oklch(42% .09 150);
  --color-success-soft: oklch(95.5% .035 145);
  --color-error: oklch(46% .15 28);
  --color-error-soft: oklch(96% .025 28);
  --color-shadow: oklch(22% .012 265 / .07);
  --color-shadow-strong: oklch(22% .012 265 / .14);
  --color-backdrop: oklch(22% .012 265 / .32);
  --color-on-dark-hover: oklch(100% 0 0 / .12);
  --color-transparent: transparent;
  --font-display: 'Plus Jakarta Sans', 'Hiragino Sans', 'Hiragino Kaku Gothic ProN', 'Noto Sans JP', sans-serif;
  --font-body: 'IBM Plex Sans', 'Hiragino Sans', 'Hiragino Kaku Gothic ProN', 'Noto Sans JP', sans-serif;
  --font-prose: var(--font-body);
  --font-code: ui-monospace, SFMono-Regular, monospace;
  --text-small: 12px;
  --text-caption: 13px;
  --text-body: 14px;
  --text-heading: 20px;
  --text-display: clamp(24px, 2.4vw, 32px);
  --radius-small: 8px;
  --radius-panel: 14px;
  --radius-large: 20px;
  --radius-pill: 999px;
  --shadow-card: 0 1px 2px var(--color-shadow), 0 4px 14px var(--color-shadow);
  --shadow-raised: 0 2px 5px var(--color-shadow-strong), 0 10px 30px var(--color-shadow);
  --ease-out: cubic-bezier(.16,1,.3,1);
  --ease-in: cubic-bezier(.4,0,1,1);
  --ease-in-out: cubic-bezier(.4,0,.2,1);
  --ease-standard: var(--ease-out);
}
```

### DTCG tokens.json

```json
{
  "color-paper": {
    "$value": "oklch(97.8% .006 255)",
    "$type": "color"
  },
  "color-surface": {
    "$value": "oklch(100% 0 0)",
    "$type": "color"
  },
  "color-ink": {
    "$value": "oklch(22% .012 265)",
    "$type": "color"
  },
  "color-muted": {
    "$value": "oklch(48% .025 255)",
    "$type": "color"
  },
  "color-faint": {
    "$value": "oklch(56% .02 255)",
    "$type": "color"
  },
  "color-line": {
    "$value": "oklch(92.5% .012 255)",
    "$type": "color"
  },
  "color-line-strong": {
    "$value": "oklch(80% .02 255)",
    "$type": "color"
  },
  "color-accent": {
    "$value": "oklch(52% .22 266)",
    "$type": "color"
  },
  "color-accent-hover": {
    "$value": "oklch(44% .19 264)",
    "$type": "color"
  },
  "color-accent-soft": {
    "$value": "oklch(95.5% .025 268)",
    "$type": "color"
  },
  "color-accent-ink": {
    "$value": "oklch(100% 0 0)",
    "$type": "color"
  },
  "color-brand": {
    "$value": "var(--color-accent)",
    "$type": "color"
  },
  "color-brand-soft": {
    "$value": "var(--color-accent-soft)",
    "$type": "color"
  },
  "color-lavender": {
    "$value": "oklch(72% .09 288)",
    "$type": "color"
  },
  "color-lavender-soft": {
    "$value": "oklch(94% .022 288)",
    "$type": "color"
  },
  "color-turquoise": {
    "$value": "oklch(82% .1 200)",
    "$type": "color"
  },
  "color-turquoise-soft": {
    "$value": "oklch(95.5% .03 200)",
    "$type": "color"
  },
  "color-green": {
    "$value": "oklch(82% .13 145)",
    "$type": "color"
  },
  "color-green-soft": {
    "$value": "oklch(95.5% .035 145)",
    "$type": "color"
  },
  "color-peach": {
    "$value": "oklch(78% .11 55)",
    "$type": "color"
  },
  "color-peach-soft": {
    "$value": "oklch(95% .03 55)",
    "$type": "color"
  },
  "color-yellow": {
    "$value": "oklch(87% .14 88)",
    "$type": "color"
  },
  "color-yellow-soft": {
    "$value": "oklch(96.5% .045 92)",
    "$type": "color"
  },
  "color-rose": {
    "$value": "oklch(80% .09 10)",
    "$type": "color"
  },
  "color-rose-soft": {
    "$value": "oklch(95.5% .025 10)",
    "$type": "color"
  },
  "color-sky": {
    "$value": "oklch(82% .07 268)",
    "$type": "color"
  },
  "color-sky-soft": {
    "$value": "oklch(95% .02 268)",
    "$type": "color"
  },
  "color-dot-ring": {
    "$value": "oklch(22% .012 265 / .28)",
    "$type": "color"
  },
  "color-code": {
    "$value": "oklch(24% .015 265)",
    "$type": "color"
  },
  "color-code-ink": {
    "$value": "oklch(95% .006 255)",
    "$type": "color"
  },
  "color-success": {
    "$value": "oklch(42% .09 150)",
    "$type": "color"
  },
  "color-success-soft": {
    "$value": "oklch(95.5% .035 145)",
    "$type": "color"
  },
  "color-error": {
    "$value": "oklch(46% .15 28)",
    "$type": "color"
  },
  "color-error-soft": {
    "$value": "oklch(96% .025 28)",
    "$type": "color"
  },
  "color-shadow": {
    "$value": "oklch(22% .012 265 / .07)",
    "$type": "color"
  },
  "color-shadow-strong": {
    "$value": "oklch(22% .012 265 / .14)",
    "$type": "color"
  },
  "color-backdrop": {
    "$value": "oklch(22% .012 265 / .32)",
    "$type": "color"
  },
  "color-on-dark-hover": {
    "$value": "oklch(100% 0 0 / .12)",
    "$type": "color"
  },
  "color-transparent": {
    "$value": "transparent",
    "$type": "color"
  },
  "gradient-brand": {
    "$value": "linear-gradient(135deg, var(--color-lavender-soft) 15%, var(--color-turquoise-soft) 55%, var(--color-green-soft))",
    "$type": "gradient"
  },
  "font-display": {
    "$value": "'Plus Jakarta Sans', 'Hiragino Sans', 'Hiragino Kaku Gothic ProN', 'Noto Sans JP', sans-serif",
    "$type": "fontFamily"
  },
  "font-body": {
    "$value": "'IBM Plex Sans', 'Hiragino Sans', 'Hiragino Kaku Gothic ProN', 'Noto Sans JP', sans-serif",
    "$type": "fontFamily"
  },
  "font-prose": {
    "$value": "var(--font-body)",
    "$type": "fontFamily"
  },
  "font-code": {
    "$value": "ui-monospace, SFMono-Regular, monospace",
    "$type": "fontFamily"
  },
  "space-1": {
    "$value": "4px",
    "$type": "dimension"
  },
  "space-2": {
    "$value": "8px",
    "$type": "dimension"
  },
  "space-3": {
    "$value": "12px",
    "$type": "dimension"
  },
  "space-4": {
    "$value": "16px",
    "$type": "dimension"
  },
  "space-5": {
    "$value": "24px",
    "$type": "dimension"
  },
  "space-6": {
    "$value": "32px",
    "$type": "dimension"
  },
  "space-7": {
    "$value": "48px",
    "$type": "dimension"
  },
  "space-8": {
    "$value": "72px",
    "$type": "dimension"
  },
  "space-sm": {
    "$value": "var(--space-4)",
    "$type": "dimension"
  },
  "space-md": {
    "$value": "var(--space-5)",
    "$type": "dimension"
  },
  "space-lg": {
    "$value": "var(--space-6)",
    "$type": "dimension"
  },
  "space-xl": {
    "$value": "var(--space-7)",
    "$type": "dimension"
  },
  "text-small": {
    "$value": "12px",
    "$type": "dimension"
  },
  "text-caption": {
    "$value": "13px",
    "$type": "dimension"
  },
  "text-body": {
    "$value": "14px",
    "$type": "dimension"
  },
  "text-heading": {
    "$value": "20px",
    "$type": "dimension"
  },
  "text-display": {
    "$value": "clamp(24px, 2.4vw, 32px)",
    "$type": "dimension"
  },
  "radius-small": {
    "$value": "8px",
    "$type": "dimension"
  },
  "radius-panel": {
    "$value": "14px",
    "$type": "dimension"
  },
  "radius-large": {
    "$value": "20px",
    "$type": "dimension"
  },
  "radius-pill": {
    "$value": "999px",
    "$type": "dimension"
  },
  "rule-width": {
    "$value": "1px",
    "$type": "dimension"
  },
  "shadow-card": {
    "$value": "0 1px 2px var(--color-shadow), 0 4px 14px var(--color-shadow)",
    "$type": "shadow"
  },
  "shadow-raised": {
    "$value": "0 2px 5px var(--color-shadow-strong), 0 10px 30px var(--color-shadow)",
    "$type": "shadow"
  },
  "ease-out": {
    "$value": "cubic-bezier(.16,1,.3,1)",
    "$type": "cubicBezier"
  },
  "ease-in": {
    "$value": "cubic-bezier(.4,0,1,1)",
    "$type": "cubicBezier"
  },
  "ease-in-out": {
    "$value": "cubic-bezier(.4,0,.2,1)",
    "$type": "cubicBezier"
  },
  "ease-standard": {
    "$value": "var(--ease-out)",
    "$type": "cubicBezier"
  },
  "dur-fast": {
    "$value": "120ms",
    "$type": "duration"
  }
}
```

### shadcn/ui CSS variables

```css
:root {
  --background: var(--color-paper);
  --foreground: var(--color-ink);
  --card: var(--color-surface);
  --card-foreground: var(--color-ink);
  --primary: var(--color-accent);
  --primary-foreground: var(--color-accent-ink);
  --secondary: var(--color-turquoise-soft);
  --secondary-foreground: var(--color-ink);
  --muted: var(--color-sky-soft);
  --muted-foreground: var(--color-muted);
  --accent: var(--color-accent-soft);
  --accent-foreground: var(--color-accent);
  --destructive: var(--color-error);
  --border: var(--color-line);
  --input: var(--color-line-strong);
  --ring: var(--color-accent);
  --radius: var(--radius-panel);
}
```
