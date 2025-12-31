/**
 * Player Control HUD Logic
 * 适配: FVTT V13 & XJZL-System
 * 作者: Tiwelee
 */
export class PlayerHUD {

    // 初始化监听器
    static init() {
        Hooks.on("controlToken", () => this.renderHUD());

        // 监听数据变化 (实时刷新)
        Hooks.on("updateActor", (actor) => {
            if (this.currentActor && this.currentActor.id === actor.id) this.renderHUD();
        });
        Hooks.on("updateItem", (item) => {
            if (this.currentActor && this.currentActor.id === item.parent?.id) this.renderHUD();
        });
        Hooks.on("updateCombat", () => this.renderHUD());
    }

    // 获取当前控制的 Actor
    static get currentActor() {
        const tokens = canvas.tokens.controlled;
        if (tokens.length !== 1) return null;
        const token = tokens[0];
        if (!token.actor) return null;
        if (!token.actor.isOwner) return null;
        return token.actor;
    }

    // 辅助方法：清洗HTML并截取文本 (用于Tooltip)
    static cleanDescription(htmlContent) {
        if (!htmlContent) return ""; // 为空返回空字符串，方便拼接
        const temp = document.createElement("div");
        temp.innerHTML = htmlContent;
        let text = temp.textContent || temp.innerText || "";
        // 移除多余的空白符
        text = text.trim();
        // 截取长度 (稍微放宽一点，因为现在有两个字段拼接)
        if (text.length > 80) {
            text = text.substring(0, 80) + "...";
        }
        return text;
    }

    // 渲染 HUD 主逻辑
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
                const temp = document.createElement('div');
                temp.innerHTML = html;
                const newEl = temp.firstElementChild;
                if (hudEl.classList.contains('collapsed')) {
                    newEl.classList.add('collapsed');
                }
                hudEl.replaceWith(newEl);
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

    // 数据准备
    static async getData(actor) {
        const sys = actor.system;
        const res = sys.resources || {};
        const combat = sys.combat || {};

        const hp = res.hp || { value: 0, max: 1 };
        const mp = res.mp || { value: 0, max: 1 };
        const rage = res.rage || { value: 0 };
        const rageVal = Math.max(0, Math.min(10, rage.value));

        const hutiValue = res.huti || 0;
        const hutiPercent = hp.max ? Math.min(100, (hutiValue / hp.max) * 100) : 0;

        // [核心修正] 预处理 Item 数据的函数
        const processItem = (item) => {
            // 1. 读取描述 (修正：xjzl-system 中 description 是直接字符串)
            let descStr = item.system.description || "";
            // 兼容性保护：万一有的物品还是对象结构
            if (typeof descStr === 'object') descStr = descStr.value || "";

            // 2. 读取自动化说明
            const autoNote = item.system.automationNote || "";

            // 3. 拼接与清洗
            let cleanDesc = this.cleanDescription(descStr);
            if (autoNote) {
                const cleanNote = this.cleanDescription(autoNote);
                // 如果有描述，换行加说明；如果没有描述，直接显示说明
                if (cleanDesc) {
                    cleanDesc += `<br><span style='color:#00e676'>[机]: ${cleanNote}</span>`;
                } else {
                    cleanDesc = `<span style='color:#00e676'>[机]: ${cleanNote}</span>`;
                }
            }
            // 保底
            if (!cleanDesc) cleanDesc = "暂无描述";

            return {
                id: item.id,
                name: item.name,
                img: item.img,
                system: item.system,
                shortDesc: cleanDesc // 这里现在包含 HTML 标签 (<br>, <span>)，模板里需要用 {{{}}}
            };
        };

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
                    if (move) {
                        // [核心修正] 招式描述 + 自动化说明
                        let moveDescStr = move.description || "";
                        const moveAutoNote = move.automationNote || "";

                        let cleanMoveDesc = this.cleanDescription(moveDescStr);
                        if (moveAutoNote) {
                            const cleanNote = this.cleanDescription(moveAutoNote);
                            if (cleanMoveDesc) {
                                cleanMoveDesc += `<br><span style='color:#00e676'>[机]: ${cleanNote}</span>`;
                            } else {
                                cleanMoveDesc = `<span style='color:#00e676'>[机]: ${cleanNote}</span>`;
                            }
                        }
                        if (!cleanMoveDesc) cleanMoveDesc = "暂无描述";

                        shortcuts.push({
                            item,
                            move,
                            moveDesc: cleanMoveDesc
                        });
                    }
                }
            }
        }

        // C. 物品分类
        const consumables = (actor.itemTypes?.consumable || []).map(processItem);
        const equipments = [
            ...(actor.itemTypes?.weapon || []),
            ...(actor.itemTypes?.armor || []),
            ...(actor.itemTypes?.qizhen || [])
        ].map(processItem);

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
                const rawDesc = this.cleanDescription(stMove.description);
                stanceDesc = `${rawDesc}<hr><div style="text-align:center; color:#ffd700; margin-top:4px"><i class="fas fa-hand-pointer"></i> 点击解除架招</div>`;
            }
        }

        const realmLevel = sys.cultivation?.realmLevel ?? 0;
        const realmKey = `XJZL.Realm.${realmLevel}`;
        const realmName = game.i18n.localize(realmKey);

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
            shortcuts, consumables, equipments,

            stats: [
                { key: "liliang", label: "力量" }, { key: "shenfa", label: "身法" },
                { key: "tipo", label: "体魄" }, { key: "neixi", label: "内息" },
                { key: "qigan", label: "气感" }, { key: "shencai", label: "神采" },
                { key: "wuxing", label: "悟性" }
            ],
            isCollapsed: false
        };
    }

    // 事件绑定
    static activateListeners(html, actor) {
        if (!html) return;

        // 输入框
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

        // 打开角色卡
        html.querySelector('[data-action="open-sheet"]')?.addEventListener("click", (ev) => {
            ev.preventDefault(); actor.sheet.render(true);
        });

        // 1. 属性检定
        html.querySelectorAll('[data-action="roll-stat"]').forEach(el => {
            el.addEventListener("click", async (ev) => {
                ev.preventDefault(); ev.stopPropagation();
                const key = ev.currentTarget.dataset.key;
                if (key) await actor.rollAttributeTest(key);
            });
        });

        // 2. 招式 (左键/右键)
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

        // 3. 物品 (左键/右键)
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

        // 4. 装备 (左键/右键)
        html.querySelectorAll('[data-action="toggle-equip"]').forEach(el => {
            el.addEventListener("click", async (ev) => {
                ev.preventDefault(); ev.stopPropagation();
                const itemId = ev.currentTarget.dataset.itemId;
                const item = actor.items.get(itemId);
                if (item) await item.toggleEquip();
            });
            el.addEventListener("contextmenu", async (ev) => {
                ev.preventDefault(); ev.stopPropagation();
                const itemId = ev.currentTarget.dataset.itemId;
                const item = actor.items.get(itemId);
                if (item) await item.postToChat();
            });
        });

        // 5. 取消架招
        const stanceBtn = html.querySelector('[data-action="stop-stance"]');
        if (stanceBtn) {
            stanceBtn.addEventListener("click", async (ev) => {
                ev.preventDefault(); ev.stopPropagation();
                await actor.stopStance();
            });
        }

        // 6. 折叠
        const toggleBtn = html.querySelector('[data-action="toggle-collapse"]');
        if (toggleBtn) {
            toggleBtn.addEventListener("click", (ev) => {
                ev.preventDefault(); ev.stopPropagation();
                html.classList.toggle("collapsed");
            });
        }
    }
}