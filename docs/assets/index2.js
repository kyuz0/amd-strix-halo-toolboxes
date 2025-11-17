const DEFAULT_CTX = "default";
const K_SIGMA = 1.0;
const MIN_TOL = 0.25;
const MODEL_COL_WIDTH = 180;
const WINNER_COL_WIDTH = 120;

const state = {
    contexts: [],
    contextMap: new Map(),
    envs: [],
    backendOrder: [],
    columnWidths: {},
    filters: {
        search: "",
        quant: "",
        context: DEFAULT_CTX,
        backends: new Set(),
        sizeLo: null,
        sizeHi: null,
    },
    ui: {},
    sizeStats: { min: Infinity, max: -Infinity },
    draggingEnv: null,
};

document.addEventListener("DOMContentLoaded", async () => {
    cacheUI();
    setupModals();
    try {
        const res = await fetch("results.json");
        const data = await res.json();
        prepareData(data?.runs || []);
        initializeControls();
        renderTables();
    } catch (err) {
        console.error("Failed to load results.json", err);
        state.ui.stats.textContent = "Failed to load results.json";
    }
});

function cacheUI() {
    state.ui = {
        search: document.getElementById("filter-search"),
        quant: document.getElementById("filter-quant"),
        contextChips: document.getElementById("context-chips"),
        backendList: document.getElementById("backend-list"),
        backendAll: document.getElementById("backend-all"),
        backendNone: document.getElementById("backend-none"),
        sizeLo: document.getElementById("sizeLo"),
        sizeHi: document.getElementById("sizeHi"),
        sizeTrack: document.getElementById("sizeTrack"),
        sizeLoVal: document.getElementById("sizeLoVal"),
        sizeHiVal: document.getElementById("sizeHiVal"),
        stats: document.getElementById("stats-line"),
        resetBtn: document.getElementById("reset-layout"),
        tables: document.getElementById("tables"),
        hipblasModalOpen: document.getElementById("hipblas-modal-open"),
        hipblasModal: document.getElementById("hipblas-modal"),
        hipblasModalClose: document.getElementById("hipblas-modal-close"),
        rpcModalOpen: document.getElementById("rpc-modal-open"),
        rpcModal: document.getElementById("rpc-modal"),
        rpcModalClose: document.getElementById("rpc-modal-close"),
        rocwmmaModalOpen: document.getElementById("rocwmma-modal-open"),
        rocwmmaModal: document.getElementById("rocwmma-modal"),
        rocwmmaModalClose: document.getElementById("rocwmma-modal-close"),
        rocwmmaImprModalOpen: document.getElementById("rocwmma-impr-modal-open"),
        rocwmmaImprModal: document.getElementById("rocwmma-impr-modal"),
        rocwmmaImprModalClose: document.getElementById("rocwmma-impr-modal-close"),
    };
}

function setupModals() {
    const modalConfigs = [
        {
            open: state.ui.hipblasModalOpen,
            modal: state.ui.hipblasModal,
            close: state.ui.hipblasModalClose,
        },
        {
            open: state.ui.rpcModalOpen,
            modal: state.ui.rpcModal,
            close: state.ui.rpcModalClose,
        },
        {
            open: state.ui.rocwmmaModalOpen,
            modal: state.ui.rocwmmaModal,
            close: state.ui.rocwmmaModalClose,
        },
        {
            open: state.ui.rocwmmaImprModalOpen,
            modal: state.ui.rocwmmaImprModal,
            close: state.ui.rocwmmaImprModalClose,
        },
    ];

    modalConfigs.forEach(({ open, modal, close }) => {
        if (!open || !modal) return;
        const openModal = () => modal.classList.remove("hidden");
        const closeModal = () => modal.classList.add("hidden");
        open.addEventListener("click", openModal);
        close?.addEventListener("click", closeModal);
        modal.addEventListener("click", (e) => {
            if (e.target === modal) closeModal();
        });
        document.addEventListener("keydown", (e) => {
            if (e.key === "Escape" && !modal.classList.contains("hidden")) {
                closeModal();
            }
        });
    });
}

