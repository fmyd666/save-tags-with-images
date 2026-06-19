# 用图片保存tag

用图片保存tag 是一个纯本地图片 tag 收藏工具。它可以读取 ComfyUI 生成图片里的元数据，把你喜欢的正向 tag 保存成卡片，并用图片作为视觉参考。

数据默认保存在浏览器 IndexedDB 中，不需要账号、不需要云端服务。

## 功能

- 导入 PNG、WebP、JPEG 图片
- 读取 ComfyUI 常见图片元数据
- 自动从正向 prompt 中提取 tag
- 卡片外只显示图片、名称和收藏 tag
- 点击图片放大预览，支持滚轮缩放
- 点击 tag 或名称进入详情
- 编辑收藏 tag、备注和分类标签
- 左侧按分类标签筛选
- 搜索 tag、备注和分类
- 支持宽松/紧凑视图
- 下载原图
- 可选择本地目录同步图片副本和 `index.json`
- 便携版 Windows 启动脚本

## 下载使用

到 GitHub Releases 页面下载：

```text
用图片保存tag.zip
```

解压后双击：

```text
启动画廊.cmd
```

默认地址：

```text
http://127.0.0.1:5188/
```

建议使用 Microsoft Edge 或 Chrome。

## 本地开发

需要 Node.js。

```powershell
npm install
npm start
```

打开：

```text
http://127.0.0.1:5188/
```

如果端口被占用，可以指定端口：

```powershell
$env:PORT=5190
npm start
```

## 打包说明

当前项目的便携版输出目录是：

```text
dist/用图片保存tag
```

压缩包是：

```text
dist/用图片保存tag.zip
```

源码仓库默认忽略 `dist/`。建议把 zip 上传到 GitHub Releases，而不是直接提交到 Git。

## 隐私

图片和 tag 默认保存在本机浏览器 IndexedDB 中。使用“本地目录”功能时，图片副本和索引会写入你选择的本地文件夹。

## 许可

本项目采用自定义的“非商业署名许可”：

- 可以个人学习、研究、非商业使用和非商业修改
- 不允许商用、收费分发、商业运营或广告变现
- 转载、修改、分发时必须注明出处：“用图片保存tag”，并保留原仓库链接和许可证文件

完整条款见 [LICENSE](./LICENSE)。
