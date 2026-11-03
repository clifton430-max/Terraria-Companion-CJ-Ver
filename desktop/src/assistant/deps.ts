// The real app behind the assistant's actions (Tauri commands; Rust validates every change).

import {
  accessibilityStatus,
  aiClassify,
  combatCommand,
  getBuildMode,
  getControlMode,
  getLinesMode,
  getPrefs,
  patchPrefs,
  setBuildMode,
  setControlMode,
  setLinesMode,
  showChat,
  showInventory,
  openSystemSettings,
  showSettings,
  startGame,
  stopGame,
  type CombatAction,
} from "../bridge";
import type { RouterDeps } from "./router";

export const appDeps = (): RouterDeps => ({
  getPrefs,
  patchPrefs,
  getControlMode,
  setControlMode,
  getBuildMode,
  setBuildMode,
  getLinesMode,
  setLinesMode,
  combat: (a) => combatCommand(a as CombatAction),
  showSettings: (tab) => showSettings(tab as Parameters<typeof showSettings>[0]),
  showInventory,
  showChat,
  classify: aiClassify,
  openSystemSettings,
  startGame,
  stopGame,
  accessibility: accessibilityStatus,
});
