(() => {
  "use strict";
  const empty = () => ({ format: "saymore-ipa-progress", version: 1, items: {} });
  const validId = id => /^(ipa-[1-9][0-9]*|[a-z][a-z0-9]*(?:-[a-z0-9]+)+)$/.test(id);

  function parse(text) {
    if (typeof text !== "string" || text.length > 1024 * 1024) throw Error("학습 기록 파일의 크기나 형식을 확인해 주세요.");
    const value = JSON.parse(text);
    if (value?.format !== "saymore-ipa-progress" || value.version !== 1 || !value.items || typeof value.items !== "object" || Array.isArray(value.items) || Object.keys(value.items).length > 1000) {
      throw Error("Say More IPA 학습 기록 파일이 아닙니다.");
    }
    const state = empty();
    for (const [id, item] of Object.entries(value.items)) {
      if (!validId(id) || typeof item?.mastered !== "boolean" || typeof item.updatedAt !== "string" || !/^\d{4}-\d{2}-\d{2}T/.test(item.updatedAt) || !Number.isFinite(Date.parse(item.updatedAt)) || typeof item.changeId !== "string" || !/^[a-zA-Z0-9-]{1,100}$/.test(item.changeId)) {
        throw Error("학습 기록에 올바르지 않은 항목이 있습니다. 기존 기록은 유지합니다.");
      }
      state.items[id] = { mastered: item.mastered, updatedAt: new Date(item.updatedAt).toISOString(), changeId: item.changeId };
    }
    return state;
  }

  function merge(a, b) {
    const result = empty();
    for (const source of [a, b]) {
      for (const [id, item] of Object.entries(source.items)) {
        const current = result.items[id];
        if (!current || item.updatedAt > current.updatedAt || (item.updatedAt === current.updatedAt && item.changeId > current.changeId)) {
          result.items[id] = { ...item };
        }
      }
    }
    return result;
  }

  function serialize(state) {
    const items = Object.fromEntries(Object.entries(state.items).sort(([a], [b]) => a.localeCompare(b)));
    return JSON.stringify({ ...empty(), items });
  }

  async function sync(local, transport) {
    for (let attempt = 0; attempt < 4; attempt++) {
      const remote = await transport.read();
      const merged = merge(remote.state, local);
      if (remote.rev && serialize(merged) === serialize(remote.state)) return merged;
      try {
        await transport.write(merged, remote.rev);
        return merged;
      } catch (error) {
        if (!error.conflict || attempt === 3) throw error;
      }
    }
  }

  globalThis.SayMoreProgress = { empty, parse, merge, serialize, sync };
})();
