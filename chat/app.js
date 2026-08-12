(function () {
  var log = document.getElementById("log");
  var input = document.getElementById("input");
  var sendBtn = document.getElementById("send");
  var projectEl = document.getElementById("project");
  var history = [];
  var current = { path: "", name: "" };

  function setCurrent(path, name) {
    current.path = path || "";
    current.name = name || (path ? path.split("/").pop() : "");
    if (projectEl) projectEl.value = current.path;
    try { localStorage.setItem("gm.project", current.path); } catch (e) {}
    var nowName = document.getElementById("nowName");
    if (nowName) nowName.textContent = current.name || "—";
    document.body.classList.toggle("has-project", !!current.path);
    if (sendBtn && current.path) sendBtn.textContent = "Continue";
  }

  function api(path, body) {
    var opt = { headers: { "Content-Type": "application/json" } };
    if (body) { opt.method = "POST"; opt.body = JSON.stringify(body); }
    return fetch(path, opt).then(function (r) { return r.json(); });
  }

  function loadProjects() {
    return api("/api/projects").then(function (d) {
      var rootEl = document.getElementById("projectsRoot");
      if (rootEl && d.root) rootEl.textContent = d.root;
      var box = document.getElementById("games");
      var list = document.getElementById("gameList");
      if (!box || !list) return d;
      var items = d.projects || [];
      if (!items.length) { box.hidden = true; list.innerHTML = ""; return d; }
      box.hidden = false;
      list.innerHTML = items.map(function (p) {
        return '<div class="game" data-path="' + p.path.replace(/"/g, "") + '" data-name="' + p.name.replace(/"/g, "") + '">' +
          "<div><b>" + p.name + "</b><span>" + p.path + "</span></div>" +
          '<button type="button" data-act="open">Open</button>' +
          '<button type="button" data-act="play">Play</button>' +
          '<button type="button" data-act="show">Folder</button></div>';
      }).join("");
      return d;
    });
  }

  function addMsg(role, text) {
    var el = document.createElement("div");
    el.className = "msg " + role;
    el.innerHTML =
      '<div class="role">' + (role === "user" ? "You" : "Gamemaster") + "</div>" +
      '<div class="body"></div>';
    el.querySelector(".body").textContent = text;
    log.appendChild(el);
    log.scrollTop = log.scrollHeight;
    return el.querySelector(".body");
  }

  window.GM.send = function () {
    var text = (input && input.value || "").replace(/^\s+|\s+$/g, "");
    if (!text || (sendBtn && sendBtn.disabled)) return false;
    document.body.classList.add("has-chat");
    input.value = "";
    addMsg("user", text);
    if (sendBtn) { sendBtn.disabled = true; sendBtn.textContent = "Working…"; }

    var making = !current.path;
    var start = making
      ? api("/api/projects/new", { name: text.slice(0, 48), prompt: text, kind: "auto" }).then(function (d) {
          if (d && d.path) setCurrent(d.path, d.name);
          loadProjects();
          return d;
        })
      : Promise.resolve(null);

    start.then(function (created) {
      if (making) {
        if (!created || created.error) {
          addMsg("bot", (created && created.error) || "Could not create the folder.");
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
      var body = addMsg("bot", "Changing the game…");
      return fetch("/api/ask", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: history.slice(-8),
          project: path || "",
        }),
      })
        .then(function (r) { return r.json().then(function (d) { if (!r.ok) throw new Error(d.error || r.status); return d; }); })
        .then(function (d) {
          var t = d.text || d.error || "No reply";
          body.textContent = t;
          history.push({ role: "assistant", content: t });
        })
        .catch(function (e) {
          body.textContent = "Could not reach the model. Keep the Gamemaster terminal open and check Ollama.app.\n\n" + e.message;
        });
    }).then(function () {
      if (sendBtn) {
        sendBtn.disabled = false;
        sendBtn.textContent = current.path ? "Continue" : "Make this game";
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

  if (input) {
    input.addEventListener("keydown", function (e) {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        window.GM.send();
      }
    });
  }

  var more = document.getElementById("more");
  var btnMore = document.getElementById("btnMore");
  var moreClose = document.getElementById("moreClose");
  if (btnMore && more) btnMore.onclick = function () { more.classList.add("show"); };
  if (moreClose && more) moreClose.onclick = function () { more.classList.remove("show"); };

  var gameList = document.getElementById("gameList");
  if (gameList) gameList.addEventListener("click", function (e) {
    var btn = e.target.closest("button");
    var row = e.target.closest(".game");
    if (!btn || !row) return;
    var path = row.getAttribute("data-path");
    var name = row.getAttribute("data-name");
    var act = btn.getAttribute("data-act");
    if (act === "open") {
      setCurrent(path, name);
      if (input) {
        input.placeholder = "What should we change in " + name + "?";
        input.focus();
      }
    }
    if (act === "show") api("/api/projects/reveal", { path: path });
    if (act === "play") {
      api("/api/projects/play", { path: path }).then(function (d) {
        if (!d || !d.ok) {
          addMsg("bot", "Play failed. " + ((d && d.error) || "Could not start the game server. Try Show folder, then npm install && npm run dev."));
        }
      });
    }
  });

  var revealRoot = document.getElementById("btnRevealRoot");
  if (revealRoot) {
    revealRoot.onclick = function () { api("/api/projects/reveal", { path: document.getElementById("projectsRoot").textContent }); };
  }
  var nowPlay = document.getElementById("nowPlay");
  var nowShow = document.getElementById("nowShow");
  var nowNew = document.getElementById("nowNew");
  if (nowNew) {
    nowNew.onclick = function () {
      setCurrent("", "");
      if (sendBtn) sendBtn.textContent = "Make this game";
      if (input) {
        input.placeholder = "The player runs, jumps, and grabs coins…";
        input.focus();
      }
    };
  }
  if (nowPlay) {
    nowPlay.onclick = function () {
      if (!current.path) return;
      api("/api/projects/play", { path: current.path }).then(function (d) {
        if (!d || !d.ok) addMsg("bot", "Play failed. " + ((d && d.error) || "Start the folder with npm run dev."));
      });
    };
  }
  if (nowShow) nowShow.onclick = function () { if (current.path) api("/api/projects/reveal", { path: current.path }); };

  loadProjects().then(function () {
    try {
      var saved = localStorage.getItem("gm.project") || "";
      if (saved) setCurrent(saved, saved.split("/").pop());
    } catch (e) {}
  });

  if (projectEl) {
    projectEl.addEventListener("change", function () {
      setCurrent(projectEl.value, projectEl.value.split("/").pop());
    });
  }

  var ghModal = document.getElementById("ghModal");
  var ghBtn = document.getElementById("btnGh");
  if (ghBtn && ghModal) {
    ghBtn.onclick = function () {
      if (more) more.classList.remove("show");
      ghModal.classList.add("show");
    };
  }
  var ghClose = document.getElementById("ghClose");
  if (ghClose && ghModal) ghClose.onclick = function () { ghModal.classList.remove("show"); };

  var ghLogin = document.getElementById("ghLogin");
  if (ghLogin) {
    ghLogin.onclick = function () {
      fetch("/api/github/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" })
        .then(function (r) { return r.json(); })
        .then(function (d) {
          var lead = document.getElementById("ghLead");
          if (!lead) return;
          if (d.user_code) lead.textContent = "Enter " + d.user_code + " at github.com/login/device";
          else if (d.logged_in) lead.textContent = "Signed in as @" + d.user;
          else lead.textContent = d.error || "Could not start login";
        });
    };
  }
  var ghShip = document.getElementById("ghShip");
  if (ghShip) {
    ghShip.onclick = function () {
      var project = (document.getElementById("ghProject").value || (projectEl && projectEl.value) || "").trim();
      var err = document.getElementById("ghErr");
      if (!project) { err.textContent = "Need a folder path."; return; }
      fetch("/api/github/ship", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          project: project,
          message: document.getElementById("ghMsg").value || "vertical slice",
          private: true,
        }),
      }).then(function (r) { return r.json(); }).then(function (d) {
        err.textContent = d.ok ? (d.html_url || "Shipped") : (d.error || "failed");
      });
    };
  }

  if (input) input.focus();
})();
