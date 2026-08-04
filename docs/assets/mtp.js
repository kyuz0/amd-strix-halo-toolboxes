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
        tr.className = "main-row";

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

        // Details row
        const detailsTr = document.createElement("tr");
        detailsTr.className = "details-row hidden";
        const detailsTd = document.createElement("td");
        detailsTd.colSpan = 8;
        
        detailsTd.innerHTML = makeDetailsHTML(row);
        detailsTr.appendChild(detailsTd);

        tr.addEventListener("click", () => {
            tr.classList.toggle("expanded");
            detailsTr.classList.toggle("hidden");
        });

        tbody.appendChild(tr);
        tbody.appendChild(detailsTr);
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

function makeDetailsHTML(row) {
    if (!row.baseline || !row.baseline.results || row.baseline.results.length === 0) {
        return `<div class="granular-wrap"><p style="font-size: 13px; color: var(--muted); margin: 0;">Granular data not available for this run. Re-run benchmarks to capture prompt-level metrics.</p></div>`;
    }
    
    const tasks = new Map();
    const modes = [
        { key: "base", data: row.baseline },
        { key: "mtp2", data: row.mtp2 },
        { key: "mtp3", data: row.mtp3 }
    ];
    
    modes.forEach(mode => {
        if (!mode.data || !mode.data.results) return;
        mode.data.results.forEach(res => {
            if (!tasks.has(res.name)) {
                tasks.set(res.name, { name: res.name });
            }
            const t = tasks.get(res.name);
            t[`${mode.key}_prefill`] = res.prompt_per_second;
            t[`${mode.key}_toks`] = res.predicted_per_second;
            t[`${mode.key}_acc`] = res.accept_rate;
        });
    });
    
    let html = `
    <div class="granular-wrap">
        <table class="granular-table">
            <thead>
                <tr>
                    <th>Prompt Task</th>
                    <th class="num" title="Prefill (Prompt Processing) tok/s (Baseline)">Prefill (Base)</th>
                    <th class="num" title="Prefill tok/s (MTP-2)">Prefill (MTP-2)</th>
                    <th class="num" title="Prefill tok/s (MTP-3)">Prefill (MTP-3)</th>
                    <th class="num" title="Baseline Gen tok/s">Base Gen</th>
                    <th class="num" title="MTP-2 Gen tok/s">MTP-2 Gen</th>
                    <th class="num" title="MTP-2 Accept Rate">Acc%</th>
                    <th class="num" title="MTP-3 Gen tok/s">MTP-3 Gen</th>
                    <th class="num" title="MTP-3 Accept Rate">Acc%</th>
                </tr>
            </thead>
            <tbody>
    `;
    
    tasks.forEach(t => {
        const p_base_val = t.base_prefill;
        const p_mtp2_val = t.mtp2_prefill;
        const p_mtp3_val = t.mtp3_prefill;

        const p_base = p_base_val ? p_base_val.toFixed(1) : "—";
        let p_mtp2 = p_mtp2_val ? p_mtp2_val.toFixed(1) : "—";
        let p_mtp3 = p_mtp3_val ? p_mtp3_val.toFixed(1) : "—";

        if (p_base_val && p_mtp2_val) {
            const pct = ((p_mtp2_val - p_base_val) / p_base_val) * 100;
            const color = pct >= 0 ? '#16a34a' : '#dc2626';
            const sign = pct > 0 ? '+' : '';
            p_mtp2 += ` <span style="font-size: 10px; color: ${color}; margin-left: 4px;">${sign}${pct.toFixed(1)}%</span>`;
        }

        if (p_base_val && p_mtp3_val) {
            const pct = ((p_mtp3_val - p_base_val) / p_base_val) * 100;
            const color = pct >= 0 ? '#16a34a' : '#dc2626';
            const sign = pct > 0 ? '+' : '';
            p_mtp3 += ` <span style="font-size: 10px; color: ${color}; margin-left: 4px;">${sign}${pct.toFixed(1)}%</span>`;
        }

        const g_base = t.base_toks ? t.base_toks.toFixed(1) : "—";
        const g_mtp2 = t.mtp2_toks ? t.mtp2_toks.toFixed(1) : "—";
        const a_mtp2 = t.mtp2_acc !== null && t.mtp2_acc !== undefined ? (t.mtp2_acc * 100).toFixed(1) + "%" : "—";
        const g_mtp3 = t.mtp3_toks ? t.mtp3_toks.toFixed(1) : "—";
        const a_mtp3 = t.mtp3_acc !== null && t.mtp3_acc !== undefined ? (t.mtp3_acc * 100).toFixed(1) + "%" : "—";
        
        html += `
                <tr>
                    <td>${t.name}</td>
                    <td class="num">${p_base}</td>
                    <td class="num">${p_mtp2}</td>
                    <td class="num">${p_mtp3}</td>
                    <td class="num">${g_base}</td>
                    <td class="num">${g_mtp2}</td>
                    <td class="num" style="color: var(--muted);">${a_mtp2}</td>
                    <td class="num">${g_mtp3}</td>
                    <td class="num" style="color: var(--muted);">${a_mtp3}</td>
                </tr>
        `;
    });
    
    html += `
            </tbody>
        </table>
    </div>`;
    
    return html;
}
