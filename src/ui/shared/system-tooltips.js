const TOOLTIP_CLASS = "uesrpg-tooltip";
const TOOLTIP_SELECTOR = "[data-tooltip], [data-tooltip-text], [data-tooltip-html]";
const SYSTEM_SCOPE_SELECTOR = ".uesrpg, [class*='uesrpg-']";
const VALID_DIRECTIONS = new Set(["CENTER", "LEFT", "RIGHT", "UP", "DOWN"]);
const LOCALIZATION_KEY_PATTERN = /^[A-Za-z0-9_.-]+$/;

const _boundFocusScopes = new WeakSet();
let _hooksRegistered = false;

function _isElement(value) {
  return typeof Element !== "undefined" && value instanceof Element;
}

function _appendClassAttribute(element, attribute, className) {
  const classes = new Set(String(element.getAttribute(attribute) ?? "").split(/\s+/).filter(Boolean));
  classes.add(className);
  element.setAttribute(attribute, [...classes].join(" "));
}

function _escapeAttribute(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function _normalizeLocalizationKey(value) {
  const key = String(value ?? "").trim();
  return LOCALIZATION_KEY_PATTERN.test(key) ? key : "";
}

function _tooltipTargetFromEvent(root, event) {
  const origin = _isElement(event?.target) ? event.target : null;
  const target = origin?.closest?.(TOOLTIP_SELECTOR) ?? null;
  return target && root.contains(target) ? target : null;
}

function _inheritsSystemTooltipClass(target, root) {
  let current = target;
  while (_isElement(current)) {
    const classes = String(current.getAttribute("data-tooltip-class") ?? "").split(/\s+/);
    if (classes.includes(TOOLTIP_CLASS)) return true;
    if (current === root) break;
    current = current.parentElement;
  }
  return false;
}

function _activateFocusedTooltip(root, event) {
  const target = _tooltipTargetFromEvent(root, event);
  if (!target || !_inheritsSystemTooltipClass(target, root)) return;
  game?.tooltip?.activate?.(target, { cssClass: TOOLTIP_CLASS });
}

function _deactivateFocusedTooltip(root, event) {
  const target = _tooltipTargetFromEvent(root, event);
  if (!target || !_inheritsSystemTooltipClass(target, root)) return;

  const related = _isElement(event?.relatedTarget) ? event.relatedTarget : null;
  if (related && target.contains(related)) return;
  game?.tooltip?.deactivate?.();
}

/**
 * Mark a UESRPG-owned DOM root as a shared tooltip scope.
 *
 * Foundry's TooltipManager inherits data-tooltip-class from ancestors, so one
 * marker is sufficient for all static tooltip elements beneath the root. A
 * single delegated focus pair supplements Foundry's pointer-driven handling.
 *
 * @param {Element} root
 * @returns {Element|null}
 */
export function markSystemTooltipScope(root) {
  if (!_isElement(root)) return null;

  markSystemTooltipElement(root);
  bindSystemTooltipFocusScope(root);
  return root;
}

/** Add the shared tooltip class without turning sibling UI into system scope. */
export function markSystemTooltipElement(element, { ariaLabel = "", ensureAccessibleName = false } = {}) {
  if (!_isElement(element)) return null;
  _appendClassAttribute(element, "data-tooltip-class", TOOLTIP_CLASS);
  element.removeAttribute("title");

  const explicitLabel = String(ariaLabel ?? "").trim();
  if (explicitLabel) element.setAttribute("aria-label", explicitLabel);
  else if (ensureAccessibleName && !element.hasAttribute("aria-label")) {
    const displayText = String(element.getAttribute("data-tooltip-text") ?? "").trim();
    const localizationKey = _normalizeLocalizationKey(element.getAttribute("data-tooltip"));
    const accessibleName = displayText || (localizationKey ? game?.i18n?.localize?.(localizationKey) : "");
    if (accessibleName) element.setAttribute("aria-label", accessibleName);
  }
  return element;
}

/** Bind one delegated focus handler pair to an existing DOM boundary. */
export function bindSystemTooltipFocusScope(root) {
  if (!_isElement(root)) return null;
  if (_boundFocusScopes.has(root)) return root;

  root.addEventListener("focusin", (event) => _activateFocusedTooltip(root, event));
  root.addEventListener("focusout", (event) => _deactivateFocusedTooltip(root, event));
  _boundFocusScopes.add(root);
  return root;
}

/**
 * Configure one dynamically-created system tooltip using Foundry's supported
 * data attributes. Localization keys and final display text are intentionally
 * separate so plain text is never interpreted as an i18n key.
 *
 * @param {Element} element
 * @param {object} options
 * @param {string} [options.key]
 * @param {string} [options.text]
 * @param {string} [options.ariaLabel]
 * @param {"CENTER"|"LEFT"|"RIGHT"|"UP"|"DOWN"} [options.direction]
 * @returns {Element|null}
 */
export function setSystemTooltip(element, { key = "", text = "", ariaLabel = "", direction } = {}) {
  if (!_isElement(element)) return null;

  const localizationKey = _normalizeLocalizationKey(key);
  const displayText = String(text ?? "").trim();
  if (localizationKey) {
    element.setAttribute("data-tooltip", localizationKey);
    element.removeAttribute("data-tooltip-text");
    element.removeAttribute("data-tooltip-html");
  } else if (displayText) {
    element.setAttribute("data-tooltip-text", displayText);
    element.removeAttribute("data-tooltip");
    element.removeAttribute("data-tooltip-html");
  } else {
    element.removeAttribute("data-tooltip");
    element.removeAttribute("data-tooltip-text");
    element.removeAttribute("data-tooltip-html");
  }

  markSystemTooltipElement(element, { ariaLabel });

  const normalizedDirection = String(direction ?? "").trim().toUpperCase();
  if (VALID_DIRECTIONS.has(normalizedDirection)) {
    element.setAttribute("data-tooltip-direction", normalizedDirection);
  } else if (direction !== undefined) {
    element.removeAttribute("data-tooltip-direction");
  }

  return element;
}

/**
 * Build tooltip attributes for system-owned HTML assembled before a DOM node
 * exists. Attribute values are escaped here so callers cannot accidentally
 * bypass the localization-key/text split used by setSystemTooltip.
 *
 * @param {object} options
 * @param {string} [options.key]
 * @param {string} [options.text]
 * @param {string} [options.ariaLabel]
 * @param {"CENTER"|"LEFT"|"RIGHT"|"UP"|"DOWN"} [options.direction]
 * @returns {string}
 */
export function systemTooltipAttributes({ key = "", text = "", ariaLabel = "", direction } = {}) {
  const localizationKey = _normalizeLocalizationKey(key);
  const displayText = String(text ?? "").trim();
  const attributes = [];

  if (localizationKey) attributes.push(`data-tooltip="${_escapeAttribute(localizationKey)}"`);
  else if (displayText) attributes.push(`data-tooltip-text="${_escapeAttribute(displayText)}"`);
  else return "";

  attributes.push(`data-tooltip-class="${TOOLTIP_CLASS}"`);

  const accessibleName = String(ariaLabel ?? "").trim();
  if (accessibleName) attributes.push(`aria-label="${_escapeAttribute(accessibleName)}"`);

  const normalizedDirection = String(direction ?? "").trim().toUpperCase();
  if (VALID_DIRECTIONS.has(normalizedDirection)) {
    attributes.push(`data-tooltip-direction="${normalizedDirection}"`);
  }

  return attributes.join(" ");
}

function _applicationIsSystemOwned(application, element) {
  try {
    const configuredClass = Array.from(application?.classList ?? []).some((className) => (
      className === "uesrpg" || className.startsWith("uesrpg-")
    ));
    return configuredClass || (_isElement(element) && element.matches(SYSTEM_SCOPE_SELECTOR));
  } catch (_error) {
    return false;
  }
}

function _topLevelSystemScopes(root) {
  if (!_isElement(root)) return [];
  if (root.matches(SYSTEM_SCOPE_SELECTOR)) return [root];

  const candidates = [...root.querySelectorAll(SYSTEM_SCOPE_SELECTOR)];
  return candidates.filter((candidate) => !candidates.some((other) => other !== candidate && other.contains(candidate)));
}

/** Register shared tooltip scope hooks exactly once. */
export function registerSystemTooltipHooks() {
  if (_hooksRegistered) return;
  _hooksRegistered = true;

  Hooks.on("renderApplicationV2", (application, element) => {
    if (!_applicationIsSystemOwned(application, element)) return;
    markSystemTooltipScope(element);
  });

  Hooks.on("renderChatMessageHTML", (_message, html) => {
    for (const scope of _topLevelSystemScopes(html)) markSystemTooltipScope(scope);
  });
}
