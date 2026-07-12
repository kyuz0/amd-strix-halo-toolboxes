const MODEL_COLORS = ["#2563eb", "#e5484d", "#12a594", "#f59e0b", "#8b5cf6"];
const PROFILE_STYLES = {
    default: { dash: "", marker: "circle" },
    "performance-no-iommu": { dash: "8 5", marker: "square" },
};
const SVG_NS = "http://www.w3.org/2000/svg";

const state = {
    data: null,
    selectedModels: new Set(),
    selectedProfiles: new Set(),
    scaleMode: "absolute",
    tableMetric: "prefill",
};

document.addEventListener("DOMContentLoaded", async () => {
    try {
        const response = await fetch("ryzen-ai-halo-results.json");
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        state.data = await response.json();
        state.selectedModels.add(state.data.models[0]);
        state.data.meta.profiles.forEach((profile) => state.selectedProfiles.add(profile.id));
        bindStaticControls();
        renderHeader();
        renderSelectors();
        renderLegend();
        renderResults();
    } catch (error) {
        console.error("Failed to load Ryzen AI Halo results", error);
        document.getElementById("result-count").textContent = "Failed to load results";
    }
});

function bindStaticControls() {
    document.getElementById("models-all").addEventListener("click", () => {
        state.selectedModels = new Set(state.data.models);
        rerenderSelection();
    });
    document.getElementById("models-none").addEventListener("click", () => {
        state.selectedModels.clear();
        rerenderSelection();
    });
    document.querySelectorAll("button[data-scale]").forEach((button) => {
        button.addEventListener("click", () => {
            if (button.disabled) return;
            state.scaleMode = button.dataset.scale;
            updateControlStates();
            renderResults();
        });
    });
    document.querySelectorAll("button[data-metric]").forEach((button) => {
        button.addEventListener("click", () => {
            state.tableMetric = button.dataset.metric;
            updateControlStates();
            renderTable(selectedPoints());
        });
    });
}

function renderHeader() {
    const { meta, models, points } = state.data;
    const build = meta.builds[0];
    const memory = `${meta.system_memory_gb || 128}GB unified memory`;
    document.getElementById("system-info").textContent =
        `${meta.device} · ${meta.architecture} · ${memory} · llama.cpp ${build?.hash || "unknown"} (${build?.number || "—"})`;
    document.getElementById("result-count").textContent =
        `${models.length} models · ${meta.profiles.length} profile${meta.profiles.length === 1 ? "" : "s"} · ${points.length} measurements`;
}

function renderSelectors() {
    renderModelSelector();
    renderProfileSelector();
    updateControlStates();
}

function renderModelSelector() {
    const selector = document.getElementById("model-selector");
    selector.innerHTML = "";
    state.data.models.forEach((model, index) => {
        const button = document.createElement("button");
        button.type = "button";
        button.className = "model-button";
        button.style.setProperty("--model-color", modelColor(model));
        button.textContent = displayModel(model);
        button.title = model;
        const selected = state.selectedModels.has(model);
        button.setAttribute("aria-pressed", String(selected));
        button.classList.toggle("active", selected);
        button.addEventListener("click", () => {
            if (state.selectedModels.has(model)) state.selectedModels.delete(model);
            else state.selectedModels.add(model);
            rerenderSelection();
        });
        selector.appendChild(button);
    });
}

function renderProfileSelector() {
    const selector = document.getElementById("profile-selector");
    selector.innerHTML = "";
    state.data.meta.profiles.forEach((profile) => {
        const button = document.createElement("button");
        button.type = "button";
        button.className = "profile-button";
        const style = profileStyle(profile.id);
        const sample = document.createElement("span");
        sample.className = "profile-line-sample";
        sample.style.borderTopStyle = style.dash ? "dashed" : "solid";
        const label = document.createElement("span");
        label.textContent = profile.label;
        button.append(sample, label);
        const selected = state.selectedProfiles.has(profile.id);
        button.setAttribute("aria-pressed", String(selected));
        button.classList.toggle("active", selected);
        button.addEventListener("click", () => {
            if (state.selectedProfiles.has(profile.id)) state.selectedProfiles.delete(profile.id);
            else state.selectedProfiles.add(profile.id);
            rerenderSelection();
        });
        selector.appendChild(button);
    });
}

