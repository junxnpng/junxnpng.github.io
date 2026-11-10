(() => {
  "use strict";
  // Pure quiz logic for the minimal-pair listening test; no DOM so node can test it.
  const empty = () => ({ format: "saymore-listen", version: 1, sets: {} });

  function parse(text) {
    try {
      const value = JSON.parse(text);
      if (value?.format !== "saymore-listen" || value.version !== 1 || !value.sets || typeof value.sets !== "object") return empty();
      const state = empty();
      for (const [id, item] of Object.entries(value.sets)) {
        if (Number.isInteger(item?.attempts) && Number.isInteger(item.correct) && item.attempts >= 0 && item.correct >= 0 && item.correct <= item.attempts) {
          state.sets[id] = { attempts: item.attempts, correct: item.correct };
        }
      }
      return state;
    } catch {
      return empty();
    }
  }

  function record(state, setId, correct) {
    const current = state.sets[setId] || { attempts: 0, correct: 0 };
    return { ...state, sets: { ...state.sets, [setId]: { attempts: current.attempts + 1, correct: current.correct + (correct ? 1 : 0) } } };
  }

  // Unpractised sets count as half wrong, so new and weak contrasts both come up more often.
  function weight(state, setId) {
    const item = state.sets[setId];
    const errorRate = item?.attempts ? 1 - item.correct / item.attempts : 0.5;
    return 1 + 4 * errorRate;
  }

  function pickSet(sets, state, random = Math.random) {
    const weights = sets.map(set => weight(state, set.id));
    let point = random() * weights.reduce((a, b) => a + b, 0);
    for (let i = 0; i < sets.length; i++) {
      point -= weights[i];
      if (point < 0) return sets[i];
    }
    return sets[sets.length - 1];
  }

  function nextTrial(sets, state, previous = null, random = Math.random) {
    for (let attempt = 0; attempt < 8; attempt++) {
      const set = sets.length === 1 ? sets[0] : pickSet(sets, state, random);
      const pairIndex = Math.floor(random() * set.pairs.length);
      const answer = random() < 0.5 ? 0 : 1;
      const repeat = previous && previous.set.id === set.id && previous.pairIndex === pairIndex && set.pairs.length > 1;
      if (!repeat || attempt === 7) return { set, pairIndex, pair: set.pairs[pairIndex], answer };
    }
  }

  globalThis.SayMoreListen = { empty, parse, record, weight, pickSet, nextTrial };
})();
