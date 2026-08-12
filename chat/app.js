(function () {
  var log = document.getElementById("log");
  var input = document.getElementById("input");
  var sendBtn = document.getElementById("send");
  var projectEl = document.getElementById("project");
  var history = [];
  var projectsCache = [];
  var current = { path: "", name: "" };

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

  function setCurrent(path, name) {
    current.path = path || "";
    current.name = name || (path ? path.split("/").pop() : "");
    if (projectEl) projectEl.value = current.path;
    try {
      localStorage.setItem("dl.project", current.path);
      localStorage.setItem("gm.project", current.path);
    } catch (e) {}

    var ctx = $("contextLine");
    if (ctx) {
      ctx.innerHTML = current.path
        ? '<b>' + esc(current.name) + '</b> · project'
        : "no project";
    }
    document.body.classList.toggle("has-project", !!current.path);
    var craft = $("craftChips");
    var examples = $("exampleChips");
    var newOpts = $("newOptions");
    if (craft) craft.hidden = !current.path;
    if (examples) examples.hidden = !!current.path;
    if (newOpts) newOpts.style.display = current.path ? "none" : "grid";

    ["nowPlay", "nowShow", "nowDup", "nowDel", "toolPlay", "toolFolder", "toolDup", "toolDel"].forEach(function (id) {
      var el = $(id);
      if (el) el.disabled = !current.path;
    });
    if (sendBtn) sendBtn.textContent = current.path ? "Continue" : "Make game";
    var hint = $("composerHint");
    if (hint) {
      hint.innerHTML = current.path
        ? 'Craft chips = instant · model for systems'
        : 'Enter send · <span class="kbd">⌘P</span> play';
    }
    renderProjects();
  }

  function api(path, body) {
    var opt = { headers: { "Content-Type": "application/json" } };
    if (body) { opt.method = "POST"; opt.body = JSON.stringify(body); }
    return fetch(path, opt).then(function (r) { return r.json(); });
  }

  function refreshHealth() {
    return api("/api/health").then(function (h) {
      var ok = !!(h && h.ok);
      var led = $("dot");
      var text = $("statusText");
      if (led) {
        led.classList.toggle("ok", ok);
        led.classList.toggle("bad", !ok);
      }
      if (text) {
        if (h && h.backend === "cloud") {
          text.textContent = (h.provider || "cloud") + " · " + (h.model || "");
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
      return h;
    }).catch(function () {
      var led = $("dot");
      if (led) { led.classList.remove("ok"); led.classList.add("bad"); }
      var text = $("statusText");
      if (text) text.textContent = "offline";
    });
  }

  function loadProjects() {
    return api("/api/projects").then(function (d) {
      var rootEl = $("projectsRoot");
      if (rootEl && d.root) rootEl.textContent = d.root;
      projectsCache = d.projects || [];
      renderProjects();
      return d;
    });
  }

  function filteredProjects() {
    var q = (($("projectSearch") && $("projectSearch").value) || "").toLowerCase().trim();
    if (!q) return projectsCache;
    return projectsCache.filter(function (p) {
      var hay = [p.name, p.path, p.genre, p.verb, p.title].join(" ").toLowerCase();
      return hay.indexOf(q) !== -1;
    });
  }

  function renderProjects() {
    var list = $("projectList");
    var count = $("projectCount");
    if (!list) return;
    var items = filteredProjects();
    if (count) count.textContent = projectsCache.length ? "(" + projectsCache.length + ")" : "";
    if (!items.length) {
      list.innerHTML = '<div class="empty-list">' +
        (projectsCache.length ? "No match." : "No projects yet.") +
        "</div>";
      return;
    }
    list.innerHTML = items.map(function (p) {
      var on = current.path === p.path ? " on" : "";
      var meta = [p.genre, p.verb].filter(Boolean).join(" · ") || p.path;
      return (
        '<div class="proj' + on + '" data-path="' + esc(p.path) + '" data-name="' + esc(p.name) + '">' +
        '<div class="t"><span class="name">' + esc(p.name) + '</span>' +
        '<span class="when">' + esc(relTime(p.mtime)) + "</span></div>" +
        '<div class="meta" title="' + esc(meta) + '">' + esc(meta) + "</div>" +
        '<div class="acts">' +
        '<button type="button" class="btn icon" data-act="play">Play</button>' +
        '<button type="button" class="btn icon" data-act="dup">Dup</button>' +
        "</div></div>"
      );
    }).join("");
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

  function playPath(path) {
    if (!path) return;
    api("/api/projects/play", { path: path }).then(function (d) {
      if (!d || !d.ok) {
        addMsg("bot", "Play failed. " + ((d && d.error) || "Open folder → npm i && npm run dev."));
      }
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
    if (!confirm("Delete project “" + (name || path) + "”?\nThis cannot be undone.")) return;
    api("/api/projects/delete", { path: path }).then(function (d) {
      if (!d || !d.ok) {
        addMsg("bot", "Delete failed. " + ((d && d.error) || ""));
        return;
      }
      if (current.path === path) setCurrent("", "");
      loadProjects();
      addMsg("bot", "Deleted " + (name || path));
    });
  }

  function newGameMode() {
    setCurrent("", "");
    history = [];
    if (input) {
      input.value = "";
      input.placeholder = "Player verb + place…";
      input.focus();
    }
    document.body.classList.remove("has-chat");
    // keep welcome visible: remove chat msgs optional — leave history in log if any
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

    var start = making
      ? api("/api/projects/new", {
          name: text.slice(0, 48),
          prompt: text,
          kind: kind,
          genre: genre || undefined,
        }).then(function (d) {
          if (d && d.path) setCurrent(d.path, d.name);
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
        var summary = created.summary || "Ready. Play.";
        addMsg("bot", summary);
        history.push({ role: "user", content: text });
        history.push({ role: "assistant", content: summary });
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
        })
        .catch(function (e) {
          body.textContent = "Model unreachable. Keep the terminal open · Ollama.app\n\n" + e.message;
        });
    }).then(function () {
      if (sendBtn) {
        sendBtn.disabled = false;
        sendBtn.textContent = current.path ? "Continue" : "Make game";
      }
      if (input) input.focus();
      log.scrollTop = log.scrollHeight;
      loadProjects();
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
      var act = btn && btn.getAttribute("data-act");
      if (act === "play") {
        setCurrent(path, name);
        playPath(path);
        return;
      }
      if (act === "dup") {
        duplicatePath(path);
        return;
      }
      setCurrent(path, name);
      if (input) {
        input.placeholder = "Change " + name + "…";
        input.focus();
      }
    });
  }

  var search = $("projectSearch");
  if (search) {
    search.addEventListener("input", renderProjects);
  }

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

  bind("btnTools", function () { openSheet("toolsSheet"); });
  bind("toolsClose", closeSheets);
  bind("btnHelp", function () { openSheet("helpSheet"); });
  bind("helpClose", closeSheets);
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

  // keyboard
  document.addEventListener("keydown", function (e) {
    var meta = e.metaKey || e.ctrlKey;
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
    if (e.key === "?" && !e.metaKey && !e.ctrlKey && document.activeElement !== input) {
      openSheet("helpSheet");
    }
    if (e.key === "Escape") closeSheets();
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