function renderLegend() {
    const legend = document.getElementById("profile-legend");
    legend.innerHTML = "";
    const models = document.createElement("div");
    models.className = "legend-group";
    const modelTitle = document.createElement("strong");
    modelTitle.textContent = "Model colors";
    models.appendChild(modelTitle);
    state.data.models.forEach((model) => {
        const item = document.createElement("span");
        item.className = "compact-legend-item";
        const swatch = document.createElement("i");
        swatch.style.backgroundColor = modelColor(model);
        item.append(swatch, document.createTextNode(displayModel(model)));
        item.addEventListener("mouseenter", () => highlightMatching("model", model, true));
        item.addEventListener("mouseleave", () => highlightMatching("model", model, false));
        models.appendChild(item);
    });

    const profiles = document.createElement("div");
    profiles.className = "legend-group";
    const profileTitle = document.createElement("strong");
    profileTitle.textContent = "Profile styles";
    profiles.appendChild(profileTitle);
    state.data.meta.profiles.forEach((profile) => {
        const item = document.createElement("span");
        item.className = "compact-legend-item";
        const sample = document.createElement("i");
        sample.className = "dash-sample";
        sample.style.borderTopStyle = profileStyle(profile.id).dash ? "dashed" : "solid";
        item.append(sample, document.createTextNode(profile.label));
        item.addEventListener("mouseenter", () => highlightMatching("profile", profile.id, true));
        item.addEventListener("mouseleave", () => highlightMatching("profile", profile.id, false));
        profiles.appendChild(item);
    });
    legend.append(models, profiles);
}

function rerenderSelection() {
    renderModelSelector();
    renderProfileSelector();
    updateControlStates();
    renderResults();
}

function updateControlStates() {
    const hasDefault = state.data.meta.profiles.some((profile) => profile.id === "default");
    const gainButton = document.querySelector('button[data-scale="gain"]');
    gainButton.disabled = !hasDefault;
    gainButton.title = hasDefault ? "" : "Available when Default results are present";
    if (!hasDefault && state.scaleMode === "gain") state.scaleMode = "absolute";
    document.querySelectorAll("button[data-scale]").forEach((button) =>
        button.classList.toggle("active", button.dataset.scale === state.scaleMode)
    );
    document.querySelectorAll("button[data-metric]").forEach((button) =>
        button.classList.toggle("active", button.dataset.metric === state.tableMetric)
    );
}

function selectedPoints() {
    return state.data.points.filter((point) =>
        state.selectedModels.has(point.model) && state.selectedProfiles.has(point.profile)
    );
}

function renderResults() {
    const points = selectedPoints();
    const unit = state.scaleMode === "absolute" ? "tokens/s" : "%";
    document.querySelectorAll(".chart-heading .unit").forEach((element) => { element.textContent = unit; });
    renderConfigSummary(points);
    renderCurve("prefill-chart", "prefill", points);
    renderCurve("generation-chart", "generation", points);
    renderTable(points);
}

function renderConfigSummary(points) {
    const summaries = [];
    state.data.models.filter((model) => state.selectedModels.has(model)).forEach((model) => {
        const point = points.find((candidate) => candidate.model === model);
        if (point) summaries.push(`${displayModel(model)}: ${point.toolbox}, batch ${point.batch.toLocaleString()}, ubatch ${point.ubatch.toLocaleString()}`);
    });
    document.getElementById("model-config").textContent = summaries.join(" · ");
}

