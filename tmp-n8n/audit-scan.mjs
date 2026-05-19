import fs from 'node:fs';
const raw = fs.readFileSync('C:/Users/tonio/Projects/trading-forge/trading-forge/tmp-n8n/all-active.json','utf8');
const data = JSON.parse(raw);
const wfs = Array.isArray(data.data) ? data.data : (data.data?.workflows || data.workflows || data);

const ZZ_ID = 'BbCvlV1ARyyvY3NI';
const out = [];
const drift = [];
const writebacks = []; // POSTs to TF backend

for (const wf of wfs) {
  const errorWf = wf.settings?.errorWorkflow || null;
  const errorWfOk = errorWf === ZZ_ID;
  let httpNodes = 0, httpWithRetry = 0, httpWithTimeout = 0, httpContinueOnFail = 0;
  let ifNodes = 0, ifLoose = 0, codeNodes = 0;
  let webhookCount = 0, idempotencyHeaders = 0;
  let hardcodedTokens = 0, port4100 = 0, port4000 = 0;
  let isActiveCalls = 0, hasCorrelationId = 0;
  let hasErrorTrigger = false;
  const tfRoutes = new Set();
  const externalUrls = new Set();

  for (const n of wf.nodes || []) {
    if (n.type === 'n8n-nodes-base.errorTrigger') hasErrorTrigger = true;
    if (n.type === 'n8n-nodes-base.httpRequest') {
      httpNodes++;
      const params = n.parameters || {};
      const opts = params.options || {};
      const retryCfg = opts.retry || {};
      if (retryCfg.retry || params.retryOnFail === true) httpWithRetry++;
      if (opts.timeout) httpWithTimeout++;
      if (n.continueOnFail === true || n.onError === 'continueRegularOutput' || n.onError === 'continueErrorOutput') httpContinueOnFail++;
      const url = String(params.url || '');
      if (url.includes(':4100')) port4100++;
      if (url.includes(':4000') || url.includes('host.docker.internal:4000')) {
        port4000++;
        // extract path
        const m = url.match(/\/api\/[^"'\s}{]*/);
        if (m) tfRoutes.add(m[0].split('?')[0]);
      } else if (/^https?:\/\//.test(url)) {
        const host = (url.match(/^https?:\/\/([^/]+)/)||[])[1] || '';
        if (host && !host.includes('host.docker.internal') && !host.includes('localhost')) externalUrls.add(host);
      }
      if (url.includes('/api/forge/active')) isActiveCalls++;
      const sendHeaders = JSON.stringify(params.headerParameters || params.sendHeaders || {});
      if (/idempotency/i.test(sendHeaders)) idempotencyHeaders++;
      const allParams = JSON.stringify(params);
      // Hardcoded bearer (not env var)
      const bearerMatches = allParams.match(/Bearer [A-Za-z0-9_\-]{20,}/g) || [];
      for (const bm of bearerMatches) {
        if (!/\$env|\$credentials|{{\s*\$env/.test(allParams)) hardcodedTokens++;
        break;
      }
    }
    if (n.type === 'n8n-nodes-base.if') {
      ifNodes++;
      const lt = n.parameters?.options?.looseTypeValidation;
      // strict default; loose if explicitly false-ish? n8n: looseTypeValidation=true means loose
      if (lt === true) ifLoose++;
    }
    if (n.type === 'n8n-nodes-base.code' || n.type === 'n8n-nodes-base.function') codeNodes++;
    if (n.type === 'n8n-nodes-base.webhook') webhookCount++;
    const s = JSON.stringify(n);
    if (s.includes('correlation_id') || s.includes('workflow_run_id') || s.includes('correlationId') || s.includes('run_id')) hasCorrelationId++;
  }
  out.push({id: wf.id, name: wf.name, nodes: (wf.nodes||[]).length, errorWf, errorWfOk, hasErrorTrigger,
            httpNodes, httpWithRetry, httpWithTimeout, httpContinueOnFail, ifNodes, ifLoose, codeNodes, webhookCount,
            idempotencyHeaders, hardcodedTokens, port4100, port4000, isActiveCalls, hasCorrelationId,
            tfRoutes: [...tfRoutes], externalUrls: [...externalUrls]});

  if (!errorWfOk && wf.id !== ZZ_ID) drift.push({id: wf.id, name: wf.name, issue: 'no_errorWorkflow'});
  if (port4100 > 0) drift.push({id: wf.id, name: wf.name, issue: `port4100=${port4100}`});
  if (hardcodedTokens > 0) drift.push({id: wf.id, name: wf.name, issue: `hardcoded_tokens=${hardcodedTokens}`});
}

fs.writeFileSync('C:/Users/tonio/Projects/trading-forge/trading-forge/tmp-n8n/audit-scan-out.json', JSON.stringify({out, drift}, null, 2));
console.log('Workflows:', out.length);
console.log('Without errorWorkflow on ZZ:', out.filter(w => !w.errorWfOk && w.id !== ZZ_ID).length);
console.log('With idempotency headers:', out.filter(w => w.idempotencyHeaders > 0).length);
console.log('With isActive() calls:', out.filter(w => w.isActiveCalls > 0).length);
console.log('With correlation_id refs:', out.filter(w => w.hasCorrelationId > 0).length);
console.log('HTTP retry coverage (workflows w/ all HTTP retried):',
  out.filter(w => w.httpNodes>0 && w.httpWithRetry === w.httpNodes).length, '/',
  out.filter(w => w.httpNodes>0).length);
console.log('HTTP timeout coverage:',
  out.filter(w => w.httpNodes>0 && w.httpWithTimeout === w.httpNodes).length, '/',
  out.filter(w => w.httpNodes>0).length);
console.log('Total port4100 nodes:', out.reduce((s,w)=>s+w.port4100,0));
console.log('Total hardcoded tokens:', out.reduce((s,w)=>s+w.hardcodedTokens,0));

// Aggregate distinct TF routes used
const allRoutes = new Set();
for (const w of out) for (const r of w.tfRoutes) allRoutes.add(r);
console.log('\\nDistinct TF routes hit (count='+allRoutes.size+'):');
for (const r of [...allRoutes].sort()) console.log('  '+r);
