import { requestUpdateDocument } from "../../../../utils/authority-proxy.js";
export function createImageVideoFilePicker({ current = "", callback } = {}) {
  const FilePickerImpl = foundry?.applications?.apps?.FilePicker?.implementation;
  if (typeof FilePickerImpl !== "function") {
    throw new Error("Foundry FilePicker implementation is unavailable.");
  }
  return new FilePickerImpl({
    type: "imagevideo",
    current,
    callback,
  });
}

export async function editSheetPortrait(event, target) {
    event?.preventDefault?.();
    event?.stopPropagation?.();
    if (!this.isEditable) return;

    const current = String(this.document?.img ?? "");
    const picker = createImageVideoFilePicker({
      current,
      callback: async (path) => {
        if (!path || path === current) return;
        await requestUpdateDocument(this.document, { img: path });
      },
    });
    await picker.browse();
  }
