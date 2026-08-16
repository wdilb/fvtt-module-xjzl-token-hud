/**
 * =================================================================
 *  My Token HUD - 主程序入口 (Main Entry Point)
 *  作者: Tiwelee
 *  适配: FVTT V12 / V13
 *  描述: 这是一个高性能的战斗状态追踪 HUD，支持实时血量、内力、怒气显示及特效。
 * =================================================================
 */
import { PlayerHUD } from "./player-hud.js";
// --- 全局状态管理对象 ---
const HUD_STATE = {
    // 记录 Token 上一次的数值(HP/内力/怒气)，用于计算动画方向 (涨/跌)
    // Key: TokenID, Value: { hp, neili, rage }
    tokens: new Map(),

    // V13 兼容性：模板加载器引用
    loader: null,
    renderer: null
};

let refreshPartyHudPositions = () => {};
let sidebarResizeObserver = null;
let hudContainerPromise = null;

// =================================================================
// 1. 初始化与配置 (Initialization)
// =================================================================

/**
 * Hook: init
 * Foundry VTT 初始化阶段触发。
 * 用于注册设置、预加载模板等。
 */
Hooks.once("init", async function () {
    console.log("My Token HUD | 正在初始化...");

    // [V13 适配] 动态获取 Handlebars 帮助函数
    // 优先尝试 foundry.applications 路径，回退到全局 globalThis 以兼容旧版本
    HUD_STATE.loader = foundry.applications?.handlebars?.loadTemplates || globalThis.loadTemplates;
    HUD_STATE.renderer = foundry.applications?.handlebars?.renderTemplate || globalThis.renderTemplate;

    // 预加载 HBS 模板文件，防止渲染时闪烁
    await HUD_STATE.loader([
        "modules/xjzl-token-hud/templates/hud-container.hbs",
        "modules/xjzl-token-hud/templates/hud-card.hbs"
    ]);

    // 注册模块设置：仅显示战斗单位
    game.settings.register("xjzl-token-hud", "onlyCombatants", {
        name: "仅显示战斗单位",
        hint: "开启后，只有加入战斗遭遇 (Combat Tracker) 的 Token 才会显示 HUD。",
        scope: "world",
        config: true,
        type: Boolean,
        default: false,
        onChange: () => updateAllTokens() // 设置变更时立即刷新
    });

    // 注册设置: 小队HUD缩放比例
    game.settings.register("xjzl-token-hud", "partyScale", {
        name: "小队HUD缩放比例",
        hint: "调整左右两侧小队列表的大小 (0.5 - 1.5 倍)。",
        scope: "client", // 仅客户端生效，每个玩家可以自己调
        config: true,
        type: Number,
        range: { min: 0.5, max: 1.5, step: 0.1 }, // 滑动条
        default: 1.0,
        onChange: (value) => updateHudScale(value)
    });

    // 注册设置: 完全隐藏敌方血条长度
    game.settings.register("xjzl-token-hud", "hideEnemyBars", {
        name: "隐藏敌方血条长度",
        hint: "开启后，普通玩家将无法通过进度条长度判断敌人状态，只能依靠文字描述（如“轻伤”、“濒死”）。GM 仍然可见。",
        scope: "world",      // 所有玩家统一规则
        config: true,
        type: Boolean,
        default: false,
        onChange: () => updateAllTokens()
    });

    // 预缓存视频文件
    // 这会让浏览器在后台静默下载文件到缓存，但不会触发并发读取错误
    fetch("modules/xjzl-token-hud/resource/effect.webm")
        .then(response => response.blob())
        .catch(error => console.warn("My Token HUD | 特效资源预缓存失败:", error));
});

/**
 * Hook: ready
 * 游戏核心数据加载完毕，画布准备好之前。
 */
Hooks.once("ready", function () {
    PlayerHUD.init();
    if (canvas.ready) initHudSystem();
});

/**
 * Hook: canvasReady
 * 画布渲染完成。切换场景时也会触发此 Hook。
 */
Hooks.on("canvasReady", function () {
    initHudSystem();
    // 某些版本 ready 早于 canvasReady；这里补齐一次人物 HUD 初始化。
    if (!PlayerHUD.debouncedRender) PlayerHUD.init();
    else PlayerHUD.debouncedRender();
});

