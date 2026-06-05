const MAIN_BLOCKS = 16;
const CACHE_LINES = 8;
const BLOCK_SIZE = 16;
const SETS = 4;
const WAYS = 2;
const AUTO_DELAY = 1000;

const demoSequences = {
  direct: [0, 8, 0, 1, 9, 1],
  fully: [3, 5, 9, 1, 12, 14, 2, 7, 10, 3],
  set: [0, 4, 8, 0, 12, 1, 5, 9]
};

const modeInfo = {
  direct: {
    title: "直接映射 Direct Mapping",
    summary: "主存块只能放入唯一 Cache 行，查找快但冲突多。",
    formula: "Cache 行号 = 主存块号 mod 8",
    principle:
      "直接映射把主存块号对 Cache 行数取模，得到唯一 Cache 行。CPU 先用 Index 直接定位这一行，再比较该行 Valid 和 Tag。",
    features: ["固定行替换", "硬件简单", "查找速度快", "典型冲突：B0 与 B8 都映射到行 0"]
  },
  fully: {
    title: "全相联映射 Fully Associative Mapping",
    summary: "主存块可以放入 Cache 任意一行，冲突少但比较器成本高。",
    formula: "任意主存块可以放入 Cache 任意一行",
    principle:
      "全相联映射没有 Index 字段。CPU Tag 会同时送到所有 Cache 行，只要任意一行 Valid = 1 且 Tag 相同，就判定 Hit。",
    features: ["任意行放置", "所有行并行比较 Tag", "示例采用 LRU 替换", "硬件复杂但冲突少"]
  },
  set: {
    title: "组相联映射 Set Associative Mapping",
    summary: "先定位固定组，再在组内任意一路比较和放置，是常见折中方案。",
    formula: "Cache 组号 = 主存块号 mod 4",
    principle:
      "2 路组相联把 8 行 Cache 分成 4 组。CPU 先用 Set Index 定位一个组，再在组内 2 行并行比较 Tag。",
    features: ["固定组内任意行", "组内并行比较", "只在对应组内替换", "比直接映射冲突少"]
  }
};

const stepNames = ["确定主存块", "定位行/组", "比较 Tag", "判断结果并装入"];

const state = {
  mode: "direct",
  selectedBlock: 0,
  step: 0,
  current: null,
  seqIndex: { direct: 0, fully: 0, set: 0 },
  clock: 0,
  autoTimer: null,
  history: [],
  cache: createAllCaches(),
  stats: {
    direct: createStats(),
    fully: createStats(),
    set: createStats()
  }
};

const els = {
  tabs: document.querySelectorAll(".mode-tab"),
  modeTitle: document.querySelector("#modeTitle"),
  modeSummary: document.querySelector("#modeSummary"),
  memoryBlocks: document.querySelector("#memoryBlocks"),
  addressStrip: document.querySelector("#addressStrip"),
  addressNumber: document.querySelector("#addressNumber"),
  formulaText: document.querySelector("#formulaText"),
  placementTitle: document.querySelector("#placementTitle"),
  placementMap: document.querySelector("#placementMap"),
  cpuTag: document.querySelector("#cpuTag"),
  compareLines: document.querySelector("#compareLines"),
  judgeBadge: document.querySelector("#judgeBadge"),
  movingToken: document.querySelector("#movingToken"),
  cacheTitle: document.querySelector("#cacheTitle"),
  cacheGrid: document.querySelector("#cacheGrid"),
  stepIndex: document.querySelector("#stepIndex"),
  stepText: document.querySelector("#stepText"),
  blockInput: document.querySelector("#blockInput"),
  visitBtn: document.querySelector("#visitBtn"),
  randomBtn: document.querySelector("#randomBtn"),
  prevBtn: document.querySelector("#prevBtn"),
  nextBtn: document.querySelector("#nextBtn"),
  autoBtn: document.querySelector("#autoBtn"),
  resetBtn: document.querySelector("#resetBtn"),
  accessCount: document.querySelector("#accessCount"),
  hitCount: document.querySelector("#hitCount"),
  missCount: document.querySelector("#missCount"),
  hitRate: document.querySelector("#hitRate"),
};

function createStats() {
  return { access: 0, hit: 0, miss: 0 };
}

function createLine() {
  return { valid: 0, tag: "-", data: "-", block: null, time: 0 };
}

