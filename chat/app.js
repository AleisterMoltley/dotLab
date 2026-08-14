(function () {
  var log = document.getElementById("log");
  var input = document.getElementById("input");
  var sendBtn = document.getElementById("send");
  var projectEl = document.getElementById("project");
  var history = [];
  var projectsCache = [];
  var current = { path: "", name: "", engine: "", vintage_profile: "", genre: "" };
  var playPoll = null;
  var agentPoll = null;
  var health = {};
  var engineListFilter = "all";

  var ENGINE_LABEL = {
    three: "Three.js",
    pixel: "Pixel",
    vintage: "Vintage",
    auto: "Auto",
  };
  var ENGINE_HINT = {
    auto: "Auto picks Three, Pixel, or Vintage from your prompt.",
    three: "WebGL Three.js · full craft juice · skill FPS ship bar.",
    pixel: "Canvas2D · pixelart.js + FX · no Three dependency.",
    vintage: "Game Boy ship bar · hard ceiling GBA (≤240×160, ≤15 colors, no 3D).",
  };

  function $(id) { return document.getElementById(id); }
  function esc(s) {
    return String(s || "").replace(/[&<>"']/g, function (c) {
      return ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c];
    });
  }
  function relTime(ts) {
    if (!ts) return "";
    var s = Math.max(0, (Date.now() / 1000) - Number(ts));
    if (s < 60) return "now";
    if (s < 3600) return Math.floor(s / 60) + "m";
    if (s < 86400) return Math.floor(s / 3600) + "h";
    if (s < 86400 * 14) return Math.floor(s / 86400) + "d";
    var d = new Date(ts * 1000);
    return (d.getMonth() + 1) + "/" + d.getDate();
  }
  function api(path, body) {
    var opt = { headers: { "Content-Type": "application/json" } };
    if (body) { opt.method = "POST"; opt.body = JSON.stringify(body); }
    return fetch(path, opt).then(function (r) { return r.json(); });
  }

  function setProjectButtons(on) {
    ["nowPlay", "nowShow", "nowTerm", "nowEditor", "nowZip", "nowVerify", "nowKeep", "nowTighter", "nowJuice", "nowAgent", "nowDup", "nowRename", "nowDel",
      "toolPlay", "toolFolder", "toolDup", "toolDel", "toolEditor", "toolTerm", "toolZip", "toolVerify", "toolAgent"].forEach(function (id) {
      var el = $(id);
      if (el) el.disabled = !on;
    });
  }

  function toast(msg, ms) {
    var el = $("toast");
    if (!el) return;
    el.textContent = msg;
    el.classList.add("show");
    clearTimeout(el._t);
    el._t = setTimeout(function () { el.classList.remove("show"); }, ms || 3200);
  }

  function pulseVerifyPath(path) {
    document.querySelectorAll(".proj").forEach(function (el) {
      if (el.getAttribute("data-path") !== path) return;
      var b = el.querySelector(".badge");
      if (!b) return;
      b.classList.remove("pulse");
      void b.offsetWidth;
      b.classList.add("pulse");
    });
  }

  function engineBadgeHtml(engine, profile) {
    var e = (engine || "three").toLowerCase();
    if (e !== "three" && e !== "pixel" && e !== "vintage") e = "three";
    var label = e === "three" ? "3D" : e === "pixel" ? "Pixel" : "GB";
    if (e === "vintage" && profile) label = String(profile).toUpperCase();
    return '<span class="badge eng-' + e + '">' + esc(label) + "</span>";
  }

  function findProject(path) {
    if (!path) return null;
    for (var i = 0; i < projectsCache.length; i++) {
      if (projectsCache[i].path === path) return projectsCache[i];
    }
    return null;
  }

  function setCurrent(path, name, meta) {
    current.path = path || "";
    current.name = name || (path ? path.split("/").pop() : "");
    meta = meta || findProject(path) || {};
    current.engine = meta.engine || "";
    current.vintage_profile = meta.vintage_profile || "";
    current.genre = meta.genre || "";
    if (projectEl) projectEl.value = current.path;
    try {
      localStorage.setItem("dl.project", current.path);
      localStorage.setItem("gm.project", current.path);
    } catch (e) {}

    var ctx = $("contextLine");
    if (ctx) {
      if (current.path) {
        var eng = current.engine || "three";
        var bits = [
          "<b>" + esc(current.name) + "</b>",
          engineBadgeHtml(eng, current.vintage_profile),
        ];
        if (current.genre) bits.push(esc(current.genre));
        ctx.innerHTML = bits.join(" · ");
      } else {
        ctx.innerHTML = "no project · pick engine below";
      }
    }
    document.body.classList.toggle("has-project", !!current.path);
    var craft = $("craftChips");
    var examples = $("exampleChips");
    var newOpts = $("newOptions");
    if (craft) craft.hidden = !current.path;
    if (examples) examples.hidden = !!current.path;
    if (newOpts) newOpts.style.display = current.path ? "none" : "";
    setProjectButtons(!!current.path);
    if (sendBtn) sendBtn.textContent = current.path ? "Continue" : "Make game";
    var ta = $("input");
    if (ta && !current.path) {
      var engSel = ($("optEngine") && $("optEngine").value) || "auto";
      if (engSel === "vintage") ta.placeholder = "GB verb + place… e.g. jump caves, collect shells";
      else if (engSel === "pixel") ta.placeholder = "Pixel verb + place… e.g. top-down forest walk";
      else if (engSel === "three") ta.placeholder = "Player verb + place… e.g. neon skill FPS";
      else ta.placeholder = "Player verb + place… engine Auto from prompt";
    } else if (ta && current.path) {
      ta.placeholder = "Continue — feel tweak or feature…";
    }
    var hint = $("composerHint");
    if (hint) {
      hint.textContent = current.path
        ? "Craft · Keep/Tighter/Juice · Deep · Enter"
        : "Pick engine · Enter make · ⌘P play";
    }
    // Play embed status engine tag
    var pes = $("playEmbedStatus");
    if (pes && current.path) {
      var elab = ENGINE_LABEL[current.engine] || current.engine || "game";
      pes.textContent = "play · " + elab.toLowerCase();
    }
    var vBar = $("vintagePaletteBar");
    if (vBar) vBar.hidden = !(current.path && current.engine === "vintage");
    document.body.classList.toggle("project-vintage", current.engine === "vintage");
    document.body.classList.toggle("project-pixel", current.engine === "pixel");
    document.body.classList.toggle("project-three", current.engine === "three" || (!current.engine && current.path));
    if (!current.path) {
      hidePlayBar();
      hideSession();
      hideIterate();
      hideAgentBox();
      stopPlayPoll();
      stopAgentPoll();
      if (pes) pes.textContent = "play";
      showShipCard(null);
      var emb = $("playEmbed");
      if (emb) {
        emb.classList.remove("eng-three", "eng-pixel", "eng-vintage");
      }
    } else {
      loadSession();
      refreshPlayStatus();
      refreshShipCard(current.path);
      var emb2 = $("playEmbed");
      if (emb2) {
        emb2.classList.remove("eng-three", "eng-pixel", "eng-vintage");
        emb2.classList.add("eng-" + (current.engine || "three"));
      }
    }
    renderProjects();
  }

  function refreshHealth() {
    return api("/api/health").then(function (h) {
      health = h || {};
      var ok = !!(h && h.ok);
      var led = $("dot");
      var text = $("statusText");
      if (led) {
        led.classList.toggle("ok", ok);
        led.classList.toggle("bad", !ok);
      }
      if (text) {
        if (h && h.backend === "cloud") {
          text.textContent = "cloud · " + (h.provider || "") + " · " + (h.model || "");
        } else if (ok) {
          text.textContent = (h.model || "dotlab") + " · local";
        } else if (h && !h.ollama) {
          text.textContent = "ollama offline";
        } else {
          text.textContent = (h && h.error) || "model missing";
        }
      }
      if (h && h.projects_root) {
        var rootEl = $("projectsRoot");
        if (rootEl) rootEl.textContent = h.projects_root;
      }
      var ss = $("settingsStatus");
      if (ss && h) {
        if (h.backend === "cloud") {
          ss.textContent = "Cloud ON · " + (h.provider || "") + " · " + (h.model || "") + " (paid)";
        } else {
          ss.textContent = "Local · " + (h.model || "dotlab") + " · $0";
        }
      }
      return h;
    }).catch(function () {
      var led = $("dot");
      if (led) { led.classList.remove("ok"); led.classList.add("bad"); }
      var text = $("statusText");
      if (text) text.textContent = "offline";
    });
  }

  function renderStats(stats) {
    var el = $("sideStats");
    if (!el || !stats || !stats.ok) {
      if (el) el.textContent = "—";
      return;
    }
    var e = stats.engines || {};
    el.innerHTML =
      "<b>" + (stats.total || 0) + "</b> games · " +
      "3D " + (e.three || 0) + " · Pixel " + (e.pixel || 0) + " · GB " + (e.vintage || 0) +
      "<br>ship-rate <b>" + (stats.ship_rate || 0) + "%</b> · avg " + (stats.avg_score || 0);
  }

  function showShipCard(card) {
    var el = $("shipCard");
    if (!el) return;
    if (!card || !card.ok) {
      el.classList.remove("show");
      el.innerHTML = "";
      return;
    }
    var eng = card.engine || "three";
    var bits = [
      engineBadgeHtml(eng, card.profile),
      esc(card.genre || ""),
      esc(card.resolution || ""),
    ];
    if (card.colors) bits.push(card.colors + " col");
    if (card.verify_score != null) {
      bits.push(
        card.verify_ok
          ? "P0 " + card.verify_score
          : "P0 fail " + ((card.p0_fail || []).join(",") || "")
      );
    }
    el.innerHTML =
      '<div class="title">' + esc(card.name || "slice") + "</div>" +
      '<div>' + bits.filter(Boolean).join(" · ") + "</div>" +
      (card.verb ? '<div class="hint">' + esc(card.verb) + "</div>" : "") +
      '<div class="row">' +
      '<button type="button" class="btn sm" id="shipPlay">Play</button>' +
      '<button type="button" class="btn sm" id="shipRoom">+Room</button>' +
      (eng === "vintage"
        ? '<button type="button" class="btn sm" id="shipPal">Palette</button>'
        : "") +
      "</div>";
    el.classList.add("show");
    var sp = $("shipPlay");
    if (sp) sp.onclick = function () { if (current.path) playPath(current.path); };
    var sr = $("shipRoom");
    if (sr) sr.onclick = function () { oneMoreRoom(); };
    var spal = $("shipPal");
    if (spal) {
      spal.onclick = function () {
        var bar = $("vintagePaletteBar");
        if (bar) bar.hidden = !bar.hidden;
      };
    }
  }

  function refreshShipCard(path) {
    if (!path) {
      showShipCard(null);
      return;
    }
    api("/api/projects/ship-card?path=" + encodeURIComponent(path)).then(function (d) {
      showShipCard(d);
    }).catch(function () {});
  }

  function switchEngine(engine) {
    if (!current.path) {
      toast("Select a project");
      return;
    }
    var body = { path: current.path, engine: engine };
    if (engine === "vintage") {
      body.vintageProfile = ($("optVintage") && $("optVintage").value) || "gb";
    }
    addMsg("bot", "Switching engine → " + (ENGINE_LABEL[engine] || engine) + "…");
    api("/api/projects/engine-switch", body).then(function (d) {
      if (!d || !d.ok) {
        addMsg("bot", "Switch failed: " + ((d && d.error) || "?"));
        return;
      }
      addMsg("bot", d.summary || ("Now " + engine));
      if (d.ship_card) showShipCard(d.ship_card);
      loadProjects().then(function () {
        setCurrent(current.path, current.name, {
          engine: engine,
          genre: current.genre,
          vintage_profile: body.vintageProfile || "",
        });
        playPath(current.path);
      });
      toast("Engine → " + engine);
    });
  }

  function oneMoreRoom() {
    if (!current.path) return;
    api("/api/projects/one-more-room", { path: current.path }).then(function (d) {
      if (!d || !d.ok) {
        toast((d && d.error) || "room failed");
        return;
      }
      addMsg("bot", d.summary || "+room");
      if (d.ship_card) showShipCard(d.ship_card);
      var frame = $("playFrame");
      if (frame && frame.getAttribute("src")) frame.src = frame.getAttribute("src");
      toast("Room " + (d.roomCount || ""));
    });
  }

  function setVintagePalette(id) {
    if (!current.path) return;
    api("/api/projects/vintage-palette", { path: current.path, palette: id }).then(function (d) {
      if (!d || !d.ok) {
        toast((d && d.error) || "palette failed");
        return;
      }
      toast(d.summary || id);
      if (d.ship_card) showShipCard(d.ship_card);
      var frame = $("playFrame");
      if (frame && frame.getAttribute("src")) frame.src = frame.getAttribute("src");
      document.querySelectorAll("#palSwatches button").forEach(function (b) {
        b.classList.toggle("on", b.getAttribute("data-pal") === id);
      });
    });
  }

  function updatePromptRouter() {
    var el = $("promptRouter");
    var ta = $("input");
    if (!el || !ta || current.path) {
      if (el) el.classList.remove("show");
      return;
    }
    var t = (ta.value || "").toLowerCase();
    var forced = ($("optEngine") && $("optEngine").value) || "auto";
    var guess = "three";
    if (/vintage|game\s*boy|\bgba\b|\bgbc\b|\bdmg\b/.test(t)) guess = "vintage";
    else if (/pixel|pixelart|sprite|tileset|canvas2d/.test(t)) guess = "pixel";
    else if (/three|webgl|fps|first.?person|3d/.test(t)) guess = "three";
    var show = forced === "auto" ? guess : forced;
    el.innerHTML =
      "Router → <b>" +
      esc(ENGINE_LABEL[show] || show) +
      "</b>" +
      (forced === "auto" ? " (from prompt)" : " (locked)") +
      (show === "vintage" ? " · GBA ceiling" : "");
    el.classList.add("show");
  }

  function loadProjects() {
    return api("/api/projects").then(function (d) {
      var rootEl = $("projectsRoot");
      if (rootEl && d.root) rootEl.textContent = d.root;
      projectsCache = d.projects || [];
      renderStats(d.stats);
      renderProjects();
      return d;
    });
  }

  function filteredProjects() {
    var q = (($("projectSearch") && $("projectSearch").value) || "").toLowerCase().trim();
    return projectsCache.filter(function (p) {
      var eng = (p.engine || "three").toLowerCase();
      if (engineListFilter !== "all" && eng !== engineListFilter) return false;
      if (!q) return true;
      var hay = [p.name, p.path, p.genre, p.verb, p.title, p.engine, p.vintage_profile]
        .join(" ")
        .toLowerCase();
      return hay.indexOf(q) !== -1;
    });
  }

  function verifyBadge(p) {
    if (p.verify_ok === true) return '<span class="badge ok">P0 ' + (p.verify_score || "") + "</span>";
    if (p.verify_ok === false) return '<span class="badge bad">P0 fail</span>';
    return '<span class="badge na">—</span>';
  }

  function renderProjects() {
    var list = $("projectList");
    var count = $("projectCount");
    if (!list) return;
    var items = filteredProjects();
    if (count) {
      var n = projectsCache.length;
      var f = items.length;
      count.textContent = n ? (f === n ? "(" + n + ")" : "(" + f + "/" + n + ")") : "";
    }
    if (!items.length) {
      list.innerHTML = '<div class="empty-list">' +
        (projectsCache.length ? "No match for filter." : "No projects yet.") +
        "</div>";
      return;
    }
    list.innerHTML = items.map(function (p) {
      var on = current.path === p.path ? " on" : "";
      var eng = p.engine || "three";
      var meta = [p.genre, p.verb].filter(Boolean).join(" · ") || p.path;
      return (
        '<div class="proj' + on + '" data-path="' + esc(p.path) + '" data-name="' + esc(p.name) +
        '" data-engine="' + esc(eng) + '">' +
        '<div class="t"><span class="name">' + esc(p.name) + "</span>" +
        '<span class="when">' + esc(relTime(p.mtime)) + "</span></div>" +
        '<div class="meta" title="' + esc(meta) + '">' +
        engineBadgeHtml(eng, p.vintage_profile) + " " +
        verifyBadge(p) + " " + esc(meta) + "</div>" +
        '<div class="acts">' +
        '<button type="button" class="btn icon" data-act="play">Play</button>' +
        '<button type="button" class="btn icon" data-act="dup">Dup</button>' +
        "</div></div>"
      );
    }).join("");
  }

  function setEngineSelection(engine) {
    var eng = engine || "auto";
    var sel = $("optEngine");
    if (sel) sel.value = eng;
    document.querySelectorAll("#enginePills .eng-pill").forEach(function (btn) {
      btn.classList.toggle("on", btn.getAttribute("data-engine") === eng);
    });
    document.body.classList.remove("eng-auto", "eng-three", "eng-pixel", "eng-vintage");
    document.body.classList.add("eng-" + eng);
    var hint = $("engineHint");
    if (hint) hint.textContent = ENGINE_HINT[eng] || ENGINE_HINT.auto;
    var vField = $("fieldVintageProfile");
    if (vField) vField.hidden = eng !== "vintage";
    var kindEl = $("optKind");
    if (kindEl) {
      if (eng === "pixel") kindEl.value = "pixel-game";
      else if (eng === "vintage") kindEl.value = "vintage-game";
      else if (eng === "three" && (kindEl.value === "pixel-game" || kindEl.value === "vintage-game")) {
        kindEl.value = "web-game";
      } else if (eng === "auto") {
        kindEl.value = "auto";
      }
    }
    var ta = $("input");
    if (ta && !current.path) {
      if (eng === "vintage") ta.placeholder = "GB verb + place… e.g. jump caves, collect shells";
      else if (eng === "pixel") ta.placeholder = "Pixel verb + place… e.g. top-down forest walk";
      else if (eng === "three") ta.placeholder = "Player verb + place… e.g. neon skill FPS";
      else ta.placeholder = "Player verb + place… engine Auto from prompt";
    }
    try {
      localStorage.setItem("dl.engine", eng);
    } catch (e) {}
  }

  function addMsg(role, text) {
    var el = document.createElement("div");
    el.className = "msg " + role;
    el.innerHTML =
      '<div class="role">' + (role === "user" ? "you" : "dotlab") + "</div>" +
      '<div class="body"></div>';
    el.querySelector(".body").textContent = text;
    log.appendChild(el);
    log.scrollTop = log.scrollHeight;
    return el.querySelector(".body");
  }

  function showIterate(on) {
    var el = $("iterateBar");
    if (el) el.classList.toggle("show", !!on && !!current.path);
  }
  function hideIterate() { showIterate(false); }

  function hidePlayBar() {
    var el = $("playBar");
    if (el) { el.classList.remove("show"); el.innerHTML = ""; }
    var emb = $("playEmbed");
    if (emb) emb.classList.remove("show");
    var frame = $("playFrame");
    if (frame) frame.removeAttribute("src");
  }
  function hideSession() {
    var el = $("sessionBar");
    if (el) { el.classList.remove("show"); el.innerHTML = ""; }
  }
  function hideAgentBox() {
    var el = $("agentBox");
    if (el) el.classList.remove("show");
  }

  function showPlayBar(d) {
    var el = $("playBar");
    if (!el) return;
    var up = d && d.up;
    var running = d && d.running;
    var url = (d && d.url) || "";
    var err = (d && d.error_line) || "";
    var badge = up ? '<span class="badge ok">up</span>' : (running ? '<span class="badge na">starting</span>' : '<span class="badge na">stopped</span>');
    if (err && !(d && d.diagnose && d.diagnose.ok)) {
      badge += ' <span class="badge bad">issue</span>';
    }
    el.innerHTML =
      '<div class="row"><span>Play ' + badge +
      (url ? ' · <a href="' + esc(url) + '" target="_blank" rel="noopener">' + esc(url) + "</a>" : "") +
      (err ? '<div style="margin-top:4px;color:var(--bad)">' + esc(err) + "</div>" : "") +
      "</span><span>" +
      (url ? '<button type="button" class="btn sm" id="playReopen">Open tab</button> ' : "") +
      '<button type="button" class="btn sm" id="playRefresh">Refresh</button>' +
      "</span></div>" +
      (d && d.log_tail ? "<pre>" + esc(d.log_tail) + "</pre>" : "");
    el.classList.add("show");
    var reopen = $("playReopen");
    if (reopen && url) reopen.onclick = function () { window.open(url, "_blank"); };
    var refresh = $("playRefresh");
    if (refresh) refresh.onclick = function () { refreshPlayStatus(); };

    // embed
    var emb = $("playEmbed");
    var frame = $("playFrame");
    var st = $("playEmbedStatus");
    var errEl = $("playEmbedErr");
    if (emb && frame && url) {
      emb.classList.add("show");
      if (frame.getAttribute("src") !== url) frame.setAttribute("src", url);
      if (st) st.innerHTML = badge + (url ? " · " + esc(url) : "");
      if (errEl) {
        if (err && !(d.diagnose && d.diagnose.ok)) {
          errEl.hidden = false;
          errEl.textContent = err;
        } else {
          errEl.hidden = true;
          errEl.textContent = "";
        }
      }
    }
  }

  function stopPlayPoll() {
    if (playPoll) { clearInterval(playPoll); playPoll = null; }
  }
  function refreshPlayStatus() {
    if (!current.path) return;
    api("/api/projects/play-status?path=" + encodeURIComponent(current.path)).then(function (d) {
      if (d && (d.running || d.url || d.log_tail)) showPlayBar(d);
    }).catch(function () {});
  }

  function loadSession() {
    if (!current.path) return;
    api("/api/projects/session?path=" + encodeURIComponent(current.path)).then(function (d) {
      var el = $("sessionBar");
      if (!el || !d || !d.session) return;
      var s = d.session;
      var crafts = (s.crafts || []).slice(0, 3).map(function (c) { return c.text; }).filter(Boolean);
      var parts = [];
      if (s.last_play) parts.push("last play <a href=\"" + esc(s.last_play) + "\" target=\"_blank\" rel=\"noopener\">open</a>");
      if (crafts.length) parts.push("recent: " + crafts.map(function (t) { return esc(t); }).join(" · "));
      if (!parts.length) {
        el.classList.remove("show");
        return;
      }
      el.innerHTML = "<b>session</b> · " + parts.join(" · ");
      el.classList.add("show");
    }).catch(function () {});
  }

  function playPath(path, openTab) {
    if (!path) return;
    // Embed by default; openTab only if explicitly true
    api("/api/projects/play", { path: path, open: !!openTab }).then(function (d) {
      if (!d || !d.ok) {
        var msg = "Play failed. " + ((d && d.error) || "Open folder → npm i && npm run dev.");
        if (d && d.error_line) msg += "\n" + d.error_line;
        addMsg("bot", msg);
        if (d) showPlayBar(d);
        return;
      }
      showPlayBar(d);
      if (d.error_line && !(d.diagnose && d.diagnose.ok)) {
        toast(d.error_line, 5000);
      }
      showIterate(true);
      loadSession();
      stopPlayPoll();
      playPoll = setInterval(refreshPlayStatus, 2000);
      setTimeout(stopPlayPoll, 90000);
    });
  }

  function runVerify(path, quiet) {
    if (!path) return Promise.resolve();
    if (!quiet) addMsg("bot", "Verifying…");
    return api("/api/projects/verify", { path: path, force: true }).then(function (d) {
      var v = d && d.verify;
      if (!v) {
        if (!quiet) addMsg("bot", "Verify failed.");
        return;
      }
      var line = v.ok
        ? "Verify OK · score " + v.score + "/100"
        : "Verify FAIL · P0: " + ((v.p0_fail || []).join(", ") || "unknown");
      if (!quiet) addMsg("bot", line + (v.report ? "\n" + v.report : ""));
      else if (!v.ok) addMsg("bot", line);
      return loadProjects().then(function () {
        pulseVerifyPath(path);
      });
    });
  }

  function runTaste(action) {
    if (!current.path) {
      toast("Select a project first");
      return;
    }
    api("/api/projects/taste", { path: current.path, action: action }).then(function (d) {
      if (!d || !d.ok) {
        addMsg("bot", "Taste " + action + ": " + ((d && d.error) || "failed"));
        return;
      }
      var sum = d.summary || (action + " applied");
      addMsg("bot", "Taste · " + action + "\n" + sum);
      toast(action + " ✓");
      var frame = $("playFrame");
      if (frame && frame.getAttribute("src")) {
        frame.src = frame.getAttribute("src");
      }
      runVerify(current.path, true);
    });
  }

  function openTerminal(path) {
    if (!path) return;
    api("/api/projects/terminal", { path: path }).then(function (d) {
      if (!d || !d.ok) addMsg("bot", "Terminal: " + ((d && d.error) || "failed"));
      else toast("Terminal → " + (d.path || path));
    });
  }

  function exportZip(path) {
    if (!path) return;
    api("/api/projects/export", { path: path }).then(function (d) {
      if (!d || !d.ok) {
        addMsg("bot", "Export failed. " + ((d && d.error) || ""));
        return;
      }
      addMsg("bot", "Zip written:\n" + d.path + "\n(" + d.bytes + " bytes)");
      api("/api/projects/reveal", { path: d.path.replace(/\/[^/]+$/, "") });
    });
  }

  function openEditor(path) {
    if (!path) return;
    api("/api/projects/editor", { path: path }).then(function (d) {
      if (!d || !d.ok) addMsg("bot", "Editor: " + ((d && d.error) || "not found"));
      else addMsg("bot", "Opened in " + (d.cmd || "editor"));
    });
  }

  function duplicatePath(path) {
    if (!path) return;
    api("/api/projects/duplicate", { path: path }).then(function (d) {
      if (!d || !d.ok) {
        addMsg("bot", "Duplicate failed. " + ((d && d.error) || ""));
        return;
      }
      setCurrent(d.path, d.name);
      loadProjects();
      addMsg("bot", "Duplicated → " + d.name);
    });
  }

  function deletePath(path, name) {
    if (!path) return;
    if (!confirm("Move “" + (name || path) + "” to Trash?\n(Soft delete — restore from Tools → Trash)")) return;
    api("/api/projects/delete", { path: path }).then(function (d) {
      if (!d || !d.ok) {
        addMsg("bot", "Delete failed. " + ((d && d.error) || ""));
        return;
      }
      if (current.path === path) setCurrent("", "");
      loadProjects();
      var msg = d.soft
        ? "Moved to Trash: " + (name || path) + (d.trash_path ? "\n" + d.trash_path : "")
        : "Deleted " + (name || path);
      addMsg("bot", msg);
      toast("In Trash — Tools → Trash to restore");
    });
  }

  function showTrash() {
    api("/api/projects/trash").then(function (d) {
      var list = $("trashList");
      if (!list) return;
      var items = (d && d.trash) || [];
      if (!items.length) {
        list.innerHTML = '<div class="empty-list">Trash empty.</div>';
      } else {
        list.innerHTML = items.map(function (t) {
          return (
            '<div class="proj" style="cursor:default">' +
            '<div class="t"><span class="name">' + esc(t.original_name || t.name) + "</span>" +
            '<span class="when">' + esc(relTime(t.deleted_at)) + "</span></div>" +
            '<div class="meta">' + esc(t.path) + "</div>" +
            '<div class="acts" style="display:flex">' +
            '<button type="button" class="btn sm" data-restore="' + esc(t.path) + '">Restore</button>' +
            "</div></div>"
          );
        }).join("");
        list.querySelectorAll("[data-restore]").forEach(function (btn) {
          btn.onclick = function () {
            api("/api/projects/restore", { path: btn.getAttribute("data-restore") }).then(function (r) {
              if (!r || !r.ok) {
                addMsg("bot", "Restore failed. " + ((r && r.error) || ""));
                return;
              }
              toast("Restored " + r.name);
              closeSheets();
              loadProjects();
              setCurrent(r.path, r.name);
            });
          };
        });
      }
      openSheet("trashSheet");
    });
  }

  // —— Command palette ——
  var cmdItems = [];
  var cmdIndex = 0;

  function buildCommands() {
    var has = !!current.path;
    return [
      { id: "play", label: "Play project", key: "⌘P", need: true, run: function () { playPath(current.path); } },
      { id: "verify", label: "Verify P0", key: "⌘⇧V", need: true, run: function () { runVerify(current.path); } },
      { id: "keep", label: "Taste: Keep feel", key: "", need: true, run: function () { runTaste("keep"); } },
      { id: "tighter", label: "Taste: Tighter", key: "", need: true, run: function () { runTaste("tighter"); } },
      { id: "juice", label: "Taste: More juice", key: "", need: true, run: function () { runTaste("juice"); } },
      { id: "room", label: "+ One more room", key: "", need: true, run: function () { oneMoreRoom(); } },
      { id: "to-three", label: "Switch engine → Three.js", key: "", need: true, run: function () { switchEngine("three"); } },
      { id: "to-pixel", label: "Switch engine → Pixel", key: "", need: true, run: function () { switchEngine("pixel"); } },
      { id: "to-vintage", label: "Switch engine → Vintage GB", key: "", need: true, run: function () { switchEngine("vintage"); } },
      { id: "new-three-fps", label: "New · Three FPS", key: "", need: false, run: function () { presetNew("three", "Skill FPS. Neon megacity. Dash, ADS, wave drones."); } },
      { id: "new-pixel-arena", label: "New · Pixel Arena", key: "", need: false, run: function () { presetNew("pixel", "Pixel arena. Twin stick waves. Hitstop juice."); } },
      { id: "new-gb", label: "New · GB Platformer", key: "", need: false, run: function () { presetNew("vintage", "Game Boy platformer. Tight jumps. Four shades. One screen."); } },
      { id: "deep", label: "Deep agent…", key: "", need: true, run: function () { openSheet("agentSheet"); } },
      { id: "zip", label: "Export zip", key: "", need: true, run: function () { exportZip(current.path); } },
      { id: "ship", label: "Ship GitHub", key: "", need: false, run: function () {
        var gp = $("ghProject");
        if (gp) gp.value = current.path || "";
        openSheet("ghModal");
      } },
      { id: "editor", label: "Open editor", key: "", need: true, run: function () { openEditor(current.path); } },
      { id: "term", label: "Terminal here", key: "", need: true, run: function () { openTerminal(current.path); } },
      { id: "folder", label: "Show folder", key: "", need: true, run: function () { api("/api/projects/reveal", { path: current.path }); } },
      { id: "dup", label: "Duplicate", key: "", need: true, run: function () { duplicatePath(current.path); } },
      { id: "rename", label: "Rename…", key: "", need: true, run: function () { renamePath(current.path); } },
      { id: "del", label: "Move to trash", key: "", need: true, run: function () { deletePath(current.path, current.name); } },
      { id: "new", label: "New game", key: "⌘N", need: false, run: newGameMode },
      { id: "model", label: "Model / cloud", key: "", need: false, run: function () { openSheet("settingsSheet"); } },
      { id: "trash", label: "Open trash", key: "", need: false, run: showTrash },
      { id: "help", label: "Keyboard help", key: "?", need: false, run: function () { openSheet("helpSheet"); } },
    ].filter(function (c) { return !c.need || has; });
  }

  function openPalette() {
    cmdItems = buildCommands();
    cmdIndex = 0;
    var pal = $("cmdPalette");
    var inp = $("cmdInput");
    if (inp) inp.value = "";
    renderPalette("");
    if (pal) pal.classList.add("show");
    if (inp) setTimeout(function () { inp.focus(); }, 10);
  }

  function closePalette() {
    var pal = $("cmdPalette");
    if (pal) pal.classList.remove("show");
  }

  function renderPalette(q) {
    var list = $("cmdList");
    if (!list) return;
    q = (q || "").toLowerCase();
    var items = cmdItems.filter(function (c) {
      return !q || c.label.toLowerCase().indexOf(q) !== -1 || c.id.indexOf(q) !== -1;
    });
    if (cmdIndex >= items.length) cmdIndex = 0;
    list.innerHTML = items.map(function (c, i) {
      return (
        '<div class="item' + (i === cmdIndex ? " on" : "") + '" data-i="' + i + '">' +
        "<div>" + esc(c.label) + "</div><span>" + esc(c.key || "") + "</span></div>"
      );
    }).join("") || '<div class="empty-list">No commands</div>';
    list._items = items;
    list.querySelectorAll(".item").forEach(function (el) {
      el.onclick = function () {
        var i = Number(el.getAttribute("data-i"));
        runPaletteItem(items[i]);
      };
    });
  }

  function runPaletteItem(item) {
    closePalette();
    if (item && item.run) item.run();
  }

  function renamePath(path) {
    if (!path) return;
    var sheet = $("renameSheet");
    var inp = $("renameInput");
    if (inp) inp.value = current.name || path.split("/").pop();
    if (sheet) sheet.classList.add("show");
  }

  function startAgent(prompt) {
    if (!current.path || !prompt) return;
    var box = $("agentBox");
    if (box) box.classList.add("show");
    var st = $("agentState");
    if (st) { st.textContent = "running"; st.className = "badge na"; }
    api("/api/projects/agent", { path: current.path, prompt: prompt }).then(function (d) {
      if (!d || !d.ok) {
        addMsg("bot", "Agent: " + ((d && d.error) || "failed"));
        if (st) { st.textContent = "error"; st.className = "badge bad"; }
        return;
      }
      addMsg("bot", "Agent started — deep change in progress.");
      stopAgentPoll();
      agentPoll = setInterval(pollAgent, 2000);
      pollAgent();
    });
  }

  function stopAgentPoll() {
    if (agentPoll) { clearInterval(agentPoll); agentPoll = null; }
  }

  function pollAgent() {
    if (!current.path) return;
    api("/api/projects/agent?path=" + encodeURIComponent(current.path)).then(function (d) {
      var logEl = $("agentLog");
      var st = $("agentState");
      if (logEl && d.log_tail) logEl.textContent = d.log_tail;
      if (st) {
        if (d.running) {
          st.textContent = "running";
          st.className = "badge na";
        } else {
          st.textContent = d.exit === 0 ? "done" : ("exit " + d.exit);
          st.className = d.exit === 0 ? "badge ok" : "badge bad";
          stopAgentPoll();
          if (current.path) {
            runVerify(current.path, true).then(function () {
              if (d.exit === 0) {
                addMsg("bot", "Agent finished. Verify updated · Play.");
                toast("Agent done · badge refreshed");
              } else {
                addMsg("bot", "Agent exit " + d.exit);
              }
            });
          } else {
            loadProjects();
          }
        }
      }
    }).catch(function () {});
  }

  function presetNew(engine, fill) {
    newGameMode();
    setEngineSelection(engine || "auto");
    if (input && fill) {
      input.value = fill;
      updatePromptRouter();
      input.focus();
    }
  }

  function newGameMode() {
    setCurrent("", "");
    history = [];
    if (input) {
      input.value = "";
      input.focus();
    }
    document.body.classList.remove("has-chat");
    var eng = ($("optEngine") && $("optEngine").value) || "auto";
    setEngineSelection(eng);
    updatePromptRouter();
  }

  // Engine pills + selects
  document.querySelectorAll("#enginePills .eng-pill").forEach(function (btn) {
    btn.addEventListener("click", function () {
      setEngineSelection(btn.getAttribute("data-engine") || "auto");
    });
  });
  var kindEl = $("optKind");
  if (kindEl) {
    kindEl.addEventListener("change", function () {
      if (kindEl.value === "vintage-game") setEngineSelection("vintage");
      else if (kindEl.value === "pixel-game") setEngineSelection("pixel");
      else if (kindEl.value === "web-game") setEngineSelection("three");
    });
  }
  document.querySelectorAll("#engineFilter button").forEach(function (btn) {
    btn.addEventListener("click", function () {
      engineListFilter = btn.getAttribute("data-ef") || "all";
      document.querySelectorAll("#engineFilter button").forEach(function (b) {
        b.classList.toggle("on", b === btn);
      });
      renderProjects();
    });
  });
  try {
    var savedEng = localStorage.getItem("dl.engine") || "auto";
    setEngineSelection(savedEng);
  } catch (e) {
    setEngineSelection("auto");
  }

  window.DL.send = function (forcedText) {
    var text = (forcedText != null ? forcedText : (input && input.value || "")).replace(/^\s+|\s+$/g, "");
    if (!text || (sendBtn && sendBtn.disabled)) return false;
    document.body.classList.add("has-chat");
    if (forcedText == null && input) input.value = "";
    addMsg("user", text);
    if (sendBtn) { sendBtn.disabled = true; sendBtn.textContent = "…"; }

    var making = !current.path;
    var kind = ($("optKind") && $("optKind").value) || "auto";
    var genre = ($("optGenre") && $("optGenre").value) || "";
    var engine = ($("optEngine") && $("optEngine").value) || "auto";
    var vProfile = ($("optVintage") && $("optVintage").value) || "gb";
    // Engine dropdown wins over type when set
    if (engine === "pixel" && kind === "auto") kind = "pixel-game";
    if (engine === "vintage" && kind === "auto") kind = "vintage-game";
    if (engine === "three" && kind === "auto") kind = "web-game";

    var start = making
      ? api("/api/projects/new", {
          name: text.slice(0, 48),
          prompt: text,
          kind: kind,
          genre: genre || undefined,
          engine: engine === "auto" ? undefined : engine,
          vintageProfile: engine === "vintage" ? vProfile : undefined,
        }).then(function (d) {
          if (d && d.path) {
            setCurrent(d.path, d.name, {
              engine: d.engine || engine || "three",
              genre: d.genre || "",
              vintage_profile: (d.vintage && d.vintage.profile) || vProfile || "",
            });
          }
          loadProjects();
          return d;
        })
      : Promise.resolve(null);

    start.then(function (created) {
      if (making) {
        if (!created || created.error) {
          addMsg("bot", (created && (created.error || created.message)) || "Could not create folder.");
          return;
        }
        var engLab = ENGINE_LABEL[created.engine] || created.engine || "";
        var summary = created.summary || "Ready. Play.";
        if (engLab) summary = "[" + engLab + "] " + summary;
        addMsg("bot", summary);
        history.push({ role: "user", content: text });
        history.push({ role: "assistant", content: summary });
        showIterate(true);
        if (created.path) {
          refreshShipCard(created.path);
          runVerify(created.path, true).then(function () {
            refreshShipCard(created.path);
            toast("Slice ready · Verify done · Play");
          });
          playPath(created.path);
        }
        return;
      }

      var path = current.path;
      history.push({ role: "user", content: text });
      var body = addMsg("bot", "…");
      return fetch("/api/ask", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: history.slice(-8), project: path || "" }),
      })
        .then(function (r) {
          return r.json().then(function (d) {
            if (!r.ok) throw new Error(d.error || r.status);
            return d;
          });
        })
        .then(function (d) {
          var t = d.text || d.error || "No reply";
          if (d.instant) t = "· " + t;
          body.textContent = t;
          history.push({ role: "assistant", content: t });
          if (d.instant || d.iterate) showIterate(true);
          loadSession();
          if (path) {
            runVerify(path, true).then(function () {
              if (d.instant) toast("Craft applied · Verify updated");
            });
          } else {
            loadProjects();
          }
        })
        .catch(function (e) {
          body.textContent = "Model unreachable. Keep terminal open · Ollama.app\n\n" + e.message;
        });
    }).then(function () {
      if (sendBtn) {
        sendBtn.disabled = false;
        sendBtn.textContent = current.path ? "Continue" : "Make game";
      }
      if (input) input.focus();
      log.scrollTop = log.scrollHeight;
    });
    return false;
  };

  document.querySelectorAll("[data-fill]").forEach(function (btn) {
    btn.addEventListener("click", function () {
      if (!input) return;
      input.value = btn.getAttribute("data-fill") || "";
      input.focus();
    });
  });
  document.querySelectorAll("[data-taste]").forEach(function (btn) {
    btn.addEventListener("click", function () {
      runTaste(btn.getAttribute("data-taste") || "keep");
    });
  });
  document.querySelectorAll("[data-craft]").forEach(function (btn) {
    btn.addEventListener("click", function () {
      if (!current.path) return;
      window.DL.send(btn.getAttribute("data-craft") || "");
    });
  });

  if (input) {
    input.addEventListener("keydown", function (e) {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        window.DL.send();
      }
    });
  }

  var projectList = $("projectList");
  if (projectList) {
    projectList.addEventListener("click", function (e) {
      var btn = e.target.closest("button");
      var row = e.target.closest(".proj");
      if (!row) return;
      var path = row.getAttribute("data-path");
      var name = row.getAttribute("data-name");
      var pmeta = findProject(path) || {
        engine: row.getAttribute("data-engine") || "three",
      };
      var act = btn && btn.getAttribute("data-act");
      if (act === "play") {
        setCurrent(path, name, pmeta);
        playPath(path);
        return;
      }
      if (act === "dup") {
        duplicatePath(path);
        return;
      }
      setCurrent(path, name, pmeta);
      if (input) {
        input.placeholder = "Change " + name + "…";
        input.focus();
      }
    });
  }

  var search = $("projectSearch");
  if (search) search.addEventListener("input", renderProjects);

  function bind(id, fn) {
    var el = $(id);
    if (el) el.onclick = fn;
  }
  function openSheet(id) {
    var el = $(id);
    if (el) el.classList.add("show");
  }
  function closeSheets() {
    document.querySelectorAll(".sheet").forEach(function (s) { s.classList.remove("show"); });
  }

  bind("btnNewGame", newGameMode);
  bind("btnClearProject", newGameMode);
  bind("btnRevealRoot", function () {
    var root = ($("projectsRoot") && $("projectsRoot").textContent) || "";
    api("/api/projects/reveal", { path: root });
  });
  bind("nowPlay", function () { if (current.path) playPath(current.path); });
  bind("toolPlay", function () { closeSheets(); if (current.path) playPath(current.path); });
  bind("nowShow", function () {
    if (current.path) api("/api/projects/reveal", { path: current.path });
  });
  bind("toolFolder", function () {
    closeSheets();
    if (current.path) api("/api/projects/reveal", { path: current.path });
  });
  bind("nowDup", function () { if (current.path) duplicatePath(current.path); });
  bind("toolDup", function () { closeSheets(); if (current.path) duplicatePath(current.path); });
  bind("nowDel", function () { if (current.path) deletePath(current.path, current.name); });
  bind("toolDel", function () {
    closeSheets();
    if (current.path) deletePath(current.path, current.name);
  });
  bind("nowEditor", function () { if (current.path) openEditor(current.path); });
  bind("toolEditor", function () { closeSheets(); if (current.path) openEditor(current.path); });
  bind("nowTerm", function () { if (current.path) openTerminal(current.path); });
  bind("toolTerm", function () { closeSheets(); if (current.path) openTerminal(current.path); });
  bind("nowZip", function () { if (current.path) exportZip(current.path); });
  bind("toolZip", function () { closeSheets(); if (current.path) exportZip(current.path); });
  bind("nowVerify", function () { if (current.path) runVerify(current.path); });
  bind("toolVerify", function () { closeSheets(); if (current.path) runVerify(current.path); });
  bind("nowKeep", function () { runTaste("keep"); });
  bind("nowTighter", function () { runTaste("tighter"); });
  bind("nowJuice", function () { runTaste("juice"); });
  bind("btnOneRoom", oneMoreRoom);
  bind("btnSwitchThree", function () { switchEngine("three"); });
  bind("btnSwitchPixel", function () { switchEngine("pixel"); });
  bind("btnSwitchVintage", function () { switchEngine("vintage"); });
  document.querySelectorAll("#palSwatches button").forEach(function (btn) {
    btn.addEventListener("click", function () {
      setVintagePalette(btn.getAttribute("data-pal") || "dmg");
    });
  });
  if (input) {
    input.addEventListener("input", updatePromptRouter);
    input.addEventListener("focus", updatePromptRouter);
  }
  bind("toolTrash", function () { closeSheets(); showTrash(); });
  bind("trashClose", closeSheets);
  bind("btnPalette", openPalette);
  bind("playEmbedOpen", function () {
    var frame = $("playFrame");
    var url = frame && frame.getAttribute("src");
    if (url) window.open(url, "_blank");
  });
  bind("playEmbedReload", function () {
    var frame = $("playFrame");
    if (frame && frame.getAttribute("src")) {
      frame.src = frame.getAttribute("src");
    }
    refreshPlayStatus();
  });
  bind("playEmbedClose", function () {
    var emb = $("playEmbed");
    if (emb) emb.classList.remove("show");
    var frame = $("playFrame");
    if (frame) frame.removeAttribute("src");
  });
  bind("nowAgent", function () {
    if (!current.path) return;
    var ta = $("agentPrompt");
    if (ta) ta.value = "";
    openSheet("agentSheet");
  });
  bind("toolAgent", function () {
    closeSheets();
    if (!current.path) return;
    openSheet("agentSheet");
  });
  bind("agentStart", function () {
    var ta = $("agentPrompt");
    var prompt = (ta && ta.value || "").trim();
    if (!prompt) return;
    closeSheets();
    startAgent(prompt);
  });
  bind("agentClose", closeSheets);
  bind("nowRename", function () { if (current.path) renamePath(current.path); });
  bind("renameGo", function () {
    var name = (($("renameInput") && $("renameInput").value) || "").trim();
    if (!name || !current.path) return;
    api("/api/projects/rename", { path: current.path, name: name }).then(function (d) {
      if (!d || !d.ok) {
        addMsg("bot", "Rename failed. " + ((d && d.error) || ""));
        return;
      }
      setCurrent(d.path, d.name);
      loadProjects();
      closeSheets();
      addMsg("bot", "Renamed → " + d.name);
    });
  });
  bind("renameClose", closeSheets);

  bind("btnTools", function () { openSheet("toolsSheet"); });
  bind("toolsClose", closeSheets);
  bind("btnHelp", function () { openSheet("helpSheet"); });
  bind("helpClose", closeSheets);
  function fillZooPanel(z) {
    var panel = $("zooPanel");
    var el = $("zooWallet");
    if (!panel) return;
    if (!z || !z.wallet) {
      panel.style.display = "none";
      return;
    }
    panel.style.display = "block";
    if (el) el.textContent = z.wallet;
  }
  function refreshZoo() {
    var p = ($("cloudProvider") && $("cloudProvider").value) || "";
    var panel = $("zooPanel");
    if (panel) panel.style.display = p === "zoo" ? "block" : "none";
    if (p !== "zoo") return;
    fetch("/api/zoo").then(function (r) { return r.json(); }).then(function (d) {
      fillZooPanel(d);
    }).catch(function () {});
  }
  bind("btnSettings", function () {
    refreshHealth();
    refreshZoo();
    openSheet("settingsSheet");
  });
  bind("settingsClose", closeSheets);
  if ($("cloudProvider")) {
    $("cloudProvider").addEventListener("change", refreshZoo);
  }
  bind("cloudOff", function () {
    api("/api/cloud", { action: "off" }).then(function () {
      refreshHealth();
      addMsg("bot", "Cloud off · local Ollama");
    });
  });
  bind("cloudOn", function () {
    var p = ($("cloudProvider") && $("cloudProvider").value) || "grok";
    api("/api/cloud", { action: "on", provider: p }).then(function (d) {
      if (!d || !d.ok) {
        var hint = p === "zoo"
          ? "OpenZoo wallet failed — `dotlab zoo wallet`"
          : "set key: export XAI_API_KEY=… then `dotlab cloud on " + p + "`";
        addMsg("bot", "Cloud on failed — " + hint);
        return;
      }
      refreshHealth();
      if (p === "zoo") {
        fillZooPanel(d.zoo);
        var w = (d.zoo && d.zoo.wallet) || "";
        addMsg("bot", "Cloud on · OpenZoo x402" + (w ? " · fund " + w : "") + " (wrap USDC/TOKEN first)");
        return;
      }
      addMsg("bot", "Cloud on · " + p + " (paid)");
    });
  });
  bind("btnGh", function () {
    var gp = $("ghProject");
    if (gp) gp.value = current.path || (projectEl && projectEl.value) || "";
    openSheet("ghModal");
  });
  bind("ghClose", closeSheets);
  bind("btnMenu", function () { document.body.classList.toggle("side-open"); });
  bind("scrim", function () { document.body.classList.remove("side-open"); });

  bind("ghLogin", function () {
    fetch("/api/github/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" })
      .then(function (r) { return r.json(); })
      .then(function (d) {
        var lead = $("ghLead");
        if (!lead) return;
        if (d.user_code) lead.textContent = "Code " + d.user_code + " → github.com/login/device";
        else if (d.logged_in) lead.textContent = "@" + d.user;
        else lead.textContent = d.error || "Login failed";
      });
  });
  bind("ghShip", function () {
    var project = (($("ghProject") && $("ghProject").value) || current.path || "").trim();
    var err = $("ghErr");
    if (!project) { if (err) err.textContent = "Need folder."; return; }
    fetch("/api/github/ship", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        project: project,
        message: ($("ghMsg") && $("ghMsg").value) || "vertical slice",
        private: true,
      }),
    }).then(function (r) { return r.json(); }).then(function (d) {
      if (err) err.textContent = d.ok ? (d.html_url || "Shipped") : (d.error || "failed");
    });
  });

  if (projectEl) {
    projectEl.addEventListener("change", function () {
      setCurrent(projectEl.value, projectEl.value.split("/").pop());
    });
  }

  var cmdInput = $("cmdInput");
  if (cmdInput) {
    cmdInput.addEventListener("input", function () {
      cmdIndex = 0;
      renderPalette(cmdInput.value);
    });
    cmdInput.addEventListener("keydown", function (e) {
      var list = $("cmdList");
      var items = (list && list._items) || [];
      if (e.key === "ArrowDown") {
        e.preventDefault();
        cmdIndex = Math.min(items.length - 1, cmdIndex + 1);
        renderPalette(cmdInput.value);
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        cmdIndex = Math.max(0, cmdIndex - 1);
        renderPalette(cmdInput.value);
      } else if (e.key === "Enter") {
        e.preventDefault();
        if (items[cmdIndex]) runPaletteItem(items[cmdIndex]);
      } else if (e.key === "Escape") {
        e.preventDefault();
        closePalette();
      }
    });
  }

  document.addEventListener("keydown", function (e) {
    var meta = e.metaKey || e.ctrlKey;
    if (meta && e.key.toLowerCase() === "k") {
      e.preventDefault();
      openPalette();
      return;
    }
    if (meta && e.key.toLowerCase() === "p") {
      e.preventDefault();
      if (current.path) playPath(current.path);
    }
    if (meta && e.key.toLowerCase() === "n") {
      e.preventDefault();
      newGameMode();
    }
    if (meta && e.key.toLowerCase() === "f") {
      e.preventDefault();
      if (search) search.focus();
    }
    if (meta && e.shiftKey && e.key.toLowerCase() === "v") {
      e.preventDefault();
      if (current.path) runVerify(current.path);
    }
    if (e.key === "?" && !e.metaKey && !e.ctrlKey && document.activeElement !== input && document.activeElement !== cmdInput) {
      openSheet("helpSheet");
    }
    if (e.key === "Escape") {
      closePalette();
      closeSheets();
    }
  });

  refreshHealth();
  setInterval(refreshHealth, 20000);
  loadProjects().then(function () {
    try {
      var saved = localStorage.getItem("dl.project") || localStorage.getItem("gm.project") || "";
      if (saved) setCurrent(saved, saved.split("/").pop());
      else setCurrent("", "");
    } catch (e) {
      setCurrent("", "");
    }
  });
  if (input) input.focus();
})();