/**
 * 初始化 HUD 系统容器并刷新所有 Token
 * 等待 HUD 容器就绪后刷新 Token，并让友方使用固定安全初始位置、敌方避开右侧栏
 */
async function initHudSystem() {
    await createHUDContainer();
    updateSidebarOffset();
    observeSidebarLayout();
    updateAllTokens();

    // 初始化时应用当前的缩放比例
    const scale = game.settings.get("xjzl-token-hud", "partyScale");
    updateHudScale(scale);
}

// =================================================================
// 2. 事件监听 (Event Listeners)
// =================================================================

/**
 * 监听侧边栏折叠/展开事件 (collapseSidebar)
 * 用于动态调整右侧 HUD 的位置，防止被侧边栏遮挡。
 * @param {Sidebar} sidebar - 侧边栏对象
 * @param {boolean} collapsed - 是否折叠 (true=收起, false=展开)
 */
Hooks.on("collapseSidebar", (sidebar, collapsed) => {
    updateSidebarOffset(collapsed);
});

/**
 * [性能优化核心] 监听 Token 数据更新
 * 仅当外观、显隐或相关属性 (actorData) 变化时才触发，
 * 避免在拖拽 Token (update x,y) 时频繁计算导致掉帧。
 */
Hooks.on("updateToken", (tokenDocument, changes, options, userId) => {
    if (!canvas.ready) return;

    // 定义我们需要关心的变更属性
    const relevantKeys = ["hidden", "texture", "name", "disposition", "actorData"];

    // 快速检查：如果 changes 里不包含上述任何 key，直接跳过
    const needsUpdate = relevantKeys.some(k => k in changes);

    if (!needsUpdate) return;

    if (tokenDocument.object) {
        // 使用 requestAnimationFrame 确保在下一帧渲染，不阻塞主线程
        requestAnimationFrame(() => updateSingleToken(tokenDocument.object));
    }
});

/**
 * [性能优化核心] 监听 Actor 数据更新 (HP/内力/怒气变化)
 */
Hooks.on("updateActor", (actor, changes, options, userId) => {
    // 如果是容器，直接忽略，不执行后续逻辑
    if (actor.type === "container") return;
    // 使用 foundry.utils.hasProperty 进行深度检查，只关心 attributes 变化
    const hasResourceChange = foundry.utils.hasProperty(changes, "system.resources");

    if (!hasResourceChange) return;

    // 刷新该 Actor 关联的所有 Token
    const tokens = actor.getActiveTokens();
    tokens.forEach(t => updateSingleToken(t));
});

/**
 * [绝招判定] 监听系统招式聊天卡
 * 系统确认施展绝招后，会在招式聊天卡中注入隐形标签【绝招标签】。
 * 聊天卡会广播到所有客户端，因此每个正在观看场景的客户端都能同步播放 Cut-in 动画。
 */
Hooks.on("createChatMessage", (message) => {
    if (!canvas.ready) return;
    if (!message.content?.includes("【绝招标签】")) return;

    // 优先用发言 token 精确定位：同一 Actor 的多个非关联 token 只有实际出招的那个播放动画
    const speakerTokenId = message.speaker?.token;
    let tokens = [];
    if (speakerTokenId) {
        const speakerToken = canvas.tokens.get(speakerTokenId);
        if (speakerToken) tokens = [speakerToken];
    } else {
        // 没有 token 时回退到 Actor 维度（例如未放置 token 的 Actor 发招）
        const actorId = message.speaker?.actor;
        if (actorId) {
            const actor = game.actors.get(actorId);
            tokens = actor ? actor.getActiveTokens() : canvas.tokens.placeables.filter(t => t.actor?.id === actorId);
        }
    }

    tokens.forEach(token => {
        const card = document.getElementById(`hud-token-${token.id}`);
        if (card) triggerAnimation(card, 'effect-ultimate');
    });
});

// 处理 Token 创建/删除/战斗状态变更
Hooks.on("createToken", (tokenDocument) => {
    if (tokenDocument.object) requestAnimationFrame(() => updateSingleToken(tokenDocument.object));
});
Hooks.on("deleteToken", (tokenDocument) => removeTokenCard(tokenDocument.id));

