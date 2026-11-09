# `apps/web/src/services/presetPreference.ts`

源码：[presetPreference.ts](../../../../../apps/web/src/services/presetPreference.ts)

记住这次要用 mock、cloud 还是 local。地址栏优先于本机 `localStorage` 里的 `kt.preset`。两者都没有时，从 cloud 开始。

## `resolvePreset`

例子：打开 `https://localhost:5173/`。没有 `?preset=`，这台设备也没存过选择，这次从 cloud 开始。打开 `https://localhost:5173/?preset=local` 时，即使上次存的是 cloud，这次也从 local 开始。

如果地址或存档要 cloud，但这台浏览器把「成人或合成语音」勾掉了，函数退回 mock，避免一打开就把录音送出去。

## `rememberPreset`

把选择写进 `localStorage`，并用 `history.replaceState` 放进地址栏。刷新后还是这一套。不发网络请求。

缺省的确认勾选是开着的。只有存成 `"0"` 才算关掉。