function renderCurve(containerId, series, points) {
    const container = document.getElementById(containerId);
    const sourcePoints = points.filter((point) => point.series === series);
    container.innerHTML = "";
    if (!sourcePoints.length) {
        const empty = document.createElement("p");
        empty.className = "empty-state";
        empty.textContent = "Select at least one model and profile.";
        container.appendChild(empty);
        return;
    }

    const transformedSeries = buildSeries(sourcePoints, series);
    if (!transformedSeries.length) {
        container.innerHTML = '<p class="empty-state">This view requires Default and Performance results.</p>';
        return;
    }
    const allPoints = transformedSeries.flatMap((entry) => entry.points);
    const width = 680;
    const height = 370;
    const margin = { top: 22, right: 22, bottom: 58, left: 62 };
    const plotWidth = width - margin.left - margin.right;
    const plotHeight = height - margin.top - margin.bottom;
    const depths = [...new Set(allPoints.map((point) => point.starting_depth))].sort((a, b) => a - b);
    const maxDepth = Math.max(...depths, 1);
    const domain = yDomain(allPoints);
    const x = (value) => margin.left + (value / maxDepth) * plotWidth;
    const y = (value) => margin.top + plotHeight - ((value - domain.min) / (domain.max - domain.min)) * plotHeight;
    const svg = svgElement("svg", {
        viewBox: `0 0 ${width} ${height}`,
        role: "img",
        "aria-label": `${series} throughput curves for selected models and profiles`,
    });

    for (let index = 0; index <= 5; index += 1) {
        const value = domain.min + ((domain.max - domain.min) / 5) * index;
        const ypos = y(value);
        svg.appendChild(svgElement("line", {
            x1: margin.left, y1: ypos, x2: width - margin.right, y2: ypos,
            class: `grid-line${Math.abs(value) < 1e-9 ? " zero-line" : ""}`,
        }));
        const label = svgElement("text", { x: margin.left - 10, y: ypos + 4, class: "axis-label", "text-anchor": "end" });
        label.textContent = formatYAxis(value);
        svg.appendChild(label);
    }
    selectTicks(depths, 9).forEach((depth) => {
        const xpos = x(depth);
        svg.appendChild(svgElement("line", { x1: xpos, y1: margin.top, x2: xpos, y2: margin.top + plotHeight, class: "grid-line vertical" }));
        const label = svgElement("text", { x: xpos, y: margin.top + plotHeight + 22, class: "axis-label", "text-anchor": "middle" });
        label.textContent = formatDepth(depth);
        svg.appendChild(label);
    });
    const axisTitle = svgElement("text", { x: margin.left + plotWidth / 2, y: height - 7, class: "axis-title", "text-anchor": "middle" });
    axisTitle.textContent = "Starting depth (tokens)";
    svg.appendChild(axisTitle);

    const showErrorBars = transformedSeries.length <= 2 && state.scaleMode === "absolute";
    transformedSeries.forEach((entry) => {
        const color = modelColor(entry.model);
        const style = profileStyle(entry.profile);
        const key = `${entry.model}|${entry.profile}`;
        const group = svgElement("g", {
            class: "curve-series",
            "data-series-key": key,
            "data-model": entry.model,
            "data-profile": entry.profile,
        });
        const pathData = entry.points.map((point, index) => `${index ? "L" : "M"} ${x(point.starting_depth)} ${y(point.value)}`).join(" ");
        group.appendChild(svgElement("path", { d: pathData, class: "curve-line", stroke: color, "stroke-dasharray": style.dash }));
        entry.points.forEach((point) => {
            if (showErrorBars && point.error) {
                group.appendChild(svgElement("line", {
                    x1: x(point.starting_depth), y1: y(point.value - point.error),
                    x2: x(point.starting_depth), y2: y(point.value + point.error),
                    class: "error-bar", stroke: color,
                }));
            }
            const marker = createMarker(style.marker, x(point.starting_depth), y(point.value), color);
            const title = svgElement("title");
            title.textContent = `${displayModel(entry.model)} · ${profileLabel(entry.profile)} · depth ${point.starting_depth.toLocaleString()} · ${formatTooltipValue(point.value, point.error)}`;
            marker.appendChild(title);
            group.appendChild(marker);
        });
        group.addEventListener("mouseenter", () => highlightSeries(key, true));
        group.addEventListener("mouseleave", () => highlightSeries(key, false));
        svg.appendChild(group);
    });
    container.appendChild(svg);
}

