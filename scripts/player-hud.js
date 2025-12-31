/**
 * Player Control HUD Logic
 */
export class PlayerHUD {
    static init() {
        // 监听 Token 选中/控制变化
        Hooks.on("controlToken", () => this.renderHUD());

        // 监听数据变化 (实时刷新)
        Hooks.on("updateActor", (actor) => {
            if (this.currentActor && this.currentActor.id === actor.id) this.renderHUD();
        });
        Hooks.on("updateItem", (item) => {
            if (this.currentActor && this.currentActor.id === item.parent?.id) this.renderHUD();
        });

        // 战斗轮次更新 (刷新先攻等)
        Hooks.on("updateCombat", () => this.renderHUD());
    }

    static get currentActor() {
        const tokens = canvas.tokens.controlled;
        if (tokens.length !== 1) return null; // 必须选中且只选中 1 个
        const token = tokens[0];
        if (!token.actor) return null;
        if (!token.actor.isOwner) return null; // 必须有权限
        return token.actor;
    }

    static async renderHUD() {
        const actor = this.currentActor;
        const hudEl = document.getElementById("xjzl-player-hud");

        // 1. 如果没有选中有效 Actor，移除 HUD
        if (!actor) {
            if (hudEl) hudEl.remove();
            return;
        }

        // 2. 准备数据
        const data = await this.getData(actor);

        // 3. 渲染模板
        // 注意：这里需要确保 main.js 里 HUD_STATE.renderer 已经可用，或者直接用全局 renderTemplate
        const html = await renderTemplate("modules/xjzl-token-hud/templates/hud-player.hbs", data);

        // 4. 插入 DOM (如果是更新，则替换)
        if (hudEl) {
            hudEl.outerHTML = html;
        } else {
            document.body.insertAdjacentHTML('beforeend', html);
        }

        // 5. 绑定事件
        this.activateListeners(document.getElementById("xjzl-player-hud"), actor);
    }

    static async getData(actor) {
        const sys = actor.system;
        const res = sys.resources || {};
        const combat = sys.combat || {};

        // A. 基础数值
        const hp = res.hp || { value: 0, max: 1 };
        const mp = res.mp || { value: 0, max: 1 };
        const rage = res.rage || { value: 0 };
        const rageVal = Math.max(0, Math.min(10, rage.value));

        // B. 常用招式 (Pinned Moves)
        // 格式 ["ItemID.MoveID", ...]
        const pinnedList = actor.getFlag("xjzl-system", "pinnedMoves") || [];
        const shortcuts = [];

        for (const str of pinnedList) {
            const [itemId, moveId] = str.split(".");
            const item = actor.items.get(itemId);
            if (item) {
                const move = item.system.moves?.find(m => m.id === moveId);
                if (move) {
                    shortcuts.push({ item, move });
                }
            }
        }

        // C. 物品分类
        const consumables = actor.itemTypes.consumable || [];
        const equipments = [
            ...(actor.itemTypes.weapon || []),
            ...(actor.itemTypes.armor || []),
            ...(actor.itemTypes.qizhen || [])
        ];

        // D. 内功与架招
        let neigongElement = "none";
        if (sys.martial?.active_neigong) {
            const ng = actor.items.get(sys.martial.active_neigong);
            if (ng) neigongElement = ng.system.element;
        }

        let stanceName = null;
        if (sys.martial?.stanceActive && sys.martial.stanceItemId) {
            const stItem = actor.items.get(sys.martial.stanceItemId);
            const stMove = stItem?.system.moves?.find(m => m.id === sys.martial.stance);
            if (stMove) stanceName = stMove.name;
        }

        // E. 境界名称 (简单映射示例，你需要根据系统实际 realmLevel 映射)
        const realmLevel = sys.cultivation?.realmLevel || 0;
        const realms = ["凡人", "初窥", "小成", "大成", "圆满", "化境", "飞升"];
        const realmName = realms[realmLevel] || "未知";

        return {
            actorImg: actor.img,
            realmName,
            neigongElement,
            stanceName,

            // 资源百分比
            hpValue: hp.value, hpMax: hp.max, hpPercent: (hp.value / hp.max) * 100,
            mpValue: mp.value, mpMax: mp.max, mpPercent: (mp.value / mp.max) * 100,
            rageDots: Array.from({ length: 10 }, (_, i) => ({ active: i < rageVal })),

            combat: {
                kanpo: combat.kanpoTotal || 0,
                initiative: combat.initiativeTotal || 0,
                hitWaigong: combat.hitWaigongTotal || 0,
                hitNeigong: combat.hitNeigongTotal || 0
            },

            shortcuts,
            consumables,
            equipments,

            // 属性列表 (用于遍历)
            stats: [
                { key: "liliang", label: "力量" },
                { key: "shenfa", label: "身法" },
                { key: "tipo", label: "体魄" },
                { key: "neixi", label: "内息" },
                { key: "qigan", label: "气感" },
                { key: "shencai", label: "神采" },
                { key: "wuxing", label: "悟性" }
            ],

            // 读取之前的折叠状态 (如果需要记忆)
            isCollapsed: false
        };
    }

    static activateListeners(html, actor) {
        if (!html) return;

        // 1. 属性检定
        html.querySelectorAll('[data-action="roll-stat"]').forEach(el => {
            el.addEventListener("click", async (ev) => {
                ev.preventDefault();
                const key = ev.currentTarget.dataset.key;
                if (key) await actor.rollAttributeTest(key);
            });
        });

        // 2. 使用招式
        html.querySelectorAll('[data-action="use-move"]').forEach(el => {
            el.addEventListener("click", async (ev) => {
                ev.preventDefault();
                const { itemId, moveId } = ev.currentTarget.dataset;
                const item = actor.items.get(itemId);
                if (item) await item.roll(moveId);
            });
        });

        // 3. 使用物品 (消耗品)
        html.querySelectorAll('[data-action="use-item"]').forEach(el => {
            el.addEventListener("click", async (ev) => {
                ev.preventDefault();
                const itemId = ev.currentTarget.dataset.itemId;
                const item = actor.items.get(itemId);
                if (item) await item.use();
            });
        });

        // 4. 装备/卸下
        html.querySelectorAll('[data-action="toggle-equip"]').forEach(el => {
            el.addEventListener("click", async (ev) => {
                ev.preventDefault();
                const itemId = ev.currentTarget.dataset.itemId;
                const item = actor.items.get(itemId);
                // 直接调用 toggleEquip，如果是奇珍，系统内部的逻辑会处理弹窗
                if (item) await item.toggleEquip();
            });
        });

        // 5. 取消架招
        const stanceBtn = html.querySelector('[data-action="stop-stance"]');
        if (stanceBtn) {
            stanceBtn.addEventListener("click", async (ev) => {
                ev.preventDefault();
                await actor.stopStance();
            });
        }

        // 6. 折叠/展开
        html.querySelector('[data-action="toggle-collapse"]').addEventListener("click", (ev) => {
            html.classList.toggle("collapsed");
        });
    }
}