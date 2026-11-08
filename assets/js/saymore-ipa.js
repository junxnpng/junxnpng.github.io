(() => {
  "use strict";
  const root = document.querySelector("[data-ipa-explorer]");
  if (!root) return;

  const input = root.querySelector("#ipa-search");
  const clearSearch = root.querySelector("[data-ipa-clear]");
  const searchStatus = root.querySelector("#ipa-search-status");
  const empty = root.querySelector(".sm-no-results");
  const records = new Map();
  const groups = [...root.querySelectorAll(".sm-group")].map(element => {
    const group = {
      element,
      title: element.querySelector("h2").textContent,
      container: element.querySelector(".sm-cards"),
      compare: element.querySelector("[data-ipa-compare]"),
      close: element.querySelector("[data-ipa-close]"),
      status: element.querySelector(".sm-selection-status"),
      choices: [...element.querySelectorAll(".sm-choice")],
      items: []
    };
    for (const choice of group.choices) {
      const link = choice.querySelector("[data-ipa-select]");
      const card = document.getElementById(link.dataset.ipaSelect);
      const record = {
        group, choice, link, card,
        label: `${link.querySelector(".sm-choice-symbol").textContent} ${link.querySelector(".sm-choice-word").textContent}`,
        search: normalize(choice.dataset.search)
      };
      group.items.push(record);
      records.set(card.id, record);
    }
    return group;
  });
  let activeGroup = null;
  let selected = [];
  let comparing = false;

  function normalize(value) {
    return value.normalize("NFKC").toLowerCase().replace(/:/g, "ː").replace(/[\[\]\/]/g, "").replace(/\s+/g, " ").trim();
  }

  function updateURL(id, replace = false) {
    const url = `${location.pathname}${location.search}${id ? `#${encodeURIComponent(id)}` : ""}`;
    if (url !== `${location.pathname}${location.search}${location.hash}`) {
      history[replace ? "replaceState" : "pushState"](null, "", url);
    }
  }

  function scrollTo(element) {
    requestAnimationFrame(() => element.scrollIntoView({
      behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth",
      block: "start"
    }));
  }

  function render() {
    for (const group of groups) {
      const active = group === activeGroup;
      const ids = active ? selected : [];
      const pair = active && comparing && ids.length === 2;
      group.container.hidden = ids.length === 0;
      group.container.classList.toggle("sm-compare-view", pair);
      group.compare.setAttribute("aria-pressed", String(active && comparing));
      group.close.hidden = ids.length === 0;
      group.status.textContent = active && comparing
        ? `비교할 기호를 두 개 고르세요. ${ids.length}/2 선택됨`
        : ids.length ? `${records.get(ids[0]).label} 설명을 보고 있습니다.`
          : "기호를 고르면 이 표 아래에 설명이 열립니다.";
      for (const record of group.items) {
        const shown = ids.includes(record.card.id);
        record.card.hidden = !shown;
        record.choice.classList.toggle("is-selected", shown);
        record.link.setAttribute("aria-expanded", String(shown));
        if (shown) record.link.setAttribute("aria-current", "true");
        else record.link.removeAttribute("aria-current");
        for (const image of record.card.querySelectorAll("[data-ipa-image]")) {
          image.hidden = pair && image.dataset.ipaImage !== record.card.id;
        }
        const title = record.card.querySelector("[data-pair-title]");
        if (title) title.textContent = pair ? "이 소리의 혀 위치" : "두 모음의 혀 위치";
      }
    }
    for (const link of root.querySelectorAll(".sm-section-nav a")) {
      if (activeGroup && link.getAttribute("href") === `#${activeGroup.element.id}`) link.setAttribute("aria-current", "true");
      else link.removeAttribute("aria-current");
    }
  }

  function filter() {
    const query = normalize(input.value);
    const words = query.split(" ").filter(Boolean);
    let count = 0;
    for (const group of groups) {
      let matches = 0;
      for (const record of group.items) {
        const match = words.every(word => record.search.includes(word));
        record.choice.hidden = !match;
        if (match) matches++;
      }
      group.element.hidden = matches === 0;
      count += matches;
    }
    clearSearch.hidden = query.length === 0;
    empty.hidden = count !== 0;
    searchStatus.textContent = query
      ? `${count}개 항목을 찾았습니다. 기호를 고르면 검색을 마치고 설명이 열립니다.`
      : "모음·자음 표에서 기호를 선택하세요. 두 소리를 나란히 비교할 수도 있습니다.";
    root.querySelector("#extra-practice").hidden = query.length > 0;
  }

  function clearFilter() {
    input.value = "";
    filter();
  }

  function select(record, { toggle = false, fromHash = false, scroll = true } = {}) {
    clearFilter();
    if (activeGroup !== record.group) {
      activeGroup = record.group;
      selected = [];
      comparing = false;
    }
    const id = record.card.id;
    if (fromHash) {
      selected = [id];
      comparing = false;
    } else if (!comparing) selected = [id];
    else if (selected.includes(id)) {
      if (toggle) selected = selected.filter(value => value !== id);
    } else if (selected.length < 2) selected.push(id);
    else selected = [selected[0], id];
    render();
    if (!fromHash) updateURL(selected.includes(id) ? id : selected[0] || activeGroup.element.id);
    if (scroll && (!comparing || selected.length === 2)) scrollTo(record.card.hidden ? activeGroup.element : record.card);
  }

  function openParents(element) {
    for (let parent = element; parent && parent !== root; parent = parent.parentElement) {
      if (parent.tagName === "DETAILS") parent.open = true;
    }
  }

  function followHash() {
    let id;
    try { id = decodeURIComponent(location.hash.slice(1)); } catch { return; }
    if (records.has(id)) {
      select(records.get(id), { fromHash: true });
      return;
    }
    activeGroup = groups.find(group => group.element.id === id) || null;
    selected = [];
    comparing = false;
    render();
    const target = document.getElementById(id);
    if (target) {
      openParents(target);
      scrollTo(target);
    }
  }

  root.addEventListener("click", event => {
    const link = event.target.closest("a[href^='#']");
    if (!link || event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    let id;
    try { id = decodeURIComponent(link.getAttribute("href").slice(1)); } catch { return; }
    if (records.has(id)) {
      event.preventDefault();
      event.stopPropagation();
      select(records.get(id), { toggle: link.hasAttribute("data-ipa-select") });
    } else {
      const target = document.getElementById(id);
      if (target) {
        event.preventDefault();
        event.stopPropagation();
        openParents(target);
        const group = groups.find(value => value.element === target);
        if (group && group !== activeGroup) {
          activeGroup = group;
          selected = [];
          comparing = false;
          clearFilter();
          render();
        }
        updateURL(id);
        scrollTo(target);
      }
    }
  }, { capture: true });

  for (const group of groups) {
    group.element.querySelector(".sm-group-tools").hidden = false;
    group.compare.addEventListener("click", () => {
      if (activeGroup !== group) {
        activeGroup = group;
        selected = [];
        comparing = false;
      }
      comparing = !comparing;
      if (!comparing) selected = selected.slice(0, 1);
      render();
      updateURL(selected[0] || group.element.id);
    });
    group.close.addEventListener("click", () => {
      const link = records.get(selected[0])?.link;
      selected = [];
      comparing = false;
      render();
      updateURL(group.element.id);
      link?.focus({ preventScroll: true });
      scrollTo(group.element);
    });
  }
  input.addEventListener("input", () => {
    activeGroup = null;
    selected = [];
    comparing = false;
    updateURL("", true);
    render();
    filter();
  });
  clearSearch.addEventListener("click", () => { clearFilter(); input.focus(); });
  window.addEventListener("hashchange", followHash);
  render();
  root.classList.add("sm-explorer-ready");
  root.querySelector(".sm-search").hidden = false;
  followHash();
})();
