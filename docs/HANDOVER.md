# 《逗比人生》纯 64 位重制增强版 — 工程架构与交接文档

**目标读者**：后续迭代开发的工程开发者或 AI Agent  
**目标运行环境**：现代纯 64 位 Android 设备（`minSdkVersion = 28`，已验证兼容 Android 16 纯 64 位架构）  
**当前最新版本号**：`versionCode = 25`（包名沿用原版 `game.msgjug.doubi`，原版基底版本 `0.922`，2017.08.28）  
**当前交付状态**：已完成纯 64 位化移植、1:1 原版黑绿 UI 还原、全量硬伤 Bug 修复、360 条去 AI 味高人味扩充事件与 82 项新增成就（总 1,541 事件 / 128 成就 / 1,120 背包规则），并通过静态严检、500 轮完整人生回归、4 大封闭副本防卡死压测与 V1+V2 独立加密验签。

---

## 一、仓库结构与单一数据源规范

所有内容修改一律先改 `data/*.json`，再执行 `node scripts/sync_data.mjs` 同步回灌至 [`index.html`](../index.html)（即 APK 内 `assets/index.html`），严禁手动分别修改造成漂移：

| 路径 | 说明 |
| :--- | :--- |
| `index.html` | APK 内置单文件完整源码与引擎（含 UI、逻辑、内联数据与 67 个 Base64 贴图/音频） |
| `data/evtLib_expanded.json` | 全量事件库（1,541 条：原版 1,181 + 扩充 360） |
| `data/goalLib_expanded.json` | 全量成就库（128 条：原版 46 + 新增 82） |
| `data/evtPath_expanded.json` | 全量背包 Mod 属性变更字典（1,120 条：原版 131 + 新增 989） |
| `data/heXie.json` | 原版和谐词库（`dirtyEvt` / `dirtyWord`） |
| `android/` | 极简纯 64 位 APK 容器模板（`AndroidManifest.xml` v25、`classes.dex`、`resources.arsc`、`res/`） |
| `scripts/sync_data.mjs` | `data/*.json` → `index.html` 单向同步工具 |
| `scripts/verify.mjs` | JS 语法、CSS 色值、数据一致性、原版不可变性、标签闭环与 AI 套话严检 |
| `scripts/sim_test.mjs` | 单元测试 + 500 轮随机人生与 4 大封闭副本防卡死回归模拟 |
| `scripts/build_apk.py` | 4 字节对齐 + V1/V2 签名纯 64 位 APK 打包脚本 |
| `scripts/verify_apk.py` | OpenSSL 独立验证 V1 PKCS#7 与 V2 Merkle/RSA 签名及对齐布局 |

---

## 二、核心设计约束与不可违背的红线

1. **视觉与交互 1:1 忠实原版 2017 Cocos Creator 风格**：
   - 保持 `1080×1920` 竖屏纯黑 `#000000` + 荧光绿 `#00d980` 线框与实心按钮，禁止圆角毛玻璃卡片或通用现代暗黑风。
   - 保持原版内联贴图、OGG 音效、非阻塞动效（`fx-evt-node` / `fx-aff-banner`）与右侧标签栏 `game-aff-bar` 增量 DOM Diff。
2. **原版内容 100% 完整保留，不得篡改**：
   - 原版 **1,181 个事件**（`id < 2000`）、**46 个原版成就**（键值 `1..48`）、**131 条原版背包规则**保持原样不动。
3. **扩充内容的写作与机械红线**：
   - **选项数与后果密度**：每条扩充事件（`id >= 2000`）必须 **≥ 3 个无条件可见选项**（推荐 4～6 个真正分叉的常规选项 + 1～3 个 `reqAff`/`reqBG` 隐藏回调）；消灭凑数废选项，保证高因果密度与约 12%～15% 的冷面荒诞死亡率。
   - **去 AI 味编剧红线**：严禁出现 AI 搞笑套话黑名单（见 `scripts/verify.mjs` 中 `BANNED_CLICHES`，发版必过 `--strict-cliche`）。采用冷面生活素描体、短平快题干、50～100 字展开式荒诞结果，以及原版沉睡标签回调、`=HIDDEN=` 暗线埋雷、`passTime: 0` 同龄连爆与封闭副本。
4. **音效触发时机严格克制**：
   - `sfx_goal`（`goal.ogg`）：**仅**在新解锁成就时播放。
   - `sfx_aff`（`aff.ogg`）：**仅**在未解锁成就且实际获得新可见标签时播放，单回合最多 1 次。
   - `sfx_msg`（`msg.ogg`）：**仅**在弹窗打开时播放。
   - BGM 必须响应 `visibilitychange`/`pagehide`/`blur`/`focus`，切后台或锁屏自动暂停。
