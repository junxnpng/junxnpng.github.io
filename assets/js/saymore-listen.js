(() => {
  "use strict";
  const root = document.querySelector("[data-listen]");
  const core = globalThis.SayMoreListen;
  if (!root || !core) return;
  const KEY = "saymore.listen.v1";
  const ROUND = 10;
  const sets = JSON.parse(document.getElementById("listen-data").textContent).sets;
  const audio = JSON.parse(document.getElementById("listen-audio")?.textContent || "null");
  // One element plays every file: iPhone Safari lets a page play sound from it once a tap has started it.
  const player = new Audio();
  player.preload = "auto";
  const turns = new Map();
  const $ = name => root.querySelector(`[data-listen-${name}]`);
  const choices = [...root.querySelectorAll("[data-listen-choice]")];
  let state = core.parse(readStore());
  let voice = null, trial = null, answered = false, done = 0, score = 0, speaking = 0;
  // Other browsers' answers (the phone, the computer) come from Dropbox and are added to this browser's own.
  // `state` holds only this browser's answers, which is what it sends; `seen()` is what is shown and weighed.
  let others = {}, sync = null, cloud = null, shareTimer = null;
  const seen = () => (sync ? { ...state, sets: sync.sumSets([state.sets, others]) } : state);
  async function share(write = true) {
    try {
      if (!sync) {
        if (!localStorage.getItem("saymore.dropbox.auth.v1")) return;
        const [dropbox, shared] = await Promise.all([import("/saymore/shared/dropbox.mjs?v=8"), import("/saymore/shared/sync.mjs?v=4")]);
        cloud = await dropbox.openDropbox();
        sync = shared; others = shared.otherListenSets();
      }
      if (!cloud?.connected) return;
      const result = await sync.syncListen(cloud, state.sets, { write });
      if (result) {
        others = result.others;
        // This browser's entry in Dropbox may hold more answers than storage here (storage cleared, private window).
        // Counts only grow; answers given while the sync was running are kept.
        const sets = sync.maxSets(state.sets, result.own);
        if (JSON.stringify(sets) !== JSON.stringify(state.sets)) { state = { ...state, sets }; writeStore(); }
      }
      renderStats();
    } catch { /* This browser's answers are kept here and sent next time. */ }
  }
  const shareSoon = () => { clearTimeout(shareTimer); shareTimer = setTimeout(() => void share(), 8000); };

  function readStore() { try { return localStorage.getItem(KEY) || ""; } catch { return ""; } }
  function writeStore() { try { localStorage.setItem(KEY, JSON.stringify(state)); } catch { /* private mode: keep this round in memory */ } }
  const status = (message, error = false) => { $("status").textContent = message; if (error) $("status").dataset.state = "error"; else delete $("status").dataset.state; };

  // Fetched while the page is idle, so the tap on Start does not wait for it.
  const speech = import("/saymore/cards/speech.mjs?v=5");
  speech.catch(() => {});

  async function loadVoice() {
    const synth = window.speechSynthesis;
    if (!synth || !window.SpeechSynthesisUtterance) return null;
    const { usVoice } = await speech;
    if (!usVoice(synth.getVoices())) {
      await new Promise(resolve => {
        const finish = () => { clearTimeout(timer); resolve(); };
        const timer = setTimeout(finish, 1500);
        synth.addEventListener("voiceschanged", finish, { once: true });
      });
    }
    return usVoice(synth.getVoices());
  }

  // A word cut short by the next one ends its wait as not finished, like a cancelled utterance.
  let playing = null;
  function stop() {
    const done = playing;
    player.onended = player.onerror = null; player.pause();
    window.speechSynthesis?.cancel();
    // Settled while it is still the word playing; only then is `playing` cleared.
    done?.(false);
    playing = null;
  }
  // The question's voice reads both words from its files; a pair without checked files, or a file that
  // cannot be played, is read by the device's voice.
  function say(word) {
    const ticket = ++speaking, file = trial?.voice;
    if (!file) return speak(word, ticket);
    stop();
    return new Promise(resolve => {
      const settle = value => { if (playing !== settle) return; playing = null; player.onended = player.onerror = null; resolve(value); };
      playing = settle;
      const fallback = () => {
        if (playing !== settle) return;
        playing = null; player.onended = player.onerror = null;
        if (voice) speak(word, ticket).then(resolve);
        else { status("소리 파일을 재생하지 못했어요. 다시 들어 보세요.", true); resolve(false); }
      };
      player.onended = () => settle(ticket === speaking);
      player.onerror = fallback;
      player.src = core.fileUrl(audio, file, word);
      player.play()?.catch?.(error => { if (error?.name !== "AbortError") fallback(); });
    });
  }
  function speak(word, ticket) {
    if (!voice) return Promise.resolve(false);
    return new Promise(resolve => {
      stop();
      const utterance = new SpeechSynthesisUtterance(word);
      utterance.voice = voice; utterance.lang = "en-US"; utterance.rate = 0.8;
      utterance.onend = utterance.onerror = () => resolve(ticket === speaking);
      window.speechSynthesis.speak(utterance);
    });
  }
  const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

  function renderStats() {
    for (const set of sets) {
      const row = root.querySelector(`[data-listen-row="${set.id}"]`);
      const item = seen().sets[set.id];
      row.querySelector("[data-listen-attempts]").textContent = item?.attempts || 0;
      row.querySelector("[data-listen-accuracy]").textContent = item?.attempts ? `${Math.round(100 * item.correct / item.attempts)}%` : "–";
      row.classList.toggle("is-weak", Boolean(item && item.attempts >= 5 && item.correct / item.attempts < 0.8));
    }
  }

  function activeSets() {
    const id = $("set").value;
    return id === "all" ? sets : sets.filter(set => set.id === id);
  }

  function showTrial() {
    trial = core.nextTrial(activeSets(), seen(), trial);
    answered = false;
    $("progress").textContent = `${done + 1} / ${ROUND}`;
    $("score").textContent = `맞힌 문제 ${score}`;
    $("contrast").textContent = `/${trial.set.sounds[0].symbol}/ ↔ /${trial.set.sounds[1].symbol}/`;
    choices.forEach((button, index) => {
      button.disabled = false;
      button.className = "";
      button.querySelector(".sm-listen-word").textContent = trial.pair[index].word;
      button.querySelector(".sm-listen-ipa").textContent = trial.pair[index].ipa;
    });
    $("feedback").hidden = true;
    $("replay").focus({ preventScroll: true });
    trial.voice = core.trialVoice(audio, trial.set, trial.pair, turns);
    status(!trial.voice ? `음성: ${voice.name} · 기기 합성 음성`
      : core.isRecorded(audio, trial.voice) ? `음성: 사람 녹음 · ${audio.voices[trial.voice]}`
      : `음성: ${audio.voices[trial.voice]} · 미리 만든 합성 음성 파일`);
    say(trial.pair[trial.answer].word);
  }

  function answer(index) {
    if (!trial || answered) return;
    answered = true;
    const correct = index === trial.answer;
    done++; if (correct) score++;
    state = core.record(state, trial.set.id, correct);
    writeStore(); renderStats(); shareSoon();
    choices.forEach((button, i) => {
      button.disabled = true;
      button.classList.toggle("is-correct", i === trial.answer);
      button.classList.toggle("is-wrong", i === index && !correct);
    });
    const heard = trial.pair[trial.answer];
    $("feedback").hidden = false; // shown first: a live region filled while hidden is not announced
    $("result").textContent = correct ? `맞았어요. ${heard.word} ${heard.ipa}` : `아니에요. 들은 단어는 ${heard.word} ${heard.ipa}예요.`;
    $("result").className = correct ? "is-correct" : "is-wrong";
    $("tip").textContent = trial.set.tip;
    $("score").textContent = `맞힌 문제 ${score}`;
    $("next").textContent = done >= ROUND ? "결과 보기" : "다음 문제 →";
    $("next").focus({ preventScroll: true }); // Enter then means the next question, right or wrong
    if (!correct) compare();
  }

  async function compare() {
    if (!trial) return;
    // The reader may move on while the three words are playing; the rest then belongs to a question that is gone.
    const current = trial, order = [trial.answer, 1 - trial.answer, trial.answer];
    for (const index of order) {
      if (trial !== current || $("trial").hidden) return;
      choices.forEach((button, i) => button.classList.toggle("is-speaking", i === index));
      if (!await say(current.pair[index].word)) break;
      await pause(350);
    }
    if (trial !== current) return;
    choices.forEach(button => button.classList.remove("is-speaking"));
  }

  function finish() {
    stop();
    $("trial").hidden = true;
    $("summary").hidden = false;
    $("summary-title").textContent = `${ROUND}문제 중 ${score}문제를 맞혔어요.`;
    $("summary-text").textContent = score === ROUND ? "모두 구별했어요. 다른 소리도 연습해 보세요." : "틀린 소리는 아래 표의 발음 설명에서 입 모양을 확인하고 다시 들어 보세요.";
    $("again").focus({ preventScroll: true });
  }

  async function start() {
    $("start").disabled = true;
    // iPhone Safari only lets a page speak from inside a tap. The voice list may take a moment,
    // so an empty utterance spoken now keeps the first word from being dropped.
    try { if (!voice && window.speechSynthesis) window.speechSynthesis.speak(new SpeechSynthesisUtterance("")); } catch { /* no speech on this device */ }
    // The same for files: a short silence started from this tap lets later words play without one.
    if (audio) { player.src = `${audio.path}silence.m4a`; player.play()?.catch?.(() => {}); }
    try { if (!voice) voice = await loadVoice(); } catch { voice = null; }
    $("start").disabled = false;
    // Questions read by the device's voice need one; a choice made only of pairs with files does not.
    const needsVoice = activeSets().some(set => set.pairs.some(pair => !core.fileVoices(audio, set, pair).length));
    if (!voice && needsVoice) { status("미국식 영어 음성을 찾지 못했어요. 기기 설정에서 영어(미국) 음성을 설치한 뒤 다시 시도해 주세요.", true); return; }
    done = 0; score = 0; trial = null;
    $("summary").hidden = true;
    $("trial").hidden = false;
    showTrial();
  }

  $("start").addEventListener("click", start);
  $("again").addEventListener("click", start);
  $("replay").addEventListener("click", () => trial && say(trial.pair[trial.answer].word));
  $("compare").addEventListener("click", compare);
  $("next").addEventListener("click", () => (done >= ROUND ? finish() : showTrial()));
  choices.forEach((button, index) => button.addEventListener("click", () => answer(index)));
  $("set").addEventListener("change", () => { if (!$("trial").hidden) start(); });
  document.addEventListener("keydown", event => {
    if ($("trial").hidden || event.metaKey || event.ctrlKey || event.altKey || event.target?.matches?.("select, input, textarea")) return;
    const onControl = Boolean(event.target?.closest?.("button, a, summary")); // Enter and Space belong to the focused control
    if (event.key === "1" || event.key === "2") { event.preventDefault(); answer(Number(event.key) - 1); }
    else if (event.key === " " && !onControl) { event.preventDefault(); trial && say(trial.pair[trial.answer].word); }
    else if (event.key === "Enter" && answered && !onControl) { event.preventDefault(); $("next").click(); }
  });
  window.addEventListener("pagehide", stop);
  renderStats();
  void share();
})();
