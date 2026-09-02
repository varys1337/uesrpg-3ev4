/**
 * Restore and focus an already-rendered ApplicationV2 singleton.
 *
 * @param {ApplicationV2|null} app
 * @param {object} [options]
 * @param {boolean|object|null} [options.render=null] Optional render argument.
 * @returns {Promise<ApplicationV2|null>}
 */
export async function activateOpenApplication(app, { render = null } = {}) {
  if (!app) return null;

  if (app.rendered && typeof app.maximize === "function") {
    await app.maximize();
  }

  if (render !== null && typeof app.render === "function") {
    await app.render(render);
  }

  app.bringToFront?.();
  return app;
}
