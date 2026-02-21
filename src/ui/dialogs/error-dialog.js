import { alertDialog } from "../../utils/dialog-v2-helper.js";

export default function renderErrorDialog(message) {
  alertDialog({
    title: "Error",
    content: `<div style="padding: 10px">${message}</div>`,
    buttonLabel: "Dismiss",
    buttonIcon: "fas fa-times",
  });
}