function createAllCaches() {
  return {
    direct: Array.from({ length: CACHE_LINES }, createLine),
    fully: Array.from({ length: CACHE_LINES }, createLine),
    set: Array.from({ length: SETS }, () => Array.from({ length: WAYS }, createLine))
  };
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function saveHistory() {
  state.history.push({
    mode: state.mode,
    selectedBlock: state.selectedBlock,
    step: state.step,
    current: clone(state.current),
    seqIndex: clone(state.seqIndex),
    clock: state.clock,
    cache: clone(state.cache),
    stats: clone(state.stats)
  });
  if (state.history.length > 80) state.history.shift();
}

function restore(snapshot) {
  stopAuto();
  state.mode = snapshot.mode;
  state.selectedBlock = snapshot.selectedBlock;
  state.step = snapshot.step;
  state.current = snapshot.current;
  state.seqIndex = snapshot.seqIndex;
  state.clock = snapshot.clock;
  state.cache = snapshot.cache;
  state.stats = snapshot.stats;
}

function clampBlock(value) {
  const parsed = Number.parseInt(value, 10);
  if (Number.isNaN(parsed)) return 0;
  return Math.max(0, Math.min(MAIN_BLOCKS - 1, parsed));
}

function binary(value, width) {
  return value.toString(2).padStart(width, "0");
}

function tagFor(mode, block) {
  if (mode === "direct") return Math.floor(block / CACHE_LINES);
  if (mode === "set") return Math.floor(block / SETS);
  return block;
}

function flatSetLine(setIndex, wayIndex) {
  return setIndex * WAYS + wayIndex;
}

function lineText(lineIndex) {
  return `行 ${lineIndex}`;
}

function prepareAccess(block) {
  state.selectedBlock = clampBlock(block);
  state.step = 0;
  state.current = buildAccessPlan(state.mode, state.selectedBlock);
  els.blockInput.value = String(state.selectedBlock);
}

function buildAccessPlan(mode, block) {
  if (mode === "direct") return buildDirectPlan(block);
  if (mode === "fully") return buildFullyPlan(block);
  return buildSetPlan(block);
}

function buildDirectPlan(block) {
  const index = block % CACHE_LINES;
  const tag = tagFor("direct", block);
  const line = state.cache.direct[index];
  const hit = line.valid === 1 && line.tag === tag;
  const conflict = line.valid === 1 && !hit;
  return {
    mode: "direct",
    block,
    tag,
    index,
    hit,
    conflict,
    targetLine: index,
    compareTargets: [{ line: index, label: lineText(index), tag: line.tag, valid: line.valid, match: hit }],
    replacement: conflict ? { line: index, old: line.data } : null,
    empty: line.valid === 0
  };
}

function buildFullyPlan(block) {
  const tag = tagFor("fully", block);
  const cache = state.cache.fully;
  const hitIndex = cache.findIndex((line) => line.valid === 1 && line.tag === tag);
  const hit = hitIndex >= 0;
  const emptyIndex = cache.findIndex((line) => line.valid === 0);
  const lruIndex = cache.reduce((least, line, index) => (line.time < cache[least].time ? index : least), 0);
  const targetLine = hit ? hitIndex : emptyIndex >= 0 ? emptyIndex : lruIndex;
  const compareTargets = cache.map((line, index) => ({
    line: index,
    label: lineText(index),
    tag: line.tag,
    valid: line.valid,
    match: line.valid === 1 && line.tag === tag
  }));
  return {
    mode: "fully",
    block,
    tag,
    hit,
    targetLine,
    compareTargets,
    replacement: !hit && emptyIndex < 0 ? { line: targetLine, old: cache[targetLine].data } : null,
    empty: !hit && emptyIndex >= 0
  };
}

function buildSetPlan(block) {
  const setIndex = block % SETS;
  const tag = tagFor("set", block);
  const group = state.cache.set[setIndex];
  const hitWay = group.findIndex((line) => line.valid === 1 && line.tag === tag);
  const hit = hitWay >= 0;
  const emptyWay = group.findIndex((line) => line.valid === 0);
  const lruWay = group.reduce((least, line, index) => (line.time < group[least].time ? index : least), 0);
  const targetWay = hit ? hitWay : emptyWay >= 0 ? emptyWay : lruWay;
  const compareTargets = group.map((line, way) => ({
    set: setIndex,
    way,
    line: flatSetLine(setIndex, way),
    label: `组 ${setIndex} / ${way} 路`,
    tag: line.tag,
    valid: line.valid,
    match: line.valid === 1 && line.tag === tag
  }));
  return {
    mode: "set",
    block,
    tag,
    setIndex,
    hit,
    targetSet: setIndex,
    targetWay,
    targetLine: flatSetLine(setIndex, targetWay),
    compareTargets,
    replacement: !hit && emptyWay < 0 ? { set: setIndex, way: targetWay, old: group[targetWay].data } : null,
    empty: !hit && emptyWay >= 0
  };
}

function commitAccess() {
  const access = state.current;
  if (!access || access.committed) return;
  const entry = { valid: 1, tag: access.tag, data: `B${access.block}`, block: access.block, time: ++state.clock };

  if (access.mode === "direct") {
    state.cache.direct[access.targetLine] = entry;
  } else if (access.mode === "fully") {
    state.cache.fully[access.targetLine] = entry;
  } else {
    state.cache.set[access.targetSet][access.targetWay] = entry;
  }

  const stats = state.stats[access.mode];
  stats.access += 1;
  if (access.hit) stats.hit += 1;
  else stats.miss += 1;
  access.committed = true;
  animateToken(access.block);
}

function nextStep() {
  saveHistory();
  if (!state.current || state.step >= 4) {
    const seq = demoSequences[state.mode];
    const block = seq[state.seqIndex[state.mode] % seq.length];
    state.seqIndex[state.mode] += 1;
    prepareAccess(block);
    render();
    return;
  }

  state.step += 1;
  if (state.step === 4) commitAccess();
  render();
}

function prevStep() {
  const snapshot = state.history.pop();
  if (!snapshot) return;
  restore(snapshot);
  render();
}

function autoTick() {
  nextStep();
  state.autoTimer = window.setTimeout(autoTick, AUTO_DELAY);
}

function startAuto() {
  if (state.autoTimer) return;
  els.autoBtn.textContent = "暂停";
  state.autoTimer = window.setTimeout(autoTick, AUTO_DELAY);
}

function stopAuto() {
  if (!state.autoTimer) return;
  window.clearTimeout(state.autoTimer);
  state.autoTimer = null;
  els.autoBtn.textContent = "自动播放";
}

function resetMode() {
  saveHistory();
  stopAuto();
  if (state.mode === "direct") state.cache.direct = Array.from({ length: CACHE_LINES }, createLine);
  if (state.mode === "fully") state.cache.fully = Array.from({ length: CACHE_LINES }, createLine);
  if (state.mode === "set") state.cache.set = Array.from({ length: SETS }, () => Array.from({ length: WAYS }, createLine));
  state.stats[state.mode] = createStats();
  state.step = 0;
  state.current = null;
  render();
}

function switchMode(mode) {
  if (state.mode === mode) return;
  saveHistory();
  stopAuto();
  state.mode = mode;
  state.step = 0;
  state.current = null;
  state.selectedBlock = demoSequences[mode][0];
  els.blockInput.value = String(state.selectedBlock);
  render();
}

function directFormula(access) {
  return `B${access.block} mod 8 = ${access.index}，所以只能进入 Cache 行 ${access.index}`;
}

function fullyFormula(access) {
  if (access.hit) return `全相联没有固定行号：所有行比较 Tag，在行 ${access.targetLine} 命中`;
  if (access.empty) return `全相联没有固定行号：选择空行 ${access.targetLine} 装入 B${access.block}`;
  return `Cache 已满：示例采用 LRU，在整个 Cache 中替换行 ${access.targetLine}`;
}

function setFormula(access) {
  return `B${access.block} mod 4 = ${access.setIndex}，所以先定位到 Cache 组 ${access.setIndex}`;
}

function formulaForCurrent() {
  const access = state.current;
  if (!access) return modeInfo[state.mode].formula;
  if (access.mode === "direct") return directFormula(access);
  if (access.mode === "fully") return fullyFormula(access);
  return setFormula(access);
}

function stepText() {
  const access = state.current;
  if (!access) return "选择主存块后点击“下一步”，观察 CPU 如何完成地址映射与命中判断。";

  if (state.step === 0) {
    return `准备访问主存块 B${access.block}。主存与 Cache 按块交换数据，每个 Cache 行可以保存一个主存块。`;
  }
  if (state.step === 1) {
    return `CPU 给出的地址属于主存块 B${access.block}，块大小为 16B，Offset 用于定位块内具体字节。`;
  }
  if (state.step === 2 && access.mode === "direct") {
    return `Index 字段直接指向唯一 Cache 行 ${access.targetLine}。直接映射不需要搜索其他行。`;
  }
  if (state.step === 2 && access.mode === "fully") {
    return "全相联没有 Index 字段，主存块可以放入任意 Cache 行，因此所有行都可能命中。";
  }
  if (state.step === 2) {
    return `Set Index 字段先定位到 Cache 组 ${access.targetSet}，只在这个组内部继续查找。`;
  }
  if (state.step === 3 && access.mode === "direct") {
    return `读取行 ${access.targetLine} 的 Valid 和 Tag：只有 Valid = 1 且 Cache Tag = CPU Tag ${access.tag} 才是 Hit。`;
  }
  if (state.step === 3 && access.mode === "fully") {
    return `CPU Tag ${access.tag} 同时送到所有 Cache 行比较，任意一行匹配即可 Hit。`;
  }
  if (state.step === 3) {
    return `CPU Tag ${access.tag} 只与组 ${access.targetSet} 内的 ${WAYS} 行并行比较，其他组不参与本次查找。`;
  }
  if (access.hit) {
    return `Valid = 1 且 Tag 匹配，Cache Hit。CPU 可以直接从 Cache 中读取 B${access.block}。`;
  }
  if (access.replacement && access.mode === "direct") {
    return `${access.replacement.old} 与 B${access.block} 都只能放在行 ${access.targetLine}，发生冲突，需要替换。`;
  }
  if (access.replacement && access.mode === "fully") {
    return `Cache 已满，Miss 后示例采用 LRU，在整个 Cache 中替换 ${access.replacement.old}。`;
  }
  if (access.replacement) {
    return `组 ${access.targetSet} 已满，Miss 后只在该组内部用 LRU 替换 ${access.replacement.old}。`;
  }
  return `Cache Miss，目标位置为空，从主存调入 B${access.block}，更新 Valid = 1、Tag 和 Data。`;
}

function addressParts(access) {
  const block = access ? access.block : state.selectedBlock;
  const mode = state.mode;
  const offset = binary(0, 4);
  if (mode === "direct") {
    return [
      { key: "tag", label: "Tag", value: binary(tagFor(mode, block), 1), help: "判断是否为目标块", className: "tag-part" },
      { key: "index", label: "Index 行号", value: binary(block % CACHE_LINES, 3), help: "定位唯一 Cache 行", className: "index-part" },
      { key: "offset", label: "Offset 块内地址", value: offset, help: "定位块内字节", className: "offset-part" }
    ];
  }
  if (mode === "fully") {
    return [
      { key: "tag", label: "Tag", value: binary(tagFor(mode, block), 4), help: "送往所有行比较", className: "tag-part" },
      { key: "offset", label: "Offset 块内地址", value: offset, help: "定位块内字节", className: "offset-part" }
    ];
  }
  return [
    { key: "tag", label: "Tag", value: binary(tagFor(mode, block), 2), help: "组内比较", className: "tag-part" },
    { key: "set", label: "Set Index 组号", value: binary(block % SETS, 2), help: "定位 Cache 组", className: "set-part" },
    { key: "offset", label: "Offset 块内地址", value: offset, help: "定位块内字节", className: "offset-part" }
  ];
}

function activePartKey() {
  if (state.step <= 1) return "";
  if (state.step === 2) return state.mode === "fully" ? "tag" : state.mode === "set" ? "set" : "index";
  if (state.step >= 3) return "tag";
  return "";
}

function renderAddress() {
  const access = state.current;
  const parts = addressParts(access);
  const activeKey = activePartKey();
  els.addressStrip.style.gridTemplateColumns = `repeat(${parts.length}, minmax(0, 1fr))`;
  els.addressStrip.innerHTML = parts
    .map((part) => {
      const active = activeKey === part.key ? "active" : "";
      const dim = state.step > 0 && activeKey !== part.key ? "dim" : "";
      return `<div class="address-part ${part.className} ${active} ${dim}">
        <span class="part-label">${part.label}</span>
        <span class="part-value">${part.value}</span>
        <span class="part-help">${part.help}</span>
      </div>`;
    })
    .join("");
}

function renderMemory() {
  els.memoryBlocks.innerHTML = "";
  for (let block = 0; block < MAIN_BLOCKS; block += 1) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `mem-block ${block === state.selectedBlock ? "active" : ""}`;
    button.innerHTML = `<strong>B${block}</strong><span>${binary(block, 4)}</span>`;
    button.addEventListener("click", () => {
      saveHistory();
      stopAuto();
      prepareAccess(block);
      render();
    });
    els.memoryBlocks.appendChild(button);
  }
}

