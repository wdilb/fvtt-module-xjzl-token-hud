/**
 * Player Control HUD Logic
 * 玩家控制 HUD 逻辑类
 */
export class PlayerHUD {

    // 定义一个防抖函数变量，防止短时间内多次重绘导致性能问题
    static debouncedRender = null;

    /**
     * 初始化监听器
     * 在 Foundry VTT 启动或模块加载时调用
     */
    static init() {
        // 创建防抖版本的 renderHUD
        // 50ms 的延迟足以合并人类的框选操作，但人眼感觉不到延迟
        this.debouncedRender = foundry.utils.debounce(() => this.renderHUD(), 50);

        // 1. 监听 Token 选中 (使用防抖)
        // 无论是选中 1 个还是框选 100 个，50ms 内的操作都会被合并为一次调用
        Hooks.on("controlToken", () => this.debouncedRender());

        // 2. 监听数据变化 (使用防抖)
        // 只有当变化的 Actor 是当前被选中的 Actor 时才重绘
        Hooks.on("updateActor", (actor) => {
            if (this.currentActor && this.currentActor.id === actor.id) this.debouncedRender();
        });

        // 3. 物品更新 (使用防抖)
        // 例如：消耗品数量变化、装备穿脱、招式修改
        Hooks.on("updateItem", (item) => {
            if (this.currentActor && this.currentActor.id === item.parent?.id) this.debouncedRender();
        });

        // 4. 战斗轮次更新 (使用防抖)
        // 战斗回合变化可能导致资源或冷却刷新
        Hooks.on("updateCombat", () => this.debouncedRender());

        // 5. 删除 Token (强制刷新)
        Hooks.on("deleteToken", () => this.debouncedRender());
    }

    /**
     * 获取当前控制的 Actor
     * 规则：必须只选中一个 Token，且玩家拥有该 Token 的 Actor 权限
     */
    static get currentActor() {
        const tokens = canvas.tokens.controlled;
        if (tokens.length !== 1) return null;
        const token = tokens[0];
        if (!token.actor) return null;
        if (!token.actor.isOwner) return null;
        return token.actor;
    }

