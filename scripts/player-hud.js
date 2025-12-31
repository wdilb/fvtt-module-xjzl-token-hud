/**
 * Player Control HUD Logic
 * 适配: FVTT V13
 */
export class PlayerHUD {
    static init() {
        Hooks.on("controlToken", () => this.renderHUD());
        Hooks.on("updateActor", (actor) => {
            if (this.currentActor && this.currentActor.id === actor.id) this.renderHUD();
        });
        Hooks.on("updateItem", (item) => {
            if (this.currentActor && this.currentActor.id === item.parent?.id) this.renderHUD();
        });
        Hooks.on("updateCombat", () => this.renderHUD());
    }

    static get currentActor() {
        const tokens = canvas.tokens.controlled;
        if (tokens.length !== 1) return null;
        const token = tokens[0];
        if (!token.actor) return null;
        if (!token.actor.isOwner) return null;
        return token.actor;
    }

    static async renderHUD() {
        const actor = this.currentActor;
        const hudEl = document.getElementById("xjzl-player-hud");

        if (!actor) {
            if (hudEl) hudEl.remove();
            return;
        }

        try {
            const data = await this.getData(actor);
            const renderer = foundry.applications?.handlebars?.renderTemplate || globalThis.renderTemplate;
            const html = await renderer("modules/xjzl-token-hud/templates/hud-player.hbs", data);

            if (hudEl) {
                // 如果只是更新数据，为了不打断输入焦点的体验，我们最好只更新内容
                // 但为了代码简单，这里先做整体替换。如果输入时会断触，需要做更复杂的 diff 更新
                const temp = document.createElement('div');
                temp.innerHTML = html;

                // 保持折叠状态
                if (hudEl.classList.contains('collapsed')) {
                    temp.firstElementChild.classList.add('collapsed');
                }

                hudEl.replaceWith(temp.firstElementChild);
            } else {
                document.body.insertAdjacentHTML('beforeend', html);
            }

            const newHudEl = document.getElementById("xjzl-player-hud");
            if (newHudEl) {
                this.activateListeners(newHudEl, actor);
            }

        } catch (err) {
            console.error("PlayerHUD Render Error:", err);
            if (hudEl) hudEl.remove();
        }
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

        // B. 常用招式
        const pinnedList = actor.getFlag("xjzl-system", "pinnedMoves") || [];
        const shortcuts = [];
        if (Array.isArray(pinnedList)) {
            for (const str of pinnedList) {
                if (typeof str !== 'string') continue;
                const [itemId, moveId] = str.split(".");
                const item = actor.items.get(itemId);
                if (item) {
                    const move = item.system.moves?.find(m => m.id === moveId);
                    if (move) shortcuts.push({ item, move });
                }
            }
        }

        // C. 物品分类
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

        // E. 境界名称 (本地化读取)
        const realmLevel = sys.cultivation?.realmLevel ?? 0; // 默认为0
        // 尝试获取翻译，如果没有 key 则回退到 "XJZL.Realm.0"
        const realmKey = `XJZL.Realm.${realmLevel}`;
        // 使用 game.i18n.localize 读取系统里的翻译
        const realmName = game.i18n.localize(realmKey);

        return {
            actorImg: actor.img,
            realmName,
            neigongElement,
            stanceName,

            // 资源 (用于 Input)
            hp, mp, rage,
            rageVal,
            hpPercent: (hp.value / hp.max) * 100,
            mpPercent: (mp.value / mp.max) * 100,
            rageDots: Array.from({ length: 10 }, (_, i) => ({ active: i < rageVal })),

            // [修改] 左侧显示的四个属性
            leftStats: [
                { label: "格挡", icon: "fas fa-shield-alt", value: combat.blockTotal || 0 },
                { label: "闪避", icon: "fas fa-running", value: combat.dodgeTotal || 0 },
                { label: "看破", icon: "fas fa-eye", value: combat.kanpoTotal || 0 },
                { label: "速度", icon: "fas fa-wind", value: combat.speedTotal || 0 }
            ],

            shortcuts,
            consumables,
            equipments,

            stats: [
                { key: "liliang", label: "力量" },
                { key: "shenfa", label: "身法" },
                { key: "tipo", label: "体魄" },
                { key: "neixi", label: "内息" },
                { key: "qigan", label: "气感" },
                { key: "shencai", label: "神采" },
                { key: "wuxing", label: "悟性" }
            ]
        };
    }

    static activateListeners(html, actor) {
        if (!html) return;

        // 资源输入框监听 (HP/MP/Rage)
        html.querySelectorAll('input.res-input').forEach(input => {
            // 聚焦时选中所有文本，方便修改
            input.addEventListener("focus", ev => ev.currentTarget.select());

            // 变更时更新 Actor
            input.addEventListener("change", async (ev) => {
                ev.preventDefault();
                const target = ev.currentTarget.dataset.target; // system.resources.hp.value
                const value = Number(ev.currentTarget.value);
                if (!target || isNaN(value)) return;
                await actor.update({ [target]: value });
            });
        });

        // 1. 属性检定 (底部按钮)
        html.querySelectorAll('[data-action="roll-stat"]').forEach(el => {
            el.addEventListener("click", async (ev) => {
                ev.preventDefault();
                ev.stopPropagation();
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

        // 3. 使用物品
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