function buildSeries(points, series) {
    const entries = [];
    state.data.models.filter((model) => state.selectedModels.has(model)).forEach((model) => {
        state.data.meta.profiles.filter((profile) => state.selectedProfiles.has(profile.id)).forEach((profile) => {
            const source = points.filter((point) => point.model === model && point.profile === profile.id).sort((a, b) => a.starting_depth - b.starting_depth);
            if (!source.length) return;
            if (state.scaleMode === "gain") {
                if (profile.id === "default") return;
                const gained = source.map((point) => {
                    const baseline = state.data.points.find((candidate) => candidate.model === model && candidate.profile === "default" && candidate.series === series && candidate.starting_depth === point.starting_depth);
                    if (!baseline) return null;
                    const ratio = point.mean / baseline.mean;
                    return { starting_depth: point.starting_depth, value: (ratio - 1) * 100, error: null };
                }).filter(Boolean);
                if (gained.length) entries.push({ model, profile: profile.id, points: gained });
            } else if (state.scaleMode === "retention") {
                const origin = source.find((point) => point.starting_depth === 0) || source[0];
                entries.push({ model, profile: profile.id, points: source.map((point) => ({
                    starting_depth: point.starting_depth,
                    value: (point.mean / origin.mean) * 100,
                    error: (point.stddev / origin.mean) * 100,
                })) });
            } else {
                entries.push({ model, profile: profile.id, points: source.map((point) => ({
                    starting_depth: point.starting_depth, value: point.mean, error: point.stddev,
                })) });
            }
        });
    });
    return entries;
}

function yDomain(points) {
    const values = points.map((point) => point.value);
    if (state.scaleMode === "absolute") return { min: 0, max: niceMaximum(Math.max(...values)) };
    if (state.scaleMode === "retention") {
        const min = Math.max(0, Math.floor(Math.min(...values) / 10) * 10);
        const max = Math.ceil(Math.max(...values) / 10) * 10;
        return { min: min === max ? min - 10 : min, max: max === min ? max + 10 : max };
    }
    const minValue = Math.min(0, ...values);
    const maxValue = Math.max(0, ...values);
    const padding = Math.max(1, (maxValue - minValue) * 0.08);
    return { min: Math.floor((minValue - padding) / 5) * 5, max: Math.ceil((maxValue + padding) / 5) * 5 };
}

function renderTable(points) {
    const profiles = state.data.meta.profiles.filter((profile) => state.selectedProfiles.has(profile.id));
    const models = state.data.models.filter((model) => state.selectedModels.has(model));
    const metricPoints = points.filter((point) => point.series === state.tableMetric);
    const depths = [...new Set(metricPoints.map((point) => point.starting_depth))].sort((a, b) => a - b);
    const head = document.getElementById("results-head");
    const body = document.getElementById("results-body");
    head.innerHTML = "";
    body.innerHTML = "";
    if (!models.length || !profiles.length) {
        body.innerHTML = '<tr><td class="empty-state">Select at least one model and profile.</td></tr>';
        return;
    }
    const comparisonProfile = profiles.find((profile) => profile.id !== "default");
    const hasDefault = profiles.some((profile) => profile.id === "default");
    const row = document.createElement("tr");
    const headings = ["Starting depth", "Model", ...profiles.map((profile) => profile.label)];
    if (hasDefault && comparisonProfile) headings.push("Change");
    headings.forEach((label) => { const th = document.createElement("th"); th.textContent = label; row.appendChild(th); });
    head.appendChild(row);

    depths.forEach((depth) => {
        models.forEach((model, modelIndex) => {
            const tr = document.createElement("tr");
            if (modelIndex === 0) {
                const depthCell = document.createElement("td");
                depthCell.className = "scenario-cell";
                depthCell.rowSpan = models.length;
                depthCell.innerHTML = `<strong>${depth.toLocaleString()}</strong><small>tokens</small>`;
                tr.appendChild(depthCell);
            }
            const modelCell = document.createElement("td");
            modelCell.className = "table-model";
            const dot = document.createElement("i");
            dot.style.backgroundColor = modelColor(model);
            modelCell.append(dot, document.createTextNode(displayModel(model)));
            tr.appendChild(modelCell);
            profiles.forEach((profile) => {
                const point = findPoint(metricPoints, model, profile.id, depth);
                const td = document.createElement("td");
                td.className = "numeric-cell";
                td.textContent = point ? `${point.mean.toFixed(2)} ± ${point.stddev.toFixed(2)}` : "—";
                tr.appendChild(td);
            });
            if (hasDefault && comparisonProfile) {
                const baseline = findPoint(metricPoints, model, "default", depth);
                const comparison = findPoint(metricPoints, model, comparisonProfile.id, depth);
                const td = document.createElement("td");
                td.className = "delta-cell";
                if (baseline && comparison) {
                    const change = ((comparison.mean / baseline.mean) - 1) * 100;
                    td.textContent = `${change >= 0 ? "+" : ""}${change.toFixed(1)}%`;
                    td.classList.add(change >= 0 ? "positive" : "negative");
                } else td.textContent = "—";
                tr.appendChild(td);
            }
            body.appendChild(tr);
        });
    });
}

