/**
 * Player Control HUD Logic
 * 适配: FVTT V13
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
        // 必须选中且只选中 1 个，且必须是拥有者权限
        if (tokens.length !== 1) return null;
        const token = tokens[0];
        if (!token.actor) return null;
        if (!token.actor.isOwner) return null;
        return token.actor;
    }

    static async renderHUD() {
        const actor = this.currentActor;
        const hudEl = document.getElementById("xjzl-player-hud");

        // 1. 如果没有选中有效 Actor，移除 HUD 并退出
        if (!actor) {
            if (hudEl) hudEl.remove();
            return;
        }

        try {
            // 2. 准备数据
            const data = await this.getData(actor);

            // 3. 渲染模板 [V13 修复核心点]
            // 使用命名空间下的渲染函数，避免全局警告
            const renderer = foundry.applications?.handlebars?.renderTemplate || globalThis.renderTemplate;
            const html = await renderer("modules/xjzl-token-hud/templates/hud-player.hbs", data);

            // 4. 插入 DOM
            if (hudEl) {
                // 如果已存在，使用 replaceWith 进行替换，比 outerHTML 更稳定
                // 我们创建一个临时容器来转换 HTML 字符串
                const temp = document.createElement('div');
                temp.innerHTML = html;
                const newEl = temp.firstElementChild;
                hudEl.replaceWith(newEl);
            } else {
                // 如果不存在，插入到 body
                document.body.insertAdjacentHTML('beforeend', html);
            }

            // 5. 重新获取 DOM 并绑定事件 (因为元素已被替换)
            const newHudEl = document.getElementById("xjzl-player-hud");
            if (newHudEl) {
                this.activateListeners(newHudEl, actor);
            }

        } catch (err) {
            console.error("PlayerHUD Render Error:", err);
            // 出错时不至于崩坏整个页面，顶多 HUD 不显示
            if (hudEl) hudEl.remove();
        }
    }

    static async getData(actor) {
        const sys = actor.system;
        const res = sys.resources || {};
        const combat = sys.combat || {}; // 添加默认值防止报错

        // A. 基础数值
        const hp = res.hp || { value: 0, max: 1 };
        const mp = res.mp || { value: 0, max: 1 };
        const rage = res.rage || { value: 0 };
        const rageVal = Math.max(0, Math.min(10, rage.value));

        // B. 常用招式 (Pinned Moves)
        // 格式 ["ItemID.MoveID", ...]
        const pinnedList = actor.getFlag("xjzl-system", "pinnedMoves") || [];
        const shortcuts = [];

        if (Array.isArray(pinnedList)) {
            for (const str of pinnedList) {
                // 安全检查 split
                if (typeof str !== 'string') continue;
                const [itemId, moveId] = str.split(".");
                const item = actor.items.get(itemId);
                if (item) {
                    const move = item.system.moves?.find(m => m.id === moveId);
                    if (move) {
                        shortcuts.push({ item, move });
                    }
                }
            }
        }

        // C. 物品分类
        // 使用 itemTypes 之前先做非空检查
        const consumables = actor.itemTypes?.consumable || [];
        const equipments = [
            ...(actor.itemTypes?.weapon || []),
            ...(actor.itemTypes?.armor || []),
            ...(actor.itemTypes?.qizhen || [])
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

        // E. 境界名称
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

            isCollapsed: false
        };
    }

    static activateListeners(html, actor) {
        if (!html) return;

        // 1. 属性检定
        html.querySelectorAll('[data-action="roll-stat"]').forEach(el => {
            el.addEventListener("click", async (ev) => {
                ev.preventDefault();
                ev.stopPropagation(); // 防止点击穿透
                const key = ev.currentTarget.dataset.key;
                if (key) await actor.rollAttributeTest(key);
            });
        });

        // 2. 使用招式
        html.querySelectorAll('[data-action="use-move"]').forEach(el => {
            el.addEventListener("click", async (ev) => {
                ev.preventDefault();
                ev.stopPropagation();
                const { itemId, moveId } = ev.currentTarget.dataset;
                const item = actor.items.get(itemId);
                if (item) await item.roll(moveId);
            });
        });

        // 3. 使用物品 (消耗品)
        html.querySelectorAll('[data-action="use-item"]').forEach(el => {
            el.addEventListener("click", async (ev) => {
                ev.preventDefault();
                ev.stopPropagation();
                const itemId = ev.currentTarget.dataset.itemId;
                const item = actor.items.get(itemId);
                if (item) await item.use();
            });
        });

        // 4. 装备/卸下
        html.querySelectorAll('[data-action="toggle-equip"]').forEach(el => {
            el.addEventListener("click", async (ev) => {
                ev.preventDefault();
                ev.stopPropagation();
                const itemId = ev.currentTarget.dataset.itemId;
                const item = actor.items.get(itemId);
                if (item) await item.toggleEquip();
            });
        });

        // 5. 取消架招
        const stanceBtn = html.querySelector('[data-action="stop-stance"]');
        if (stanceBtn) {
            stanceBtn.addEventListener("click", async (ev) => {
                ev.preventDefault();
                ev.stopPropagation();
                await actor.stopStance();
            });
        }

        // 6. 折叠/展开
        const toggleBtn = html.querySelector('[data-action="toggle-collapse"]');
        if (toggleBtn) {
            toggleBtn.addEventListener("click", (ev) => {
                ev.preventDefault();
                ev.stopPropagation();
                html.classList.toggle("collapsed");
            });
        }
    }
}