Hooks.on("createCombatant", (combatant) => { // 加入战斗
    const token = canvas.tokens.get(combatant.tokenId);
    if (token) updateSingleToken(token);
});
Hooks.on("deleteCombatant", (combatant) => { // 离开战斗
    const token = canvas.tokens.get(combatant.tokenId);
    if (token) updateSingleToken(token);
});
Hooks.on("deleteCombat", () => { // 战斗结束
    // 删除遭遇后 Token 的 inCombat 状态可能在当前调用栈结束后才同步。
    // 延后一帧刷新，避免旧状态把已删除的 HUD 卡片重新创建出来。
    requestAnimationFrame(() => updateAllTokens());
});


// =================================================================
// 3. 核心逻辑 (Core Logic)
// =================================================================

/**
 * 动态设置 CSS 变量，控制右侧 HUD 的偏移量
 * @param {boolean} [isCollapsed] - 侧边栏是否折叠；省略时读取当前实际宽度
 */
function updateSidebarOffset(isCollapsed) {
    const sidebar = document.getElementById("sidebar");
    const rect = sidebar?.getBoundingClientRect();
    const measuredWidth = rect && rect.width > 0
        ? Math.ceil(window.innerWidth - rect.left + 12)
        : 0;
    const offset = isCollapsed === true
        ? 60
        : isCollapsed === false
            ? Math.max(360, measuredWidth)
            : Math.max(60, measuredWidth || 60);

    document.documentElement.style.setProperty("--hud-right-offset", offset + "px");
    requestAnimationFrame(() => refreshPartyHudPositions());

    // Foundry 的侧栏带有展开动画，动画结束后再按真实边界校准一次。
    if (typeof isCollapsed === "boolean") {
        window.setTimeout(() => {
            const liveSidebar = document.getElementById("sidebar");
            const liveRect = liveSidebar?.getBoundingClientRect();
            const liveOffset = isCollapsed
                ? 60
                : Math.max(60, liveRect?.width > 0
                    ? Math.ceil(window.innerWidth - liveRect.left + 12)
                    : 360);

            document.documentElement.style.setProperty("--hud-right-offset", liveOffset + "px");
            refreshPartyHudPositions();
        }, 260);
    }
}

/**
 * 监听侧栏和窗口尺寸变化，让敌方 HUD 避开右侧界面；友方 HUD 使用固定初始安全位置。
 */
function observeSidebarLayout() {
    const sidebar = document.getElementById("sidebar");
    if (sidebar && !sidebarResizeObserver && globalThis.ResizeObserver) {
        sidebarResizeObserver = new ResizeObserver(() => updateSidebarOffset());
        sidebarResizeObserver.observe(sidebar);
    }

    if (document.body.dataset.xjzlHudResizeBound !== "true") {
        document.body.dataset.xjzlHudResizeBound = "true";
        window.addEventListener("resize", () => updateSidebarOffset());
    }
}
/**
 * 创建主容器 (单例模式)
 */
async function createHUDContainer() {
    const existing = document.getElementById("xjzl-custom-hud");
    if (existing) {
        setupHudDragging(existing);
        return;
    }

    // ready 与 canvasReady 可能并行触发；用共享 Promise 保证模板只渲染一次。
    if (hudContainerPromise) return hudContainerPromise;

    hudContainerPromise = (async () => {
        const html = await HUD_STATE.renderer("modules/xjzl-token-hud/templates/hud-container.hbs", {});
        if (document.getElementById("xjzl-custom-hud")) return;
        document.body.insertAdjacentHTML('beforeend', html);

        // 绑定“一键收起”按钮事件
        const toggleBtn = document.getElementById("hud-toggle-party-btn");
        if (toggleBtn) {
            toggleBtn.addEventListener("click", () => {
                const container = document.getElementById("xjzl-custom-hud");
                if (container) {
                    container.classList.toggle("hidden-ui");
                    const icon = toggleBtn.querySelector("i");
                    if (container.classList.contains("hidden-ui")) {
                        icon.className = "fas fa-eye-slash";
                    } else {
                        icon.className = "fas fa-eye";
                    }
                }
            });
        }

        setupHudDragging(document.getElementById("xjzl-custom-hud"));
    })();

    try {
        await hudContainerPromise;
    } finally {
        hudContainerPromise = null;
    }
}

/**
 * 为左右小队 HUD 绑定拖动、边界限制和本地位置记忆。
 * 位置只保存在当前浏览器，避免改变世界设置或影响其他玩家。
 * @param {HTMLElement|null} root - 小队 HUD 根节点
 */
