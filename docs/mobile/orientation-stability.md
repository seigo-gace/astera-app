# Astera Orientation Stability — Private Development Note

## 1. 目的

縦画面から横画面、横画面から縦画面へ変更したときに、表示・入力・Scroll・Navigation・Safe Areaを壊さず、途中のViewport変化を利用者へ見せない。

## 2. 回転時の必須動作

1. `matchMedia('(orientation: landscape)')`と`orientationchange`の両方で向き変更を検知する。
2. 回転開始時に`astera-rotating`を付与し、Layout Transitionを一時停止する。
3. Mobile Drawerなど一時NavigationをReactの実Click経由で閉じる。
4. Windowと主要Scroll Containerの縦位置を保存する。
5. 横Scroll位置は必ず0へ戻す。
6. 0ms／80ms／180ms／360msの4段階でViewportを再計算する。
7. 回転途中の通常`resize`は、確定先のOrientationを維持し、中間サイズで縦横Classを往復させない。
8. 最終PassでScroll位置を復元し、`astera-rotating`を解除する。
9. 入力値、選択内容、開いている内容Dialogは保持する。
10. Landscapeでは左右Safe Area、Short LandscapeではHeader・Composer・Dialog高さを再調整する。

## 3. Source

- `src/device-compatibility.ts`
  - Orientation Lifecycle
  - Staged Viewport Settlement
  - Scroll Snapshot／Restore
  - Drawer Closure
  - Horizontal Clamp
  - Lifecycle Event
- `src/orientation-stability.css`
  - Rotation中Transition停止
  - Landscape Safe Area
  - Short Landscape Layout
- `tests/horizontal-stability.spec.ts`
  - Portrait → Landscape → Portrait往復
  - Email／Password入力保持
  - Scroll位置保持
  - Horizontal Scroll 0
  - Drawer自動閉鎖
  - Orientation Event確認
- `scripts/device-matrix-audit.mjs`
  - Source・CSS・Test消失防止Gate

## 4. 禁止

- 回転時にPage Reloadしない。
- 入力内容や選択内容を初期化しない。
- `window.innerWidth`だけを1回読んで確定しない。
- 回転途中の中間幅でDesktop／Mobile Layoutを往復させない。
- DrawerをClassだけ消してReact Stateと不一致にしない。
- Scrollを常にPage先頭へ戻さない。
- Portrait／Landscapeを機種名やUser-Agentで判定しない。

## 5. Evidence状態

```text
Source反映                         完了
Portrait／Landscape回帰Test Source 完了
Static Gate                        完了
GitHub Actions実Run                未取得
WebKit／Chromium Report            未取得
Android実機回転                    未実施
iPhone／iPad実機回転               未実施
Production                         NO-GO
```

Test Sourceの存在を実機合格として扱わない。GitHub Actionsと実機Evidence取得後にのみRelease判定を更新する。
