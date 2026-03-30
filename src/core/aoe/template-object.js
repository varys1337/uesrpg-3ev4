export async function awaitTemplateObject(templateId, maxAttempts = 40) {
  for (let i = 0; i < maxAttempts; i++) {
    const obj =
      canvas.templates?.get?.(templateId) ??
      canvas.templates?.placeables?.find?.((template) => template?.document?.id === templateId) ??
      null;
    if (obj) {
      if (obj.shape && typeof obj.shape.contains === "function") return obj;
      await new Promise((resolve) => setTimeout(resolve, 50));
      if (obj.shape && typeof obj.shape.contains === "function") return obj;
      try { obj.renderFlags?.set?.({ refreshShape: true }); } catch (_e) { /* noop */ }
      await new Promise((resolve) => setTimeout(resolve, 50));
      if (obj.shape) return obj;
      return obj;
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  return null;
}