function lineClasses(mode, lineIndex, setIndex, wayIndex) {
  const access = state.current;
  const classes = ["cache-line"];
  if (!access || access.mode !== mode) return classes.join(" ");

  const compares = access.compareTargets.some((target) => {
    if (mode === "set") return target.set === setIndex && target.way === wayIndex;
    return target.line === lineIndex;
  });
  const isTargetLine = mode === "set" ? access.targetSet === setIndex && access.targetWay === wayIndex : access.targetLine === lineIndex;
  const isTargetGroup = mode === "set" && access.targetSet === setIndex;
  const isReplacement = access.replacement
    ? mode === "set"
      ? access.replacement.set === setIndex && access.replacement.way === wayIndex
      : access.replacement.line === lineIndex
    : false;

  if (state.step >= 2 && (isTargetLine || isTargetGroup)) classes.push("target");
  if (state.step === 3 && compares) classes.push("compare");
  if (state.step >= 3 && isTargetLine && access.hit) classes.push("hit");
  if (state.step >= 3 && isTargetLine && !access.hit) classes.push("miss");
  if (state.step >= 4 && isReplacement) classes.push("replace");
  return classes.join(" ");
}

function renderLine(line, label, className) {
  return `<div class="${className}">
    <div class="line-no">${label}</div>
    <div class="line-cell"><span>Valid</span><strong>${line.valid}</strong></div>
    <div class="line-cell"><span>Tag</span><strong>${line.tag}</strong></div>
    <div class="line-cell"><span>Data</span><strong>${line.data}</strong></div>
  </div>`;
}

