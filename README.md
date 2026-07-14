# 新艾利都资源规划局

面向《绝区零》限定代理人与音擎的中文抽卡概率及资源缺口规划器。

## 功能

- 菲林、单色菲林、加密母带和信号余波换算
- 代理人与音擎独立保底状态
- 可排序的多目标计划
- 固定种子蒙特卡洛模拟与硬保底计算
- 重复代理人、音擎的信号余波返还
- 本机自动保存及 JSON 导入导出

软保底逐抽曲线属于非官方近似，网站内已单独标注。项目与米哈游或 HoYoverse 无关联。

## 在线使用

网站通过 GitHub Pages 发布：<https://a1m1ghty.github.io/zzz-gacha-planner/>

所有规划数据只保存在当前浏览器中，不需要登录，也不会上传到服务器。

## 本地运行

```bash
npm install
npm run dev
```

Sites 生产构建使用 `npm run build`，GitHub Pages 静态构建使用 `npm run build:pages`。静态产物生成到 `docs/`，供 GitHub Pages 直接发布；测试使用 `npm test`。
