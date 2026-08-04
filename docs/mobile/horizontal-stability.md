# Astera Horizontal Stability — Private Development Note

> 内部開発用。Web／Tablet／Android／iOSでPage全体が横に揺れる、横へ移動する、不要な横Scrollbarが出る問題を禁止する正本。

## 1. 不変条件

- Document全体のHorizontal Scrollを禁止する。
- Drawer、Dialog、Toast、固定Button、Transform AnimationをViewport外幅の発生源にしない。
- iOS Visual Viewportの移動、Keyboard、Pinch ZoomをLayout Width判定へ直接使わない。
- DesktopでVertical Scrollbarが出入りしても横位置を変えない。
- 長いURL、ID、Error Code、API Key表示、Code、Table、ChipがDocument幅を拡張しない。
- 必須操作を横Scrollしないと押せない配置にしない。
- 特定機種名やUser-Agentによる補正を行わない。

## 2. Source実装

### Stable Layout Width

`src/device-compatibility.ts`

- 横Layout幅：`document.documentElement.clientWidth`
- 縦表示領域：`VisualViewport.height`
- Layout幅、Viewport高さ、Offset、Scrollbar幅は値が変わった場合だけCSS Variableへ反映する。
- iOS KeyboardやVisual Viewport Scrollによる同一値の再書込みを防止する。

### Horizontal Guard

`src/horizontal-stability.css`

- `html`、`body`、`#root`を`max-width:100%`へ固定する。
- Legacy Engineは`overflow-x:hidden`、対応Engineは`overflow-x:clip`を使用する。
- `overscroll-behavior-x:none`で横方向のOverscrollを抑制する。
- `scrollbar-gutter:stable`でVertical Scrollbar出現時の横ズレを抑制する。
- AppShell、Canonical Shell、Public Page、CheckoutをViewport幅内へ固定する。
- Flex／Gridの子要素へ`min-width:0`を適用する。
- Mobile Drawerは`--app-layout-width`から計算し、Raw `100vw`へ依存しない。
- Dialog、Toast、Jump ButtonをViewport内へ制限する。
- Chip列はHorizontal Scrollではなく折返し表示にする。
- 長いURL、Code、Table Cellは折返し表示にする。

## 3. Browser Regression Test

`tests/horizontal-stability.spec.ts`

WebKit／Chromiumの全Device Projectで次を検査する。

1. Horizontal Wheel操作後も`window.scrollX`、Document／Body `scrollLeft`が0。
2. Mobile Drawerの開閉前後でDocument幅がViewportを超えない。
3. 非改行の長いURL／Codeを挿入してもPage幅が増えない。
4. 12個の長いChipが折り返され、内部Horizontal Scrollerも発生しない。
5. Vertical Scrollbar出現前後でRootの左端が移動しない。
6. Viewport幅を変更して元へ戻してもRootが横へずれない。

既存`tests/device-matrix.spec.ts`では全43 Canonical Routeについて、Document `scrollWidth <= clientWidth + 2px`を検査する。

## 4. Static Gate

`scripts/device-matrix-audit.mjs`

次が欠けた場合はBuild前に失敗する。

- Horizontal Stability CSSが全Styleの最後に読み込まれること。
- Stable Layout Viewport Widthを使用すること。
- 同一Viewport値の再書込みを行わないこと。
- Root Horizontal Lock。
- `overflow-x:clip` Enhancement。
- Stable Scrollbar Gutter。
- DrawerのRaw `100vw`依存を上書きすること。
- Chip折返し。
- 長文折返し。
- Overlay幅制限。
- Table折返し。
- Wheel、Drawer、長文、Scrollbar、Viewport復帰Test。

## 5. 現在Evidence

```text
Source反映                       完了
Stable Layout Width TypeScript   Strict TypeScript合格
Horizontal Test TypeScript       Strict TypeScript構文合格
GitHub Actions実Run              未取得
WebKit／Chromium実結果           未取得
Android／iPhone／iPad実機        未実施
Production                       NO-GO
```

WorkflowやTest Sourceが存在することを実行合格とは扱わない。GitHub Actions Reportと実機Evidence取得前はProduction完成へ昇格しない。
