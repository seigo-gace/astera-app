# Astera Device Compatibility Matrix — Private Development Note

> 内部開発用。対外向け対応機種表ではありません。

## 1. 対応境界

Asteraは機種名、Manufacturer、User-AgentのAllowlistで動作可否を決めない。

```text
Native iOS／iPadOS : 15.0以上
Native Android     : API 24（Android 7.0）以上
Web Browser        : 必須Web機能を満たすSafari／Chrome／Edge／Firefox系
```

上記未満のOSはCapacitor 8のNative配布対象外とする。AndroidでOSが対象内でもSystem WebViewが古い場合は、真っ白な画面や反応しないButtonを出さず、起動前Compatibility Gateで更新案内を表示する。

## 2. 機種制限禁止

次を禁止する。

- iPhoneだけ、iPadだけに限定する`UIDeviceFamily`
- `UIRequiredDeviceCapabilities`による特定Hardware必須化
- `UIRequiresFullScreen`によるiPad Multitasking／Resize拒否
- Android `screenOrientation`固定
- Android `minAspectRatio`／`maxAspectRatio`制限
- Android `supports-screens`による画面Size除外
- Android `uses-feature android:required="true"`による不要なHardware制限
- Device名／Manufacturer／User-Agent文字列による表示分岐
- Hoverだけで現れる必須操作

## 3. iOS／iPadOS

Generated Xcode Projectは次を満たす。

```text
TARGETED_DEVICE_FAMILY = "1,2"
iPhone  : Portrait／Landscape Left／Landscape Right
iPad    : Portrait／Portrait Upside Down／Landscape Left／Landscape Right
UIRequiresFullScreen : 無効
UIRequiredDeviceCapabilities : なし
Deployment Target : iOS 15.0
```

iPadはFull ScreenだけでなくSplit View、Slide Over相当の狭い幅、Stage Manager相当のWindow ResizeをResponsive Widthとして処理する。

### WebKit対策

- `color-mix()`非対応時の実色Fallback
- `backdrop-filter`非対応時の不透明Background
- `100dvh`だけに依存せず`100vh`＋Visual Viewport実測値
- Safe Area Insets
- Focus時の自動Zoomを避ける16px以上の入力
- `pageshow`、Rotation、Visual Viewport Resizeで再計算
- Hoverなし端末でMenu／Copy等の操作を常時表示
- Small iPhone幅320pxと短いLandscape Heightを個別Gate化

## 4. Android

Generated Android Projectは次を満たす。

```text
minSdkVersion     = 24
compileSdkVersion = 36
targetSdkVersion  = 36
resizeableActivity = true
screenOrientation  = 未指定
Aspect Ratio制限   = なし
Screen Size Filter = なし
Required Hardware  = なし
```

Phone、Tablet、Foldable、Multi-window、Desktop Windowingを同じResponsive Sourceで処理する。

### WebView対策

- `interactive-widget=resizes-content`
- Visual Viewport実測
- Keyboard表示時の高さ再計算
- Touch Action `manipulation`
- 44〜48px以上のTouch Target
- 古いSystem WebViewで必須機能不足時はCompatibility Notice
- JavaScript Build TargetはChrome 80／ES2019基準

## 5. Browser実行Matrix

GitHub ActionsでPlaywright WebKit／Chromiumを使い、全43 Routeを次の画面条件で開く。

```text
WebKit
- 320 × 568   Small iPhone
- 430 × 932   Large iPhone
- 844 × 390   iPhone Landscape
- 375 × 1024  iPad Split Width
- 1024 × 1366 iPad Full Width

Chromium
- 360 × 640   Small Android
- 412 × 915   Large Android
- 915 × 412   Android Landscape
- 800 × 1280  Android Tablet
- 673 × 841   Foldable／Resizable Window
- 1440 × 900  Desktop
```

各構成で次をFail条件とする。

- Rootが0pxまたは非表示
- Horizontal Overflow
- 正規RouteがNot Foundへ落ちる
- Button／Link／Inputが別Layerに覆われる
- Touch Inputが16px未満
- Mobile Drawerが表示またはClickできない
- Login Formが入力またはSubmitできない

## 6. Native Smoke Matrix

GitHub Actionsで次を実行する。

### Android

- Phone EmulatorへDebug APK Install
- Tablet Emulatorへ同一APK Install
- MainActivity起動
- Process生存確認
- Custom Schemeで`/login`を開く
- Launch／Login ScreenshotとWindow DumpをArtifact化

### iOS／iPadOS

- Universal Simulator App Build
- Available iPhone SimulatorへInstall／Launch
- Available iPad Simulatorへ同一AppをInstall／Launch
- Custom Schemeで`/login`を開く
- Launch／Login ScreenshotをArtifact化

## 7. 実機完成条件

Simulator／Emulator合格だけでは完成にしない。少なくとも次の実機CategoryでStory Testを通す。

- Small-screen iPhone
- Standard／Large iPhone
- iPadのFull ScreenとSplit View
- Small Android Phone
- Standard Android Phone
- Android Tablet
- FoldableまたはResizable Window

確認項目：表示、全主要Button、Keyboard、Rotation、Background復帰、OAuth、Passkey、2FA、Square、Download／Share、Deep Link、Offline復帰。

## 8. 現在判定

```text
機種名Allowlist              なし
iPhone／iPad Universal設定   Source実装済み
Android Resizable設定        Source実装済み
旧WebKit／WebView Fallback    Source実装済み
WebKit／Chromium Matrix CI    Workflow実装済み・実Run未確認
Android Phone／Tablet Smoke  Workflow実装済み・実Run未確認
iPhone／iPad Smoke           Workflow実装済み・実Run未確認
実機Matrix                    未実施
Production                   NO-GO
```
