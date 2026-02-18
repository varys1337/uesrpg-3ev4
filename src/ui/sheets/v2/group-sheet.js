/**
 * src/ui/sheets/v2/group-sheet.js
 *
 * ApplicationV2 Group Actor Sheet.
 *
 * Key improvements:
 * - Uses HandlebarsApplicationMixin(ActorSheetV2) base
 * - Native DOM event binding via data-action + _onRender (no jQuery)
 * - Single-registration updateActor hook (fixes V1 leak on re-render)
 * - Integrated container-safe item deletion (fixes V1 dual-handler race)
 */

import { prepareCharacterItems } from "../sheet-prepare-items.js";
import { unlinkAllItemsFromContainer, unlinkItemFromContainer } from "../sheet-containers.js";
import { applyShortRest, applyLongRest, buildRestChatContent } from "../rest-workflow.js";
import { cachedEnrichHTML } from "../../../utils/enrich-cache.js";
import { confirmDialog, customDialog } from "../../../utils/dialog-v2-helper.js";
import {
  requestUpdateDocument,
  requestCreateEmbeddedDocuments,
  requestDeleteEmbeddedDocuments,
} from "../../../utils/authority-proxy.js";
import { resolveDroppedItem } from "../../../utils/drop-data.js";
import { asyncGuard } from "../../../utils/async-guard.js";
import { activateEditorButtons } from "../shared/editor-activation.js";
import { bindItemDescriptionTooltips, clearItemDescriptionTooltip } from "./shared/sheet-tooltips.js";

const { HandlebarsApplicationMixin } = foundry.applications.api;
const ActorSheetV2 = foundry.applications.sheets.ActorSheetV2;

export class GroupSheetV2 extends HandlebarsApplicationMixin(ActorSheetV2) {

  /** @type {number|null} Hooks.on("updateActor") handle for member refresh */
  #memberUpdateHook = null;

  _isSheetPerfTraceEnabled() {
    try {
      return Boolean(game?.settings?.get?.("uesrpg-3ev4", "sheetPerfTrace"));
    } catch (_e) {
      return false;
    }
  }

  _traceSheetPerf(stage, startedAtMs, details = {}) {
    if (!this._isSheetPerfTraceEnabled()) return;
    const elapsedMs = Number((performance.now() - startedAtMs).toFixed(2));
    const payload = {
      sheet: "GroupSheetV2",
      actorId: this.document?.id ?? null,
      actorName: this.document?.name ?? null,
      tab: this.tabGroups?.primary ?? "members",
      stage,
      elapsedMs,
      ...details,
    };
    const warnThresholdMs = stage === "_onClose"
      ? 24
      : stage === "_onRender"
        ? 32
        : stage === "_prepareContext"
          ? 40
          : null;
    const line = `UESRPG | sheetPerfTrace ${JSON.stringify(payload)}`;
    if (warnThresholdMs !== null && elapsedMs > warnThresholdMs) console.warn(line);
    else console.log(line);
  }

  /**
   * Native AppV2 tab configuration.
   * @type {Record<string, ApplicationTabsConfiguration>}
   */
  static TABS = {
    primary: {
      tabs: [
        { id: "members" },
        { id: "inventory" },
        { id: "travel" },
        { id: "details" },
      ],
      initial: "members",
    },
  };

  /* ──────────────────────── Static Configuration ──────────────────────── */

  static DEFAULT_OPTIONS = {
    classes: ["uesrpg", "sheet", "actor", "group", "worldbuilding"],
    position: { width: 780, height: 900 },
    window: { resizable: true },
    form: { submitOnChange: true },
    dragDrop: [{
      dragSelector: ".member-item, .item, .npc-item",
      dropSelector: ".window-content, .sheet-body, .tab, .itemListContainer",
    }],
    actions: {
      editPortrait: GroupSheetV2.prototype._onEditPortrait,
      viewMember: GroupSheetV2.prototype._onViewMember,
      removeMember: GroupSheetV2.prototype._onRemoveMember,
      changePace: GroupSheetV2.prototype._onChangePace,
      shortRest: GroupSheetV2.prototype._onShortRest,
      longRest: GroupSheetV2.prototype._onLongRest,
      deployGroup: GroupSheetV2.prototype._onDeployGroup,
      itemCreate: GroupSheetV2.prototype._onItemCreate,
      itemDelete: GroupSheetV2.prototype._onItemDelete,
      itemShow: GroupSheetV2.prototype._onItemShow,
      openContainer: GroupSheetV2.prototype._onOpenContainer,
      openDescriptionEditor: GroupSheetV2.prototype._onOpenDescriptionEditor,
      openNotesEditor: GroupSheetV2.prototype._onOpenNotesEditor,
    },
  };