    /**
     * [辅助方法] 清洗富文本
     * 将 HTML 转换为适合 Tooltip 显示的纯文本，但保留换行
     */
    static cleanRichText(text) {
        if (!text) return "";
        return text
            .replace(/<br\s*\/?>/gi, '\n') // 将 HTML 换行转为文本换行
            .replace(/<\/(p|div|h[1-6]|li|ul|ol)>/gi, '\n') // 将块级元素结束符转为换行
            .replace(/<[^>]+>/g, '')       // 删掉剩余所有标签
            .replace(/&nbsp;/g, ' ')       // 修复空格
            .replace(/"/g, '&quot;')       // 修复引号
            .trim();
    };

    /**
     * 构建详细的招式 Tooltip HTML
     * 复刻 Character Sheet 的样式，显示类型、消耗、伤害预览等
     * 
     * @param {Item} item - 武学物品对象
     * @param {Object} move - 招式数据对象
     * @param {Object} derivedData - (可选) 计算后的衍生数据，包含 damage 和 cost
     */
    static _buildMoveTooltip(item, move, derivedData) {
        // 1. 准备基础标签数据
        // 获取本地化文本，如果没找到则显示 key
        const typeLabel = game.i18n.localize(`XJZL.Wuxue.Type.${move.type}`) || move.type;
        // 计算后的等级 (如果有 computedLevel 属性，否则显示未知)
        const levelVal = move.computedLevel !== undefined ? move.computedLevel : (derivedData?.level || "?");
        const levelLabel = game.i18n.localize(`XJZL.Wuxue.Moves.Levels.${levelVal}`) || `Lv.${levelVal}`;

        // 2. 定义样式常量 (内联样式以确保在 HUD 中正确显示)
        const sContainer = "text-align:left; min-width:220px; max-width:280px; font-family:var(--font-serif); font-size:13px;";
        const sHeader = "border-bottom:1px solid rgba(255,255,255,0.2); margin-bottom:6px; padding-bottom:4px; display:flex; justify-content:space-between; align-items:center;";
        const sTypeBadge = "font-size:10px; color:#ffd700; border:1px solid #555; padding:1px 5px; border-radius:4px; background:rgba(0,0,0,0.3);";
        const sSubInfo = "display:flex; justify-content:space-between; font-size:11px; color:#aaa; margin-bottom:6px;";

        // 开始构建 HTML 字符串
        let html = `<div style='${sContainer}'>`;

        // --- 头部: 招式名 + 类型 Badge ---
        html += `<div style='${sHeader}'>
                    <span style='font-weight:bold; color:#fff; font-size:14px;'>${move.name}</span>
                    <span style='${sTypeBadge}'>${typeLabel}</span>
                 </div>`;

        // --- 次级信息: 所属武学 | 等级 | 距离 ---
        html += `<div style='${sSubInfo}'>
                    <span>${item.name} · ${levelLabel}</span>
                    ${move.range ? `<span><i class='fas fa-ruler-horizontal'></i> ${move.range}</span>` : ''}
                 </div>`;

        // --- 消耗行 (根据 derivedData 或 move.cost) ---
        // 优先使用计算后的 currentCost，如果没有则使用基础 cost
        const cost = derivedData?.cost || move.currentCost || move.cost || {};
        if (cost.mp || cost.rage || cost.hp) {
            html += `<div style='display:flex; gap:10px; font-size:11px; margin-bottom:6px; background:rgba(255,255,255,0.05); padding:3px 5px; border-radius:3px;'>`;
            if (cost.mp) html += `<span style='color:#3498db'><i class='fas fa-tint'></i> ${cost.mp}</span>`;
            if (cost.rage) html += `<span style='color:#e74c3c'><i class='fas fa-fire'></i> ${cost.rage}</span>`;
            if (cost.hp) html += `<span style='color:#e91e63'><i class='fas fa-heart'></i> ${cost.hp}</span>`;
            html += `</div>`;
        }

        // --- 伤害预览 (绿色高亮) ---
        if (derivedData && derivedData.damage) {
            html += `<div style='margin-bottom:6px; color:#2ecc71; font-size:12px; font-family:Consolas; border-left: 2px solid #2ecc71; padding-left: 4px;'>
                        <i class='fas fa-fist-raised'></i> 预计伤害: ${derivedData.damage}
                     </div>`;
        }

        // --- 描述文本 ---
        if (move.description) {
            let desc = this.cleanRichText(move.description);
            // 限制长度防止 HUD 遮挡太多屏幕，保留120字
            if (desc.length > 120) desc = desc.substring(0, 120) + "...";
            // white-space: pre-wrap 用于保留换行符
            html += `<div style='font-size:11px; color:#ccc; line-height:1.4; white-space: pre-wrap; margin-top:4px; border-top:1px dashed #444; padding-top:4px;'>${desc}</div>`;
        }

        // --- 自动化/机制说明 (蓝色框) ---
        if (move.automationNote) {
            const note = this.cleanRichText(move.automationNote);
            html += `<div style='margin-top:6px; font-size:10px; color:#81d4fa; background:rgba(41, 182, 246, 0.1); padding:3px; border-left:2px solid #29b6f6;'>
                        <i class='fas fa-robot'></i> ${note}
                     </div>`;
        }

        // --- 底部操作提示 ---
        html += `<hr style='border:0; border-top:1px solid #444; margin:6px 0;'>
                 <div style='display:flex; justify-content:space-between; font-size:10px; color:#777;'>
                    <span><i class='fas fa-mouse-pointer'></i> 左键出招</span>
                    <span><i class='fas fa-comment-dots'></i> 右键发送</span>
                 </div>`;

        html += `</div>`;
        return html;
    }

    /**
     * 通用物品 Tooltip 构建器 (消耗品/装备)
     */
    static _buildItemTooltip(item) {
        // 样式定义
        const sContainer = "text-align:left; min-width:200px; max-width:300px; font-family:var(--font-serif); font-size:13px;";
        const sHeader = "border-bottom:1px solid rgba(255,255,255,0.2); margin-bottom:6px; padding-bottom:4px; font-weight:bold; color:#fff; font-size:14px;";
        const sDesc = "font-size:11px; color:#ccc; line-height:1.5; white-space: pre-wrap; margin-top:4px;";
        // 显眼的自动化说明样式 (蓝色背景 + 左侧亮条)
        const sAuto = "margin-top:8px; font-size:11px; color:#81d4fa; background:rgba(41, 182, 246, 0.15); padding:5px; border-left:3px solid #29b6f6; line-height: 1.4;";

        let html = `<div style='${sContainer}'>`;

        // 1. 标题
        html += `<div style='${sHeader}'>
                    ${item.name}
                    ${item.system.quantity > 1 ? `<span style='float:right; font-size:11px; color:#aaa'>x${item.system.quantity}</span>` : ''}
                 </div>`;

        // 2. 描述 (不截断，保留换行)
        if (item.system.description) {
            const desc = this.cleanRichText(item.system.description);
            html += `<div style='${sDesc}'>${desc}</div>`;
        } else {
            html += `<div style='${sDesc}; font-style:italic; color:#666;'>暂无描述</div>`;
        }

        // 3. 自动化说明 (显眼且换行)
        if (item.system.automationNote) {
            const note = this.cleanRichText(item.system.automationNote);
            html += `<div style='${sAuto}'>
                        <strong style='display:block; margin-bottom:2px; color:#29b6f6;'><i class='fas fa-robot'></i> 自动化效果:</strong>
                        ${note}
                     </div>`;
        }

        // 4. 底部操作提示 (装备和消耗品稍有不同，这里做通用处理)
        const isEquip = item.type !== "consumable" && item.type !== "misc";
        const clickAction = isEquip ? "穿戴/脱下" : "使用";

        html += `<hr style='border:0; border-top:1px solid #444; margin:6px 0;'>
                 <div style='display:flex; justify-content:space-between; font-size:10px; color:#777;'>
                    <span><i class='fas fa-mouse-pointer'></i> 左键${clickAction}</span>
                    <span><i class='fas fa-comment-dots'></i> 右键发送</span>
                 </div>`;

        html += `</div>`;
        return html;
    }

    /**
     * 渲染 HUD 主逻辑
     * 负责准备 HTML 并将其插入到页面中
     */
    static async renderHUD() {
        const actor = this.currentActor;
        const hudEl = document.getElementById("xjzl-player-hud");

        // 记录我们打算渲染谁 (ID)
        const targetId = actor ? actor.id : null;

        if (!actor) {
            if (hudEl) hudEl.remove();
            return;
        }

        try {
            // 获取渲染所需的数据
            const data = await this.getData(actor);

            // 数据准备期间，玩家可能换了选中目标，再次检查
            if (this.currentActor?.id !== targetId) return;

            // 渲染 Handlebars 模板
            const renderer = foundry.applications?.handlebars?.renderTemplate || globalThis.renderTemplate;
            const html = await renderer("modules/xjzl-token-hud/templates/hud-player.hbs", data);

            // 模板渲染期间再次检查
            if (this.currentActor?.id !== targetId) return;

            // DOM 操作：插入或替换 HUD
            const currentHudEl = document.getElementById("xjzl-player-hud");

            if (currentHudEl) {
                // 如果已存在，进行替换以保持位置或折叠状态
                const temp = document.createElement('div');
                temp.innerHTML = html;
                const newEl = temp.firstElementChild;

                // 保持折叠状态
                if (currentHudEl.classList.contains('collapsed')) {
                    newEl.classList.add('collapsed');
                }
                currentHudEl.replaceWith(newEl);
            } else {
                // 如果不存在，追加到 body
                document.body.insertAdjacentHTML('beforeend', html);
            }

            // 重新绑定事件监听器
            const newHudEl = document.getElementById("xjzl-player-hud");
            if (newHudEl) {
                this.activateListeners(newHudEl, actor);
            }

        } catch (err) {
            console.error("PlayerHUD Render Error:", err);
        }
    }

    /**
     * 数据准备核心方法
     * 从 Actor 和 Item 中提取 HUD 所需的所有状态
     */
    static async getData(actor) {
        const sys = actor.system;
        const res = sys.resources || {};
        const combat = sys.combat || {};

        // === A. 基础数值 (血量、内力、怒气) ===
        const hp = res.hp || { value: 0, max: 1 };
        const mp = res.mp || { value: 0, max: 1 };
        const rage = res.rage || { value: 0 };
        const rageVal = Math.max(0, Math.min(10, rage.value));

        const hutiValue = res.huti || 0;
        const hutiPercent = hp.max ? Math.min(100, (hutiValue / hp.max) * 100) : 0;

        // === B. 常用招式 (Pinned Moves) - [逻辑重写] ===
        const pinnedList = actor.getFlag("xjzl-system", "pinnedMoves") || [];
        const shortcuts = [];

        if (Array.isArray(pinnedList)) {
            for (const str of pinnedList) {
                if (typeof str !== 'string') continue;

                // 解析存储的字符串 "ItemId.MoveId"
                const [itemId, moveId] = str.split(".");
                const item = actor.items.get(itemId);

                if (item) {
                    const move = item.system.moves?.find(m => m.id === moveId);
                    if (move) {
                        // [关键步骤] 1. 计算实时数据 (伤害、消耗)
                        // 我们尝试调用 Item 类中的 calculateMoveDamage 方法
                        // 如果 Item 类没有这个方法，提供一个默认空对象防报错
                        let derived = { damage: 0, cost: move.cost };

                        if (typeof item.calculateMoveDamage === 'function') {
                            // 注意：calculateMoveDamage 通常返回 { damage: X, breakdown: Y, cost: Z ... }
                            derived = item.calculateMoveDamage(moveId) || derived;
                        }

                        // [关键步骤] 2. 调用构建器生成 HTML Tooltip
                        const detailedTooltip = this._buildMoveTooltip(item, move, derived);

                        shortcuts.push({
                            item: item,
                            move: move,
                            // 这里不再是简单的 moveDesc，而是完整的 HTML
                            tooltip: detailedTooltip
                        });
                    }
                }
            }
        }

        // === C. 消耗品处理 (保持原有逻辑，稍作清洗) ===
        const processItem = (item) => {
            return {
                id: item.id,
                name: item.name,
                img: item.img,
                system: item.system,
                // 这里直接生成完整的 HTML tooltip
                tooltip: this._buildItemTooltip(item) 
            };
        };
        const consumables = (actor.itemTypes?.consumable || []).map(processItem);

        // === D. 装备分组逻辑 ===
        const typeMapping = {
            weapon: { label: "武器", items: [] },
            head: { label: game.i18n.localize("XJZL.Armor.Type.Head") || "头饰", items: [] },
            top: { label: game.i18n.localize("XJZL.Armor.Type.Top") || "上衣", items: [] },
            bottom: { label: game.i18n.localize("XJZL.Armor.Type.Bottom") || "下装", items: [] },
            shoes: { label: game.i18n.localize("XJZL.Armor.Type.Shoes") || "鞋子", items: [] },
            necklace: { label: game.i18n.localize("XJZL.Armor.Type.Necklace") || "项链", items: [] },
            ring: { label: game.i18n.localize("XJZL.Armor.Type.Ring") || "戒指", items: [] },
            earring: { label: game.i18n.localize("XJZL.Armor.Type.Earring") || "耳环", items: [] },
            accessory: { label: game.i18n.localize("XJZL.Armor.Type.Accessory") || "饰品", items: [] },
            qizhen: { label: "奇珍", items: [] },
            other: { label: "其他装备", items: [] }
        };

        const allEquips = [
            ...(actor.itemTypes?.weapon || []),
            ...(actor.itemTypes?.armor || []),
            ...(actor.itemTypes?.qizhen || [])
        ];

        // 遍历所有装备并分类
        for (const item of allEquips) {
            const processed = processItem(item);
            if (item.type === "weapon") {
                typeMapping.weapon.items.push(processed);
            } else if (item.type === "qizhen") {
                typeMapping.qizhen.items.push(processed);
            } else if (item.type === "armor") {
                const subType = item.system.type;
                if (typeMapping[subType]) {
                    typeMapping[subType].items.push(processed);
                } else {
                    typeMapping.other.items.push(processed);
                }
            } else {
                typeMapping.other.items.push(processed);
            }
        }

        // 转换为数组供 HBS 遍历
        const equipmentGroups = Object.entries(typeMapping)
            .filter(([key, group]) => group.items.length > 0)
            .map(([key, group]) => ({
                key: key,
                label: group.label,
                items: group.items,
                isCollapsed: false
            }));

        // === E. 技能与属性分组 ===
        const skillGroupsStructure = [
            { key: "wuxing", skills: ["wuxue", "jianding", "bagua", "shili"] },
            { key: "liliang", skills: ["jiaoli", "zhengtuo", "paozhi", "qinbao"] },
            { key: "shenfa", skills: ["qianxing", "qiaoshou", "qinggong", "mashu"] },
            { key: "tipo", skills: ["renxing", "biqi", "rennai", "ningxue"] },
            { key: "neixi", skills: ["liaoshang", "chongxue", "lianxi", "duqi"] },
            { key: "qigan", skills: ["dianxue", "zhuizong", "tancha", "dongcha"] },
            { key: "shencai", skills: ["jiaoyi", "qiman", "shuofu", "dingli"] }
        ];

        const skillGroups = skillGroupsStructure.map(group => {
            const statKey = group.key;
            return {
                key: statKey,
                label: game.i18n.localize(`XJZL.Stats.${statKey.charAt(0).toUpperCase() + statKey.slice(1)}`),
                value: sys.stats?.[statKey]?.total || 0,
                skills: group.skills.map(skillKey => ({
                    key: skillKey,
                    label: game.i18n.localize(`XJZL.Skills.${skillKey.charAt(0).toUpperCase() + skillKey.slice(1)}`),
                    value: sys.skills?.[skillKey]?.total || 0
                }))
            };
        });

        // === F. 技艺分组 ===
        const learnedArts = [];
        for (const [key, artData] of Object.entries(sys.arts || {})) {
            if (artData.total > 0) {
                learnedArts.push({
                    key: key,
                    label: game.i18n.localize(`XJZL.Arts.${key.charAt(0).toUpperCase() + key.slice(1)}`),
                    value: artData.total || 0
                });
            }
        }

        // === G. 内功与架招状态 ===
        let neigongElement = "none";
        if (sys.martial?.active_neigong) {
            const ng = actor.items.get(sys.martial.active_neigong);
            if (ng) neigongElement = ng.system.element;
        }

        let stanceName = null;
        let stanceDesc = null;
        if (sys.martial?.stanceActive && sys.martial.stanceItemId) {
            const stItem = actor.items.get(sys.martial.stanceItemId);
            const stMove = stItem?.system.moves?.find(m => m.id === sys.martial.stance);
            if (stMove) {
                stanceName = stMove.name;
                // 复用新的 Tooltip 构建器来生成架招描述
                stanceDesc = this._buildMoveTooltip(stItem, stMove);
            }
        }

        const realmLevel = sys.cultivation?.realmLevel ?? 0;
        const realmName = game.i18n.localize(`XJZL.Realm.${realmLevel}`);

        // 返回所有数据
        return {
            actorImg: actor.img,
            realmName, neigongElement, stanceName, stanceDesc,
            hp, mp, rage, rageVal, hutiValue, hutiPercent,
            hpPercent: (hp.value / hp.max) * 100,
            mpPercent: (mp.value / mp.max) * 100,
            rageDots: Array.from({ length: 10 }, (_, i) => ({ active: i < rageVal })),

            leftStats: [
                { label: "格挡", value: combat.blockTotal || 0 },
                { label: "闪避", value: combat.dodgeTotal || 0 },
                { label: "看破", value: combat.kanpoTotal || 0 },
                { label: "速度", value: combat.speedTotal || 0 }
            ],

            shortcuts,          // 包含 rich html tooltip 的招式列表
            consumables,        // 消耗品
            equipmentGroups,    // 装备
            skillGroups,        // 技能
            learnedArts,        // 技艺

            isCollapsed: false
        };
    }

    /**
     * DOM 事件监听器绑定
     */
    static activateListeners(html, actor) {
        if (!html) return;

        // 0. 资源输入框 (双向绑定)
        html.querySelectorAll('input.res-input').forEach(input => {
            input.addEventListener("focus", ev => ev.currentTarget.select());
            input.addEventListener("change", async (ev) => {
                ev.preventDefault(); ev.stopPropagation();
                const target = ev.currentTarget.dataset.target;
                const value = Number(ev.currentTarget.value);
                if (!target || isNaN(value)) return;
                await actor.update({ [target]: value });
            });
        });

        // 1. 打开完整角色卡
        html.querySelector('[data-action="open-sheet"]')?.addEventListener("click", (ev) => {
            ev.preventDefault(); actor.sheet.render(true);
        });

        // 2. 属性/技能/技艺检定
        html.querySelectorAll('[data-action="roll-stat"]').forEach(el => {
            el.addEventListener("click", async (ev) => {
                ev.preventDefault(); ev.stopPropagation();
                const key = ev.currentTarget.dataset.key;
                if (key) await actor.rollAttributeTest(key);
            });
        });

        // 3. 招式操作 (左键: 出招 | 右键: 发送详情)
        html.querySelectorAll('[data-action="use-move"]').forEach(el => {
            el.addEventListener("click", async (ev) => {
                ev.preventDefault(); ev.stopPropagation();
                const { itemId, moveId } = ev.currentTarget.dataset;
                const item = actor.items.get(itemId);
                if (item) await item.roll(moveId);
            });
            el.addEventListener("contextmenu", async (ev) => {
                ev.preventDefault(); ev.stopPropagation();
                const { itemId, moveId } = ev.currentTarget.dataset;
                const item = actor.items.get(itemId);
                if (item) await item.postMoveToChat(moveId);
            });
        });

        // 4. 物品操作 (左键: 使用 | 右键: 发送)
        html.querySelectorAll('[data-action="use-item"]').forEach(el => {
            el.addEventListener("click", async (ev) => {
                ev.preventDefault(); ev.stopPropagation();
                const itemId = ev.currentTarget.dataset.itemId;
                const item = actor.items.get(itemId);
                if (item) await item.use();
            });
            el.addEventListener("contextmenu", async (ev) => {
                ev.preventDefault(); ev.stopPropagation();
                const itemId = ev.currentTarget.dataset.itemId;
                const item = actor.items.get(itemId);
                if (item) await item.postToChat();
            });
        });

        // 5. 装备操作 (左键: 穿脱/选穴位 | 右键: 发送)
        html.querySelectorAll('[data-action="toggle-equip"]').forEach(el => {
            el.addEventListener("contextmenu", async (ev) => {
                ev.preventDefault(); ev.stopPropagation();
                const itemId = ev.currentTarget.dataset.itemId;
                const item = actor.items.get(itemId);
                if (item) await item.postToChat();
            });

            el.addEventListener("click", async (ev) => {
                ev.preventDefault(); ev.stopPropagation();
                const itemId = ev.currentTarget.dataset.itemId;
                const item = actor.items.get(itemId);
                if (!item) return;

                // 简单的穿脱
                if (item.system.equipped) {
                    return await item.toggleEquip();
                }

                // 奇珍特殊处理：需要选择穴位
                if (item.type === "qizhen") {
                    const availableSlots = actor.getAvailableAcupoints();
                    if (!availableSlots || availableSlots.length === 0) {
                        return ui.notifications.warn("没有可用的已打通穴位。");
                    }

                    const content = `
                    <div class="form-group">
                        <label>选择放入穴位:</label>
                        <div class="form-fields">
                            <select name="acupoint" style="width: 100%; min-width: 250px; height: 30px; font-size: 1.1em; color: var(--color-text-dark-primary);">
                                ${availableSlots.map(slot => `<option value="${slot.key}">${slot.label}</option>`).join("")}
                            </select>
                        </div>
                    </div>`;
                    try {
                        const acupoint = await foundry.applications.api.DialogV2.prompt({
                            window: { title: `装备: ${item.name}`, icon: "fas fa-gem" },
                            content: content,
                            ok: {
                                label: "放入",
                                callback: (event, button) => new FormData(button.form).get("acupoint")
                            }
                        });
                        if (acupoint) await item.toggleEquip(acupoint);
                    } catch (e) { /* Cancelled */ }
                } else {
                    await item.toggleEquip();
                }
            });
        });

        // 6. 停止架招
        const stanceBtn = html.querySelector('[data-action="stop-stance"]');
        if (stanceBtn) {
            stanceBtn.addEventListener("click", async (ev) => {
                ev.preventDefault(); ev.stopPropagation();
                await actor.stopStance();
            });
        }

        // 7. 折叠 HUD 主体
        const toggleBtn = html.querySelector('[data-action="toggle-collapse"]');
        if (toggleBtn) {
            toggleBtn.addEventListener("click", (ev) => {
                ev.preventDefault(); ev.stopPropagation();
                html.classList.toggle("collapsed");
            });
        }

        // 8. 内部组折叠 (装备组、技能组)
        html.querySelectorAll('.group-header').forEach(header => {
            header.addEventListener("click", (ev) => {
                ev.preventDefault(); ev.stopPropagation();
                // 如果点击的是左侧的“检定”区域，不要折叠
                if (ev.target.closest('.header-left')) return;

                const group = header.closest('.equip-group');
                group.classList.toggle('collapsed');
            });
        });
    }
}