function findPoint(points, model, profile, depth) {
    return points.find((point) => point.model === model && point.profile === profile && point.starting_depth === depth);
}

function createMarker(type, cx, cy, color) {
    if (type === "square") {
        return svgElement("rect", { x: cx - 4.3, y: cy - 4.3, width: 8.6, height: 8.6, rx: 1, class: "curve-point", fill: color, tabindex: "0" });
    }
    return svgElement("circle", { cx, cy, r: 4.5, class: "curve-point", fill: color, tabindex: "0" });
}

function highlightSeries(key, enabled) {
    document.querySelectorAll(".curve-chart svg").forEach((svg) => {
        svg.classList.toggle("has-highlight", enabled);
        svg.querySelectorAll(".curve-series").forEach((group) => group.classList.toggle("highlighted", enabled && group.dataset.seriesKey === key));
    });
}

function highlightMatching(field, value, enabled) {
    document.querySelectorAll(".curve-chart svg").forEach((svg) => {
        svg.classList.toggle("has-highlight", enabled);
        svg.querySelectorAll(".curve-series").forEach((group) => group.classList.toggle("highlighted", enabled && group.dataset[field] === value));
    });
}

function svgElement(name, attributes = {}) {
    const element = document.createElementNS(SVG_NS, name);
    Object.entries(attributes).forEach(([key, value]) => element.setAttribute(key, value));
    return element;
}
function selectTicks(values, maximum) {
    if (values.length <= maximum) return values;
    return [...new Set(Array.from({ length: maximum }, (_, index) => values[Math.round(index * (values.length - 1) / (maximum - 1))]))];
}
function modelColor(model) { return MODEL_COLORS[state.data.models.indexOf(model) % MODEL_COLORS.length]; }
function profileStyle(profileId) { return PROFILE_STYLES[profileId] || { dash: "4 4", marker: "square" }; }
function profileLabel(profileId) { return state.data.meta.profiles.find((profile) => profile.id === profileId)?.label || profileId; }
function displayModel(model) { return model.replaceAll("-UD-", " · ").replaceAll("_", " "); }
function niceMaximum(value) {
    if (!value) return 1;
    const target = value * 1.06;
    const magnitude = 10 ** Math.floor(Math.log10(target));
    const normalized = target / magnitude;
    return [1, 1.2, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10].find((step) => step >= normalized) * magnitude;
}
function formatYAxis(value) {
    if (state.scaleMode !== "absolute") return `${value.toFixed(0)}%`;
    if (value >= 1000) return `${(value / 1000).toFixed(value >= 10000 ? 0 : 1)}k`;
    if (value >= 100) return Math.round(value).toLocaleString();
    return value.toFixed(value < 10 ? 1 : 0);
}
function formatTooltipValue(value, error) {
    const suffix = state.scaleMode === "absolute" ? " tokens/s" : "%";
    return `${value.toFixed(2)}${error ? ` ± ${error.toFixed(2)}` : ""}${suffix}`;
}
function formatDepth(value) { return value === 0 ? "0" : `${Math.round(value / 1024)}K`; }