function displayLineFor(mode, line, lineIndex, setIndex, wayIndex) {
  const access = state.current;
  const copy = { ...line };
  if (!access || state.step < 4 || !access.replacement || access.mode !== mode) return copy;

  const isReplacement =
    mode === "set"
      ? access.replacement.set === setIndex && access.replacement.way === wayIndex
      : access.replacement.line === lineIndex;

  if (isReplacement) {
    copy.data = `${access.replacement.old} → B${access.block}`;
  }
  return copy;
}

function renderCache() {
  els.cacheGrid.innerHTML = "";
  if (state.mode === "set") {
    els.cacheTitle.textContent = "Cache 组相联状态";
    state.cache.set.forEach((group, setIndex) => {
      const groupNode = document.createElement("div");
      const target = state.current?.mode === "set" && state.step >= 2 && state.current.targetSet === setIndex ? "target" : "";
      groupNode.className = `cache-group ${target}`;
      groupNode.innerHTML = `<div class="cache-group-title">第 ${setIndex} 组</div>`;
      group.forEach((line, wayIndex) => {
        const flatLine = flatSetLine(setIndex, wayIndex);
        const displayLine = displayLineFor("set", line, flatLine, setIndex, wayIndex);
        groupNode.innerHTML += renderLine(displayLine, `${wayIndex} 路`, lineClasses("set", flatLine, setIndex, wayIndex));
      });
      els.cacheGrid.appendChild(groupNode);
    });
    return;
  }

  els.cacheTitle.textContent = "Cache 行状态";
  const cache = state.cache[state.mode];
  cache.forEach((line, index) => {
    const displayLine = displayLineFor(state.mode, line, index);
    els.cacheGrid.innerHTML += renderLine(displayLine, `行 ${index}`, lineClasses(state.mode, index));
  });
}