function setupHudDragging(root) {
    if (!root) return;

    const storageKey = "xjzl-token-hud.party-positions.v3";
    const FRIENDS_INITIAL_LEFT = 100;
    const clamp = (value, min, max) => Math.min(Math.max(value, min), Math.max(min, max));
    const readPositions = () => {
        try {
            return JSON.parse(localStorage.getItem(storageKey) || "{}") || {};
        } catch (error) {
            console.warn("XJZL Token HUD | 无法读取小队 HUD 位置:", error);
            return {};
        }
    };

    const getRightSafeOffset = () => {
        const value = getComputedStyle(document.documentElement)
            .getPropertyValue("--hud-right-offset");
        return Math.max(60, Number.parseFloat(value) || 60);
    };

    /**
     * 将用户保存的位置限制在当前可用战场区域内。
     * 右侧栏展开时只临时收紧位置，不覆盖用户原本保存的坐标。
     * @param {HTMLElement} side - 左侧或右侧小队 HUD
     * @param {{top:number,left:number}|undefined} position - 用户保存的期望坐标
     */
    const applyPosition = (side, position) => {
        if (!position || !Number.isFinite(position.top) || !Number.isFinite(position.left)) return;

        const rect = side.getBoundingClientRect();
        const leftInset = side.dataset.dragSide === "friends" ? FRIENDS_INITIAL_LEFT : 8;
        const rightInset = side.dataset.dragSide === "enemies" ? getRightSafeOffset() + 8 : 8;
        const maxLeft = Math.max(leftInset, window.innerWidth - rect.width - rightInset);
        const maxTop = Math.max(8, window.innerHeight - rect.height - 8);
        const left = clamp(position.left, leftInset, maxLeft);
        const top = clamp(position.top, 8, maxTop);

        side.style.top = top + "px";
        side.style.bottom = "auto";
        side.style.left = left + "px";
        side.style.right = "auto";
    };

    refreshPartyHudPositions = () => {
        const positions = readPositions();
        root.querySelectorAll("[data-drag-side]").forEach(side => {
            if (!side.classList.contains("is-dragging")) {
                applyPosition(side, positions[side.dataset.dragSide]);
            }
        });
    };

    const persistPosition = side => {
        const positions = readPositions();
        const rect = side.getBoundingClientRect();
        positions[side.dataset.dragSide] = {
            top: Math.round(rect.top),
            left: Math.round(rect.left)
        };

        try {
            localStorage.setItem(storageKey, JSON.stringify(positions));
        } catch (error) {
            console.warn("XJZL Token HUD | 无法保存小队 HUD 位置:", error);
        }
    };

    /**
     * 清除当前浏览器记忆的小队 HUD 坐标，并立即恢复 CSS 初始位置。
     * 通过全局调试入口暴露，便于测试不同分辨率下的默认布局，不增加游戏界面按钮。
     */
    const resetPartyPositions = () => {
        try {
            localStorage.removeItem(storageKey);
        } catch (error) {
            console.warn("XJZL Token HUD | 无法清除小队 HUD 位置:", error);
        }

        root.querySelectorAll("[data-drag-side]").forEach(side => {
            side.style.removeProperty("top");
            side.style.removeProperty("bottom");
            side.style.removeProperty("left");
            side.style.removeProperty("right");
        });
        refreshPartyHudPositions();
    };

    globalThis.XJZLTokenHUD ??= {};
    globalThis.XJZLTokenHUD.resetPartyPositions = resetPartyPositions;
    refreshPartyHudPositions();

    root.querySelectorAll("[data-drag-side]").forEach(side => {
        const sideKey = side.dataset.dragSide;
        const handle = side.querySelector('[data-drag-handle="' + sideKey + '"]');
        if (!handle || handle.dataset.dragBound === "true") return;

        handle.dataset.dragBound = "true";
        handle.addEventListener("pointerdown", event => {
            if (event.button !== 0) return;

            event.preventDefault();
            event.stopPropagation();
            handle.setPointerCapture?.(event.pointerId);

            const rect = side.getBoundingClientRect();
            const offsetX = event.clientX - rect.left;
            const offsetY = event.clientY - rect.top;
            side.classList.add("is-dragging");

            const updatePosition = moveEvent => {
                if (moveEvent.pointerId !== event.pointerId) return;

                const liveRect = side.getBoundingClientRect();
                const leftInset = sideKey === "friends" ? FRIENDS_INITIAL_LEFT : 8;
                const rightInset = sideKey === "enemies" ? getRightSafeOffset() + 8 : 8;
                const maxLeft = Math.max(leftInset, window.innerWidth - liveRect.width - rightInset);
                const maxTop = Math.max(8, window.innerHeight - liveRect.height - 8);
                const left = clamp(moveEvent.clientX - offsetX, leftInset, maxLeft);
                const top = clamp(moveEvent.clientY - offsetY, 8, maxTop);

                side.style.top = top + "px";
                side.style.bottom = "auto";
                side.style.left = left + "px";
                side.style.right = "auto";
            };

            const finishDrag = upEvent => {
                if (upEvent.pointerId !== event.pointerId) return;

                side.classList.remove("is-dragging");
                handle.releasePointerCapture?.(event.pointerId);
                window.removeEventListener("pointermove", updatePosition);
                window.removeEventListener("pointerup", finishDrag);
                window.removeEventListener("pointercancel", finishDrag);
                persistPosition(side);
            };

            window.addEventListener("pointermove", updatePosition);
            window.addEventListener("pointerup", finishDrag);
            window.addEventListener("pointercancel", finishDrag);
        });
    });
}