  static PARTS = {
    sidebar: {
      template: "systems/uesrpg-3ev4/templates/v2/sheets/group/sidebar.hbs",
    },
    body: {
      template: "systems/uesrpg-3ev4/templates/v2/sheets/group/body.hbs",
      scrollable: [""],
    },
    limited: {
      template: "systems/uesrpg-3ev4/templates/v2/sheets/group/limited.hbs",
    },
  };

  /** @override */
  get title() {
    return this.document.name;
  }

  /* ────────────────────────── Render Options ─────────────────────────── */

  /** @override — select limited vs full template PARTS */
  _configureRenderOptions(options) {
    super._configureRenderOptions(options);
    if (this.document.limited && !game.user.isGM) {
      options.parts = ["limited"];
    } else {
      options.parts = ["sidebar", "body"];
    }
  }

  /* ──────────────────────── Context Preparation ───────────────────────── */

  /** @override */
  /** @override */
  async _prepareContext(options) {
    const perfStart = performance.now();
    try {
      const context = await super._prepareContext(options);
      const actor = this.document;

      context.actor = actor;
      context.system = actor.system;
      context.isGM = game.user.isGM;
      context.editable = this.isEditable;
      context.limited = !game.user.isGM && actor.limited;
      context.owner = actor.isOwner;

      context.resolvedMembers = await this.#resolveMembers(actor.system.members || []);

      const enrichFn = foundry.applications.ux.TextEditor.implementation.enrichHTML;
      const _enrich = (raw) => enrichFn(raw || "");

      if (context.limited) {
        context.enrichedDescription = await _enrich(actor.system.description ?? "");
        return context;
      }

      const sheetData = {
        actor: actor.toObject(),
        items: actor.items.map(i => {
          const obj = i.toObject();
          obj.system = i.system;
          return obj;
        }),
      };
      prepareCharacterItems(sheetData);

      context.gear = sheetData.actor.gear ?? { equipped: [], unequipped: [] };
      context.weapon = sheetData.actor.weapon ?? { equipped: [], unequipped: [] };
      context.armor = sheetData.actor.armor ?? { equipped: [], unequipped: [] };
      context.ammunition = sheetData.actor.ammunition ?? { equipped: [], unequipped: [] };
      context.container = sheetData.actor.container ?? [];

      const speeds = context.resolvedMembers
        .filter(m => m.canView && m.speed)
        .map(m => m.speed);
      const baseSpeed = speeds.length > 0 ? Math.min(...speeds) : 0;
      const currentPace = actor.system.travelPace || "normal";
      let speedMultiplier = 1.0;
      if (currentPace === "slow") speedMultiplier = 0.6;
      else if (currentPace === "fast") speedMultiplier = 1.4;

      context.displayAverageSpeed = Math.round(baseSpeed * speedMultiplier);
      context.displayAverageSpeedKmh = (context.displayAverageSpeed * 0.6).toFixed(1);
      context.currentPace = currentPace;

      context.enrichedDescription = await cachedEnrichHTML(
        this, "group:desc", actor.system.description ?? "", _enrich
      );
      context.enrichedNotes = await cachedEnrichHTML(
        this, "group:notes", actor.system.notes ?? "", _enrich
      );

      return context;
    } finally {
      this._traceSheetPerf("_prepareContext", perfStart, {
        renderKeys: options ? Object.keys(options).length : 0,
      });
    }
  }

  /* ───────────────────────────── Lifecycle ─────────────────────────────── */

  /** @override */
  /** @override */
  _onRender(context, options) {
    const perfStart = performance.now();
    try {
      super._onRender(context, options);
      const el = this.element;
      clearItemDescriptionTooltip(this);

      if (!this.#memberUpdateHook) {
        this.#memberUpdateHook = Hooks.on("updateActor", (updatedActor) => {
          const members = this.document.system.members || [];
          if (members.some(m => m.id === updatedActor?.uuid)) {
            this.render(false);
          }
        });
      }

