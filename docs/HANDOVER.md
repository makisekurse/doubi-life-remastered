# 《逗比人生》纯 64 位重制增强版 — 工程架构与交接文档

**目标读者**：后续迭代开发的工程开发者或 AI Agent  
**目标运行环境**：现代纯 64 位 Android 设备（`minSdkVersion = 28`，已验证兼容 Android 16 纯 64 位架构）及现代浏览器  
**当前最新版本号**：`versionCode = 24`（包名沿用原版 `game.msgjug.doubi`，原版基底版本 `0.922`，2017.08.28）  
**当前交付状态**：已完成纯 64 位化移植、1:1 原版黑绿 UI 还原、200 个现代新增事件与 54 项新增成就扩充、Android 16 签名兼容与软键盘防挤压修复，并通过自动化多轮完整人生回归测试（0 JS 报错）。

---

## 一、仓库结构与核心文件

核心前端、引擎逻辑、全量文本数据与 67 个内联 Base64 媒体资源均收敛于单文件 [`index.html`](../index.html)（同时作为 APK 内的 `assets/index.html`）：

| 路径 | 说明 |
| :--- | :--- |
| `index.html` | 单文件完整源码与引擎（含 UI、逻辑、数据与 67 个 Base64 贴图/音频） |
| `data/evtLib_expanded.json` | 全量事件库（1,381 条：原版 1,181 + 新增 200） |
| `data/goalLib_expanded.json` | 全量成就库（100 条：原版 46 + 新增 54） |
| `data/evtPath_expanded.json` | 全量背包 Mod 属性变更字典（237 条：原版 131 + 新增 106） |
| `data/heXie.json` | 原版和谐词库（`dirtyEvt` / `dirtyWord`） |
| `android/` | 极简纯 64 位 APK 容器模板（`AndroidManifest.xml`、`classes.dex`、`resources.arsc`、`res/`） |
| `scripts/verify.mjs` | 数据一致性、CSS 合法性与选项底线校验脚本 |
| `scripts/build_apk.py` | 4 字节对齐 + V1/V2 签名 APK 打包脚本 |

---

## 二、核心设计约束与不可违背的红线

后续任何改动都必须严格遵守以下约束，切勿回退或擅自发挥：

1. **视觉与交互必须 1:1 忠实原版 2017 Cocos Creator 风格**：
   - 保持 `1080×1920` 竖屏比例美学：纯黑底色 `#000000` + 高对比度荧光绿 `#00d980` 线框与实心按钮，禁止改成圆角卡片、渐变毛玻璃或通用现代暗黑风。
   - 必须使用从原版 APK 提取并内联的原始贴图与音频（包括 `rankD2` 椭圆底框合成的 `male1..6` / `female1..6` 头像、`evt_panel.png`、`lifeRoad.png`、`egg9.png`、`tomb.png`、`dead_s.png`、`star.png`、`icon_bag.png` 以及原版 OGG 音效）。
   - 保留原版非阻塞动效（`evtNodeIn` 与 `plusAffEffectAniIn`）以及右侧标签栏 `affNode` 的增量 DOM Diff 更新，确保点击选项流畅。
2. **原版内容 100% 完整保留，不得篡改**：
   - 原版 **1,181 个事件**（`id < 2000`）、**46 个原版成就**（键值 `1..48`）、**131 条原版背包 Mod 规则**（`evtPath`）保持原样不动。
3. **新增事件的数量、题材与选项底线**：
   - 当前已扩充至 **200 个现代事件**（`id: 2001..2200`，总事件数 **1,381**）、**54 个新增成就**（键值 `50..103`，总成就数 **100**）、**106 条新增背包规则**（总计 **237** 条）。
   - **选项数红线**：每一个新增事件都**必须至少有 3 个无条件可见的选项**（禁止只给 2 个选项）；在此基础上可以额外追加带 `reqAff` / `reqBG` 前置条件的隐藏选项（不满足条件时按原版机制在下方显示灰色条 `X个选项因为条件不足而被隐藏`）。
   - **题材与世界观联动**：政治/社会讽刺梗以**国内本土鉴证梗与社会现实吐槽为主**（少量高知名度国际梗可点缀），并与原版世界观深度贯通（如 `申国`、`中南河`、`希望国`、`目国`、`申国证书证明部门`、`新能源发电部门(比卡丘)`、`水利部门查水表`、`SWAT`、`阿尔法狗`、`黑框眼镜`、`隐身` 等原版标签与设定）。
4. **音效触发时机严格克制**：
   - `sfx_aff`（`aff.ogg`）：**仅**在玩家做出选择后实际获得新标签时播放，且单回合最多触发 1 次（禁止普通对话或按钮点击弹出音效）。
   - `sfx_goal`（`goal.ogg`）：**仅**在新解锁成就时播放。
   - `sfx_msg`（`msg.ogg`）：**仅**在弹窗打开时播放。
