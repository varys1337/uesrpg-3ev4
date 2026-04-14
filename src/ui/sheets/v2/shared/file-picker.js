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
