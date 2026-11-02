// Test helper: a picture of a whole Hillium window without macOS screen-recording rights.
// Captures every view with capturePage and paints them in stacking order on a neutral
// "desktop". Native window effects are an OS layer and can't appear.
export async function composeWindow(app, which = 0) {
  const dataUrl = await app.evaluate(async ({ BrowserWindow }, which) => {
    const win = [...globalThis.__hillium.windows][which];
    const { width, height } = win.base.getContentBounds();
    const parts = [];
    for (const view of win.base.contentView.children) {
      const image = await view.webContents.capturePage();
      parts.push({ url: image.toDataURL(), ...view.getBounds() });
    }
    const painter = new BrowserWindow({ show: false, width, height, webPreferences: { offscreen: true } });
    await painter.loadURL("about:blank");
    const result = await painter.webContents.executeJavaScript(`(async () => {
      const parts = ${JSON.stringify(parts)};
      const c = document.createElement("canvas");
      c.width = ${width} * 2; c.height = ${height} * 2;
      const g = c.getContext("2d");
      g.scale(2, 2);
      g.fillStyle = "#d9d9df"; g.fillRect(0, 0, ${width}, ${height});
      for (const p of parts) {
        const img = new Image(); img.src = p.url; await img.decode();
        g.drawImage(img, p.x, p.y, p.width, p.height);
      }
      return c.toDataURL("image/png");
    })()`);
    painter.destroy();
    return result;
  }, which);
  return Buffer.from(dataUrl.split(",")[1], "base64");
}