function prepareData(runs) {
    const contextMap = new Map();
    const envSet = new Set();
    const quantSet = new Set();

    for (const run of runs) {
        const test = normalizeTest(run.test);
        if (!test || !run.env) continue;
        const contextKey = run.context || DEFAULT_CTX;
        const env = run.env;
        envSet.add(env);
        if (run.quant) quantSet.add(run.quant.toUpperCase());

        const ctx = ensureContext(contextMap, contextKey, run.context_tokens);
        const testEntry = ensureTest(ctx, test.original);

        const modelName = run.model_clean || run.model;
        const row = ensureModel(testEntry, modelName, run);
        row.backends[env] = {
            mean: typeof run.tps_mean === "number" ? run.tps_mean : null,
            std: typeof run.tps_std === "number" ? run.tps_std : null,
            error: Boolean(run.error),
            error_type: run.error_type || null,
        };
    }

    state.contextMap = contextMap;
    state.contexts = [...contextMap.values()].sort((a, b) => {
        if (a.key === DEFAULT_CTX) return -1;
        if (b.key === DEFAULT_CTX) return 1;
        if (a.tokens && b.tokens) return a.tokens - b.tokens;
        if (a.tokens) return -1;
        if (b.tokens) return 1;
        return a.key.localeCompare(b.key);
    });
    state.envs = [...envSet].sort();
    state.backendOrder = [...state.envs];
    state.columnWidths = Object.fromEntries(state.envs.map((env) => [env, 120]));
    state.quantOptions = [...quantSet].sort();
    state.filters.context = state.contexts[0]?.key || DEFAULT_CTX;
    state.filters.backends = new Set(state.envs);
}

function ensureContext(map, key, tokens) {
    if (!map.has(key)) {
        map.set(key, {
            key,
            label: formatContextLabel(key, tokens),
            tokens: tokens ?? null,
            tests: new Map(),
        });
    } else if (tokens && !map.get(key).tokens) {
        const ctx = map.get(key);
        ctx.tokens = tokens;
        ctx.label = formatContextLabel(key, tokens);
    }
    return map.get(key);
}

function ensureTest(ctx, testName) {
    if (!ctx.tests.has(testName)) {
        ctx.tests.set(testName, {
            name: testName,
            models: new Map(),
        });
    }
    return ctx.tests.get(testName);
}

function ensureModel(testEntry, modelName, run) {
    if (!testEntry.models.has(modelName)) {
        testEntry.models.set(modelName, {
            model: modelName,
            quant: (run.quant || "Unknown").toUpperCase(),
            sizeB: run.name_params_b ?? run.params_b ?? null,
            backends: {},
            isRpc: Boolean(run.rpc),
            search_blob: [modelName, run.quant, run.env, run.test]
                .filter(Boolean)
                .map((s) => s.toString().toLowerCase())
                .join(" "),
        });
    }
    const row = testEntry.models.get(modelName);
    const sizeCandidate = run.name_params_b ?? run.params_b;
    if (row.sizeB == null && typeof sizeCandidate === "number") {
        row.sizeB = sizeCandidate;
    }
    if (typeof row.sizeB === "number") {
        state.sizeStats.min = Math.min(state.sizeStats.min, row.sizeB);
        state.sizeStats.max = Math.max(state.sizeStats.max, row.sizeB);
    }
    if (run.rpc) {
        row.isRpc = true;
        if (!row.search_blob.includes("rpc")) {
            row.search_blob = `${row.search_blob} rpc`;
        }
    }
    return row;
}

function initializeControls() {
    const { quant, contextChips, backendList, search, resetBtn, sizeLo, sizeHi } = state.ui;

    quant.innerHTML = "";
    const anyOpt = document.createElement("option");
    anyOpt.value = "";
    anyOpt.textContent = "Any";
    quant.appendChild(anyOpt);
    state.quantOptions.forEach((q) => {
        const opt = document.createElement("option");
        opt.value = q;
        opt.textContent = q;
        quant.appendChild(opt);
    });

    contextChips.innerHTML = "";
    state.contexts.forEach((ctx) => {
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "chip" + (ctx.key === state.filters.context ? " active" : "");
        btn.dataset.context = ctx.key;
        btn.textContent = ctx.label;
        contextChips.appendChild(btn);
    });

    renderBackendList();
    setupSizeSlider();

    search.addEventListener("input", (e) => {
        state.filters.search = (e.target.value || "").trim().toLowerCase();
        renderTables();
    });

    quant.addEventListener("change", (e) => {
        state.filters.quant = e.target.value;
        renderTables();
    });

    contextChips.addEventListener("click", (e) => {
        const btn = e.target.closest("button[data-context]");
        if (!btn) return;
        state.filters.context = btn.dataset.context;
        [...contextChips.querySelectorAll("button")].forEach((b) => b.classList.toggle("active", b === btn));
        renderTables();
    });

    backendList.addEventListener("change", (e) => {
        const checkbox = e.target.closest("input[data-env]");
        if (!checkbox) return;
        const env = checkbox.dataset.env;
        if (checkbox.checked) {
            state.filters.backends.add(env);
        } else {
            state.filters.backends.delete(env);
        }
        renderTables();
    });

    state.ui.backendAll.addEventListener("click", () => {
        state.filters.backends = new Set(state.envs);
        renderBackendList();
        renderTables();
    });

    state.ui.backendNone.addEventListener("click", () => {
        state.filters.backends = new Set();
        renderBackendList();
        renderTables();
    });

    sizeLo.addEventListener("input", () => updateSizeUI(true));
    sizeHi.addEventListener("input", () => updateSizeUI(true));

    resetBtn.addEventListener("click", () => {
        state.filters.search = "";
        state.filters.quant = "";
        state.filters.context = state.contexts[0]?.key || DEFAULT_CTX;
        state.filters.backends = new Set(state.envs);
        search.value = "";
        quant.value = "";
        [...contextChips.querySelectorAll("button")].forEach((btn) =>
            btn.classList.toggle("active", btn.dataset.context === state.filters.context)
        );
        renderBackendList();
        setupSizeSlider();
        renderTables();
    });
}

