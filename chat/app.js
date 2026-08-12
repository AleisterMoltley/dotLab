/* Gamemaster chat UI — loaded after the page. bootSend works even if this file 404s. */
(function () {
  var log = document.getElementById("log");
  var input = document.getElementById("input");
  var sendBtn = document.getElementById("send");
  var projectEl = document.getElementById("project");
  var MODEL = "gamemaster";
  var history = [];

  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c];
    });
  }

  function addMsg(role, text) {
    var el = document.createElement("div");
    el.className = "msg " + role;
    var label = role === "user" ? "You" : role === "bot" ? "Gamemaster" : "";
    el.innerHTML =
      (label ? '<div class="role">' + label + "</div>" : "") +
      '<div class="body">' + (role === "system" ? esc(text) : esc(text)) + "</div>";
    log.appendChild(el);
    log.scrollTop = log.scrollHeight;
    return el.querySelector(".body") || el;
  }

  function setBusy(on) {
    if (sendBtn) sendBtn.disabled = !!on;
    if (sendBtn) sendBtn.textContent = on ? "…" : "Send";
  }

  function projectNote() {
    var p = (projectEl && projectEl.value || "").replace(/^\s+|\s+$/g, "");
    return p ? "\n\nProject path: " + p : "";
  }

  window.GM.send = function () {
    var text = (input && input.value || "").replace(/^\s+|\s+$/g, "");
    if (!text || (sendBtn && sendBtn.disabled)) return false;
    input.value = "";
    addMsg("user", text);
    history.push({ role: "user", content: text + projectNote() });
    var body = addMsg("bot", "…");
    setBusy(true);

    var payload = {
      model: MODEL,
      messages: [{ role: "system", content: "You are Gamemaster. Three.js games. Complete files. CONFIG feel. fog=bg. English code." }].concat(history.slice(-10)),
    };

    fetch("/api/ask", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    })
      .then(function (r) {
        return r.json().then(function (d) {
          if (!r.ok) throw new Error(d.error || ("HTTP " + r.status));
          return d;
        });
      })
      .then(function (d) {
        var t = d.text || d.error || "No reply";
        body.textContent = t;
        history.push({ role: "assistant", content: t });
      })
      .catch(function (e) {
        body.textContent = "Error: " + e.message + "\n\nIs this window's terminal still running? Ollama.app open?";
      })
      .then(function () {
        setBusy(false);
        if (input) input.focus();
        log.scrollTop = log.scrollHeight;
      });
    return false;
  };

  function fill(text) {
    if (!input) return;
    input.value = text;
    input.focus();
  }

  document.querySelectorAll("[data-fill]").forEach(function (btn) {
    btn.addEventListener("click", function () {
      fill(btn.getAttribute("data-fill") || "");
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

  if (projectEl) {
    try {
      projectEl.value = localStorage.getItem("gm.project") || "";
      projectEl.addEventListener("change", function () {
        localStorage.setItem("gm.project", projectEl.value);
      });
    } catch (e) {}
  }

  var ghModal = document.getElementById("ghModal");
  var ghBtn = document.getElementById("btnGh");
  if (ghBtn && ghModal) {
    ghBtn.onclick = function () { ghModal.classList.add("show"); };
    var close = document.getElementById("ghClose");
    if (close) close.onclick = function () { ghModal.classList.remove("show"); };
    document.getElementById("ghLogin").onclick = function () {
      fetch("/api/github/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" })
        .then(function (r) { return r.json(); })
        .then(function (d) {
          var lead = document.getElementById("ghLead");
          if (d.user_code && lead) {
            lead.textContent = "Code " + d.user_code + " at github.com/login/device";
          } else if (d.logged_in && lead) {
            lead.textContent = "Signed in as @" + d.user;
            ghBtn.textContent = "@" + d.user;
          } else if (d.error && lead) {
            lead.textContent = d.error;
          }
        })
        .catch(function (e) {
          document.getElementById("ghLead").textContent = String(e);
        });
    };
    document.getElementById("ghShip").onclick = function () {
      var project = document.getElementById("ghProject").value || (projectEl && projectEl.value) || "";
      var err = document.getElementById("ghErr");
      if (!project) { err.textContent = "Set the game folder."; return; }
      fetch("/api/github/ship", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          project: project,
          message: document.getElementById("ghMsg").value || "vertical slice",
          private: document.getElementById("ghPrivate").checked,
        }),
      })
        .then(function (r) { return r.json(); })
        .then(function (d) {
          err.textContent = d.ok ? (d.html_url || "Shipped") : (d.error || "failed");
        })
        .catch(function (e) { err.textContent = String(e); });
    };
  }

  if (input) input.focus();
})();
