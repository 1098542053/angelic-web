# Angelic Web - 视觉小说 Web 阅读器

基于 Web 技术的视觉小说阅读器，支持 Ren'Py 剧本解析、角色立绘显示、语音播放、多语言切换（日语/中文）。

## 功能特性

- **剧本解析**：解析 Ren'Py `.rpy` 脚本，提取对话、场景、菜单等指令
- **立绘显示**：支持 Composite 立绘合成、表情切换、位置动画
- **CG/背景**：支持图片 CG 和视频 CG（WebM 格式）
- **语音播放**：按场景自动播放对应语音文件
- **多语言**：支持日语/中文切换，通过中间层实现中文汉化
- **中文汉化中间层**：
  - 主翻译源：`Multilingual/zh/*.txt`（534 个完整翻译文件）
  - 回退源：`*_zh.json` 翻译文件 + `character_names.json` 角色名映射
  - 翻译覆盖率：文本 99%、角色名 100%

## 技术栈

- **后端**：Node.js + Express
- **前端**：原生 HTML/CSS/JavaScript
- **部署**：Docker + docker-compose

## Docker 部署（推荐）

### 1. 拉取镜像并启动

```bash
# 创建项目目录
mkdir -p angelic-web
cd angelic-web

# 下载 docker-compose.yml
curl -O https://raw.githubusercontent.com/1098542053/angelic-web/main/docker-compose.yml

# 启动服务
docker-compose up -d
```

### 2. 放置资源文件

将游戏资源放入宿主机的数据目录（默认 `/vol2/1000/项目/angelic/data`）：

```
data/
├── images/
│   ├── bg/           # 背景图片
│   ├── stand/        # 立绘图片
│   ├── thumbnail/    # 缩略图
│   ├── shome/        # 首页图片
│   └── gui/          # GUI 图片
├── audio/
│   ├── bgm/          # 背景音乐
│   └── ext_voice/    # 语音文件
├── resources/        # CG/视频资源（按前缀分子目录）
├── script/
│   ├── hscene/       # H场景剧本 (.rpy)
│   ├── sub_nav/      # 导航剧本
│   └── Multilingual/ # 多语言翻译文件
│       ├── jp/       # 日语原文
│       └── zh/       # 中文翻译
├── character_names.json  # 角色名映射
└── script.rpy        # 主剧本
```

### 3. 在可视化 Docker 中配置存储映射

在可视化 Docker 界面（如 Portainer）中：
- 将宿主机路径映射到容器的 `/data` 路径
- 资源以只读方式挂载（`:ro`）

### 4. 访问

浏览器打开 `http://<服务器IP>:3000`

## 本地开发

```bash
# 安装依赖
npm install

# 启动开发服务器
npm run dev

# 或指定数据目录
DATA_DIR=/path/to/data node server.js
```

## Docker 镜像

镜像自动构建并发布到 GitHub Container Registry：

```bash
docker pull ghcr.io/1098542053/angelic-web:latest
```

每次推送代码到 `main` 分支时，GitHub Actions 会自动构建并推送镜像。

## 中文汉化说明

中间层翻译系统工作原理：

1. 解析 `.rpy` 剧本为指令列表（dialogue/menu/scene 等）
2. 当客户端请求带 `lang=zh-CN` 参数时，加载中文翻译
3. 翻译优先级：`Multilingual/zh` > `*_zh.json` > `character_names.json`
4. 按行匹配日文原文到中文译文，应用翻译到指令

在网页阅读器中通过语言下拉菜单选择「中文」即可切换。

## 项目结构

```
angelic-web/
├── server.js              # 后端服务（含翻译中间层）
├── package.json
├── Dockerfile
├── docker-compose.yml
├── .github/
│   └── workflows/
│       └── docker-publish.yml  # Docker 镜像自动构建
├── public/
│   ├── index.html         # 主页面
│   ├── scene-debug.html   # 场景调试页面
│   ├── script-debug.html  # 脚本调试页面
│   ├── css/
│   │   └── style.css
│   └── js/
│       ├── app.js         # 主应用逻辑
│       └── novel-reader.js # 阅读器逻辑
└── data/                  # 游戏资源（不入库，手动部署）
```

## License

MIT
