# 富士口袋 · RAW 本地转换

一个可安装到 iPhone 主屏幕的静态网页工具。网页资源从 GitHub Pages 加载；选择的照片在当前设备浏览器中处理，不会上传到服务器。

## 发布

GitHub Actions 会在 `main` 分支更新后自动部署 `site/` 到 GitHub Pages。首个工作流运行前，请在仓库 **Settings → Pages → Build and deployment** 中选择 **GitHub Actions**（如果 Pages 尚未启用）。

## 内容

- `site/`：网页、RAW 解码 WebAssembly、离线缓存资源
- `.github/workflows/deploy-pages.yml`：GitHub Pages 自动部署流程
