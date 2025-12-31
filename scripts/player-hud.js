/**
 * Player Control HUD Logic
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
        if (!htmlContent) return "";
        const temp = document.createElement("div");
        temp.innerHTML = htmlContent;
        let text = temp.textContent || temp.innerText || "";
        text = text.trim();
        // 截取长度
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
                // 尝试保留之前的折叠状态
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

        const hutiValue = res.huti || 0;
        const hutiPercent = hp.max ? Math.min(100, (hutiValue / hp.max) * 100) : 0;

        // 预处理 Item 数据的函数 (处理描述和自动化说明)
        const processItem = (item) => {
            let descStr = item.system.description || "";
            if (typeof descStr === 'object') descStr = descStr.value || "";
            const autoNote = item.system.automationNote || "";

            let cleanDesc = this.cleanDescription(descStr);
            if (autoNote) {
                const cleanNote = this.cleanDescription(autoNote);
                if (cleanDesc) {
                    cleanDesc += `<br><span style='color:#00e676'>[机]: ${cleanNote}</span>`;
                } else {
                    cleanDesc = `<span style='color:#00e676'>[机]: ${cleanNote}</span>`;
                }
            }
            if (!cleanDesc) cleanDesc = "暂无描述";

            return {
                id: item.id,
                name: item.name,
                img: item.img,
                system: item.system,
                shortDesc: cleanDesc
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

        // C. 消耗品
        const consumables = (actor.itemTypes?.consumable || []).map(processItem);

        // D. 装备分组逻辑
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

        const equipmentGroups = Object.entries(typeMapping)
            .filter(([key, group]) => group.items.length > 0)
            .map(([key, group]) => ({
                key: key,
                label: group.label,
                items: group.items,
                isCollapsed: false
            }));

        // E. 技能与属性分组 (Skill Groups - 替代原来的 stats 列表)
        const skillGroupsStructure = [
            { key: "liliang", skills: ["jiaoli", "zhengtuo", "paozhi", "qinbao"] },
            { key: "shenfa", skills: ["qianxing", "qiaoshou", "qinggong", "mashu"] },
            { key: "tipo", skills: ["renxing", "biqi", "rennai", "ningxue"] },
            { key: "neixi", skills: ["liaoshang", "chongxue", "lianxi", "duqi"] },
            { key: "qigan", skills: ["dianxue", "zhuizong", "tancha", "dongcha"] },
            { key: "shencai", skills: ["jiaoyi", "qiman", "shuofu", "dingli"] },
            { key: "wuxing", skills: ["wuxue", "jianding", "bagua", "shili"] }
        ];

        const skillGroups = skillGroupsStructure.map(group => {
            const statKey = group.key;
            const statVal = sys.stats?.[statKey]?.total || 0;
            const statLabel = game.i18n.localize(`XJZL.Stats.${statKey.charAt(0).toUpperCase() + statKey.slice(1)}`);

            const skills = group.skills.map(skillKey => {
                const skillTotal = sys.skills?.[skillKey]?.total || 0;
                const label = game.i18n.localize(`XJZL.Skills.${skillKey.charAt(0).toUpperCase() + skillKey.slice(1)}`);
                return { key: skillKey, label, value: skillTotal };
            });

            return {
                key: statKey,
                label: statLabel,
                value: statVal,
                skills: skills
            };
        });

        // F. 技艺分组 (Arts)
        const artsObj = sys.arts || {};
        const learnedArts = [];
        for (const [key, artData] of Object.entries(artsObj)) {
            if (artData.total > 0) {
                let label = game.i18n.localize(`XJZL.Arts.${key.charAt(0).toUpperCase() + key.slice(1)}`);

                learnedArts.push({
                    key: key,
                    label: label,
                    value: artData.total || 0
                });
            }
        }

        // G. 内功与架招
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

            shortcuts,
            consumables,
            equipmentGroups,
            skillGroups, // 新增：属性+技能分组
            learnedArts, // 新增：已学技艺列表

            isCollapsed: false
        };
    }

    // 事件绑定
    static activateListeners(html, actor) {
        if (!html) return;

        // 0. 输入框
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

        // 1. 属性/技能/技艺检定 (左键)
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

        // 4. 装备 (左键: 穿脱(含奇珍) | 右键: 发送)
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

                if (item.system.equipped) {
                    return await item.toggleEquip();
                }

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

        // 5. 取消架招
        const stanceBtn = html.querySelector('[data-action="stop-stance"]');
        if (stanceBtn) {
            stanceBtn.addEventListener("click", async (ev) => {
                ev.preventDefault(); ev.stopPropagation();
                await actor.stopStance();
            });
        }

        // 6. 折叠 HUD
        const toggleBtn = html.querySelector('[data-action="toggle-collapse"]');
        if (toggleBtn) {
            toggleBtn.addEventListener("click", (ev) => {
                ev.preventDefault(); ev.stopPropagation();
                html.classList.toggle("collapsed");
            });
        }

        // 7. 分组折叠/展开 (通用: 装备分组 + 技能分组)
        html.querySelectorAll('.group-header').forEach(header => {
            header.addEventListener("click", (ev) => {
                ev.preventDefault(); ev.stopPropagation();

                // [关键] 如果点击的是标题栏左侧的“属性检定”区域，则不执行折叠，
                // 而是让事件冒泡给上面的 [data-action="roll-stat"] 监听器去处理
                if (ev.target.closest('.header-left')) return;

                const group = header.closest('.equip-group');
                group.classList.toggle('collapsed');
            });
        });
    }
}