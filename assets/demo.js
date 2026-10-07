/* Synthetic demo pipeline. Every value here is generated; no real company, person or deal.
   Columns use the labels of a standard Salesforce Opportunities report so the demo
   exercises the same auto-mapping a real export would. */
(function () {
  function rng(seed) {
    return function () {
      seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
      let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  const STAGES = [
    { name: 'Prospecting', p: 10, fc: 'Pipeline' },
    { name: 'Qualification', p: 10, fc: 'Pipeline' },
    { name: 'Needs Analysis', p: 20, fc: 'Pipeline' },
    { name: 'Value Proposition', p: 50, fc: 'Pipeline' },
    { name: 'Proposal/Price Quote', p: 75, fc: 'Best Case' },
    { name: 'Negotiation/Review', p: 90, fc: 'Commit' }
  ];
  const NEXT_STEPS = ['Send revised proposal', 'Security review call', 'Pricing follow-up with finance',
    'Intro to economic buyer', 'Technical deep dive', 'Confirm legal redlines', 'Book demo for wider team',
    'Share mutual action plan', 'Reference call with existing customer', 'Procurement kickoff'];
  const OWNERS = [
    ['Demo Rep 1', 0.05], ['Demo Rep 2', 0.1], ['Demo Rep 3', 0.14], ['Demo Rep 4', 0.19],
    ['Demo Rep 5', 0.25], ['Demo Rep 6', 0.31], ['Demo Rep 7', 0.4], ['Demo Rep 8', 0.52]
  ];

  function fmt(d) { return (d.getMonth() + 1) + '/' + d.getDate() + '/' + d.getFullYear(); }
  function addDays(d, n) { const x = new Date(d); x.setDate(x.getDate() + n); return x; }

  function generate(asOf) {
    const r = rng(20261007);
    const int = (a, b) => a + Math.floor(r() * (b - a + 1));
    const pick = (arr) => arr[Math.floor(r() * arr.length)];
    const rows = [];
    let acct = 100;

    OWNERS.forEach(([owner, sloppy]) => {
      const nOpen = int(12, 19), nClosed = int(3, 7);
      for (let i = 0; i < nOpen + nClosed; i++) {
        const closed = i >= nOpen;
        acct++;
        const account = 'Demo Account ' + acct;
        const stageIdx = closed ? -1 : Math.min(STAGES.length - 1, Math.floor(Math.pow(r(), 0.85) * STAGES.length));
        const age = int(12, 260);
        const created = addDays(asOf, -age);
        let amount = Math.round(Math.exp(9.6 + r() * 1.9) / 500) * 500;
        if (!closed && r() < sloppy * 0.12) amount = '';

        let stage, prob, fc, close, nextStep = '', lastAct = '', dur;
        if (closed) {
          const won = r() < 0.4;
          stage = won ? 'Closed Won' : 'Closed Lost';
          prob = won ? 100 : 0; fc = won ? 'Closed' : 'Omitted';
          close = addDays(asOf, -int(1, 90));
          lastAct = fmt(addDays(close, -int(0, 10)));
          dur = int(1, 30);
        } else {
          const s = STAGES[stageIdx];
          stage = s.name; prob = s.p; fc = s.fc;
          close = r() < sloppy * 0.75 ? addDays(asOf, -int(1, 120)) : addDays(asOf, int(4, 150));
          if (r() > sloppy * 0.85) nextStep = pick(NEXT_STEPS);
          const roll = r();
          if (roll < sloppy * 0.25) lastAct = '';
          else if (roll < sloppy * 0.9) lastAct = fmt(addDays(asOf, -int(31, 140)));
          else lastAct = fmt(addDays(asOf, -int(0, 24)));
          dur = Math.min(age, r() < sloppy * 0.7 ? int(46, 160) : int(2, 40));
        }

        rows.push({
          'Opportunity Owner': owner,
          'Account Name': account,
          'Opportunity Name': account + ' - ' + pick(['New Business', 'Expansion', 'Platform Upgrade', 'Renewal + Upsell']),
          'Stage': stage,
          'Amount': amount === '' ? '' : String(amount),
          'Probability (%)': String(prob),
          'Forecast Category': fc,
          'Close Date': fmt(close),
          'Created Date': fmt(created),
          'Stage Duration': String(dur),
          'Next Step': nextStep,
          'Last Activity': lastAct
        });
      }
    });
    return { headers: Object.keys(rows[0]), rows };
  }

  window.PT_DEMO = { generate };
})();