function renderCompareLines() {
  const access = state.current;
  if (!access || state.step < 3) {
    els.compareLines.innerHTML = `<div class="compare-line">等待 Tag 比较</div>`;
    return;
  }
  els.compareLines.innerHTML = access.compareTargets
    .map((target) => {
      const stateClass = target.match ? "match" : target.valid ? "no-match" : "active";
      const result = target.match ? "✓ 匹配" : target.valid ? "× 不同" : "空行";
      return `<div class="compare-line ${stateClass}">Tag ${access.tag} → ${target.label}：${result}</div>`;
    })
    .join("");
}

function renderJudgeBadge() {
  const access = state.current;
  if (!access || state.step < 4) {
    els.judgeBadge.className = "judge-badge idle";
    els.judgeBadge.textContent = state.step >= 3 ? "比较中" : "等待开始";
    return;
  }
  if (access.hit) {
    els.judgeBadge.className = "judge-badge hit";
    els.judgeBadge.textContent = "Hit";
    return;
  }
  if (access.replacement) {
    els.judgeBadge.className = "judge-badge conflict";
    els.judgeBadge.textContent = "Miss 替换";
    return;
  }
  els.judgeBadge.className = "judge-badge miss";
  els.judgeBadge.textContent = "Miss";
}

function renderStats() {
  const stats = state.stats[state.mode];
  const rate = stats.access === 0 ? 0 : Math.round((stats.hit / stats.access) * 100);
  els.accessCount.textContent = stats.access;
  els.hitCount.textContent = stats.hit;
  els.missCount.textContent = stats.miss;
  els.hitRate.textContent = `${rate}%`;
}

