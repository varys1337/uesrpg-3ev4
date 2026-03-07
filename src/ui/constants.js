import { SYSTEM_ID } from "../core/constants.js";

export { SYSTEM_ID };
export const UI_NAMESPACE = SYSTEM_ID;
export const TEMPLATE_ROOT = `systems/${SYSTEM_ID}/templates`;

export function templatePath(rel = "") {
  const clean = String(rel ?? "").replace(/^\/+/, "");
  return clean ? `${TEMPLATE_ROOT}/${clean}` : TEMPLATE_ROOT;
}

export function imagePath(rel = "") {
  const clean = String(rel ?? "").replace(/^\/+/, "");
  return clean ? `systems/${SYSTEM_ID}/images/${clean}` : `systems/${SYSTEM_ID}/images`;
}
