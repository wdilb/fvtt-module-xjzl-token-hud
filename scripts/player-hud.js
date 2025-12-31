/**
 * Player Control HUD Logic
 * 适配: FVTT V13
 * 作者: Tiwelee
 */
export class PlayerHUD {

    // 初始化监听器
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

    // 获取当前控制的 Actor (必须是 Owner)
    static get currentActor() {
        const tokens = canvas.tokens.controlled;
        // 必须选中且只选中 1 个，且必须是拥有者权限
        if (tokens.length !== 1) return null;
        const token = tokens[0];
        if (!token.actor) return null;
        if (!token.actor.isOwner) return null;
        return token.actor;
    }

    // 渲染 HUD 主逻辑
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

            // 3. 渲染模板 (V13 兼容写法)
            const renderer = foundry.applications?.handlebars?.renderTemplate || globalThis.renderTemplate;
            const html = await renderer("modules/xjzl-token-hud/templates/hud-player.hbs", data);

            // 4. 插入 DOM
            if (hudEl) {
                // 如果已存在，使用 replaceWith 进行替换，并尝试保留折叠状态
                const temp = document.createElement('div');
                temp.innerHTML = html;
                const newEl = temp.firstElementChild;

                if (hudEl.classList.contains('collapsed')) {
                    newEl.classList.add('collapsed');
                }

                hudEl.replaceWith(newEl);
            } else {
                // 如果不存在，插入到 body
                document.body.insertAdjacentHTML('beforeend', html);
            }

            // 5. 重新获取 DOM 并绑定事件
            const newHudEl = document.getElementById("xjzl-player-hud");
            if (newHudEl) {
                this.activateListeners(newHudEl, actor);
            }

        } catch (err) {
            console.error("PlayerHUD Render Error:", err);
            if (hudEl) hudEl.remove();
        }
    }

    // 数据准备
    static async getData(actor) {
        const sys = actor.system;
        const res = sys.resources || {};
        const combat = sys.combat || {};

        // A. 基础数值
        const hp = res.hp || { value: 0, max: 1 };
        const mp = res.mp || { value: 0, max: 1 };
        const rage = res.rage || { value: 0 };
        const rageVal = Math.max(0, Math.min(10, rage.value));

        // 护体真气 (基于 HP 上限计算百分比)
        const hutiValue = res.huti || 0;
        const hutiPercent = hp.max ? Math.min(100, (hutiValue / hp.max) * 100) : 0;

        // B. 常用招式 (Pinned Moves)
        const pinnedList = actor.getFlag("xjzl-system", "pinnedMoves") || [];
        const shortcuts = [];

        if (Array.isArray(pinnedList)) {
            for (const str of pinnedList) {
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
        let stanceDesc = null;
        if (sys.martial?.stanceActive && sys.martial.stanceItemId) {
            const stItem = actor.items.get(sys.martial.stanceItemId);
            const stMove = stItem?.system.moves?.find(m => m.id === sys.martial.stance);
            if (stMove) {
                stanceName = stMove.name;
                // 拼接架招描述与操作提示
                const rawDesc = stMove.description || "暂无描述";
                stanceDesc = `${rawDesc}<hr><div style="text-align:center; color:#ffd700; margin-top:4px"><i class="fas fa-hand-pointer"></i> 点击解除架招</div>`;
            }
        }

        // E. 境界名称
        const realmLevel = sys.cultivation?.realmLevel ?? 0;
        const realmKey = `XJZL.Realm.${realmLevel}`;
        const realmName = game.i18n.localize(realmKey);

        return {
            actorImg: actor.img,
            realmName,
            neigongElement,
            stanceName,
            stanceDesc,

            // 资源百分比
            hp, mp, rage, rageVal, hutiValue, hutiPercent,
            hpPercent: (hp.value / hp.max) * 100,
            mpPercent: (mp.value / mp.max) * 100,
            rageDots: Array.from({ length: 10 }, (_, i) => ({ active: i < rageVal })),

            // 左侧四维
            leftStats: [
                { label: "格挡", value: combat.blockTotal || 0 },
                { label: "闪避", value: combat.dodgeTotal || 0 },
                { label: "看破", value: combat.kanpoTotal || 0 },
                { label: "速度", value: combat.speedTotal || 0 }
            ],

            shortcuts,
            consumables,
            equipments,

            // 属性列表
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

    // 事件绑定
    static activateListeners(html, actor) {
        if (!html) return;

        // 0. 资源输入框监听 (HP/MP/Rage/Huti)
        // 使用 CSS 选择器 .res-input，因为护体输入框也加了这个类
        html.querySelectorAll('input.res-input').forEach(input => {
            input.addEventListener("focus", ev => ev.currentTarget.select());
            input.addEventListener("change", async (ev) => {
                ev.preventDefault();
                ev.stopPropagation();
                const target = ev.currentTarget.dataset.target;
                const value = Number(ev.currentTarget.value);
                if (!target || isNaN(value)) return;
                await actor.update({ [target]: value });
            });
        });

        // 头像点击 -> 打开角色卡
        html.querySelector('[data-action="open-sheet"]')?.addEventListener("click", (ev) => {
            ev.preventDefault();
            actor.sheet.render(true);
        });

        // 1. 属性检定
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