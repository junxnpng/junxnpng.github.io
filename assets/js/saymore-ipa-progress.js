(() => {
  "use strict";
  const root = document.querySelector("[data-ipa-explorer]");
  const panel = root?.querySelector("[data-ipa-progress]");
  if (!panel) return;
  const core = SayMoreProgress;
  const key = "saymore.ipa.progress.v1";
  const appKey = panel.dataset.dropboxAppKey;
  const status = panel.querySelector("[data-ipa-progress-status]");
  const connect = panel.querySelector("[data-dropbox-connect]");
  const syncButton = panel.querySelector("[data-dropbox-sync]");
  const disconnect = panel.querySelector("[data-dropbox-disconnect]");
  const choices = [...root.querySelectorAll("[data-ipa-select]")];
  let state = core.empty();
  let cloud = null;
  let persistent = true;
  let syncTask = null;
  let generation = 0;
  let rerun = false;

  function notice(message, error = false) {
    status.textContent = message;
    status.classList.toggle("is-error", error);
  }
  function readLocal() {
    try {
      const text = localStorage.getItem(key);
      if (text) state = core.merge(state, core.parse(text));
      return true;
    } catch {
      notice("이 브라우저의 기존 기록을 읽지 못했습니다. 백업을 확인해 주세요. 기존 저장 내용은 덮어쓰지 않습니다.", true);
      persistent = false;
      return false;
    }
  }
  function saveLocal() {
    if (!persistent) return false;
    try {
      // Read again before writing so another tab's different-sound edit survives.
      if (!readLocal()) return false;
      localStorage.setItem(key, core.serialize(state));
      return true;
    } catch {
      persistent = false;
      notice("이 브라우저에 저장하지 못했습니다. 기록 파일을 받아 두세요. 현재 탭에서는 체크가 유지됩니다.", true);
      return false;
    }
  }
  function render() {
    let count = 0;
    for (const link of choices) {
      const done = state.items[link.dataset.ipaSelect]?.mastered === true;
      if (done) count++;
      link.closest(".sm-choice").classList.toggle("is-mastered", done);
    }
    for (const checkbox of root.querySelectorAll("[data-ipa-mastered]")) checkbox.checked = state.items[checkbox.dataset.ipaMastered]?.mastered === true;
    panel.querySelector("[data-ipa-progress-count]").textContent = `${count} / ${choices.length}개 외움`;
    const bar = panel.querySelector("[data-ipa-progress-bar]");
    bar.max = choices.length;
    bar.value = count;
    connect.hidden = !!cloud?.connected;
    syncButton.hidden = !cloud?.connected;
    disconnect.hidden = !cloud?.connected;
    connect.disabled = !appKey;
    root.dispatchEvent(new CustomEvent("saymore-progress-changed"));
  }

  readLocal();
  for (const link of choices) {
    link.closest(".sm-choice").querySelector(".sm-choice-progress").hidden = false;
    const label = document.createElement("label");
    label.className = "sm-card-progress";
    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.dataset.ipaMastered = link.dataset.ipaSelect;
    const symbol = link.querySelector(".sm-choice-symbol").textContent;
    checkbox.setAttribute("aria-label", `${symbol} 이 항목을 외웠어요`);
    const text = document.createElement("span");
    text.textContent = "이 항목을 외웠어요";
    label.append(checkbox, text);
    root.querySelector(`#${link.dataset.ipaSelect} .sm-card-heading`).after(label);
  }
  root.addEventListener("change", event => {
    const checkbox = event.target.closest("[data-ipa-mastered]");
    if (!checkbox) return;
    readLocal();
    const id = checkbox.dataset.ipaMastered;
    const previous = Date.parse(state.items[id]?.updatedAt || "") || 0;
    state.items[id] = { mastered: checkbox.checked, updatedAt: new Date(Math.max(Date.now(), previous + 1)).toISOString(), changeId: crypto.randomUUID() };
    const saved = saveLocal();
    render();
    if (saved) notice(cloud?.connected ? "이 브라우저에 저장했습니다. Dropbox에 반영 중…" : "이 브라우저에 저장했습니다. 다른 기기에서도 이어 쓰려면 Dropbox를 연결하세요.");
    if (cloud?.connected) void synchronize();
  });
  window.addEventListener("storage", event => {
    if (event.key === "saymore.dropbox.auth.v1") { render(); if (cloud?.connected) void synchronize(); return; }
    if (event.key !== key) return;
    readLocal();
    render();
    if (cloud?.connected) void synchronize();
  });

  async function initializeCloud() {
    const {openDropbox} = await import("/saymore/shared/dropbox.mjs?v=2");
    cloud = await openDropbox();
    render();
  }
  async function synchronize() {
    if (!cloud?.connected) return;
    if (syncTask) { rerun = true; return syncTask; }
    const thisGeneration = generation;
    syncButton.disabled = true;
    syncTask = (async () => {
      try {
        do {
          rerun = false;
          readLocal();
          const next = await core.sync(state, {
            read: async () => {
              const file = await cloud.download("/ipa-progress.json");
              return file ? {state: core.parse(await file.text()), rev: file.metadata.rev} : {state: core.empty(), rev: null};
            },
            write: (next, rev) => cloud.upload("/ipa-progress.json", core.serialize(next), {rev})
          });
          if (thisGeneration !== generation) return;
          state = core.merge(next, state);
          saveLocal();
          render();
        } while (rerun);
        const time = new Date().toLocaleTimeString("ko-KR", {hour: "2-digit", minute: "2-digit"});
        notice(`Dropbox와 동기화했습니다 · ${time}${persistent ? "" : " · 이 브라우저에는 저장하지 못했습니다. 기록 파일을 받아 두세요."}`, !persistent);
      } catch (error) {
        if (thisGeneration === generation) notice(error.message || "동기화하지 못했습니다. 이 브라우저의 기록은 유지합니다.", true);
      } finally {
        syncTask = null;
        syncButton.disabled = false;
      }
    })();
    return syncTask;
  }
  connect.addEventListener("click", async () => {
    connect.disabled = true;
    try {
      if (!cloud) await initializeCloud();
      await cloud.authorize();
    } catch (error) { connect.disabled = false; notice(error.message, true); }
  });
  syncButton.addEventListener("click", () => void synchronize());
  disconnect.addEventListener("click", () => {
    cloud?.disconnect();
    generation++;
    render();
    notice("이 브라우저의 Dropbox 연결을 해제했습니다. 학습 기록은 그대로 유지합니다.");
  });
  panel.querySelector("[data-ipa-export]").addEventListener("click", () => {
    const blob = new Blob([core.serialize(state) + "\n"], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `saymore-ipa-${new Date().toISOString().slice(0, 10)}.json`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 30000);
  });
  panel.querySelector("[data-ipa-import]").addEventListener("change", async event => {
    const file = event.target.files[0];
    if (!file) return;
    try {
      if (file.size > 1024 * 1024) throw Error("1MB 이하의 학습 기록 파일을 선택해 주세요.");
      const incoming = core.parse(await file.text());
      state = core.merge(state, incoming);
      const saved = saveLocal();
      render();
      if (saved) notice("학습 기록을 합쳤습니다. 항목마다 더 최근에 변경한 상태를 유지합니다.");
      if (cloud?.connected) void synchronize();
    } catch (error) { notice(error.message, true); }
    finally { event.target.value = ""; }
  });
  window.addEventListener("online", () => void synchronize());
  window.addEventListener("pageshow", () => { readLocal(); render(); void synchronize(); });
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) { readLocal(); render(); void synchronize(); }
  });
  setInterval(() => { if (!document.hidden && cloud?.connected) void synchronize(); }, 30000);
  globalThis.SayMoreIPAState = { isMastered: id => state.items[id]?.mastered === true };
  panel.hidden = false;
  render();
  void initializeCloud().then(() => synchronize()).catch(error => notice(error.message, true));
})();
