/** Mittelalterliche Oberfläche (DOM). Platzhalter, wird ersetzt. */
import type { MountUi } from "../app/contract";

export const mountUi: MountUi = (root) => {
  root.textContent = "";
};
