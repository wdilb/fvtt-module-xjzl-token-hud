/**
 * =================================================================
 *  My Token HUD - 主程序入口 (Main Entry Point)
 *  作者: Tiwelee
 *  适配: FVTT V12 / V13
 *  描述: 这是一个高性能的战斗状态追踪 HUD，支持实时血量、内力、怒气显示及特效。
 * =================================================================
 */

// --- 全局状态管理对象 ---
const HUD_STATE = {
    // 记录 Token 上一次的数值(HP/内力/怒气)，用于计算动画方向 (涨/跌)
    // Key: TokenID, Value: { hp, neili, rage }
    tokens: new Map(),

    // V13 兼容性：模板加载器引用
    loader: null,
    renderer: null
};

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
});

/**
 * Hook: ready
 * 游戏核心数据加载完毕，画布准备好之前。
 */
Hooks.once("ready", function () {
    if (canvas.ready) {
        initHudSystem();
    }
});

/**
 * Hook: canvasReady
 * 画布渲染完成。切换场景时也会触发此 Hook。
 */
Hooks.on("canvasReady", function () {
    initHudSystem();
});

/**
 * 初始化 HUD 系统容器并刷新所有 Token
 * 注意：此处不再强制计算侧边栏位置，依赖 CSS 默认值 (60px) 处理初始状态
 */
function initHudSystem() {
    createHUDContainer();
    updateAllTokens();
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
 * 监听设置变更
 */
Hooks.on("updateSetting", (setting) => {
    if (setting.key === "xjzl-token-hud.onlyCombatants") {
        updateAllTokens();
    }
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
    // 使用 foundry.utils.hasProperty 进行深度检查，只关心 attributes 变化
    const hasResourceChange = foundry.utils.hasProperty(changes, "system.resources");

    if (!hasResourceChange) return;

    // 刷新该 Actor 关联的所有 Token
    const tokens = actor.getActiveTokens();
    tokens.forEach(t => updateSingleToken(t));
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
Hooks.on("deleteCombat", (combat) => { // 战斗结束
    updateAllTokens();
});


// =================================================================
// 3. 核心逻辑 (Core Logic)
// =================================================================

/**
 * 动态设置 CSS 变量，控制右侧 HUD 的偏移量
 * @param {boolean} isCollapsed - 侧边栏是否折叠
 */
function updateSidebarOffset(isCollapsed) {
    // 展开状态：侧边栏宽度(约300px) + 安全间距 = 360px
    const EXPANDED_WIDTH = 360;

    // 折叠状态：侧边栏宽度(约32px) + 安全间距 = 60px
    const COLLAPSED_WIDTH = 60;

    // 如果 isCollapsed 为 true，使用 60px；否则使用 360px
    const offset = isCollapsed ? COLLAPSED_WIDTH : EXPANDED_WIDTH;

    // 修改 CSS 变量，触发 CSS 中的 transition 动画
    document.documentElement.style.setProperty('--hud-right-offset', `${offset}px`);
}

/**
 * 创建主容器 (单例模式)
 */
async function createHUDContainer() {
    if (document.getElementById("xjzl-custom-hud")) return;

    const html = await HUD_STATE.renderer("modules/xjzl-token-hud/templates/hud-container.hbs", {});
    document.body.insertAdjacentHTML('beforeend', html);
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
    document.querySelectorAll('.hud-card').forEach(card => {
        if (!currentIds.has(card.dataset.tokenId)) card.remove();
    });
}

/**
 * 更新或创建单个 Token 的 HUD 卡片
 * @param {Token} token - Foundry Token 对象
 */
async function updateSingleToken(token) {
    if (!token || !token.actor) return;
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
    // 1. 卡片不存在：创建新卡片
    if (!card) {
        const data = {
            id, name: token.name, img: token.document.texture.src, actorImg: actorImg,
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
        }
    }

    // 2. 卡片已存在：局部更新
    if (card) {
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

        const imgEl = card.querySelector('.hud-avatar');
        const newImg = token.document.texture.src;
        if (imgEl && imgEl.getAttribute('src') !== newImg) imgEl.src = newImg;

        // 绝招立绘更新 (确保如果换了立绘，大招图也跟着变)
        const ultImgEl = card.querySelector('.ultimate-img');
        if (ultImgEl && ultImgEl.getAttribute('src') !== actorImg) {
            ultImgEl.src = actorImg;
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
        const { hp: lastHp, neili: lastNeili, rage: lastRage } = lastState;

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

            // 绝招触发：怒气减少时，判定为释放了大招 -> 播放 Cut-in 动画
            if (rageValue < lastRage) animToPlay = 'effect-ultimate';
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
    const card = document.getElementById(`hud-token-${tokenId}`);
    if (card) {
        card.classList.remove('active');
        // 等待 CSS 离场动画结束后移除 DOM (300ms)
        setTimeout(() => card.remove(), 300);
    }
    HUD_STATE.tokens.delete(tokenId);
}

/**
 * 触发 CSS 动画类 (自动重置)
 */
function triggerAnimation(element, className) {
    // 移除互斥的动画类，重置状态
    element.classList.remove('effect-shake', 'effect-heal', 'effect-neili-cast', 'effect-neili-surge', 'effect-ultimate');

    // 强制浏览器重绘 (Reflow) 以重启动画
    void element.offsetWidth;

    element.classList.add(className);

    // 特殊处理：绝招视频播放
    if (className === 'effect-ultimate') {
        const video = element.querySelector('.ultimate-video');
        if (video) {
            video.currentTime = 0;
            // 捕获播放错误 (例如用户未交互导致无法自动播放)
            video.play().catch(e => { });
        }
    }

    // 动画结束后自动清理类名 (1.5s 是保守估计，对应最长动画时间)
    setTimeout(() => {
        if (element) element.classList.remove(className);
    }, 1500);
}