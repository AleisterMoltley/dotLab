(function () {
  var log = document.getElementById("log");
  var input = document.getElementById("input");
  var sendBtn = document.getElementById("send");
  var projectEl = document.getElementById("project");
  var history = [];
  var current = { path: "", name: "" };
  var health = { ok: false, model: "", product: "dotLab" };

  function $(id) { return document.getElementById(id); }

  function setCurrent(path, name) {
    current.path = path || "";
    current.name = name || (path ? path.split("/").pop() : "");
    if (projectEl) projectEl.value = current.path;
    try { localStorage.setItem("dl.project", current.path); } catch (e) {}
    try { localStorage.setItem("gm.project", current.path); } catch (e) {}

    var ctx = $("contextLine");
    if (ctx) {
      ctx.innerHTML = current.path
        ? 'Working on <strong>' + esc(current.name) + '</strong>'
        : "No project selected — describe a new game below";
    }
    document.body.classList.toggle("has-project", !!current.path);
    var craft = $("craftChips");
    var examples = $("exampleChips");
    var newOpts = $("newOptions");
    if (craft) craft.hidden = !current.path;
    if (examples) examples.hidden = !!current.path;
    if (newOpts) newOpts.style.opacity = current.path ? "0.45" : "1";

    ["nowPlay", "nowShow", "nowCraft", "toolPlay", "toolFolder"].forEach(function (id) {
      var el = $(id);
      if (el) el.disabled = !current.path && id !== "toolFolder";
    });
    if (sendBtn) sendBtn.textContent = current.path ? "Continue" : "Make this game";
    var hint = $("composerHint");
    if (hint) {
      hint.textContent = current.path
        ? "Craft chips are instant. Chat can add systems via the model."
        : "First build is instant. Pick type/genre or leave on Auto.";
    }
    highlightProjectList();
  }

  function esc(s) {
    return String(s || "").replace(/[&<>"']/g, function (c) {
      return ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c];
    });
  }

  function api(path, body) {
    var opt = { headers: { "Content-Type": "application/json" } };
    if (body) { opt.method = "POST"; opt.body = JSON.stringify(body); }
    return fetch(path, opt).then(function (r) { return r.json(); });
  }

  function refreshHealth() {
    return api("/api/health").then(function (h) {
      health = h || health;
      var ok = !!(h && h.ok);
      var dot = $("dot");
      var text = $("statusText");
      if (dot) {
        dot.classList.toggle("ok", ok);
        dot.classList.toggle("bad", !ok);
      }
      if (text) {
        if (h && h.backend === "cloud") {
          text.textContent = "cloud · " + (h.provider || "") + " · " + (h.model || "");
        } else if (ok) {
          text.textContent = "online · " + (h.model || "dotlab") + " · $0";
        } else if (h && !h.ollama) {
          text.textContent = "Ollama offline — open Ollama.app";
        } else {
          text.textContent = h && h.error ? h.error : "model missing";
        }
      }
      if (h && h.projects_root) {
        var rootEl = $("projectsRoot");
        if (rootEl) rootEl.textContent = h.projects_root;
      }
      return h;
    }).catch(function () {
      var dot = $("dot");
      if (dot) { dot.classList.remove("ok"); dot.classList.add("bad"); }
      var text = $("statusText");
      if (text) text.textContent = "dashboard offline";
    });
  }

  function loadProjects() {
    return api("/api/projects").then(function (d) {
      var rootEl = $("projectsRoot");
      if (rootEl && d.root) rootEl.textContent = d.root;
      var list = $("projectList");
      if (!list) return d;
      var items = d.projects || [];
      if (!items.length) {
        list.innerHTML = '<div style="padding:8px 12px;color:var(--muted);font-size:12px">No games yet. Describe one below.</div>';
        return d;
      }
      list.innerHTML = items.map(function (p) {
        var active = current.path === p.path ? " active" : "";
        return (
          '<div class="proj' + active + '" data-path="' + esc(p.path) + '" data-name="' + esc(p.name) + '">' +
          "<div><b>" + esc(p.name) + "</b><span>" + esc(p.path) + "</span></div>" +
          '<div class="row">' +
          '<button type="button" class="btn sm" data-act="play">Play</button>' +
          "</div></div>"
        );
      }).join("");
      return d;
    });
  }

  function highlightProjectList() {
    document.querySelectorAll(".proj").forEach(function (el) {
      el.classList.toggle("active", el.getAttribute("data-path") === current.path);
    });
  }

  function addMsg(role, text) {
    var el = document.createElement("div");
    el.className = "msg " + role;
    el.innerHTML =
      '<div class="role">' + (role === "user" ? "You" : "dotLab") + "</div>" +
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
        addMsg("bot", "Play failed. " + ((d && d.error) || "Try Folder → npm install && npm run dev."));
      }
    });
  }

  function newGameMode() {
    setCurrent("", "");
    if (input) {
      input.placeholder = "The player runs, jumps, and grabs coins…";
      input.focus();
    }
    document.body.classList.remove("has-chat");
  }

  window.DL.send = function (forcedText) {
    var text = (forcedText != null ? forcedText : (input && input.value || "")).replace(/^\s+|\s+$/g, "");
    if (!text || (sendBtn && sendBtn.disabled)) return false;
    document.body.classList.add("has-chat");
    if (forcedText == null && input) input.value = "";
    addMsg("user", text);
    if (sendBtn) { sendBtn.disabled = true; sendBtn.textContent = "Working…"; }

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
          addMsg("bot", (created && (created.error || created.message)) || "Could not create the folder.");
          return;
        }
        var summary = created.summary || "Playable slice is ready. Click Play.";
        addMsg("bot", summary);
        history.push({ role: "user", content: text });
        history.push({ role: "assistant", content: summary });
        return;
      }

      var path = current.path;
      history.push({ role: "user", content: text });
      var body = addMsg("bot", "Working…");
      return fetch("/api/ask", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: history.slice(-8),
          project: path || "",
        }),
      })
        .then(function (r) {
          return r.json().then(function (d) {
            if (!r.ok) throw new Error(d.error || r.status);
            return d;
          });
        })
        .then(function (d) {
          var t = d.text || d.error || "No reply";
          if (d.instant) t = "⚡ " + t;
          body.textContent = t;
          history.push({ role: "assistant", content: t });
        })
        .catch(function (e) {
          body.textContent =
            "Could not reach the model. Keep the dotLab terminal open and check Ollama.app.\n\n" +
            e.message;
        });
    }).then(function () {
      if (sendBtn) {
        sendBtn.disabled = false;
        sendBtn.textContent = current.path ? "Continue" : "Make this game";
      }
      if (input) input.focus();
      log.scrollTop = log.scrollHeight;
      loadProjects();
    });
    return false;
  };

  // chips
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

  // sidebar projects
  var projectList = $("projectList");
  if (projectList) {
    projectList.addEventListener("click", function (e) {
      var btn = e.target.closest("button");
      var row = e.target.closest(".proj");
      if (!row) return;
      var path = row.getAttribute("data-path");
      var name = row.getAttribute("data-name");
      if (btn && btn.getAttribute("data-act") === "play") {
        setCurrent(path, name);
        playPath(path);
        return;
      }
      setCurrent(path, name);
      if (input) {
        input.placeholder = "What should we change in " + name + "?";
        input.focus();
      }
    });
  }

  function bindClick(id, fn) {
    var el = $(id);
    if (el) el.onclick = fn;
  }

  bindClick("btnNewGame", newGameMode);
  bindClick("toolNew", function () { closeSheets(); newGameMode(); });
  bindClick("btnClearProject", newGameMode);
  bindClick("btnRefreshProjects", function () { loadProjects(); refreshHealth(); });
  bindClick("btnRevealRoot", function () {
    var root = ($("projectsRoot") && $("projectsRoot").textContent) || "";
    api("/api/projects/reveal", { path: root });
  });
  bindClick("nowPlay", function () { if (current.path) playPath(current.path); });
  bindClick("toolPlay", function () { closeSheets(); if (current.path) playPath(current.path); });
  bindClick("nowShow", function () {
    if (current.path) api("/api/projects/reveal", { path: current.path });
  });
  bindClick("toolFolder", function () {
    closeSheets();
    if (current.path) api("/api/projects/reveal", { path: current.path });
  });
  bindClick("nowCraft", function () {
    if (!current.path) return;
    var craft = $("craftChips");
    if (craft) {
      craft.hidden = false;
      craft.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }
  });

  // sheets
  function openSheet(id) {
    var el = $(id);
    if (el) el.classList.add("show");
  }
  function closeSheets() {
    document.querySelectorAll(".sheet").forEach(function (s) { s.classList.remove("show"); });
  }
  bindClick("btnTools", function () { openSheet("toolsSheet"); });
  bindClick("toolsClose", closeSheets);
  bindClick("btnHelp", function () { openSheet("helpSheet"); });
  bindClick("helpClose", closeSheets);
  bindClick("btnGh", function () {
    var gp = $("ghProject");
    if (gp) gp.value = current.path || (projectEl && projectEl.value) || "";
    openSheet("ghModal");
  });
  bindClick("toolGh", function () {
    closeSheets();
    var gp = $("ghProject");
    if (gp) gp.value = current.path || "";
    openSheet("ghModal");
  });
  bindClick("ghClose", closeSheets);

  bindClick("btnMenu", function () {
    document.body.classList.toggle("side-open");
  });
  bindClick("scrim", function () {
    document.body.classList.remove("side-open");
  });

  bindClick("ghLogin", function () {
    fetch("/api/github/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" })
      .then(function (r) { return r.json(); })
      .then(function (d) {
        var lead = $("ghLead");
        if (!lead) return;
        if (d.user_code) lead.textContent = "Enter " + d.user_code + " at github.com/login/device";
        else if (d.logged_in) lead.textContent = "Signed in as @" + d.user;
        else lead.textContent = d.error || "Could not start login";
      });
  });
  bindClick("ghShip", function () {
    var project = (($("ghProject") && $("ghProject").value) || current.path || "").trim();
    var err = $("ghErr");
    if (!project) { if (err) err.textContent = "Need a folder path."; return; }
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

  refreshHealth();
  setInterval(refreshHealth, 15000);
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
