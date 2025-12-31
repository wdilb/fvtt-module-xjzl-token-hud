# 侠界之旅 - 战斗 HUD (XJZL Token HUD)

![Foundry v13](https://img.shields.io/badge/Foundry-v13-orange)
![System](https://img.shields.io/badge/System-侠界之旅-red)
![Version](https://img.shields.io/badge/Version-1.1.0-blue)

专为 **[侠界之旅 (XJZL System)]** 系统打造的沉浸式战斗 HUD 模组。

> **注意**：本模组深度绑定 `xjzl-system` 的数据结构（内力、怒气、经脉、招式），无法在 DND5e 或其他系统中使用。

---

## ✨ 核心特性 (Features)

### 1. 玩家主控面板 (Player Control HUD)
屏幕下方常驻的综合操作台，集成了资源监控与快捷操作，完全替代繁琐的角色卡交互。

[玩家HUD预览]<img width="1305" height="436" alt="1" src="https://github.com/user-attachments/assets/81f21248-ec3b-4ff5-9fe2-b1889cb29393" />


*   **本我中庭**：
    *   **动态立绘**：读取角色卡立绘，带有基于内功属性（阴/阳/太极）的呼吸光效。
    *   **架招监控**：顶部悬浮当前架招，点击即可快速解除。
    *   **境界印章**：实时显示角色当前的境界。
    *   **怒气核心**：环绕式怒气槽（10格），支持手动输入修正。
*   **战阵四维**：左侧实时显示 **格挡、闪避、看破、速度**，数据随装备/Buff实时变动。
*   **操作底座**：
    *   **常用招式**：自动读取角色卡中“置顶”的武学招式。
    *   **消耗品**：网格化展示背包内的丹药/道具，显示数量。
    *   **装备库**：按部位（武器、头饰、上衣等）自动折叠分组，支持一键换装。
    *   **属性/技能**：完整的七维属性与技能检定面板，支持折叠技艺。

### 2. 小队/敌人侧边栏 (Party & Enemy HUD)
屏幕两侧显示战场上的单位状态。

[侧边栏预览]<img width="2419" height="753" alt="2" src="https://github.com/user-attachments/assets/e69fd37b-4409-4069-b3b5-4ffd43232e80" />


*   **智能分组**：左侧显示友方（绿色系），右侧显示敌方（红色系）。
*   **动态血条**：
    *   **斜切风格**：独特的视觉设计。
    *   **幽灵条**：扣血/回血时带有缓冲动画。
    *   **护体真气**：以光罩形式覆盖在血条之上。
*   **怒气系统**：
    *   **色相偏移**：怒气从 绿色 -> 黄色 -> 红色 渐变，最后一格带有高频闪烁特效。
    *   **绝招 Cut-in**：当怒气耗尽释放绝招时，播放角色立绘切入动画与全屏特效。
*   **战争迷雾**：对敌方单位隐藏具体数值，仅显示“状态良好”、“重伤”等模糊描述（GM 可见数值）。

---

## 🎮 操作指南 (Controls)

本模组遵循 FVTT 的标准交互逻辑，并针对武侠操作进行了优化：

### 底部按钮 (物品/招式/装备)
| 操作 | 效果 |
| :--- | :--- |
| **左键点击** | **使用/出招/穿戴**。如果是奇珍装备，会自动弹出穴位选择窗口。 |
| **右键点击** | **发送详情**。将物品或招式的详细信息发送至聊天栏，供大家查阅。 |

### 界面交互
*   **折叠 HUD**：点击头像上方的箭头，可将 HUD 最小化，仅保留展开按钮，防止遮挡地图。
*   **输入框**：血量、内力、怒气等数值支持直接输入修改，回车或失焦自动保存。
*   **分组折叠**：装备和技能面板支持点击标题栏折叠，保持界面整洁。

---

## 🔧 安装 (Installation)

1.  前往本项目的 **[Releases 页面](../../releases)** (点击跳转)。
2.  下载最新版本的压缩包（通常命名为 `module.zip` 或 `xjzl-token-hud.zip`）。
3.  打开您的 Foundry VTT 用户数据目录，进入 `Data/modules/` 文件夹。
4.  将压缩包解压至此。
    > **⚠️ 重要**：请确保解压后的文件夹名称为 `xjzl-token-hud`，且该文件夹内直接包含 `module.json` 文件（不要套娃文件夹）。
5.  重启 Foundry VTT，在 **Manage Modules** 中勾选并启用本模组。

### 📁 参考路径 (默认数据目录)
*   **Windows**: `%localappdata%/FoundryVTT/Data/modules/`
*   **macOS**: `~/Library/Application Support/FoundryVTT/Data/modules/`
*   **Linux**: `~/.local/share/FoundryVTT/Data/modules/`

---

## 🛠️ 技术细节 (Technical)

*   **兼容性**：Foundry VTT v13+
*   **依赖系统**：`xjzl-system`
*   **技术栈**：原生 JavaScript (ES Modules), Handlebars, CSS3 (Grid/Flexbox, Animations)。

---

## 👥 作者 (Authors)

*   **Tiwelee** - *核心开发 / UI设计*

---

## 📄 许可证 (License)

本项目采用 [MIT License](LICENSE) 许可证。
