document.addEventListener("DOMContentLoaded", async () => {
    const statsLine = document.getElementById("stats-line");
    const table = document.getElementById("mtp-table");
    const tbody = document.getElementById("mtp-tbody");

    try {
        const res = await fetch("mtp-summary.json");
        if (!res.ok) throw new Error("Network response was not ok");
        const data = await res.json();
        
        renderTable(data, tbody);
        table.classList.remove("hidden");
        statsLine.textContent = `Showing ${data.length} benchmark runs`;

    } catch (err) {
        console.error("Failed to load mtp-summary.json", err);
        statsLine.textContent = "Failed to load mtp-summary.json. Ensure the file is present in the docs folder.";
    }
});

function renderTable(runs, tbody) {
    // Group by model and toolbox
    const grouped = new Map();
    
    runs.forEach(run => {
        const key = `${run.model}|${run.toolbox}`;
        if (!grouped.has(key)) {
            grouped.set(key, {
                model: run.model,
                toolbox: run.toolbox,
                baseline: null,
                mtp2: null,
                mtp3: null
            });
        }
        
        const entry = grouped.get(key);
        if (run.mode === "baseline") entry.baseline = run;
        if (run.mode === "mtp-2") entry.mtp2 = run;
        if (run.mode === "mtp-3") entry.mtp3 = run;
    });

    const rows = Array.from(grouped.values()).sort((a, b) => {
        if (a.model !== b.model) return a.model.localeCompare(b.model);
        return a.toolbox.localeCompare(b.toolbox);
    });

    tbody.innerHTML = "";
    
    rows.forEach(row => {
        const tr = document.createElement("tr");

        // Model
        const tdModel = document.createElement("td");
        tdModel.className = "model";
        const modelHead = document.createElement("div");
        modelHead.className = "model-head";
        const nameSpan = document.createElement("span");
        nameSpan.className = "model-name";
        nameSpan.textContent = row.model;
        modelHead.appendChild(nameSpan);
        tdModel.appendChild(modelHead);
        tr.appendChild(tdModel);

        // Toolbox
        const tdToolbox = document.createElement("td");
        const tbPill = document.createElement("span");
        tbPill.className = "toolbox-pill";
        if (row.toolbox.includes("vulkan") || row.toolbox.includes("radv")) {
            tbPill.classList.add("radv");
        }
        tbPill.textContent = row.toolbox;
        tdToolbox.appendChild(tbPill);
        tr.appendChild(tdToolbox);

        // Baseline
        const baseSpeed = row.baseline ? row.baseline.avg_tok_s : null;
        tr.appendChild(makeMetricCell(baseSpeed));

        // MTP-2
        const mtp2Speed = row.mtp2 ? row.mtp2.avg_tok_s : null;
        tr.appendChild(makeMetricCell(mtp2Speed));
        tr.appendChild(makeSpeedupCell(baseSpeed, mtp2Speed));

        // MTP-3
        const mtp3Speed = row.mtp3 ? row.mtp3.avg_tok_s : null;
        tr.appendChild(makeMetricCell(mtp3Speed));
        tr.appendChild(makeSpeedupCell(baseSpeed, mtp3Speed));

        tbody.appendChild(tr);
    });
}

function makeMetricCell(val) {
    const td = document.createElement("td");
    td.className = "metric-col";
    if (val !== null && val !== undefined) {
        td.innerHTML = `<span class="measure">${val.toFixed(1)}</span>`;
    } else {
        td.innerHTML = `<span class="cell-empty">—</span>`;
    }
    return td;
}

function makeSpeedupCell(base, mtp) {
    const td = document.createElement("td");
    td.className = "metric-col";
    
    if (base && mtp && base > 0) {
        const ratio = mtp / base;
        const badge = document.createElement("span");
        badge.className = "speedup-badge";
        badge.textContent = `${ratio.toFixed(2)}×`;
        
        if (ratio >= 1.8) {
            badge.classList.add("speedup-high");
        } else if (ratio >= 1.3) {
            badge.classList.add("speedup-med");
        } else {
            badge.classList.add("speedup-low");
        }
        
        td.appendChild(badge);
    } else {
        td.innerHTML = `<span class="cell-empty">—</span>`;
    }
    return td;
}
