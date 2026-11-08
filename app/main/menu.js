// The application menu. It's how keyboard shortcuts work everywhere: macOS shows it in the
// menu bar, Linux keeps it hidden on the window (Alt shows it) with the accelerators active.
import { Menu, app } from "electron";
import { COMMANDS, runCommand } from "./commands.js";

const mac = process.platform === "darwin";

export function buildMenu(hub) {
  const run = (id, arg) => () => runCommand(hub, hub.focusedWindow(), id, arg).catch((e) => console.warn(`[archium] ${id}: ${e.message}`));
  const cmd = (id) => {
    const c = COMMANDS.find((x) => x.id === id);
    return { label: c.label, accelerator: c.keys || undefined, click: run(id) };
  };
  const nav = (action) => () => {
    const win = hub.focusedWindow();
    if (win) hub.history(win, action);
  };
  const zoom = (step) => () => {
    const win = hub.focusedWindow();
    if (win) hub.zoom(win, step);
  };
  // ⌘1–⌘9 pick a tab; ⌃1–⌃9 (Alt on Linux) pick a space. Hidden, so the menus stay short.
  const numbered = [1, 2, 3, 4, 5, 6, 7, 8, 9].flatMap((n) => [
    { label: `Tab ${n}`, accelerator: `CmdOrCtrl+${n}`, click: run("tab-number", n), visible: false, acceleratorWorksWhenHidden: true },
    { label: `Space ${n}`, accelerator: `${mac ? "Control" : "Alt"}+${n}`, click: run("space-number", n), visible: false, acceleratorWorksWhenHidden: true },
  ]);

  const template = [
    ...(mac
      ? [
          {
            label: app.name,
            submenu: [
              { role: "about" },
              { type: "separator" },
              cmd("settings"),
              { type: "separator" },
              { role: "services" },
              { type: "separator" },
              { role: "hide" },
              { role: "hideOthers" },
              { role: "unhide" },
              { type: "separator" },
              { role: "quit" },
            ],
          },
        ]
      : []),
    {
      label: "File",
      submenu: [
        cmd("new-tab"),
        cmd("new-window"),
        cmd("private-window"),
        cmd("little"),
        cmd("new-space"),
        { type: "separator" },
        cmd("edit-url"),
        cmd("copy-url"),
        cmd("archive-page"),
        { type: "separator" },
        cmd("import"),
        { type: "separator" },
        cmd("close-tab"),
        cmd("reopen-tab"),
        ...(mac ? [] : [{ type: "separator" }, cmd("settings"), { role: "quit" }]),
      ],
    },
    { role: "editMenu" },
    {
      label: "View",
      submenu: [
        cmd("toggle-sidebar"),
        cmd("find"),
        { type: "separator" },
        { label: "Reload", accelerator: "CmdOrCtrl+R", click: nav("reload") },
        { label: "Hard Reload", accelerator: "CmdOrCtrl+Shift+R", click: nav("hard-reload") },
        { type: "separator" },
        { label: "Actual Size", accelerator: "CmdOrCtrl+0", click: zoom(0) },
        { label: "Zoom In", accelerator: "CmdOrCtrl+=", click: zoom(0.5) },
        { label: "Zoom In", accelerator: "CmdOrCtrl+Plus", click: zoom(0.5), visible: false, acceleratorWorksWhenHidden: true },
        { label: "Zoom Out", accelerator: "CmdOrCtrl+-", click: zoom(-0.5) },
        { type: "separator" },
        cmd("look-arc"),
        cmd("look-zen"),
        cmd("look-glass"),
        cmd("look-retro"),
        { type: "separator" },
        { role: "togglefullscreen" },
        cmd("devtools"),
      ],
    },
    {
      label: "History",
      submenu: [
        { label: "Back", accelerator: mac ? "CmdOrCtrl+[" : "Alt+Left", click: nav("back") },
        { label: "Forward", accelerator: mac ? "CmdOrCtrl+]" : "Alt+Right", click: nav("forward") },
        ...(mac
          ? [
              { label: "Back", accelerator: "CmdOrCtrl+Left", click: nav("back"), visible: false, acceleratorWorksWhenHidden: true },
              { label: "Forward", accelerator: "CmdOrCtrl+Right", click: nav("forward"), visible: false, acceleratorWorksWhenHidden: true },
            ]
          : []),
        { type: "separator" },
        cmd("library"),
      ],
    },
    {
      label: "Tabs",
      submenu: [
        cmd("pin-tab"),
        cmd("favourite-tab"),
        cmd("split"),
        cmd("unsplit"),
        { type: "separator" },
        cmd("next-tab"),
        cmd("previous-tab"),
        cmd("next-space"),
        cmd("previous-space"),
        { type: "separator" },
        cmd("zap"),
        cmd("boost"),
        ...numbered,
      ],
    },
    { role: "windowMenu" },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}