5. **人物姓名与成就归属**：
   - 新建人物输入框**必须留空**；成就解锁永久记录真实姓名与解锁年龄至 `userData.goalRecords` 及本局 `role.goalAges`。

---

## 三、Android（纯 64 位）容器与打包签名架构

1. **纯 Dalvik `classes.dex`（`1,448` 字节，零 `.so` 依赖）**：
   - 入口沿用 `org.cocos2dx.javascript.AppActivity`，全屏 `#FF000000` WebView，启用 JS、DOMStorage 与 `setMediaPlaybackRequiresUserGesture(false)`，加载 `file:///android_asset/index.html`。
   - `onBackPressed()` 桥接至 `window.onAndroidBack()`（局内按返回打开 `modal-game-menu`，兼顾暂存返回、设置与中断本局）。
2. **`AndroidManifest.xml` 原位二进制修补（`4,184` 字节）**：
   - 严禁手写重建二进制 XML 树；仅在 `aapt` 编译基底上原位修补：`versionCode` 偏移 `2472`（当前 `25`），`minSdkVersion` 偏移 `2568`（当前 `28`）。
3. **ZIP 4 字节对齐与 V1+V2 签名**：
   - `classes.dex`、`resources.arsc`、`res/*` 必须 `ZIP_STORED` 且数据起始偏移 4 字节对齐。
   - 同时具备 V1 签名（含 `X-Android-APK-Signed: 2`）与 V2 签名（仅含区块 ID `0x7109871a`，**严禁**添加 `0x42726577` Verity Padding 区块）。

---

## 四、前端引擎与数据结构规范（`index.html`）

### 1. 内置数据常量

| 常量名 | 当前规模 | 结构与说明 |
| :--- | :--- | :--- |
| `RAW_EVT_LIB` | **1,541** 条（原版 `1,181` + 扩充 `360`） | 数组，每条含 `{ id, title, text, aff, sexCond, ageCondMin, ageCondMax, passTime, affCond, background, unAffCond }`。`sexCond` 取值 **`-1`（不限）/ `0`（男）/ `1`（女）**。 |
| `RAW_GOAL_LIB` | **128** 条（原版 `46` + 新增 `82`） | 字典 `{"id": [title, text, value]}`（原版 `1..48`，新增 `50..131`）。 |
| `EVT_PATH` | **1,120** 条（原版 `131` + 新增 `989`） | 背包属性规则 `{"evtId_choiceIdx": [attrName, deltaOrJsCode]}`。 |
| `HE_XIE` | 原版完整词库 | `dirtyEvt` 与 `dirtyWord`。 |
| `ASSETS` | **67** 个资源 | Base64 编码的原始 PNG 贴图与 OGG 音频。 |

### 2. 本地存储与压缩存档码（`localStorage`）

- `doubi_remaster_config`：动画、BGM、音效、震动、背包模组、和谐模式、图鉴剧透开关 `encycSpoiler`。
- `doubi_remaster_userdata`：成就进度 `goalIds`、`goalRecords`、图鉴 `seenEvtIds`、跨周目持久道具 `persistentAttrs`（保留龙珠）、生涯统计。
- `doubi_remaster_tombs`：本地 20 槽位墓碑（支持单槽清理与生平简报复制）。
- `doubi_remaster_active_run`：未结束人生自动存档，纳入 `DOUBI2:` Gzip 压缩存档码备份与恢复（向后兼容旧版明文 JSON 存档码）。

---

## 五、已踩过的技术坑与避坑铁律

1. **Android 16 `ResXMLParser` 报错「安装包已损坏」**：永远基于 `android/AndroidManifest.xml` 原位修补偏移 `2472`，严禁重建 XML 树。
2. **APK V2 `0x42726577` Verity Padding 拒装**：打包脚本严禁写入 `0x42726577`，发版前必跑 `python3 scripts/verify_apk.py`。
3. **禁止宽泛全局替换 HTML/CSS**：发版必跑 `node scripts/verify.mjs --strict-cliche` 核验所有 CSS Hex 色值与 `#00d980`。
4. **软键盘弹出挤压新建人物页**：保留 `#scene-new-game` 的 `overflow-y: auto`、`flex-shrink: 0` 与 `@media (max-height: 620px)` 紧凑规则。
5. **APK WebView 无文件选择/下载桥接**：在 `file://` Android WebView 下自动隐藏无效的 JSON 文件导入/导出按钮，统一引导使用 `DOUBI2:` 压缩存档码。
6. **签名证书连续性**：妥善保留 `keystore/release.key` 与 `keystore/release.crt`（已入 `.gitignore`），更换证书前务必提醒玩家在「存档管理」备份存档码。