      if (context.limited) return;

      const expectedPrimary = this.tabGroups.primary ?? "members";
      const activePrimary = el?.querySelector('.tab[data-group="primary"].active')?.dataset?.tab ?? null;
      if (activePrimary !== expectedPrimary) {
        this.changeTab(expectedPrimary, "primary", { force: true });
      }

      activateEditorButtons(this, el);
    } finally {
      this._traceSheetPerf("_onRender", perfStart, {
        limited: Boolean(context?.limited),
      });
    }
  }

  /**
   * Per-part listener registration (called for each re-rendered part).
   * Non-click listeners scoped to their specific part.
   * @override
   */
  _attachPartListeners(partId, htmlElement, options) {
    const perfStart = performance.now();
    try {
      super._attachPartListeners(partId, htmlElement, options);

      if (partId === "body") {
        bindItemDescriptionTooltips(this, htmlElement);
        htmlElement.querySelectorAll(".itemEquip").forEach(el => {
          el.addEventListener("change", asyncGuard(async (_ev) => {
            const itemId = el.closest(".item")?.dataset?.itemId;
            if (!itemId) return;
            const item = this.document.items.get(itemId);
            if (item) await requestUpdateDocument(item, { "system.equipped": el.checked });
          }));
        });

        htmlElement.querySelectorAll(".plusQty").forEach(el => {
          el.addEventListener("click", asyncGuard(async (ev) => {
            ev.preventDefault();
            const itemId = el.closest(".item")?.dataset?.itemId;
            if (!itemId) return;
            const item = this.document.items.get(itemId);
            if (!item) return;
            await requestUpdateDocument(item, { "system.quantity": Number(item.system.quantity ?? 0) + 1 });
          }));
          el.addEventListener("contextmenu", asyncGuard(async (ev) => {
            ev.preventDefault();
            const itemId = el.closest(".item")?.dataset?.itemId;
            if (!itemId) return;
            const item = this.document.items.get(itemId);
            if (!item) return;
            const qty = Number(item.system.quantity ?? 0);
            const next = Math.max(qty - 1, 0);
            if (next === 0 && qty > 0) {
              ui.notifications.info(`You have used your last ${item.name}!`);
            }
            await requestUpdateDocument(item, { "system.quantity": next });
          }));
        });

        htmlElement.querySelectorAll(".item-name").forEach(el => {
          el.addEventListener("contextmenu", async (ev) => {
            ev.preventDefault();
            const itemId = el.closest(".item")?.dataset?.itemId;
            if (!itemId) return;
            const item = this.document.items.get(itemId);
            if (item) this.#duplicateItem(item);
          });
        });
      }
    } finally {
      this._traceSheetPerf("_attachPartListeners", perfStart, { partId });
    }
  }

  /** @override */
  /** @override */
  _onClose(options) {
    const perfStart = performance.now();
    try {
      clearItemDescriptionTooltip(this);
      if (this.#memberUpdateHook) {
        Hooks.off("updateActor", this.#memberUpdateHook);
        this.#memberUpdateHook = null;
      }
      return super._onClose(options);
    } finally {
      this._traceSheetPerf("_onClose", perfStart, {});
    }
  }

  /* ──────────────────────────── Drag & Drop ────────────────────────────── */

  /** @override */
  _canDragDrop(_selector) {
    return this.isEditable;
  }

  /** @override */
  async _onDrop(event) {
    const data = foundry.applications.ux.TextEditor.implementation.getDragEventData(event);
    if (data.type === "Actor") return this.#onDropActor(data);
    if (data.type === "Item") return this.#onDropItem(event, data);
    return super._onDrop(event);
  }

  /* ──────────────────────── Private Helpers ────────────────────────────── */

  /** Get GM user IDs for whispered chat messages */
  #getGMUserIds() {
    return game.users.filter(u => u.isGM).map(u => u.id);
  }

  /** Resolve member UUIDs to actor data with permission-gated stats */
  async #resolveMembers(members) {
    const resolved = [];
    for (const member of members) {
      const actor = await fromUuid(member.id);
      if (!actor) {
        resolved.push({
          ...member,
          missing: true,
          canView: false,
          name: member.name || "Unknown Actor",
          img: member.img || "icons/svg/mystery-man.svg",
        });
        continue;
      }
      const canView = actor.testUserPermission(
        game.user, CONST.DOCUMENT_OWNERSHIP_LEVELS.OBSERVER
      );
      resolved.push({
        id: member.id,
        uuid: member.id,
        name: actor.name,
        img: actor.img,
        type: actor.type,
        sortOrder: member.sortOrder || 0,
        missing: false,
        canView,
        actor: canView ? actor : null,
        hp: canView
          ? { value: actor.system.hp.value, max: actor.system.hp.max }
          : null,
        stamina: canView
          ? { value: actor.system.stamina.value, max: actor.system.stamina.max }
          : null,
        magicka:
          canView && actor.system.magicka
            ? { value: actor.system.magicka.value, max: actor.system.magicka.max }
            : null,
        speed: canView ? actor.system.speed.value : null,
        fatigue: canView ? actor.system.fatigue.level : 0,
      });
    }
    return resolved;
  }

  /** Show confirmation and duplicate an item */
  async #duplicateItem(item) {
    const confirmed = await confirmDialog({
      title: "Duplicate Item",
      content: `<p>Create a duplicate of <strong>${item.name}</strong>?</p>`,
    });
    if (confirmed) {
      const dupData = item.toObject();
      delete dupData._id;
      await requestCreateEmbeddedDocuments(this.document, "Item", [dupData]);
    }
  }

  /** Handle Actor drag-drop (add to group members) */
  async #onDropActor(data) {
    const actor = await fromUuid(data.uuid);
    if (!actor) {
      ui.notifications.warn("Could not find actor.");
      return;
    }
    if (actor.type === "Group") {
      ui.notifications.warn("Cannot add a group to a group.");
      return;
    }
    const members = this.document.system.members || [];
    if (members.some(m => m.id === actor.uuid)) {
      ui.notifications.warn("This actor is already a member.");
      return;
    }
    members.push({ id: actor.uuid, uuid: actor.uuid, sortOrder: members.length });
    await requestUpdateDocument(this.document, { "system.members": members });
    ui.notifications.info(`${actor.name} added to group.`);
  }

  /** Handle Item drag-drop (add to group inventory or unlink from container) */
  async #onDropItem(event, data) {
    const ALLOWED_ITEM_TYPES = ["weapon", "armor", "ammunition", "item"];
    const STACKABLE_TYPES = ["ammunition"];

    if (!this.document.isOwner) {
      ui.notifications.warn("You do not have permission to modify this group's inventory.");
      return;
    }

    const item = await resolveDroppedItem(data);
    if (!item) {
      console.debug?.("UESRPG | Group sheet received unresolved item drop payload", {
        actor: this.document?.uuid,
        data,
      });
      ui.notifications.warn("Could not find item.");
      return;
    }
    // Same-actor drops should keep native reorder/sort behavior.
    if (item.actor?.id === this.document.id) {
      return super._onDrop(event);
    }

    if (!ALLOWED_ITEM_TYPES.includes(item.type)) {
      ui.notifications.warn(`Cannot add ${item.type} items to group inventory.`);
      return;
    }

    const itemData = item.toObject();
    delete itemData._id;
    if (
      itemData.system?.quantity !== undefined &&
      !STACKABLE_TYPES.includes(itemData.type)
    ) {
      itemData.system.quantity = 1;
    }

    await requestCreateEmbeddedDocuments(this.document, "Item", [itemData]);
    ui.notifications.info(`${item.name} added to group inventory.`);
  }

  /* ────────────────── Action Handlers (instance methods) ─────────────── */
  // Referenced via prototype in DEFAULT_OPTIONS.actions.
  // ApplicationV2 dispatches them with `this` bound to the app instance.

  /** Open a member's actor sheet */
  async _onEditPortrait(event, target) {
    event?.preventDefault?.();
    event?.stopPropagation?.();
    if (!this.isEditable) return;

    const current = String(this.document?.img ?? "");
    const picker = new FilePicker({
      type: "imagevideo",
      current,
      callback: async (path) => {
        if (!path || path === current) return;
        await requestUpdateDocument(this.document, { img: path });
      },
    });
    await picker.browse();
  }

  _onOpenDescriptionEditor(event, _target) {
    event?.preventDefault?.();
    if (!this.isEditable) return;
    const container = this.element?.querySelector?.(".details .editor-section.description .editor");
    const button = container?.querySelector?.(".editor-edit");
    if (button) {
      button.click();
      return;
    }
    const field = container?.querySelector?.("[name='system.description']");
    if (field) field.focus();
  }

  _onOpenNotesEditor(event, _target) {
    event?.preventDefault?.();
    if (!this.isEditable) return;
    const container = this.element?.querySelector?.(".details .editor-section.notes .editor");
    const button = container?.querySelector?.(".editor-edit");
    if (button) {
      button.click();
      return;
    }
    const field = container?.querySelector?.("[name='system.notes']");
    if (field) field.focus();
  }

  /** Open a member's actor sheet */
  async _onViewMember(event, target) {
    const uuid =
      target.dataset?.uuid ||
      target.closest(".member-item")?.dataset?.uuid;
    if (!uuid) return;
    const actor = await fromUuid(uuid);
    if (actor) actor.sheet.render(true);
  }

  /** Remove a member from the group */
  async _onRemoveMember(event, target) {
    if (!this.document.isOwner) return;
    const uuid = target.closest(".member-item")?.dataset?.uuid;
    if (!uuid) return;
    const members = this.document.system.members.filter(m => m.id !== uuid);
    await requestUpdateDocument(this.document, { "system.members": members });
  }

  /** Cycle travel pace: slow → normal → fast → slow */
  async _onChangePace(_event, _target) {
    const paces = ["slow", "normal", "fast"];
    const current = this.document.system.travelPace || "normal";
    const idx = paces.indexOf(current);
    await requestUpdateDocument(this.document, {
      "system.travelPace": paces[(idx + 1) % paces.length],
    });
  }

  /** Apply short rest to all visible group members */
  async _onShortRest(_event, _target) {
    const members = await this.#resolveMembers(
      this.document.system.members || []
    );
    const visibleMembers = members.filter(m => m.canView && m.actor);

    if (!visibleMembers.length) {
      ui.notifications.warn("No members available for rest.");
      return;
    }

    const lines = [];
    for (const member of visibleMembers) {
      const { line } = await applyShortRest(member.actor);
      if (line) lines.push(line);
    }

    const content = buildRestChatContent("Short Rest (1 hour)", lines);
    await requestUpdateDocument(this.document, {
      "system.lastRest.short": game.time.worldTime,
    });
    await ChatMessage.create({
      user: game.user.id,
      speaker: { alias: this.document.name },
      content,
      whisper: this.#getGMUserIds(),
      style: CONST.CHAT_MESSAGE_STYLES.OTHER,
    });
    await this.render(false);
    ui.notifications.info("Short rest completed.");
  }

  /** Apply long rest to all visible group members */
  async _onLongRest(_event, _target) {
    const members = await this.#resolveMembers(
      this.document.system.members || []
    );
    const visibleMembers = members.filter(m => m.canView && m.actor);

    if (!visibleMembers.length) {
      ui.notifications.warn("No members available for rest.");
      return;
    }

    const lines = [];
    for (const member of visibleMembers) {
      const { line } = await applyLongRest(member.actor);
      if (line) lines.push(line);
    }

    const content = buildRestChatContent("Long Rest (8 hours)", lines);
    await requestUpdateDocument(this.document, {
      "system.lastRest.long": game.time.worldTime,
    });
    await ChatMessage.create({
      user: game.user.id,
      speaker: { alias: this.document.name },
      content,
      whisper: this.#getGMUserIds(),
      style: CONST.CHAT_MESSAGE_STYLES.OTHER,
    });
    await this.render(false);
    ui.notifications.info("Long rest completed.");
  }

  /** Deploy group members as tokens on the active canvas (GM only) */
  async _onDeployGroup(_event, _target) {
    if (!game.user.isGM) {
      ui.notifications.warn("Only GMs can deploy groups.");
      return;
    }
    if (!canvas.ready || !canvas.scene) {
      ui.notifications.warn("Canvas is not ready or no scene is active.");
      return;
    }

    const members = await this.#resolveMembers(
      this.document.system.members || []
    );
    const deployable = members.filter(m => m.actor && !m.missing);

    if (!deployable.length) {
      ui.notifications.warn("No members to deploy.");
      return;
    }

    // Calculate grid layout
    const cols = Math.ceil(Math.sqrt(deployable.length));
    const rows = Math.ceil(deployable.length / cols);
    const gridSize = canvas.grid.size;
    const spacing = gridSize;
    const canvasRect = canvas.dimensions.sceneRect;
    const gridWidth = cols * spacing;
    const gridHeight = rows * spacing;

    const padding = gridSize;
    let startX = canvasRect.x + canvasRect.width / 2 - gridWidth / 2;
    let startY = canvasRect.y + canvasRect.height / 2 - gridHeight / 2;
    startX = Math.max(
      canvasRect.x + padding,
      Math.min(startX, canvasRect.x + canvasRect.width - gridWidth - padding)
    );
    startY = Math.max(
      canvasRect.y + padding,
      Math.min(startY, canvasRect.y + canvasRect.height - gridHeight - padding)
    );

    const tokenDocs = [];
    for (let i = 0; i < deployable.length; i++) {
      const actor = deployable[i].actor;
      const col = i % cols;
      const row = Math.floor(i / cols);
      const snapped = canvas.grid.getSnappedPosition(
        startX + col * spacing,
        startY + row * spacing,
        1
      );
      try {
        const tokenData = await actor.getTokenDocument();
        tokenDocs.push({
          ...tokenData.toObject(),
          x: snapped.x,
          y: snapped.y,
          hidden: false,
        });
      } catch (err) {
        console.error(`UESRPG | Failed to prepare token for ${actor.name}`, err);
        ui.notifications.warn(`Could not prepare token for ${actor.name}.`);
      }
    }

    if (tokenDocs.length) {
      try {
        await canvas.scene.createEmbeddedDocuments("Token", tokenDocs);
        ui.notifications.info(
          `Deployed ${tokenDocs.length} group members in a ${cols}×${rows} grid.`
        );
      } catch (err) {
        console.error("UESRPG | Failed to deploy group tokens", err);
        ui.notifications.error("Failed to deploy group. See console for details.");
      }
    } else {
      ui.notifications.warn("No tokens could be deployed.");
    }
  }

  /** Show item creation dialog with type selection */
  async _onItemCreate(_event, _target) {
    const type = await customDialog({
      title: "Create Group Item",
      content: `<p>Select item type to create:</p>`,
      buttons: {
        weapon: { label: "Weapon" },
        armor: { label: "Armor" },
        ammunition: { label: "Ammunition" },
        container: { label: "Container" },
        item: { label: "Item" },
      },
    });
    if (!type) return;

    const name = `New ${type.charAt(0).toUpperCase() + type.slice(1)}`;
    await requestCreateEmbeddedDocuments(this.document, "Item", [{ name, type }]);
  }

  /** Delete an item with confirmation and container safety */
  async _onItemDelete(event, target) {
    if (!this.document.isOwner) return;

    const itemId = target.closest(".item")?.dataset?.itemId;
    if (!itemId) return;
    const item = this.document.items.get(itemId);
    if (!item) return;

    const escaped = item.name
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");

    const confirmed = await confirmDialog({
      title: "Delete Item",
      content: `<p>Are you sure you want to delete <strong>${escaped}</strong>?</p>`,
    });
    if (!confirmed) return;

    // Container-safe deletion
    if (item.type === "container") {
      await unlinkAllItemsFromContainer(this.document, item);
    } else {
      await unlinkItemFromContainer(this.document, item);
    }

    await requestDeleteEmbeddedDocuments(this.document, "Item", [itemId]);
    ui.notifications.info(`${item.name} deleted from group inventory.`);
  }

  /** Open an item's sheet */
  async _onItemShow(event, target) {
    const itemId = target.closest(".item")?.dataset?.itemId;
    if (!itemId) return;
    const item = this.document.items.get(itemId);
    if (item) item.sheet.render(true);
  }

  /** Open a container item's sheet from the backpack icon */
  async _onOpenContainer(event, target) {
    const containerId = target.dataset?.containerId;
    if (!containerId) return;
    const container = this.document.items.get(containerId);
    if (container) container.sheet.render(true);
  }
}