function renderBackendList() {
    const container = state.ui.backendList;
    container.innerHTML = "";
    state.backendOrder.forEach((env) => {
        const label = document.createElement("label");
        label.className = "backend-item";
        const checkbox = document.createElement("input");
        checkbox.type = "checkbox";
        checkbox.dataset.env = env;
        checkbox.checked = state.filters.backends.has(env);
        label.appendChild(checkbox);

        const baseSpan = document.createElement("span");
        const { base, tags } = splitEnvName(env);
        baseSpan.textContent = base;
        label.appendChild(baseSpan);
        tags.forEach((tag) => {
            const pill = document.createElement("span");
            pill.className = "tag";
            pill.textContent = tag;
            const safeTag = tag.replace(/[^a-z0-9]+/gi, "-").toLowerCase();
            pill.classList.add(`tag-${safeTag}`);
            label.appendChild(pill);
        });

        container.appendChild(label);
    });
}

function setupSizeSlider() {
    const { sizeLo, sizeHi } = state.ui;
    const minRaw = state.sizeStats.min === Infinity ? 0 : Math.floor(state.sizeStats.min || 0);
    const maxRaw = state.sizeStats.max === -Infinity ? 0 : Math.ceil(state.sizeStats.max || 0);
    const minB = Math.max(0, minRaw);
    const maxB = Math.max(minB, maxRaw);

    [sizeLo, sizeHi].forEach((inp) => {
        inp.min = minB;
        inp.max = maxB;
        inp.step = 1;
    });

    sizeLo.value = minB;
    sizeHi.value = maxB;
    sizeLo.style.zIndex = 2;
    sizeHi.style.zIndex = 1;
    updateSizeUI(false);
}

function updateSizeUI(triggerRender) {
    const { sizeLo, sizeHi, sizeLoVal, sizeHiVal, sizeTrack } = state.ui;
    if (+sizeLo.value > +sizeHi.value) {
        if (document.activeElement === sizeLo) {
            sizeHi.value = sizeLo.value;
        } else {
            sizeLo.value = sizeHi.value;
        }
    }
    sizeLo.style.zIndex = +sizeLo.value >= +sizeHi.max - 1 ? 4 : 2;
    sizeHi.style.zIndex = +sizeHi.value <= +sizeLo.min + 1 ? 3 : 1;
    state.filters.sizeLo = +sizeLo.value;
    state.filters.sizeHi = +sizeHi.value;
    sizeLoVal.textContent = formatSizeLabel(state.filters.sizeLo);
    sizeHiVal.textContent = formatSizeLabel(state.filters.sizeHi);
    const range = (sizeHi.max - sizeLo.min) || 1;
    const minB = +sizeLo.min;
    const start = ((state.filters.sizeLo - minB) / range) * 100;
    const end = ((state.filters.sizeHi - minB) / range) * 100;
    sizeTrack.style.background = `linear-gradient(to right, #e3e7f1 ${start}%, var(--accent) ${start}%, var(--accent) ${end}%, #e3e7f1 ${end}%)`;
    if (triggerRender) renderTables();
}

