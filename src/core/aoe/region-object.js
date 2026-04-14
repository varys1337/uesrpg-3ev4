export async function awaitRegionObject(regionId, maxAttempts = 40) {
  for (let i = 0; i < maxAttempts; i += 1) {
    const obj =
      canvas.regions?.get?.(regionId) ??
      canvas.regions?.placeables?.find?.((region) => region?.document?.id === regionId) ??
      null;
    if (obj) {
      if (obj.geometry || obj.document?.documentName === "Region") return obj;
      await new Promise((resolve) => setTimeout(resolve, 50));
      if (obj.geometry || obj.document?.documentName === "Region") return obj;
      try { obj.renderFlags?.set?.({ redraw: true, refresh: true }); } catch (_e) { /* noop */ }
      await new Promise((resolve) => setTimeout(resolve, 50));
      return obj;
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  return null;
}