// 更新缩放比例的辅助函数
function updateHudScale(scale) {
    // 缩放会改变实际占用宽度，因此同步重新限制拖动后的安全边界。
    document.documentElement.style.setProperty("--hud-party-scale", scale);
    requestAnimationFrame(() => refreshPartyHudPositions());
}

/**
 * 根据当前是否存在卡片切换空 HUD 状态。
 * 空容器不显示眼睛按钮和拖动把手；新卡片插入后会自动恢复。
 */
function updateHudEmptyState() {
    const root = document.getElementById("xjzl-custom-hud");
    if (!root) return;
    root.classList.toggle("hud-empty", !root.querySelector(".hud-card"));
}

/**
 * 刷新当前场景所有 Token 的 HUD
 */
function updateAllTokens() {
    if (!canvas.tokens) return;
    const tokens = canvas.tokens.placeables;

    // 更新所有存在的 Token
    tokens.forEach(token => updateSingleToken(token));

    // 清理残留的卡片 (比如切换场景后)
    const currentIds = new Set(tokens.map(t => t.id));
    document.querySelectorAll('#xjzl-custom-hud .hud-card').forEach(card => {
        if (!currentIds.has(card.dataset.tokenId)) card.remove();
    });
    updateHudEmptyState();
}

/**
 * 更新或创建单个 Token 的 HUD 卡片
 * @param {Token} token - Foundry Token 对象
 */