function renderTables() {
    const ctx = state.contextMap.get(state.filters.context);
    if (!ctx) {
        state.ui.tables.innerHTML = "<p>No data for this context.</p>";
        state.ui.stats.textContent = "0 rows";
        return;
    }

    const backendList = state.backendOrder.filter((env) => state.filters.backends.has(env));
    const tests = [...ctx.tests.values()].sort((a, b) => a.name.localeCompare(b.name));
    const frag = document.createDocumentFragment();
    let totalRows = 0;

    for (const test of tests) {
        const models = filterModels(test.models);
        if (!models.length) continue;
        totalRows += models.length;
        const block = document.createElement("div");
        block.className = "test-block";
        const heading = document.createElement("h2");
        heading.textContent = `${test.name.toUpperCase()} — tokens/second`;
        block.appendChild(heading);

        const tableWrap = document.createElement("div");
        tableWrap.className = "table-wrap";
        const scroller = document.createElement("div");
        scroller.className = "table-scroll";

        const modelsWithWinners = models.map((model) => {
            const winners = computeWinners(model, backendList);
            return { ...model, _cachedWinners: winners };
        });

        const table = buildSingleTable(modelsWithWinners, backendList);
        scroller.appendChild(table);
        tableWrap.appendChild(scroller);
        block.appendChild(tableWrap);
        setupResizeOverlay(scroller, backendList, table);
        frag.appendChild(block);
    }

    state.ui.tables.innerHTML = "";
    if (frag.childNodes.length) {
        state.ui.tables.appendChild(frag);
    } else {
        state.ui.tables.innerHTML = "<p>No models match the current filters.</p>";
    }
    state.ui.stats.textContent = `Showing ${totalRows.toLocaleString()} model rows across ${backendList.length} backends`;
}

function buildSingleTable(models, backendList) {
    const table = document.createElement("table");
    const colgroup = document.createElement("colgroup");
    const colModel = document.createElement("col");
    colModel.style.width = `${MODEL_COL_WIDTH}px`;
    colgroup.appendChild(colModel);
    const colWinner = document.createElement("col");
    colWinner.style.width = `${WINNER_COL_WIDTH}px`;
    colgroup.appendChild(colWinner);
    backendList.forEach((env) => {
        const col = document.createElement("col");
        col.style.width = `${state.columnWidths[env] || 120}px`;
        col.dataset.env = env;
        colgroup.appendChild(col);
    });
    table.appendChild(colgroup);

    const thead = document.createElement("thead");
    const headRow = document.createElement("tr");
    headRow.appendChild(makeHeaderCell("Model", "model"));
    headRow.appendChild(makeHeaderCell("Winner", "winner"));
    backendList.forEach((env) => {
        const th = makeHeaderCell(env, "backend-header");
        attachHeaderInteractions(th, env);
        headRow.appendChild(th);
    });
    thead.appendChild(headRow);
    table.appendChild(thead);

    const tbody = document.createElement("tbody");
    models.forEach((model) => {
        const tr = document.createElement("tr");
        const tdModel = document.createElement("td");
        tdModel.className = "model";
        const head = document.createElement("div");
        head.className = "model-head";
        const nameSpan = document.createElement("span");
        nameSpan.className = "model-name";
        nameSpan.textContent = model.model;
        head.appendChild(nameSpan);
        if (model.isRpc) {
            const pill = document.createElement("span");
            pill.className = "model-pill model-pill-rpc";
            pill.title = "Run executed via llama.cpp RPC across two servers";
            pill.textContent = "RPC · dual server";
            head.appendChild(pill);
        }
        tdModel.appendChild(head);
        const meta = document.createElement("div");
        meta.className = "meta";
        meta.textContent = `${model.quant} · ${formatSize(model.sizeB)}`;
        tdModel.appendChild(meta);

        const actionWrap = document.createElement("div");
        actionWrap.className = "row-actions";
        const btnDesc = document.createElement("button");
        btnDesc.type = "button";
        btnDesc.className = "row-action-btn";
        btnDesc.textContent = "Sort ↓";
        btnDesc.addEventListener("click", (e) => {
            e.preventDefault();
            sortBackendsByModel(model, "desc");
        });
        const btnAsc = document.createElement("button");
        btnAsc.type = "button";
        btnAsc.className = "row-action-btn";
        btnAsc.textContent = "Sort ↑";
        btnAsc.addEventListener("click", (e) => {
            e.preventDefault();
            sortBackendsByModel(model, "asc");
        });
        actionWrap.appendChild(btnDesc);
        actionWrap.appendChild(btnAsc);
        tdModel.appendChild(actionWrap);
        tr.appendChild(tdModel);

        const tdWinner = document.createElement("td");
        tdWinner.className = "winner";
        if (model._cachedWinners.length) {
            const wrap = document.createElement("div");
            wrap.className = "winner-list";
            wrap.innerHTML = model._cachedWinners.map((w) => `<span class="winner-pill">${w}</span>`).join("");
            tdWinner.appendChild(wrap);
        } else {
            tdWinner.innerHTML = `<span class="cell-empty">—</span>`;
        }

        tr.appendChild(tdWinner);

        backendList.forEach((env) => {
            const td = document.createElement("td");
            td.className = "data-cell";
            td.dataset.env = env;
            const cell = model.backends[env];
            if (!cell) {
                td.innerHTML = `<span class="cell-empty">—</span>`;
            } else if (cell.error || cell.mean == null) {
                td.innerHTML = `<span class="cell-error">⚠ ${cell.error_type || "error"}</span>`;
            } else {
                const isBest = model._cachedWinners.includes(env);
                if (isBest) td.classList.add("best");
                td.innerHTML = `<div class="measure">${cell.mean.toFixed(2)}</div><div class="std">± ${cell.std?.toFixed(2) ?? "—"}</div>`;
            }
            tr.appendChild(td);
        });
        tbody.appendChild(tr);
    });
    table.appendChild(tbody);
    return table;
}

