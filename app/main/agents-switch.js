// Turns the control socket on and off with the "Allow the CLI and AI agents" setting.
import { app } from "electron";
import { startControl } from "./control.js";
import { agentMethods } from "./agent.js";

let control = null;

export function startAgents(hub) {
  if (control) return control;
  control = startControl({ userData: app.getPath("userData"), methods: agentMethods(hub), log: console.warn });
  return control;
}

export async function stopAgents() {
  const c = control;
  control = null;
  await c?.close();
}
