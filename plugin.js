(function () {
  let ctx = null;
  let loc = null;
  let imageUrl = "";
  let seq = 0;
  let pushedAt = 0;
  const tones = {};

  function take(next) {
    if (!next) return;
    ctx = ctx || {};
    ["roomId", "headers", "campaign", "save"].forEach(function (key) {
      if (next[key] != null) ctx[key] = next[key];
    });
  }

  function store() {
    const campaign = ctx && ctx.campaign ? ctx.campaign() : null;
    if (!campaign) return null;
    if (!campaign.plugins || typeof campaign.plugins !== "object" || Array.isArray(campaign.plugins)) campaign.plugins = {};
    if (!campaign.plugins.placeColor || typeof campaign.plugins.placeColor !== "object" || Array.isArray(campaign.plugins.placeColor)) {
      campaign.plugins.placeColor = { mode: "common", pick: "#e6c36a", frame: false, bright: 40 };
    }
    const bag = campaign.plugins.placeColor;
    if (bag.mode !== "pick" && bag.mode !== "common") bag.mode = "common";
    if (!/^#[0-9a-f]{6}$/i.test(bag.pick || "")) bag.pick = "#e6c36a";
    const bright = Math.round(Number(bag.bright));
    bag.bright = Number.isFinite(bright) ? Math.max(0, Math.min(100, bright)) : 40;
    bag.frame = bag.frame === true;
    return bag;
  }

  function save() {
    try { if (ctx && ctx.save) ctx.save(); } catch (err) {}
  }

  function hexOf(value) {
    return /^#[0-9a-f]{6}$/i.test(value || "") ? value : "";
  }

  function read(target) {
    const row = target || loc;
    const locked = row ? hexOf(row.lampColor) : "";
    const tone = row && tones[row.id] ? tones[row.id].hex : "";
    let bright = 30;
    if (row && row.lampBright != null && row.lampBright !== "") {
      const n = Math.round(Number(row.lampBright));
      if (Number.isFinite(n)) bright = Math.max(0, Math.min(100, n));
    }
    return { color: locked || tone || "", bright: bright, dominant: tone || "" };
  }

  window.ShirmoTone = { read: read };

  function frameColor(bag) {
    if (bag.mode === "pick") return bag.pick;
    const tone = read(loc);
    return tone.dominant || tone.color || bag.pick;
  }

  function dropMasterFrame() {
    const layer = document.getElementById("play-frame");
    if (layer && !document.querySelector(".viewer")) layer.remove();
  }

  function pushFrame(force) {
    dropMasterFrame();
    const bag = store();
    if (!bag || !ctx || !ctx.roomId) return;
    const now = Date.now();
    if (!force && now - pushedAt < 200) return;
    pushedAt = now;
    seq += 1;
    const on = bag.frame === true;
    fetch("/api/rooms/" + ctx.roomId + "/events", {
      method: "POST",
      headers: ctx.headers || { "content-type": "application/json" },
      body: JSON.stringify({
        type: "place-frame",
        on: on,
        color: frameColor(bag),
        alpha: bag.bright / 100,
        seq: seq
      })
    }).catch(function () {});
  }

  function sample(url, place) {
    if (!url || !place || !place.id) return;
    const known = tones[place.id];
    if (known && known.url === url) {
      if (loc && loc.id === place.id) {
        window.dispatchEvent(new Event("shirmo-tone"));
        const bag = store();
        if (bag && bag.frame && bag.mode === "common") pushFrame(true);
      }
      return;
    }
    const image = new Image();
    image.onload = function () {
      try {
        const canvas = document.createElement("canvas");
        canvas.width = 96;
        canvas.height = 54;
        const draw = canvas.getContext("2d", { willReadFrequently: true });
        draw.drawImage(image, 0, 0, 96, 54);
        const data = draw.getImageData(0, 0, 96, 54).data;
        const bins = {};
        for (let i = 0; i < data.length; i += 4) {
          if (data[i + 3] < 128) continue;
          const key = (data[i] >> 4) + "," + (data[i + 1] >> 4) + "," + (data[i + 2] >> 4);
          const bin = bins[key] || (bins[key] = { n: 0, r: 0, g: 0, b: 0 });
          bin.n += 1;
          bin.r += data[i];
          bin.g += data[i + 1];
          bin.b += data[i + 2];
        }
        let best = null;
        Object.keys(bins).forEach(function (key) {
          if (!best || bins[key].n > best.n) best = bins[key];
        });
        if (!best) return;
        const hex = "#" + [best.r, best.g, best.b].map(function (n) {
          return Math.round(n / best.n).toString(16).padStart(2, "0");
        }).join("");
        tones[place.id] = { url: url, hex: hex };
        window.dispatchEvent(new Event("shirmo-tone"));
        const bag = store();
        if (bag && bag.frame && bag.mode === "common" && loc && loc.id === place.id) pushFrame(true);
      } catch (err) { /* чужая картинка без доступа к пикселям */ }
    };
    image.src = url;
  }

  function mount(host) {
    take(ctx);
    const bag = store();
    if (!bag) return;
    host.innerHTML = "";
    const box = document.createElement("div");
    box.className = "place-color";
    const lead = document.createElement("p");
    lead.className = "note";
    lead.textContent = "Остальные плагины берут отсюда цвет и яркость локации. Рамка рисуется вокруг экрана.";
    const show = document.createElement("label");
    show.className = "check";
    const showBox = document.createElement("input");
    showBox.type = "checkbox";
    showBox.checked = bag.frame;
    show.append(showBox, document.createTextNode(" Рамка вокруг экрана"));
    const modes = document.createElement("div");
    modes.className = "clock-shapes";
    function modeButton(id, label) {
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = label;
      button.className = bag.mode === id ? "is-on" : "";
      button.addEventListener("click", function () {
        bag.mode = id;
        save();
        mount(host);
        pushFrame(true);
      });
      return button;
    }
    modes.append(modeButton("common", "Самый частый"), modeButton("pick", "Свой цвет"));
    const color = document.createElement("input");
    color.type = "color";
    color.value = bag.pick;
    color.hidden = bag.mode !== "pick";
    color.addEventListener("input", function () {
      bag.pick = color.value;
      save();
      swatch.style.background = frameColor(bag);
      pushFrame(false);
    });
    const level = document.createElement("label");
    level.className = "plugin-field";
    const title = document.createElement("span");
    const range = document.createElement("input");
    range.type = "range";
    range.min = "0";
    range.max = "100";
    range.value = String(bag.bright);
    title.textContent = "Яркость рамки " + bag.bright;
    range.addEventListener("input", function () {
      bag.bright = Math.max(0, Math.min(100, Math.round(Number(range.value) || 0)));
      title.textContent = "Яркость рамки " + bag.bright;
      swatch.style.opacity = String(bag.bright / 100);
      save();
      pushFrame(false);
    });
    level.append(title, range);
    const swatch = document.createElement("div");
    swatch.style.height = "36px";
    swatch.style.borderRadius = "8px";
    swatch.style.border = "1px solid #8a6a3a";
    swatch.style.background = frameColor(bag);
    swatch.style.opacity = String(bag.bright / 100);
    showBox.addEventListener("change", function () {
      bag.frame = showBox.checked;
      save();
      pushFrame(true);
    });
    box.append(lead, show, modes, color, level, swatch);
    host.append(box);
  }

  function stop() {
    const bag = store();
    if (bag && bag.frame) {
      bag.frame = false;
      pushFrame(true);
      bag.frame = true;
    }
    dropMasterFrame();
    try { delete window.ShirmoTone; } catch (err) { window.ShirmoTone = undefined; }
  }

  function install(host) {
    host.add({
      id: "place-color",
      icon: '<rect x="4" y="4" width="16" height="16" rx="2" fill="none" stroke="currentColor" stroke-width="1.6"/><rect x="8" y="8" width="8" height="8" fill="currentColor"/>',
      settings: function (env) {
        take(env);
        const host = document.createElement("div");
        mount(host);
        return host;
      },
      boot: function (env) { take(env); window.ShirmoTone = { read: read }; pushFrame(true); },
      place: function (place, image) {
        loc = place || null;
        imageUrl = image || "";
        if (loc && imageUrl) sample(imageUrl, loc);
        else window.dispatchEvent(new Event("shirmo-tone"));
        const bag = store();
        if (bag && bag.frame) pushFrame(true);
      },
      module: {
        title: "Цвет локаций",
        icon: '<rect x="4" y="4" width="16" height="16" rx="2" fill="none" stroke="currentColor" stroke-width="1.6"/><rect x="8" y="8" width="8" height="8" fill="currentColor"/>',
        mount: function (hostNode, next) { take(next); mount(hostNode); },
        stop: stop
      }
    });
  }

  if (window.ShirmoHost) install(window.ShirmoHost);
  else window.addEventListener("shirmo-host", function () { install(window.ShirmoHost); }, { once: true });
})();