async function updateSingleToken(token) {
    if (!token || !token.actor) return;
    // 忽略我们新增的容器类
    if (token.actor.type === "container") {
        // 如果之前意外创建了卡片，这里确保将其移除
        removeTokenCard(token.id);
        return;
    }
    const id = token.id;

    // --- A. 可见性检查 ---
    // 1. 如果 Token 被 GM 隐藏
    if (token.document.hidden) { removeTokenCard(id); return; }
    // 2. 如果 Token 在战争迷雾中不可见
    if (!token.visible) { removeTokenCard(id); return; }
    // 3. 如果开启了“仅战斗单位”且不在战斗中
    const onlyCombatants = game.settings.get("xjzl-token-hud", "onlyCombatants");
    if (onlyCombatants && !token.inCombat) { removeTokenCard(id); return; }

    // --- B. 数据提取 ---
    // 获取 Actor 属性数据 (根据具体的 System 结构可能需要调整)
    const resources = token.actor.system.resources || {};

    // 1. HP 处理
    const hp = resources.hp;
    if (!hp) return;
    const hpValue = hp.value || 0;
    const hpMax = hp.max || 1;
    const hpPercent = Math.max(0, Math.min(100, (hpValue / hpMax) * 100));

    // 2. 内力 (Neili) 处理
    const neili = resources.mp || { value: 0, max: 0 };
    const neiliValue = neili.value || 0;
    const neiliMax = neili.max || 0;
    const hasNeili = neiliMax > 0;
    const neiliPercent = hasNeili ? Math.max(0, Math.min(100, (neiliValue / neiliMax) * 100)) : 0;

    // 3. 怒气 (Rage) 处理
    const rage = resources.rage || { value: 0, max: 0 };
    // 系统定义 rage.max 固定为 10，这里做一个兼容判断
    const hasRage = (rage.max > 0) || (rage.value !== undefined);
    const rageValue = Math.max(0, Math.min(10, rage.value || 0));

    // 怒气点生成
    const rageDots = Array.from({ length: 10 }, (_, i) => ({
        active: i < rageValue
    }));

    // 4. 阵营判断 (友方/敌方)
    const disposition = token.document.disposition;
    let type = 'neutral';
    if (disposition === 1) type = 'friend';      // 友方
    else if (disposition < 0) type = 'enemy';    // 敌方

    // 暂不显示中立生物
    if (type === 'neutral') { removeTokenCard(id); return; }

    const isEnemy = (type === 'enemy');
    const isGM = game.user.isGM;
    // 敌方单位对玩家隐藏具体数值，仅显示状态描述
    const showExactHp = isGM || !isEnemy;

    // 读取设置：是否完全隐藏敌方条
    const hideEnemyBars = game.settings.get("xjzl-token-hud", "hideEnemyBars");
    // 判定条件：不是GM + 是敌人 + 开启了设置
    const isSecretMode = !isGM && isEnemy && hideEnemyBars;

    // 5. 状态文本计算 (如: 濒临死亡)
    let statusLabel = "未知";
    let statusColorClass = "status-high";
    if (hpPercent >= 100) { statusLabel = "状态完美"; statusColorClass = "status-perfect"; }
    else if (hpPercent >= 75) { statusLabel = "略微擦伤"; statusColorClass = "status-high"; }
    else if (hpPercent >= 50) { statusLabel = "明显受伤"; statusColorClass = "status-mid"; }
    else if (hpPercent >= 25) { statusLabel = "身负重伤"; statusColorClass = "status-low"; }
    else if (hpValue > 0) { statusLabel = "濒临死亡"; statusColorClass = "status-critical"; }
    else { statusLabel = "已死亡"; statusColorClass = "status-dead"; }

    // --- C. DOM 操作 (Direct DOM Manipulation) ---
    // 直接操作 DOM 比重新渲染整个模板性能高得多
    let card = document.getElementById(`hud-token-${id}`);

    // 如果阵营改变 (例如被控制)，由于布局完全不同，需要移除重建
    if (card && !card.classList.contains(type)) {
        card.remove();
        card = null;
        HUD_STATE.tokens.delete(id);
    }
    // 逻辑：优先取 Actor 图片，如果没有（比如默认神秘人），则回退使用 Token 图片
    const actorImg = token.actor.img || token.document.texture.src;
    // 判断是否为视频格式
    const isVideo = actorImg.toLowerCase().endsWith('.webm') || actorImg.toLowerCase().endsWith('.mp4');
    // 1. 卡片不存在：创建新卡片
    if (!card) {
        const data = {
            id, name: token.name, img: actorImg, actorImg: actorImg, isVideo: isVideo,
            hpValue, hpMax, hpPercent,
            neiliValue, neiliMax, neiliPercent, hasNeili,
            rageDots, hasRage,
            type, isEnemy, showExactHp,
            statusLabel, statusColorClass
        };

        const html = await HUD_STATE.renderer("modules/xjzl-token-hud/templates/hud-card.hbs", data);
        const containerId = isEnemy ? 'hud-enemies' : 'hud-friends';
        const container = document.getElementById(containerId);

        if (container) {
            container.insertAdjacentHTML('beforeend', html);
            card = document.getElementById(`hud-token-${id}`);

            // 强制重排后添加 active 类以触发 CSS 滑入动画
            requestAnimationFrame(() => {
                if (card) card.classList.add('active');
            });
            // 初始化状态缓存
            HUD_STATE.tokens.set(id, { hp: hpValue, neili: neiliValue, rage: rageValue });
            updateHudEmptyState();
        }
    }

    // 2. 卡片已存在：局部更新
    if (card) {
        // 应用/移除保密模式类名
        if (isSecretMode) {
            card.classList.add('mode-secret');
        } else {
            card.classList.remove('mode-secret');
        }
        // 2.1 模糊/精确模式切换 (Fog of War for Stats)
        const hpTrack = card.querySelector('.hp-track');
        const neiliTrack = card.querySelector('.neili-track');
        if (showExactHp) {
            card.classList.add('mode-exact');
            card.classList.remove('mode-obscured');
            if (hpTrack) hpTrack.classList.remove('obscured');
            if (neiliTrack) neiliTrack.classList.remove('obscured');
        } else {
            card.classList.remove('mode-exact');
            card.classList.add('mode-obscured');
            if (hpTrack) hpTrack.classList.add('obscured');
            if (neiliTrack) neiliTrack.classList.add('obscured');
        }

        // 2.2 基础信息更新 (名字、头像)
        const nameEl = card.querySelector('.hud-name');
        if (nameEl && nameEl.innerText !== token.name) nameEl.innerText = token.name;

        // 获取当前决定的新图像路径和类型
        const newImg = actorImg;
        const newIsVideo = newImg.toLowerCase().endsWith('.webm') || newImg.toLowerCase().endsWith('.mp4');

        // --- 头像更新逻辑 ---
        const avatarContainer = card.querySelector('.hud-avatar-container');
        if (avatarContainer) {
            const currentAvatar = avatarContainer.querySelector('.hud-avatar');
            if (currentAvatar && currentAvatar.getAttribute('src') !== newImg) {
                const isCurrentlyVideo = currentAvatar.tagName.toLowerCase() === 'video';

                // 如果媒体类型改变了 (比如从图片变成了视频)，直接替换整个内部 DOM
                if (isCurrentlyVideo !== newIsVideo) {
                    if (newIsVideo) {
                        avatarContainer.innerHTML = `<video class="hud-avatar" src="${newImg}" autoplay loop muted playsinline></video>`;
                    } else {
                        avatarContainer.innerHTML = `<img class="hud-avatar" src="${newImg}" alt="${token.name}">`;
                    }
                } else {
                    // 类型没变，直接换 src
                    currentAvatar.src = newImg;
                    if (newIsVideo) {
                        currentAvatar.load(); // 切换视频源需要调用 load() 重新加载
                        currentAvatar.play().catch(() => { });
                    }
                }
            }
        }

        // --- 绝招立绘更新逻辑 ---
        const ultContainer = card.querySelector('.ultimate-overlay');
        if (ultContainer) {
            const currentUlt = ultContainer.querySelector('.ultimate-img');
            if (currentUlt && currentUlt.getAttribute('src') !== newImg) {
                const isCurrentlyVideo = currentUlt.tagName.toLowerCase() === 'video';

                if (isCurrentlyVideo !== newIsVideo) {
                    if (newIsVideo) {
                        currentUlt.outerHTML = `<video class="ultimate-img" src="${newImg}" autoplay loop muted playsinline></video>`;
                    } else {
                        currentUlt.outerHTML = `<img class="ultimate-img" src="${newImg}">`;
                    }
                } else {
                    currentUlt.src = newImg;
                    if (newIsVideo) currentUlt.load();
                }
            }
        }

        // 2.3 数值文本更新
        const updateText = (selector, val) => {
            const el = card.querySelector(selector);
            if (el) el.innerText = val;
        };
        updateText('.hp-text-overlay .current-val', hpValue);
        updateText('.hp-text-overlay .max-val', hpMax);
        updateText('.neili-text-overlay .current-val', neiliValue);
        updateText('.neili-text-overlay .max-val', neiliMax);

        // 2.4 状态文字颜色更新
        const statusEl = card.querySelector('.status-label');
        if (statusEl) {
            statusEl.innerText = statusLabel;
            statusEl.className = `status-label ${statusColorClass}`;
        }

        // --- 2.5 动画与特效逻辑 ---
        // 对比上一次的状态，决定播放什么动画
        const lastState = HUD_STATE.tokens.get(id) || { hp: hpValue, neili: neiliValue, rage: rageValue };
        const { hp: lastHp, neili: lastNeili } = lastState;

        let animToPlay = null;

        // -> 怒气更新
        if (hasRage) {
            const segEls = card.querySelectorAll('.rage-segment');
            segEls.forEach((seg, index) => {
                if (index < rageValue) seg.classList.add('active');
                else seg.classList.remove('active');
            });

            // 怒气过载特效 (>=5点)
            if (rageValue >= 5) {
                card.classList.add('rage-overload');
                const intensity = (rageValue - 4) / 6;
                card.style.setProperty('--rage-intensity', intensity.toFixed(2));
            } else {
                card.classList.remove('rage-overload');
                card.style.removeProperty('--rage-intensity');
            }

            // 绝招动画由系统绝招聊天卡确认后触发，怒气下降本身不再播放绝招动画

        }

        // -> HP 更新
        const hpGhost = card.querySelector('.hp-track .hp-ghost');
        const hpBar = card.querySelector('.hp-track .hp-bar');
        if (hpBar) hpBar.style.width = `${hpPercent}%`;

        if (hpValue < lastHp) {
            // 受伤：幽灵条滞后显示 (CSS transition)
            if (hpGhost) hpGhost.style.width = `${hpPercent}%`;
            if (!animToPlay) animToPlay = 'effect-shake';
        } else if (hpValue > lastHp) {
            // 治疗：幽灵条立即跟进，防止出现“先扣血再回血”的视觉错误
            if (hpGhost) {
                hpGhost.style.transition = 'none';
                hpGhost.style.width = `${hpPercent}%`;
                void hpGhost.offsetWidth; // 强制回流 (Force Reflow)
                hpGhost.style.transition = '';
            }
            if (!animToPlay) animToPlay = 'effect-heal';
        } else {
            if (hpGhost) hpGhost.style.width = `${hpPercent}%`;
        }

        // -> 内力更新 (逻辑同 HP)
        if (hasNeili && neiliTrack) {
            const neiliGhost = neiliTrack.querySelector('.neili-ghost');
            const neiliBar = neiliTrack.querySelector('.neili-bar');
            if (neiliBar) neiliBar.style.width = `${neiliPercent}%`;

            if (neiliValue < lastNeili) {
                if (neiliGhost) neiliGhost.style.width = `${neiliPercent}%`;
                if (!animToPlay) animToPlay = 'effect-neili-cast';
            } else if (neiliValue > lastNeili) {
                if (neiliGhost) {
                    neiliGhost.style.transition = 'none';
                    neiliGhost.style.width = `${neiliPercent}%`;
                    void neiliGhost.offsetWidth;
                    neiliGhost.style.transition = '';
                }
                if (!animToPlay) animToPlay = 'effect-neili-surge';
            } else {
                if (neiliGhost) neiliGhost.style.width = `${neiliPercent}%`;
            }
        }

        // 死亡变灰处理
        if (hpValue <= 0) card.classList.add('dead');
        else card.classList.remove('dead');

        // 触发最终决定的动画
        if (animToPlay) triggerAnimation(card, animToPlay);

        // 更新状态缓存
        HUD_STATE.tokens.set(id, { hp: hpValue, neili: neiliValue, rage: rageValue });
    }
}