function placementInfo() {
  const access = state.current || buildAccessPlan(state.mode, state.selectedBlock);
  if (state.mode === "direct") {
    return {
      title: `只能放入行 ${access.targetLine}`,
      chips: Array.from({ length: CACHE_LINES }, (_, index) => ({
        label: `行 ${index}`,
        possible: index === access.targetLine,
        target: index === access.targetLine
      }))
    };
  }
  if (state.mode === "fully") {
    return {
      title: "8 行都可以放",
      chips: Array.from({ length: CACHE_LINES }, (_, index) => ({
        label: `行 ${index}`,
        possible: true,
        target: index === access.targetLine
      }))
    };
  }
  return {
    title: `先定组 ${access.targetSet}，组内 2 路可放`,
    chips: Array.from({ length: SETS }, (_, setIndex) => ({
      label: `组 ${setIndex}`,
      possible: setIndex === access.targetSet,
      target: setIndex === access.targetSet,
      group: true
    }))
  };
}

function renderPlacement() {
  const info = placementInfo();
  els.placementTitle.textContent = info.title;
  els.placementMap.innerHTML = info.chips
    .map((chip) => {
      const classes = ["place-chip"];
      if (chip.possible) classes.push("possible");
      if (chip.target && state.step >= 2) classes.push("target");
      if (chip.group) classes.push("group-chip");
      return `<div class="${classes.join(" ")}">${chip.label}</div>`;
    })
    .join("");
}

function renderKnowledge() {
  const info = modeInfo[state.mode];
  els.modeTitle.textContent = info.title;
  els.modeSummary.textContent = info.summary;
  els.formulaText.textContent = formulaForCurrent();
}

function render() {
  els.tabs.forEach((tab) => tab.classList.toggle("active", tab.dataset.mode === state.mode));
  const access = state.current;
  const block = access ? access.block : state.selectedBlock;
  els.addressNumber.textContent = `当前地址：B${block}，块内偏移 0`;
  els.cpuTag.textContent = String(tagFor(state.mode, block));
  els.movingToken.textContent = `B${block}`;
  els.stepIndex.textContent = access ? `步骤 ${state.step} / 4` : "步骤 0 / 4";
  els.stepText.textContent = stepText();
  els.prevBtn.disabled = state.history.length === 0;
  els.blockInput.value = String(block);

  renderKnowledge();
  renderMemory();
  renderAddress();
  renderPlacement();
  renderCache();
  renderCompareLines();
  renderJudgeBadge();
  renderStats();
}

function animateToken(block) {
  els.movingToken.textContent = `B${block}`;
  els.movingToken.classList.remove("fly");
  void els.movingToken.offsetWidth;
  els.movingToken.classList.add("fly");
}

els.tabs.forEach((tab) => {
  tab.addEventListener("click", () => switchMode(tab.dataset.mode));
});

els.visitBtn.addEventListener("click", () => {
  saveHistory();
  stopAuto();
  prepareAccess(els.blockInput.value);
  render();
});

els.blockInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter") {
    saveHistory();
    stopAuto();
    prepareAccess(els.blockInput.value);
    render();
  }
});

els.randomBtn.addEventListener("click", () => {
  saveHistory();
  stopAuto();
  prepareAccess(Math.floor(Math.random() * MAIN_BLOCKS));
  render();
});

els.prevBtn.addEventListener("click", prevStep);
els.nextBtn.addEventListener("click", () => {
  stopAuto();
  nextStep();
});
els.autoBtn.addEventListener("click", () => {
  if (state.autoTimer) stopAuto();
  else startAuto();
});
els.resetBtn.addEventListener("click", resetMode);

prepareAccess(0);
render();
