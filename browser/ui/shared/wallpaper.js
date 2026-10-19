// Procedural wallpapers, drawn on this device (no image files). Glass needs detail behind
// it or it has nothing to bend, so both have firm edges.
// clouds: the Win98-style sky from Qrer and Retrofind (MIT, same author).
// aurora: soft colour fields crossed by fine contour lines, for Liquid Glass.

function seeded(seed) {
  return () => (seed = (seed * 16807) % 2147483647) / 2147483647;
}

export function paintClouds(canvas) {
  const width = (canvas.width = innerWidth);
  const height = (canvas.height = innerHeight);
  const c = canvas.getContext("2d");
  const sky = c.createLinearGradient(0, 0, 0, height);
  sky.addColorStop(0, "#0b4fae");
  sky.addColorStop(0.6, "#3d86d6");
  sky.addColorStop(1, "#5f9de0");
  c.fillStyle = sky;
  c.fillRect(0, 0, width, height);
  const random = seeded(7);
  const clouds = Math.max(8, Math.round((width * height) / 40000));
  for (let k = 0; k < clouds; k++) {
    const cx = random() * width;
    const cy = random() * (height + 60);
    const size = 40 + random() * 110;
    for (let i = 0; i < 22; i++) {
      const x = cx + (random() - 0.5) * size * 3;
      const y = cy + (random() - 0.6) * size * 0.9;
      const r = size * (0.35 + random() * 0.5);
      const puff = c.createRadialGradient(x, y, 0, x, y, r);
      puff.addColorStop(0, "#ffffffc0");
      puff.addColorStop(0.7, "#eef4ff80");
      puff.addColorStop(0.85, "#dfe9fa30");
      puff.addColorStop(1, "#ffffff00");
      c.fillStyle = puff;
      c.beginPath();
      c.arc(x, y, r, 0, Math.PI * 2);
      c.fill();
    }
  }
}

export function paintAurora(canvas, dark) {
  const width = (canvas.width = innerWidth);
  const height = (canvas.height = innerHeight);
  const c = canvas.getContext("2d");
  c.fillStyle = dark ? "#0d0b1f" : "#e9e4ff";
  c.fillRect(0, 0, width, height);
  const random = seeded(11);
  const colours = dark ? ["#5b3fd1", "#0f8f9c", "#c2389b", "#2b54d8", "#e0803a"] : ["#8f74ff", "#3cc6d0", "#ff7ab8", "#5f8bff", "#ffb35c"];
  for (let i = 0; i < 9; i++) {
    const x = random() * width;
    const y = random() * height;
    const r = (0.25 + random() * 0.35) * Math.max(width, height);
    const g = c.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, `${colours[i % colours.length]}${dark ? "cc" : "dd"}`);
    g.addColorStop(1, `${colours[i % colours.length]}00`);
    c.fillStyle = g;
    c.fillRect(0, 0, width, height);
  }
  // Contour lines: thin, high-contrast detail that shows the refraction at a glance.
  c.lineWidth = 1.2;
  for (let k = 0; k < 46; k++) {
    c.strokeStyle = dark ? `rgb(255 255 255 / ${0.06 + (k % 3) * 0.03})` : `rgb(255 255 255 / ${0.25 + (k % 3) * 0.1})`;
    c.beginPath();
    const base = (k / 46) * (height + 240) - 120;
    for (let x = 0; x <= width; x += 12) {
      const y = base + Math.sin(x / 180 + k * 0.45) * 38 + Math.sin(x / 61 + k) * 9;
      if (x === 0) c.moveTo(x, y);
      else c.lineTo(x, y);
    }
    c.stroke();
  }
}