function makeHeaderCell(label, extra = "") {
    const th = document.createElement("th");
    th.textContent = label;
    if (extra) th.className = extra;
    return th;
}

function attachHeaderInteractions(th, env) {
    const width = state.columnWidths[env] || 120;
    th.style.width = `${width}px`;
    th.style.minWidth = `${width}px`;
    th.draggable = true;
    th.addEventListener("dragstart", (e) => {
        state.draggingEnv = env;
        th.classList.add("dragging");
        e.dataTransfer.effectAllowed = "move";
    });
    th.addEventListener("dragend", () => {
        state.draggingEnv = null;
        th.classList.remove("dragging");
        document.querySelectorAll("th.backend-header.drop-target").forEach((el) => el.classList.remove("drop-target"));
    });
    th.addEventListener("dragover", (e) => {
        if (!state.draggingEnv || state.draggingEnv === env) return;
        e.preventDefault();
        th.classList.add("drop-target");
    });
    th.addEventListener("dragleave", () => th.classList.remove("drop-target"));
    th.addEventListener("drop", (e) => {
        if (!state.draggingEnv || state.draggingEnv === env) return;
        e.preventDefault();
        moveBackend(state.draggingEnv, env);
        th.classList.remove("drop-target");
    });

    const handle = document.createElement("span");
    handle.className = "resize-handle";
    handle.addEventListener("mousedown", (e) => startResize(e, env));
    th.appendChild(handle);
}

function moveBackend(from, to) {
    const order = state.backendOrder;
    const fromIdx = order.indexOf(from);
    const toIdx = order.indexOf(to);
    if (fromIdx === -1 || toIdx === -1) return;
    const [col] = order.splice(fromIdx, 1);
    order.splice(toIdx, 0, col);
    renderBackendList();
    renderTables();
}

function filterModels(modelsMap) {
    const models = [];
    for (const model of modelsMap.values()) {
        if (state.filters.search && !model.search_blob.includes(state.filters.search)) continue;
        if (state.filters.quant && model.quant !== state.filters.quant) continue;
        if (model.sizeB != null) {
            if (state.filters.sizeLo != null && model.sizeB < state.filters.sizeLo - 1e-6) continue;
            if (state.filters.sizeHi != null && model.sizeB > state.filters.sizeHi + 1e-6) continue;
        }
        models.push(model);
    }
    models.sort((a, b) => a.model.localeCompare(b.model));
    return models;
}

function computeWinners(model, backends) {
    const values = [];
    backends.forEach((env) => {
        const entry = model.backends[env];
        if (entry && !entry.error && typeof entry.mean === "number") {
            values.push({
                env,
                mean: entry.mean,
                std: typeof entry.std === "number" ? entry.std : 0,
            });
        }
    });
    if (!values.length) return [];
    let best = values[0];
    for (const v of values) if (v.mean > best.mean) best = v;
    const winners = [];
    for (const v of values) {
        const pooled = Math.sqrt((best.std || 0) ** 2 + (v.std || 0) ** 2);
        const tol = Math.max(MIN_TOL, K_SIGMA * pooled);
        if ((best.mean - v.mean) <= tol) winners.push(v.env);
    }
    return winners;
}

function normalizeTest(name) {
    if (!name) return null;
    return { key: name.toLowerCase(), original: name };
}

