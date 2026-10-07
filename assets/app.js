/* Pipeline Truth: all analysis runs in the browser. */
(function () {
  'use strict';
  const $ = (s) => document.querySelector(s);
  const DAY = 86400000;

  // ---------- field definitions ----------
  const FIELDS = [
    { key: 'stage', label: 'Stage', required: true, syn: ['stage', 'opportunity stage', 'deal stage', 'stagename', 'stage name'] },
    { key: 'amount', label: 'Amount', required: true, syn: ['amount', 'opportunity amount', 'amount converted', 'amount (converted)', 'deal value', 'value', 'total amount', 'arr', 'acv'] },
    { key: 'close', label: 'Close Date', required: true, syn: ['close date', 'closedate', 'expected close date', 'close'] },
    { key: 'owner', label: 'Opportunity Owner', syn: ['opportunity owner', 'owner', 'owner name', 'owner full name', 'deal owner', 'account executive', 'sales rep'] },
    { key: 'name', label: 'Opportunity Name', syn: ['opportunity name', 'opportunity', 'deal name', 'name'] },
    { key: 'account', label: 'Account Name', syn: ['account name', 'account', 'company', 'company name'] },
    { key: 'nextStep', label: 'Next Step', syn: ['next step', 'nextstep', 'next steps'] },
    { key: 'lastActivity', label: 'Last Activity', syn: ['last activity', 'last activity date', 'lastactivitydate'] },
    { key: 'stageDuration', label: 'Stage Duration (days)', syn: ['stage duration', 'days in stage', 'time in stage', 'days in current stage'] },
    { key: 'lastStageChange', label: 'Last Stage Change Date', syn: ['last stage change date', 'laststagechangedate', 'stage change date'] },
    { key: 'forecast', label: 'Forecast Category', syn: ['forecast category', 'forecastcategory', 'forecast category name', 'forecastcategoryname'] },
    { key: 'probability', label: 'Probability (%)', syn: ['probability (%)', 'probability', 'win probability'] },
    { key: 'created', label: 'Created Date', syn: ['created date', 'createddate', 'create date', 'opportunity created date'] }
  ];

  const CHECKS = [
    { id: 'pastClose', label: 'Close date already passed', short: 'Past close date', needs: ['close'],
      fix: 'Update the close date or close the deal out.' },
    { id: 'noNextStep', label: 'No next step recorded', short: 'No next step', needs: ['nextStep'],
      fix: 'Agree and log a dated next step.' },
    { id: 'noActivity', label: 'No logged activity recently', short: 'No recent activity', needs: ['lastActivity'],
      fix: 'Log the last touch or re-engage the buyer.' },
    { id: 'stuck', label: 'Stuck in the same stage', short: 'Stuck in stage', needs: ['stageDuration|lastStageChange'],
      fix: 'Confirm what is blocking the move to the next stage.' },
    { id: 'noAmount', label: 'Amount missing or zero', short: 'No amount', needs: ['amount'],
      fix: 'Add a realistic amount so the deal counts in the forecast.' }
  ];

  const state = {
    rows: [], headers: [], mapping: {}, closed: new Set(), stagesSeen: [], source: null, fileName: '',
    settings: { asOf: todayISO(), staleDays: 30, stuckDays: 45, dateFmt: 'auto', currency: '$' },
    detectedFmt: null, result: null
  };

  // ---------- helpers ----------
  function todayISO() { const d = new Date(); return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
  function pad(n) { return String(n).padStart(2, '0'); }
  function norm(s) { return String(s || '').toLowerCase().replace(/[^a-z0-9%()]+/g, ' ').trim(); }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
  function isoToDate(iso) { const [y, m, d] = iso.split('-').map(Number); return new Date(y, m - 1, d); }
  function val(row, key) { const h = state.mapping[key]; return h ? String(row[h] == null ? '' : row[h]).trim() : ''; }
  function has(key) { return !!state.mapping[key]; }

  function parseAmount(s) {
    if (s == null) return NaN;
    let t = String(s).replace(/[^\d.,\-]/g, '');
    if (!t) return NaN;
    const lc = t.lastIndexOf(','), ld = t.lastIndexOf('.');
    if (lc > -1 && ld > -1) {
      if (lc > ld) t = t.replace(/\./g, '').replace(',', '.'); else t = t.replace(/,/g, '');
    } else if (lc > -1) {
      const after = t.length - lc - 1;
      t = (after === 3 && t.split(',').length >= 2) ? t.replace(/,/g, '') : t.replace(',', '.');
    }
    return parseFloat(t);
  }

  function splitDate(s) {
    s = String(s || '').trim();
    if (!s) return null;
    s = s.split(/[ T]/)[0];
    const m = s.match(/^(\d{1,4})[\/.\-](\d{1,2})[\/.\-](\d{1,4})$/);
    return m ? [m[1], m[2], m[3]] : null;
  }
  function detectDateFormat(samples) {
    let first12 = false, second12 = false, iso = 0, n = 0;
    for (const s of samples) {
      const p = splitDate(s); if (!p) continue; n++;
      if (p[0].length === 4) { iso++; continue; }
      if (+p[0] > 12) first12 = true;
      if (+p[1] > 12) second12 = true;
    }
    if (n && iso === n) return { fmt: 'ymd', sure: true };
    if (first12 && !second12) return { fmt: 'dmy', sure: true };
    if (second12 && !first12) return { fmt: 'mdy', sure: true };
    return { fmt: 'mdy', sure: false };
  }
  function parseDate(s, fmt) {
    const p = splitDate(s); if (!p) return null;
    let y, m, d;
    if (p[0].length === 4) { y = +p[0]; m = +p[1]; d = +p[2]; }
    else if (fmt === 'dmy') { d = +p[0]; m = +p[1]; y = +p[2]; }
    else { m = +p[0]; d = +p[1]; y = +p[2]; }
    if (y < 100) y += 2000;
    if (!(m >= 1 && m <= 12 && d >= 1 && d <= 31)) return null;
    const dt = new Date(y, m - 1, d);
    return isNaN(dt) ? null : dt;
  }

  function money(v) {
    const sym = state.settings.currency;
    if (!isFinite(v)) return '–';
    const s = new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: v >= 1e6 ? 2 : 1 }).format(v);
    return sym + s;
  }
  function pct(a, b) { return b > 0 ? (100 * a) / b : 0; }
  function pctStr(x) { return (Math.round(x * 10) / 10).toFixed(x >= 10 || x === 0 ? 0 : 1) + '%'; }
  function tone(p) { return p >= 40 ? 'bad' : p >= 20 ? 'warn' : 'good'; }

  // ---------- loading ----------
  function autoMap(headers) {
    const m = {};
    const used = new Set();
    const nh = headers.map((h) => ({ h, n: norm(h) }));
    FIELDS.forEach((f) => {
      const syn = f.syn.map(norm);
      let hit = nh.find((x) => !used.has(x.h) && syn.includes(x.n));
      if (!hit && f.key !== 'name') hit = nh.find((x) => !used.has(x.h) && syn.some((s) => s.length > 4 && x.n.includes(s)));
      if (hit) { m[f.key] = hit.h; used.add(hit.h); }
    });
    return m;
  }

  function load(headers, rows, source, fileName) {
    state.headers = headers;
    state.mapping = autoMap(headers);
    state.source = source;
    state.fileName = fileName;
    state.rows = rows;
    state.settings.currency = source === 'demo' ? '$' : guessCurrency(rows);
    refreshStages(true);
    detectFmt();
    renderSetup();
    run();
    $('#setup').classList.remove('hidden');
    $('#results').classList.remove('hidden');
    $('#results').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function guessCurrency(rows) {
    const h = state.mapping.amount; if (!h) return '$';
    const sample = rows.slice(0, 200).map((r) => String(r[h] || '')).join(' ');
    if (/€|\bEUR\b/.test(sample)) return '€';
    if (/£|\bGBP\b/.test(sample)) return '£';
    if (/₹|\bINR\b/.test(sample)) return '₹';
    return '$';
  }

  function detectFmt() {
    const samples = [];
    ['close', 'created', 'lastActivity', 'lastStageChange'].forEach((k) => {
      if (has(k)) state.rows.slice(0, 400).forEach((r) => samples.push(val(r, k)));
    });
    state.detectedFmt = detectDateFormat(samples);
  }
  function dateFmt() { return state.settings.dateFmt === 'auto' ? state.detectedFmt.fmt : state.settings.dateFmt; }

  function refreshStages(resetClosed) {
    const seen = new Map();
    state.rows.forEach((r) => {
      const s = val(r, 'stage'); if (!s) return;
      const p = parseFloat(val(r, 'probability'));
      const e = seen.get(s) || { name: s, n: 0, pSum: 0, pN: 0, first: seen.size };
      e.n++; if (isFinite(p)) { e.pSum += p; e.pN++; }
      seen.set(s, e);
    });
    const list = [...seen.values()];
    list.sort((a, b) => {
      const pa = a.pN ? a.pSum / a.pN : null, pb = b.pN ? b.pSum / b.pN : null;
      if (pa != null && pb != null && pa !== pb) return pa - pb;
      return a.first - b.first;
    });
    state.stagesSeen = list.map((x) => x.name);
    if (resetClosed) {
      state.closed = new Set(state.stagesSeen.filter((s) => /closed|won|lost|disqualif|dead/i.test(s)));
    }
  }

  function handleFile(file) {
    if (!file) return;
    if (file.size > 40 * 1024 * 1024) { alert('That file is over 40 MB. Try exporting only open opportunities.'); return; }
    Papa.parse(file, {
      header: true, skipEmptyLines: 'greedy',
      transformHeader: (h) => h.replace(/^﻿/, '').trim(),
      complete: (res) => {
        const headers = (res.meta.fields || []).filter(Boolean);
        if (!headers.length || !res.data.length) { alert('Could not read any rows from that file. Is it a CSV export?'); return; }
        load(headers, res.data, 'upload', file.name);
      },
      error: (err) => alert('Could not read the file: ' + err.message)
    });
  }

  // ---------- analysis ----------
  function analyze() {
    const s = state.settings, fmt = dateFmt();
    const asOf = isoToDate(s.asOf);
    const measured = {
      pastClose: has('close'), noNextStep: has('nextStep'), noActivity: has('lastActivity'),
      stuck: has('stageDuration') || has('lastStageChange'), noAmount: has('amount')
    };
    const deals = [];
    let skipped = 0, closedCount = 0, badDates = 0;

    state.rows.forEach((r) => {
      const stage = val(r, 'stage');
      if (!stage) { skipped++; return; }
      if (state.closed.has(stage)) { closedCount++; return; }
      const amount = parseAmount(val(r, 'amount'));
      const close = parseDate(val(r, 'close'), fmt);
      if (val(r, 'close') && !close) badDates++;
      const d = {
        name: val(r, 'name') || val(r, 'account') || '(unnamed)', account: val(r, 'account'),
        owner: val(r, 'owner') || '(no owner)', stage, amount: isFinite(amount) ? amount : 0,
        close, forecast: val(r, 'forecast'), prob: parseFloat(val(r, 'probability')), flags: [], overdue: 0,
        inactiveDays: null, daysInStage: null
      };
      if (measured.pastClose && close && close < asOf) {
        d.overdue = Math.round((asOf - close) / DAY);
        d.flags.push('pastClose');
      }
      if (measured.noNextStep && !val(r, 'nextStep')) d.flags.push('noNextStep');
      if (measured.noActivity) {
        const la = parseDate(val(r, 'lastActivity'), fmt);
        if (!la) { d.inactiveDays = Infinity; d.flags.push('noActivity'); }
        else { d.inactiveDays = Math.round((asOf - la) / DAY); if (d.inactiveDays > s.staleDays) d.flags.push('noActivity'); }
      }
      if (measured.stuck) {
        let dis = null;
        if (has('stageDuration')) { const x = parseFloat(val(r, 'stageDuration')); if (isFinite(x)) dis = x; }
        if (dis == null && has('lastStageChange')) { const lc = parseDate(val(r, 'lastStageChange'), fmt); if (lc) dis = Math.round((asOf - lc) / DAY); }
        d.daysInStage = dis;
        if (dis != null && dis > s.stuckDays) d.flags.push('stuck');
      }
      if (!(d.amount > 0)) d.flags.push('noAmount');
      deals.push(d);
    });

    const totalValue = deals.reduce((a, d) => a + d.amount, 0);
    const flagged = deals.filter((d) => d.flags.length);
    const flaggedValue = flagged.reduce((a, d) => a + d.amount, 0);
    const cleanValue = totalValue - flaggedValue;
    const score = totalValue > 0 ? Math.round(pct(cleanValue, totalValue)) : (deals.length ? Math.round(pct(deals.length - flagged.length, deals.length)) : 0);

    const byCheck = CHECKS.map((c) => {
      const hit = deals.filter((d) => d.flags.includes(c.id));
      return { id: c.id, label: c.label, measured: measured[c.id], deals: hit.length, value: hit.reduce((a, d) => a + d.amount, 0) };
    });

    const buckets = [['1–7 days', 1, 7], ['8–30 days', 8, 30], ['31–90 days', 31, 90], ['90+ days', 91, Infinity]].map(([label, lo, hi]) => {
      const hit = deals.filter((d) => d.overdue >= lo && d.overdue <= hi);
      return { label, deals: hit.length, value: hit.reduce((a, d) => a + d.amount, 0) };
    });

    function group(keyFn) {
      const m = new Map();
      deals.forEach((d) => {
        const k = keyFn(d);
        const g = m.get(k) || { key: k, deals: 0, value: 0, flaggedDeals: 0, flaggedValue: 0, dis: [], issues: {} };
        g.deals++; g.value += d.amount;
        if (d.flags.length) { g.flaggedDeals++; g.flaggedValue += d.amount; }
        if (d.daysInStage != null) g.dis.push(d.daysInStage);
        d.flags.forEach((f) => { g.issues[f] = (g.issues[f] || 0) + 1; });
        m.set(k, g);
      });
      return [...m.values()].map((g) => {
        const top = Object.entries(g.issues).sort((a, b) => b[1] - a[1])[0];
        const sorted = g.dis.slice().sort((a, b) => a - b);
        return Object.assign(g, {
          flaggedPct: g.value > 0 ? pct(g.flaggedValue, g.value) : pct(g.flaggedDeals, g.deals),
          topIssue: top ? top[0] : null, topIssueN: top ? top[1] : 0,
          medianDays: sorted.length ? sorted[Math.floor(sorted.length / 2)] : null
        });
      });
    }
    const stageOrder = state.stagesSeen;
    const byStage = group((d) => d.stage).sort((a, b) => stageOrder.indexOf(a.key) - stageOrder.indexOf(b.key));
    const byOwner = group((d) => d.owner).sort((a, b) => b.flaggedValue - a.flaggedValue);

    // forecast exposure
    let forecast = null;
    if (has('forecast')) {
      const cats = ['commit', 'best case'];
      forecast = { basis: 'category', rows: cats.map((c) => {
        const hit = deals.filter((d) => d.forecast.toLowerCase() === c);
        const fl = hit.filter((d) => d.flags.length);
        return { label: c === 'commit' ? 'Commit' : 'Best Case', deals: hit.length, value: hit.reduce((a, d) => a + d.amount, 0), flaggedDeals: fl.length, flaggedValue: fl.reduce((a, d) => a + d.amount, 0) };
      }) };
      if (!forecast.rows.some((r) => r.deals)) forecast = null;
    }
    if (!forecast && has('probability')) {
      const hit = deals.filter((d) => d.prob >= 50);
      const fl = hit.filter((d) => d.flags.length);
      forecast = { basis: 'probability', rows: [{ label: 'Probability ≥ 50%', deals: hit.length, value: hit.reduce((a, d) => a + d.amount, 0), flaggedDeals: fl.length, flaggedValue: fl.reduce((a, d) => a + d.amount, 0) }] };
    }

    return {
      asOf: s.asOf, deals, totalValue, flagged, flaggedValue, cleanValue, score, byCheck, buckets, byStage, byOwner, forecast,
      measured, skipped, closedCount, badDates,
      measuredCount: Object.values(measured).filter(Boolean).length
    };
  }

  // ---------- rendering ----------
  function renderSetup() {
    const meta = state.source === 'demo'
      ? 'Synthetic demo pipeline: ' + state.rows.length + ' rows, generated in your browser'
      : esc(state.fileName) + ' · ' + state.rows.length.toLocaleString() + ' rows · ' + state.headers.length + ' columns';
    $('#file-meta').innerHTML = meta;
    $('#demo-flag').classList.toggle('hidden', state.source !== 'demo');

    const opts = (sel) => '<option value="">Not in file</option>' + state.headers.map((h) => `<option value="${esc(h)}"${h === sel ? ' selected' : ''}>${esc(h)}</option>`).join('');
    $('#map-table').innerHTML = FIELDS.map((f) => `<tr><td>${esc(f.label)}${f.required ? ' <span class="req" title="required">*</span>' : ''}</td><td><select data-field="${f.key}" aria-label="${esc(f.label)} column">${opts(state.mapping[f.key])}</select></td></tr>`).join('');

    $('#as-of').value = state.settings.asOf;
    $('#stale-days').value = state.settings.staleDays;
    $('#stuck-days').value = state.settings.stuckDays;
    $('#date-fmt').value = state.settings.dateFmt;
    $('#currency').value = state.settings.currency;
    renderStageChips();
    renderNotices();
  }

  function renderStageChips() {
    $('#stage-chips').innerHTML = state.stagesSeen.length
      ? state.stagesSeen.map((s) => `<button type="button" class="chip" data-stage="${esc(s)}" aria-pressed="${state.closed.has(s)}">${esc(s)}</button>`).join('')
      : '<span class="small muted">Map the Stage column to see stages.</span>';
  }

  function renderNotices() {
    const n = [];
    const missing = FIELDS.filter((f) => f.required && !state.mapping[f.key]).map((f) => f.label);
    if (missing.length) n.push(`<div class="notice bad">Required column not found: <b>${missing.join(', ')}</b>. Pick it in the mapping below.</div>`);
    if (state.detectedFmt && !state.detectedFmt.sure && state.settings.dateFmt === 'auto') {
      n.push('<div class="notice warn">Every date in this file could be read as either MM/DD or DD/MM. I\'ve assumed <b>MM/DD/YYYY</b> (the US default). If your Salesforce locale is European, switch "Date format" to DD/MM/YYYY.</div>');
    }
    if (state.result && state.result.badDates) n.push(`<div class="notice warn">${state.result.badDates} close dates couldn't be read. Check the date format setting.</div>`);
    $('#setup-notices').innerHTML = n.join('');
  }

  function run() {
    const ready = ['stage', 'amount', 'close'].every(has);
    if (!ready) { state.result = null; renderNotices(); $('#results').classList.add('hidden'); return; }
    $('#results').classList.remove('hidden');
    state.result = analyze();
    renderNotices();
    renderResults(state.result);
  }

  const CHECK_BY_ID = Object.fromEntries(CHECKS.map((c) => [c.id, c]));

  function renderResults(r) {
    $('#results-meta').textContent = `${r.deals.length.toLocaleString()} open deal${r.deals.length === 1 ? '' : 's'} ·${money(r.totalValue)} open pipeline · measured as of ${r.asOf}` + (r.closedCount ? ` · ${r.closedCount.toLocaleString()} closed deal${r.closedCount === 1 ? '' : 's'} excluded` : '');
    $('#score-num').textContent = r.deals.length ? r.score : '–';
    const C = 2 * Math.PI * 52;
    const arc = $('#gauge-arc');
    arc.setAttribute('stroke-dasharray', `${(C * r.score) / 100} ${C}`);
    const g = r.score >= 80 ? ['good', 'Healthy'] : r.score >= 60 ? ['warn', 'Needs attention'] : ['bad', 'At risk'];
    arc.setAttribute('stroke', `var(--${g[0] === 'warn' ? 'warn' : g[0] === 'good' ? 'good' : 'bad'})`);
    const grade = $('#grade'); grade.className = 'grade ' + g[0]; grade.textContent = g[1];

    const oldest = r.deals.filter((d) => d.overdue > 0).length;
    $('#kpis').innerHTML = [
      [money(r.flaggedValue), `open pipeline on deals with at least one issue (${pctStr(pct(r.flaggedValue, r.totalValue))})`],
      [r.flagged.length.toLocaleString() + ' of ' + r.deals.length.toLocaleString(), 'open deals flagged'],
      [oldest.toLocaleString(), 'open deals with a close date that has already passed'],
      [r.byOwner.filter((o) => o.flaggedPct >= 50).length.toLocaleString(), 'owners with half or more of their pipeline value flagged']
    ].map(([b, s]) => `<div class="kpi"><b>${esc(b)}</b><span>${esc(s)}</span></div>`).join('');
    const unmeasured = CHECKS.filter((c) => !r.measured[c.id]);
    $('#coverage').innerHTML = `${r.measuredCount} of ${CHECKS.length} checks measured.` +
      (unmeasured.length ? ' Not measured (column not in file): ' + unmeasured.map((c) => esc(c.short)).join(', ') + '. Missing checks can only make the score look better than it is.' : '');

    const maxV = Math.max(1, ...r.byCheck.map((c) => c.value));
    $('#issue-bars').innerHTML = r.byCheck.slice().sort((a, b) => b.value - a.value).map((c) => c.measured
      ? `<div class="bar-row"><div class="bar-label">${esc(c.label)} <span class="muted small">· ${c.deals} deals</span></div><div class="bar-track"><div class="bar-fill" style="width:${(100 * c.value) / maxV}%"></div></div><div class="bar-val">${money(c.value)} · ${pctStr(pct(c.value, r.totalValue))}</div></div>`
      : `<div class="bar-row off"><div class="bar-label">${esc(c.label)}</div><div class="bar-track"></div><div class="bar-val">not measured</div></div>`).join('');

    const maxB = Math.max(1, ...r.buckets.map((b) => b.value));
    $('#overdue-bars').innerHTML = r.buckets.map((b, i) => `<div class="bar-row"><div class="bar-label">${b.label} overdue <span class="muted small">· ${b.deals}</span></div><div class="bar-track"><div class="bar-fill ${i < 1 ? 'mid' : ''}" style="width:${(100 * b.value) / maxB}%"></div></div><div class="bar-val">${money(b.value)}</div></div>`).join('');
    const stale = r.buckets.slice(2).reduce((a, b) => a + b.value, 0);
    $('#overdue-note').textContent = r.buckets.some((b) => b.deals)
      ? `${money(stale)} sits on deals whose close date passed more than a month ago. Those are usually forgotten updates, not slipping deals.`
      : 'No open deals have a past close date.';

    if (r.forecast) {
      $('#forecast-body').innerHTML = r.forecast.rows.map((f) => `<div style="margin-bottom:14px"><div class="small muted">${esc(f.label)}: ${f.deals} deals, ${money(f.value)}</div>
        <div style="font:600 26px/1.2 var(--serif)">${money(f.flaggedValue)} <span class="pct-pill ${tone(pct(f.flaggedValue, f.value))}" style="font:600 15px var(--sans)">${pctStr(pct(f.flaggedValue, f.value))}</span></div>
        <div class="small muted">of it is on deals with at least one data issue</div></div>`).join('') +
        `<p class="small muted" style="margin:0">${r.forecast.basis === 'category' ? 'Based on the Forecast Category column.' : 'No Forecast Category column, so this uses deals with probability of 50% or more.'} These are the deals a forecast call depends on most.</p>`;
    } else {
      $('#forecast-body').innerHTML = '<p class="small muted">Add a <code>Forecast Category</code> or <code>Probability (%)</code> column to see how much of your committed number sits on flagged deals.</p>';
    }

    const issueName = (id) => (id ? CHECK_BY_ID[id].short : '–');
    $('#stage-table').innerHTML = `<thead><tr><th>Stage</th><th class="num">Deals</th><th class="num">Value</th><th class="num">Median days in stage</th><th class="num">Value flagged</th><th>Most common issue</th></tr></thead><tbody>` +
      r.byStage.map((s) => `<tr><td>${esc(s.key)}</td><td class="num">${s.deals}</td><td class="num">${money(s.value)}</td><td class="num">${s.medianDays == null ? '–' : s.medianDays}</td><td class="num"><span class="pct-pill ${tone(s.flaggedPct)}">${pctStr(s.flaggedPct)}</span></td><td>${issueName(s.topIssue)}${s.topIssueN ? ` <span class="muted small">(${s.topIssueN})</span>` : ''}</td></tr>`).join('') + '</tbody>';

    $('#owner-table').innerHTML = `<thead><tr><th>Owner</th><th class="num">Open deals</th><th class="num">Open value</th><th class="num">Flagged value</th><th class="num">Share flagged</th><th>Most common issue</th></tr></thead><tbody>` +
      r.byOwner.map((o) => `<tr><td>${esc(o.key)}</td><td class="num">${o.deals}</td><td class="num">${money(o.value)}</td><td class="num">${money(o.flaggedValue)}</td><td class="num"><span class="pct-pill ${tone(o.flaggedPct)}">${pctStr(o.flaggedPct)}</span></td><td>${issueName(o.topIssue)}</td></tr>`).join('') + '</tbody>';

    const top = r.flagged.slice().sort((a, b) => b.amount - a.amount || b.flags.length - a.flags.length).slice(0, 15);
    $('#fix-table').innerHTML = `<thead><tr><th>Deal</th><th>Owner</th><th>Stage</th><th class="num">Amount</th><th>Issues</th><th>First fix</th></tr></thead><tbody>` +
      top.map((d) => `<tr><td>${esc(d.name)}</td><td>${esc(d.owner)}</td><td>${esc(d.stage)}</td><td class="num">${d.amount ? money(d.amount) : '–'}</td><td>${d.flags.map((f) => `<span class="flag">${esc(CHECK_BY_ID[f].short)}${f === 'pastClose' ? ' · ' + d.overdue + 'd' : ''}</span>`).join('')}</td><td class="small">${esc(CHECK_BY_ID[d.flags[0]].fix)}</td></tr>`).join('') + '</tbody>';
    $('#fix-note').textContent = r.flagged.length > top.length ? `Showing the ${top.length} largest of ${r.flagged.length} flagged deals. The download has all of them.` : '';

    $('#ai-payload').textContent = JSON.stringify(buildAiPayload(r).payload, null, 2);
    $('#ai-out').innerHTML = '';
  }

  // ---------- export ----------
  function downloadFixList() {
    const r = state.result; if (!r) return;
    const rows = r.flagged.slice().sort((a, b) => b.amount - a.amount).map((d) => ({
      'Opportunity': d.name, 'Account': d.account, 'Owner': d.owner, 'Stage': d.stage, 'Amount': d.amount || '',
      'Close Date': d.close ? d.close.toISOString().slice(0, 10) : '', 'Days Overdue': d.overdue || '',
      'Issues': d.flags.map((f) => CHECK_BY_ID[f].short).join('; '), 'Suggested First Fix': CHECK_BY_ID[d.flags[0]].fix
    }));
    const csv = Papa.unparse(rows);
    const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'pipeline-fix-list-' + r.asOf + '.csv';
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  // ---------- AI brief (aggregates only, pseudonymised owners) ----------
  function buildAiPayload(r) {
    const labels = {};
    const letters = (i) => (i < 26 ? String.fromCharCode(65 + i) : 'Z' + (i - 25));
    r.byOwner.slice(0, 15).forEach((o, i) => { labels['Rep ' + letters(i)] = o.key; });
    const round = (v) => Math.round(v);
    const payload = {
      measured_as_of: r.asOf,
      currency: state.settings.currency || 'none',
      rules: { no_activity_days: state.settings.staleDays, stuck_in_stage_days: state.settings.stuckDays },
      open_deals: r.deals.length,
      open_pipeline_value: round(r.totalValue),
      health_score_0_100: r.score,
      flagged_deals: r.flagged.length,
      flagged_value: round(r.flaggedValue),
      issues: r.byCheck.filter((c) => c.measured).map((c) => ({ issue: c.label, deals: c.deals, value: round(c.value) })),
      checks_not_measured: r.byCheck.filter((c) => !c.measured).map((c) => c.label),
      past_due_close_dates: r.buckets.map((b) => ({ overdue: b.label, deals: b.deals, value: round(b.value) })),
      forecast_exposure: r.forecast ? r.forecast.rows.map((f) => ({ group: f.label, deals: f.deals, value: round(f.value), flagged_value: round(f.flaggedValue) })) : null,
      stages: r.byStage.slice(0, 15).map((s) => ({ stage: s.key.slice(0, 40), deals: s.deals, value: round(s.value), median_days_in_stage: s.medianDays, pct_value_flagged: Math.round(s.flaggedPct), top_issue: s.topIssue ? CHECK_BY_ID[s.topIssue].short : null })),
      owners: r.byOwner.slice(0, 15).map((o, i) => ({ owner: 'Rep ' + letters(i), deals: o.deals, value: round(o.value), pct_value_flagged: Math.round(o.flaggedPct), top_issue: o.topIssue ? CHECK_BY_ID[o.topIssue].short : null }))
    };
    if (r.byOwner.length > 15) payload.owners_not_listed = r.byOwner.length - 15;
    return { payload, labels };
  }

  function renderBrief(text, labels) {
    const names = Object.keys(labels).sort((a, b) => b.length - a.length);
    let html = esc(text);
    names.forEach((l) => { html = html.split(esc(l)).join('<b>' + esc(labels[l]) + '</b>'); });
    const blocks = html.split(/\n{2,}/).map((b) => {
      const lines = b.split('\n');
      if (lines.every((l) => /^\s*[-•]\s+/.test(l))) return '<ul>' + lines.map((l) => '<li>' + l.replace(/^\s*[-•]\s+/, '') + '</li>').join('') + '</ul>';
      return '<p>' + lines.join('<br>') + '</p>';
    });
    return blocks.join('');
  }

  async function writeBrief() {
    const r = state.result; if (!r) return;
    const btn = $('#ai-btn'); const out = $('#ai-out');
    const { payload, labels } = buildAiPayload(r);
    btn.disabled = true; btn.textContent = 'Writing…';
    out.innerHTML = '<p class="muted small">Sending aggregated numbers only…</p>';
    try {
      const res = await fetch('/api/summary', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ stats: payload }) });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'The AI brief is unavailable right now.');
      out.innerHTML = renderBrief(data.text, labels) + '<p class="small muted">Written by Claude from the aggregates above. Check it against the numbers before forwarding.</p>';
    } catch (e) {
      out.innerHTML = `<div class="notice warn">${esc(e.message)} Everything else on this page works without it.</div>`;
    } finally {
      btn.disabled = false; btn.textContent = 'Write the brief';
    }
  }

  // ---------- wiring ----------
  $('#file-input').addEventListener('change', (e) => { handleFile(e.target.files[0]); e.target.value = ''; });
  function loadDemo() {
    const d = window.PT_DEMO.generate(isoToDate(todayISO()));
    state.settings.asOf = todayISO();
    load(d.headers, d.rows, 'demo', 'demo');
  }
  $('#demo-btn').addEventListener('click', loadDemo);
  if (new URLSearchParams(location.search).has('demo')) loadDemo();
  const drop = $('#drop');
  ['dragenter', 'dragover'].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.add('over'); }));
  ['dragleave', 'drop'].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.remove('over'); }));
  drop.addEventListener('drop', (e) => handleFile(e.dataTransfer.files[0]));
  window.addEventListener('dragover', (e) => e.preventDefault());
  window.addEventListener('drop', (e) => { if (!drop.contains(e.target)) { e.preventDefault(); if (e.dataTransfer.files[0]) handleFile(e.dataTransfer.files[0]); } });

  $('#map-table').addEventListener('change', (e) => {
    const f = e.target.dataset.field; if (!f) return;
    if (e.target.value) state.mapping[f] = e.target.value; else delete state.mapping[f];
    if (f === 'stage' || f === 'probability') { refreshStages(f === 'stage'); renderStageChips(); }
    if (['close', 'created', 'lastActivity', 'lastStageChange'].includes(f)) detectFmt();
    run();
  });
  $('#stage-chips').addEventListener('click', (e) => {
    const s = e.target.dataset && e.target.dataset.stage; if (s == null) return;
    if (state.closed.has(s)) state.closed.delete(s); else state.closed.add(s);
    e.target.setAttribute('aria-pressed', state.closed.has(s));
    run();
  });
  $('#as-of').addEventListener('change', (e) => { if (e.target.value) { state.settings.asOf = e.target.value; run(); } });
  $('#stale-days').addEventListener('change', (e) => { const v = parseInt(e.target.value, 10); if (v > 0) { state.settings.staleDays = v; run(); } });
  $('#stuck-days').addEventListener('change', (e) => { const v = parseInt(e.target.value, 10); if (v > 0) { state.settings.stuckDays = v; run(); } });
  $('#date-fmt').addEventListener('change', (e) => { state.settings.dateFmt = e.target.value; run(); });
  $('#currency').addEventListener('change', (e) => { state.settings.currency = e.target.value; run(); });
  $('#reset-btn').addEventListener('click', () => {
    state.rows = []; state.result = null;
    $('#setup').classList.add('hidden'); $('#results').classList.add('hidden');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  });
  $('#download-btn').addEventListener('click', downloadFixList);
  $('#ai-btn').addEventListener('click', writeBrief);

  // exposed for tests
  window.PT = { parseAmount, parseDate, detectDateFormat, autoMap, state, analyze };
})();
