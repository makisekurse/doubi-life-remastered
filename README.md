# 逗比人生 · 64 位重制增强版 (Doubi Life Remastered)

经典文字模拟游戏《逗比人生》（原版 v0.922, 2015–2017）的现代纯 64 位 Android 重制增强版与单文件 Web 版。

- **当前版本**：`v0.922+`（Android `versionCode = 24`，包名沿用原版 `game.msgjug.doubi`）
- **兼容目标**：现代纯 64 位 Android 设备（`minSdkVersion = 28`，已验证兼容 Android 16 纯 64 位架构）及任意现代桌面/移动端浏览器

## 核心特性

- **1:1 忠实还原原版美学与内容**
  - 完整保留原版 **1,181 个经典事件**、**46 项原版成就**、**131 条背包 Mod 规则** 与原版和谐词库。
  - 严格保持原版 `1080×1920` 竖屏纯黑（`#000000`）+ 荧光绿（`#00d980`）视觉风格、原版贴图、BGM 与 OGG 音效。
- **200+ 现代事件与 54 项新增成就扩充**
  - 新增 **200 个现代事件**（`id: 2001..2200`，总事件数 **1,381**），涵盖当代社会现实、职场、体制、AI、二次元与游戏梗，并与原版世界观深度联动。
  - 每个新增事件均保证至少 **3 个无条件可见选项**，并支持原版前置标签/背景条件的隐藏分支。
  - 新增 **54 项成就**（总成就数 **100**）与 **106 条新增背包规则**（总计 **237** 条）。
- **新增实用功能**
  - **事件图鉴**：支持防剧透（战争迷雾）开关、原版/新增与已解锁/未解锁筛选、关键词检索与分支详情查看。
  - **存档管理**：支持一键复制/粘贴存档码以及 JSON 存档文件导入/导出，支持后台自动续玩与本地 20 槽位墓地。
- **零原生 `.so` 依赖的纯 64 位 Android 容器**
  - 彻底剥离原版 32 位 `armeabi-v7a` Cocos2d-x `.so` 与加固壳，采用极简纯 Dalvik `classes.dex` + 原生全屏 `WebView` 架构，支持系统返回手势桥接与软键盘防挤压布局。

## 目录结构

```text
.
├── index.html                  # 单文件完整版（含 HTML/CSS/JS 引擎、数据与 67 个内联 Base64 素材，可直接浏览器打开游玩）
├── data/                       # 独立导出的全量 JSON 数据集（与 index.html 保持严格一致）
│   ├── evtLib_expanded.json    # 1,381 条事件库
│   ├── goalLib_expanded.json   # 100 项成就库
│   ├── evtPath_expanded.json   # 237 条背包 Mod 属性规则
│   └── heXie.json              # 原版和谐词库
├── android/                    # 纯 64 位 Android APK 打包模板资源
│   ├── AndroidManifest.xml     # 原位二进制修补版 Manifest（v24 / minSdk 28）
│   ├── classes.dex             # 极简 Dalvik WebView 启动器与返回手势桥接（1,448 B）
│   ├── resources.arsc          # 编译后的应用资源表
│   └── res/                    # 应用图标与布局资源
├── scripts/
│   ├── verify.mjs              # 数据一致性、CSS 色值、选项底线与自动化校验脚本
│   └── build_apk.py            # 纯 64 位 APK 打包与 V1+V2 签名脚本（4 字节对齐，适配 Android 16）
└── docs/
    └── HANDOVER.md             # 工程架构、设计红线与开发避坑指南
```

## 快速开始

### 1. 浏览器直接游玩

直接用任意现代浏览器打开根目录的 [`index.html`](index.html) 即可离线完整游玩。

### 2. 数据与完整性校验

```bash
node scripts/verify.mjs
```

校验内容包括：
- `index.html` 内联常量与 `data/*.json` 的严格一致性
- CSS 中全部 Hex 颜色值合法性（防止全局替换破坏主题色 `#00d980`）
- 所有 `id >= 2000` 新增事件至少包含 3 个无门槛可见选项
- 所有 `target` 事件跳转 ID 与 `goal` 成就 ID 的有效性

### 3. 构建纯 64 位 Android APK

需要 `python3` 与 `openssl`（无需安装 Android SDK）：

```bash
# 使用已有签名证书构建（推荐，保持覆盖安装签名一致）
python3 scripts/build_apk.py \
  --out dist/doubi-life-64bit-v24.apk \
  --key keystore/release.key \
  --cert keystore/release.crt

# 首次本地测试构建（自动在 keystore/ 生成持久化本地证书，不会提交到 Git）
python3 scripts/build_apk.py --out dist/doubi-life-64bit-v24.apk
```

如需升级版本号，可传入 `--version-code 25`（脚本将在 `AndroidManifest.xml` 偏移 `2472` 处执行原位修补，避免破坏二进制 XML 结构）。

> **覆盖安装提示**：若更换签名证书重新构建 APK，Android 系统会要求先卸载旧版再安装；卸载前请务必在游戏内 **「存档管理」** 导出或复制存档码进行备份。

## 致谢与声明

- 原版游戏《逗比人生 (Doubi living)》由 **MsgJug / WildPtr (2015–2017)** 及广大众创玩家共同创作。
- 本项目旨在让这款经典文字游戏能够在现代纯 64 位 Android 系统与浏览器上继续运行和传承。