function formatContextLabel(key, tokens) {
    if (key === DEFAULT_CTX) return "Default window";
    if (tokens) return `ctx ${tokens.toLocaleString()}`;
    return key;
}

function formatSize(size) {
    if (size == null) return "—";
    return `${Number(size).toFixed(1)}B`;
}

function formatSizeLabel(size) {
    if (size >= 1000) return `${(size / 1000).toFixed(1)}kB`;
    return `${Math.round(size)}B`;
}

function sortBackendsByModel(model, direction) {
    const dir = direction === "asc" ? 1 : -1;
    const order = [...state.backendOrder].sort((a, b) => {
        const va = backendValue(model.backends[a], direction);
        const vb = backendValue(model.backends[b], direction);
        if (va === vb) return a.localeCompare(b);
        return (va - vb) * dir;
    });
    state.backendOrder = order;
    renderBackendList();
    renderTables();
}

function backendValue(entry, direction) {
    if (!entry || entry.error || typeof entry.mean !== "number") {
        return direction === "asc" ? Number.POSITIVE_INFINITY : Number.NEGATIVE_INFINITY;
    }
    return entry.mean;
}

function splitEnvName(env) {
    const canonical = env.replace(/_/g, ".");
    const tagRegex = /-(rocwmma-improved|rocwmma|improved|hblt0)/gi;
    const tags = [];
    let match;
    while ((match = tagRegex.exec(canonical)) !== null) {
        tags.push(match[1].toLowerCase());
    }
    const base = canonical.replace(tagRegex, "");
    return { base, tags };
}

function startResize(event, env) {
    event.preventDefault();
    event.stopPropagation();
    const column = state.columnWidths[env] || 120;
    const startX = event.clientX;
    const shellRect = state.ui.tables.getBoundingClientRect();
    const guide = document.createElement("div");
    guide.className = "resize-line";
    guide.style.position = "fixed";
    guide.style.top = `${shellRect.top}px`;
    guide.style.bottom = `${window.innerHeight - shellRect.bottom}px`;
    guide.style.left = `${startX}px`;
    guide.style.width = "2px";
    guide.style.background = "var(--accent)";
    guide.style.zIndex = "10";
    document.body.appendChild(guide);
    let nextWidth = column;

    const onMove = (e) => {
        const delta = e.clientX - startX;
        nextWidth = Math.max(80, column + delta);
        guide.style.left = `${e.clientX}px`;
    };

    const onUp = () => {
        document.removeEventListener("mousemove", onMove);
        document.removeEventListener("mouseup", onUp);
        guide.remove();
        state.columnWidths[env] = nextWidth;
        renderTables();
    };

    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
}

function setupResizeOverlay(tableWrap, backendList, table) {
    let overlay = tableWrap.querySelector(".resize-overlay");
    if (!overlay) {
        overlay = document.createElement("div");
        overlay.className = "resize-overlay";
        tableWrap.appendChild(overlay);
    } else {
        overlay.innerHTML = "";
    }

    overlay.style.width = `${tableWrap.clientWidth}px`;
    overlay.style.height = `${table.offsetHeight}px`;

    const bars = [];
    let offset = MODEL_COL_WIDTH + WINNER_COL_WIDTH;
    backendList.forEach((env) => {
        const width = state.columnWidths[env] || 120;
        const bar = document.createElement("div");
        bar.className = "resize-bar";
        bar.dataset.env = env;
        bar.addEventListener("mousedown", (e) => startResize(e, env));
        overlay.appendChild(bar);
        bars.push({ bar, offset, width, env });
        offset += width;
    });

    const positionBars = () => {
        bars.forEach(({ bar, offset, width }) => {
            const left = offset + width - 3 - tableWrap.scrollLeft;
            bar.style.left = `${left}px`;
        });
    };
    positionBars();

    if (tableWrap._overlayScroll) {
        tableWrap.removeEventListener("scroll", tableWrap._overlayScroll);
    }
    const onScroll = () => positionBars();
    tableWrap.addEventListener("scroll", onScroll);
    tableWrap._overlayScroll = onScroll;

    if (tableWrap._overlayResize) {
        tableWrap._overlayResize.disconnect();
    }
    const resizeObserver = new ResizeObserver(() => {
        overlay.style.width = `${tableWrap.clientWidth}px`;
        overlay.style.height = `${table.offsetHeight}px`;
        positionBars();
    });
    resizeObserver.observe(tableWrap);
    tableWrap._overlayResize = resizeObserver;
}