/**
 * 安全移除卡片并清理缓存
 */
function removeTokenCard(tokenId) {
    const card = document.getElementById("hud-token-" + tokenId);
    if (card) {
        card.classList.remove('active');
        // 等待 CSS 离场动画结束后移除 DOM (300ms)
        setTimeout(() => {
            card.remove();
            updateHudEmptyState();
        }, 300);
    }
    HUD_STATE.tokens.delete(tokenId);
    updateHudEmptyState();
}
/**
 * 触发 CSS 动画类 (自动重置)
 */
function triggerAnimation(element, className) {
    // 移除互斥的动画类
    element.classList.remove('effect-shake', 'effect-heal', 'effect-neili-cast', 'effect-neili-surge', 'effect-ultimate');

    // 强制重绘
    void element.offsetWidth;

    element.classList.add(className);

    // 懒加载播放逻辑
    if (className === 'effect-ultimate') {
        const video = element.querySelector('.ultimate-video');
        if (video) {
            // 1. 如果还没有 src，从 data-src 读取并赋值
            if (!video.src) {
                // 这里的 dataset.src 对应 HTML 里的 data-src
                // window.location.origin 确保生成完整的绝对路径
                const videoPath = video.dataset.src;
                if (videoPath) {
                    video.src = videoPath;
                    video.load(); // 告诉浏览器加载资源
                }
            }

            // 2. 播放
            video.currentTime = 0;
            video.play().catch(e => {
                // 忽略未交互导致的自动播放失败警告
                // console.warn("XJZL HUD | Video play prevented:", e);
            });
        }
    }

    // 动画结束后清理类名
    setTimeout(() => {
        if (element) element.classList.remove(className);
    }, 1500);
}