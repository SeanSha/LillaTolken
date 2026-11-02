# `apps/web/src/monitor/monitor.css`

源码：[monitor.css](../../../../../apps/web/src/monitor/monitor.css)

只给 `/monitor` 用的成人后台样式。儿童页的 `styles.css` 不会一起加载，所以这里的按钮是小的灰框，不是给孩子按的大圆钮。

## 整页和顶栏

`.mon-app` 最宽 1400 像素，居中。`.mon-header` 左边是标题，右边是时间范围和退出。窄屏时 `flex-wrap` 让它们换行，不挤出屏幕。

## 筛选、标签、数字卡

`.mon-filters` 是一行筛选。`.mon-tabs button.active` 给当前标签一条蓝底边，例如「概览」被选中时。`.mon-cards` 把任务数、耗时摊成一格一格。`.mon-card.warn` 用黄边标需要看的数字。

例子：近 7 天里失败变多。那张卡带 `warn`，黄底，数字本身仍来自接口，颜色只是提示。

## 表格和翻页

`.mon-scroll` 让宽表可以横滑。表头 `position: sticky`，往下滚时列名还在。`.row-bad` 把失败行涂浅红色。`.mon-pager` 是上一页、下一页。

## 点开一行

`.mon-drawer` 从右边滑出，宽最多 560 像素，手机上则占满。里面用 `.mon-kv` 排「字段名 / 值」。这里仍只有耗时、模型、费用依据，样式不会凭空多出一列原文。

## 登录和危险操作

`.mon-login` 把密码框放在屏幕中间。`.mon-danger` 是清空数据那一块红框，提醒这是会删记录的按钮。确认文字仍由页面逻辑检查，颜色只是让人停一下。