5. **人物默认名称与成就归属记录**：
   - 新建人物时输入框**必须留空**（禁止预填网文默认名），仅允许玩家手输或点击随机骰子从名字库生成。
   - 成就解锁时，必须将当时真实的人物姓名与年龄永久记录到 `userData.goalRecords` 并在成就详情中显示，禁止写死默认姓名。
6. **主菜单精简与新增功能保留**：
   - 已移除原版「支持开发！」、「制作者名单」、「官网」入口。
   - 主菜单槽位替换为 **事件图鉴**（带战争迷雾/防剧透开关、原版/新增与已解锁/未解锁筛选、关键词搜索、懒加载分页及完整分支详情弹窗）与 **存档管理**（支持一键复制/粘贴剪贴板存档码，以及 JSON 文件导入/导出）。

---

## 三、Android（纯 64 位）容器与打包签名架构

原版 `doubirensheng.apk` 依赖 32 位 `armeabi-v7a` Cocos2d-x `.so` 库及第三方加固壳（`com.stub.StubApp`），在纯 64 位 Android 设备上无法安装运行。重制版采用「极简纯 Dalvik 字节码 + 原生 WebView」架构，彻底消除原生 `.so` 依赖：

1. **纯 Java/Dalvik `classes.dex`（`1,448` 字节，零 `.so` 依赖）**：
   - 入口 Activity 沿用原版类名 `org.cocos2dx.javascript.AppActivity`（继承 `android.app.Activity`）。
   - 启动时创建全屏 `android.webkit.WebView`，背景色设为 `#FF000000` 防止白屏闪烁，开启 JavaScript、DOMStorage，设置 `setMediaPlaybackRequiresUserGesture(false)` 允许自动播放音效与 BGM，并加载 `file:///android_asset/index.html`。
   - **系统返回手势桥接**：重写 `onBackPressed()`，调用 `mWebView.loadUrl("javascript:window.onAndroidBack&&window.onAndroidBack()")` 将系统返回手势交给前端路由处理（Dalvik 字节码 PC 偏移：`iget-object` 2u、`if-eqz +7` 2u 跳至 PC 9 `return-void`、`const-string` 2u、`invoke-virtual` 3u、`return-void` 1u）。
2. **`AndroidManifest.xml` 原位二进制修补（`4,184` 字节）**：
   - 基于原版 `aapt` 编译出的二进制 `AndroidManifest.xml` 做原位字节修补，剥离 `com.stub.StubApp` 及加固壳相关属性。
   - 关键字节偏移：`versionCode` 位于偏移 `2472`（当前值 `24`），`minSdkVersion` 位于偏移 `2568`（当前值 `28`）。
3. **ZIP 4 字节对齐与 V1+V2 签名规范**：
   - `classes.dex`、`resources.arsc` 以及 `res/*` 必须以未压缩方式（`ZIP_STORED`）存入，并通过本地文件头 extra-field 填充确保数据起始偏移严格 4 字节对齐。
   - 同时包含 V1 签名（`META-INF/MANIFEST.MF`、`CERT.SF` 含 `X-Android-APK-Signed: 2` 头、`CERT.RSA` 通过 `openssl smime` 生成）与 V2 签名（`APK Sig Block 42`，区块 ID `0x7109871a`，算法 RSASSA-PKCS1-v1_5 SHA-256 `0x0103`）。

---

## 四、前端单文件引擎与数据结构规范（`index.html`）

### 1. 核心内置数据常量

| 常量名 | 当前规模 | 结构与说明 |
| :--- | :--- | :--- |
| `RAW_EVT_LIB` | **1,381** 条（原版 `1,181` + 新增 `200`） | 数组，每条事件结构：`{ id, title, text, aff, sexCond, ageCondMin, ageCondMax, passTime, affCond, background, unAffCond }`。其中 `aff` 为选项数组的字符串定义；`sexCond` 取值 `-1`（不限）/ `0`（女）/ `1`（男）。 |
| `RAW_GOAL_LIB` | **100** 条（原版 `46` + 新增 `54`） | 字典对象，格式 `{"id": [title, text, value]}`（原版键值 `1..48`，新增键值 `50..103`）。 |
| `EVT_PATH` | **237** 条（原版 `131` + 新增 `106`） | 背包 Mod 属性变更字典，格式 `{"evtId_choiceIdx": [attrName, deltaOrJsCode]}`。 |
| `HE_XIE` | 原版完整词库 | 包含 `dirtyEvt` 与 `dirtyWord`，兼容原版和谐开关设置。 |
| `ASSETS` | **67** 个资源 | Base64 编码的 PNG 贴图与 OGG 音频（含 `DoubiBGM.ogg`、`aff.ogg`、`goal.ogg`、`msg.ogg` 及全部 UI/头像素材）。 |

### 2. 事件文本占位符与选项字段

- **文本占位符**：`=NAME=`（人物名）、`=SEX=`（性别称谓）、`=AGE=`（当前年龄）、`=INHERIT=`（遗产/继承内容）、`___`（叙事留白）、`=HIDDEN=`（隐藏标记）。
- **选项对象字段**：`btn`（按钮文案）、`title`（结果标题）、`text`（结果正文）、`plusAff`（增加标签）、`delAff`（移除标签）、`plusBG` / `delBG` / `delBG2` / `plusCBG` / `delCBG`（背景/隐藏背景标记增删）、`reqAff` / `reqBG`（条件可见门槛）、`target`（强制跳转后续事件 ID）、`goal`（触发解锁的成就 ID）。
- **新旧事件抽取权重**：当当前回合同时存在符合条件的原版事件（`id < 2000`）与新增事件（`id >= 2000`）时，引擎按 **35%** 概率优先从新增池抽取，兼顾新梗体验与原版经典主线。

### 3. 本地持久化存储（`localStorage`）

- `doubi_remaster_config`：音效、BGM、和谐模式、图鉴防剧透开关等全局配置。
- `doubi_remaster_userdata`：已解锁成就 ID 列表 `goalIds`、成就归属记录 `goalRecords`（含解锁时的姓名与年龄）、图鉴已遭遇事件 `seenEvtIds`、生涯统计。
- `doubi_remaster_tombs`：墓碑记录（最多保存 20 个历史人生槽位）。
- `doubi_remaster_active_run`：未结束人生的实时自动存档，支持切后台或重启后无缝续玩。

---

## 五、关键技术坑与避坑清单（必读）

1. **Android 16 `ResXMLParser` 报错「安装包已损坏」**：
   - **根因**：从零手写重建二进制 `AndroidManifest.xml` 时，若带 `android:` 命名空间的属性排在无命名空间的 `package` 属性之前，Android 16 的二分查找解析器会直接判定包损坏。
   - **铁律**：永远基于 `android/AndroidManifest.xml`（`aapt` 编译基底）做原位字节修补（升级版本号只改偏移 `2472` 的 `versionCode`，不要重写整个 XML 树）。
2. **APK V2 Verity Padding 区块（`0x42726577`）导致系统安装器拒装**：
   - **根因**：写入 `0x42726577` 填充区块但未满足严格 4096 字节整包对齐时，Android 16 及部分厂商定制系统安装器会拒绝校验。
   - **铁律**：打包脚本严禁添加 `0x42726577` 区块，仅保留标准的 `0x7109871a` V2 签名区块。
3. **禁止对 HTML/CSS 做宽泛全局字符串替换**：
   - **教训**：曾因全局将 `"80"` 替换为 `"100"`，意外把主题色 `#00d980` 改坏为无效色值 `#00d9100`，导致界面失去荧光绿对比度。
   - **铁律**：修改脚本或数据后，务必运行 `node scripts/verify.mjs` 校验 CSS 中所有 Hex 颜色值合法性及数据完整性。
4. **Android 软键盘弹出导致姓名输入框被压扁**：
   - **根因**：竖屏 Flex 容器设置 `overflow: hidden` 时，弹出输入法使视口高度骤降，挤压输入框和性别切换栏。
   - **铁律**：保持新建人物页容器 `overflow-y: auto`，为输入框与按钮设置 `flex-shrink: 0`，并保留 `@media (max-height: 620px)` 下的紧凑布局规则。
5. **签名密钥连续性与覆盖安装**：
   - **注意点**：在临时环境中重新生成签名证书会导致新版 APK 无法直接覆盖安装旧版（需先卸载）。
   - **建议**：持续发版时妥善保存本地 `keystore/` 下的签名证书（已列入 `.gitignore`，切勿提交至公开仓库）；若更换签名，务必提醒玩家先在游戏内「存档管理」备份存档码。

---

## 六、回归验收标准与后续可迭代方向

### 发版前建议执行的自动化检查

- 运行 `node scripts/verify.mjs`：校验 `index.html` 与 `data/*.json` 一致性、所有 `id >= 2000` 事件拥有 `>= 3` 个无门槛可见选项、所有 `target` / `goal` 引用有效、CSS Hex 颜色值合法。
- 多轮人生模拟：通过无头脚本跑完多轮完整人生，验证 0 JS 报错、无死循环、音效触发时机严格合规。
- APK 完整性校验：确认 `classes.dex`、`resources.arsc`、`res/*` 为 `ZIP_STORED` 且 4 字节对齐，V1+V2 签名有效且无 `0x42726577` 区块。

### 后续迭代方向

1. **深化原版中后期（40～80 岁）与冷门职业线联动**：补充更多中后期现代事件与职业隐藏分支，提升二周目重玩深度。
2. **支持外部自定义事件包（Mod）导入**：在现有「存档管理」基础上扩展本地 JSON 事件包热加载能力，无需重新打包即可体验自定义剧情。
3. **GitHub Actions 自动构建与发布**：使用 GitHub Secrets 托管固定签名证书，推送 Tag 时自动校验并产出签名 APK Release。
