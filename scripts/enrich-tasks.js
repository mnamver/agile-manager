#!/usr/bin/env node
/**
 * Jira Data Enrichment Agent
 * Excel'deki her satır için Jira traversal yaparak Tamamlanma Tarihi'ni doldurur.
 *
 * Gerçek hiyerarşi (keşfedildi):
 *   ICTREQ / ICTFT / ICTWP
 *     → ICTP (Project) veya direkt ICTWP linki
 *       → ICTWP (Project Workpackage)
 *         → App Task (Workpackage-Task linki, örn. FD*-*)
 *           → Release (Release-Task linki)
 *             → customfield_13224 = Tamamlanma Tarihi
 *
 * Kullanım:
 *   node scripts/enrich-tasks.js [input.xlsx] [output.xlsx]
 */

// Load .env.local manually (no dotenv dependency needed)
const fs = require('fs');
const envPath = require('path').resolve('.env.local');
if (fs.existsSync(envPath)) {
  fs.readFileSync(envPath, 'utf8').split('\n').forEach(line => {
    const m = line.match(/^([^#=]+)=(.*)$/);
    if (m) process.env[m[1].trim()] = m[2].trim();
  });
}
const xlsx = require('xlsx');
const path = require('path');
const https = require('https');
const http  = require('http');

// ─── CONFIG ──────────────────────────────────────────────────────────────────

const JIRA_BASE   = process.env.JIRA_BASE_URL || 'https://jira.turkcell.com.tr';
const JIRA_TOKEN  = process.env.JIRA_TOKEN    || '';
const INPUT_FILE  = path.resolve(process.argv[2] || 'Overvibe_Tasklar.xlsx');
const OUTPUT_FILE = path.resolve(process.argv[3] || 'Overvibe_Tasklar_Enriched.xlsx');

// Prefixes that are NOT app-level tasks
const INFRA_PREFIXES = ['ICTREQ-', 'ICTFT-', 'ICTWP-', 'ICTP-', 'ICTPG-', 'ICTFTG-', 'CSEC-', 'ICTAR-'];

// ─── JIRA CLIENT ─────────────────────────────────────────────────────────────

const issueCache = new Map();

async function fetchIssue(key) {
  if (issueCache.has(key)) return issueCache.get(key);

  const result = await new Promise((resolve, reject) => {
    const urlPath = `/rest/api/2/issue/${encodeURIComponent(key)}?fields=summary,issuetype,issuelinks,customfield_13224,status`;
    const url = new URL(JIRA_BASE + urlPath);
    const lib = url.protocol === 'https:' ? https : http;

    const opts = {
      hostname: url.hostname,
      port:     url.port || (url.protocol === 'https:' ? 443 : 80),
      path:     url.pathname + url.search,
      method:   'GET',
      headers:  {
        Authorization: `Bearer ${JIRA_TOKEN}`,
        Accept:        'application/json',
      },
      rejectUnauthorized: false,
    };

    const req = lib.request(opts, res => {
      let d = '';
      res.on('data', c => { d += c; });
      res.on('end', () => {
        if (res.statusCode === 404 || res.statusCode === 401) return resolve(null);
        if (res.statusCode !== 200) return reject(new Error(`HTTP ${res.statusCode}`));
        try   { resolve(JSON.parse(d)); }
        catch { reject(new Error('JSON parse error')); }
      });
    });
    req.on('error', reject);
    req.setTimeout(20000, () => { req.destroy(); reject(new Error('timeout')); });
    req.end();
  });

  issueCache.set(key, result);
  return result;
}

// ─── LINK HELPERS ────────────────────────────────────────────────────────────

function getLinks(issue) {
  return (issue?.fields?.issuelinks || []).map(l => ({
    key:      (l.outwardIssue || l.inwardIssue)?.key,
    typeName: (l.outwardIssue || l.inwardIssue)?.fields?.issuetype?.name || '',
    linkType: l.type?.name || '',
  })).filter(l => l.key);
}

const isWorkpackage = l => l.key.startsWith('ICTWP-');
const isProject     = l => l.key.startsWith('ICTP-');
const isAppTask     = l => !INFRA_PREFIXES.some(p => l.key.startsWith(p));
const isRelease     = l => l.typeName.toLowerCase().includes('release') || l.linkType.toLowerCase().includes('release');

// ─── DATE HELPERS ────────────────────────────────────────────────────────────

function excelSerialToDate(serial) {
  if (typeof serial !== 'number') return null;
  const d = xlsx.SSF.parse_date_code(serial);
  if (!d) return null;
  return `${d.y}-${String(d.m).padStart(2,'0')}-${String(d.d).padStart(2,'0')}`;
}

function normalizeDate(val) {
  if (!val) return null;
  if (typeof val === 'number')  return excelSerialToDate(val);
  if (val instanceof Date)      return val.toISOString().slice(0, 10);
  if (typeof val === 'string') {
    const s = val.trim();
    if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
    const m = s.match(/^(\d{2})[./](\d{2})[./](\d{4})/);
    if (m) return `${m[3]}-${m[2]}-${m[1]}`;
    return s || null;
  }
  return null;
}

// ─── TRAVERSAL ────────────────────────────────────────────────────────────────

async function findCompletionDate(startKey, log) {
  // ── Step 1: Fetch start issue ────────────────────────────────────────────
  let startIssue;
  try { startIssue = await fetchIssue(startKey); }
  catch (e) { log(`  [ERR] Fetch ${startKey}: ${e.message}`); return null; }
  if (!startIssue) { log(`  [404] ${startKey} not found`); return null; }
  log(`  [1] ${startKey} (${startIssue.fields?.issuetype?.name})`);

  // ── Step 2: Collect Workpackage keys ─────────────────────────────────────
  // Direct ICTWP links OR via ICTP → ICTWP
  let wpKeys = [];

  if (startKey.startsWith('ICTWP-')) {
    // Input is already a WP
    wpKeys = [startKey];
    log(`  [2] Input is WP → ${startKey}`);
  } else {
    const links = getLinks(startIssue);

    // Direct ICTWP links
    const directWPs = links.filter(isWorkpackage).map(l => l.key);
    wpKeys.push(...directWPs);

    // ICTP → ICTWP (indirect)
    const projectKeys = links.filter(isProject).map(l => l.key);
    for (const pKey of projectKeys) {
      let proj;
      try { proj = await fetchIssue(pKey); }
      catch (e) { log(`  [2] Error fetching project ${pKey}: ${e.message}`); continue; }
      if (!proj) continue;
      const wpFromProject = getLinks(proj).filter(isWorkpackage).map(l => l.key);
      wpKeys.push(...wpFromProject);
      if (wpFromProject.length) log(`  [2] ${pKey} → WPs: ${wpFromProject.join(', ')}`);
    }

    wpKeys = [...new Set(wpKeys)];
    if (!wpKeys.length) { log(`  [2] No ICTWP links found`); return null; }
    log(`  [2] Workpackages: ${wpKeys.join(', ')}`);
  }

  // ── Step 3-4-5: WP → Task → Release → cf13224 ───────────────────────────
  for (const wpKey of wpKeys) {
    let wp;
    try { wp = wpKey === startKey ? startIssue : await fetchIssue(wpKey); }
    catch (e) { log(`  [ERR] WP ${wpKey}: ${e.message}`); continue; }
    if (!wp) { log(`  [3] WP ${wpKey} not found`); continue; }

    const taskLinks = getLinks(wp).filter(isAppTask);
    if (!taskLinks.length) { log(`  [3] No app tasks in ${wpKey}`); continue; }
    log(`  [3] Tasks in ${wpKey}: ${taskLinks.map(l=>l.key).join(', ')}`);

    for (const tl of taskLinks) {
      let task;
      try { task = await fetchIssue(tl.key); }
      catch (e) { log(`  [ERR] Task ${tl.key}: ${e.message}`); continue; }
      if (!task) { log(`  [4] Task ${tl.key} not found`); continue; }

      const releaseLinks = getLinks(task).filter(isRelease);
      if (!releaseLinks.length) { log(`  [4] No Release link in ${tl.key}`); continue; }
      log(`  [4] Releases in ${tl.key}: ${releaseLinks.map(l=>l.key).join(', ')}`);

      for (const rl of releaseLinks) {
        let rel;
        try { rel = await fetchIssue(rl.key); }
        catch (e) { log(`  [ERR] Release ${rl.key}: ${e.message}`); continue; }
        if (!rel) { log(`  [5] Release ${rl.key} not found`); continue; }

        const cf = rel.fields?.customfield_13224;
        if (cf) {
          const date = normalizeDate(cf);
          log(`  [5] ${rl.key} cf13224=${cf} → ${date} ✓`);
          return date;
        } else {
          log(`  [5] ${rl.key} cf13224 boş`);
        }
      }
    }
  }

  return null;
}

// ─── MAIN ─────────────────────────────────────────────────────────────────────

async function main() {
  if (!JIRA_TOKEN) { console.error('ERROR: JIRA_TOKEN not set (.env.local)'); process.exit(1); }

  console.log(`\n📂 Input : ${INPUT_FILE}`);
  console.log(`📂 Output: ${OUTPUT_FILE}`);
  console.log(`🔗 Jira  : ${JIRA_BASE}\n`);

  const wb    = xlsx.readFile(INPUT_FILE);
  const sheet = wb.Sheets[wb.SheetNames[0]];
  const rows  = xlsx.utils.sheet_to_json(sheet, { defval: null });
  console.log(`📋 ${rows.length} satır okundu\n`);

  const results = [];
  let found = 0, notFound = 0, errors = 0;

  for (let i = 0; i < rows.length; i++) {
    const row      = rows[i];
    const issueKey = String(row['No'] || '').trim();

    if (!issueKey) {
      results.push({ no: '', backlog_giris_tarihi: normalizeDate(row['Backlog Giriş Tarihi']),
        sprint_no: row['Sprint No'], sprint_baslangic: normalizeDate(row['Sprint Baslangic']),
        sprint_bitis: normalizeDate(row['Sprint Bitis']), tamamlanma_tarihi: null });
      continue;
    }

    process.stdout.write(`[${String(i+1).padStart(2)}/${rows.length}] ${issueKey} ... `);
    const logs = [];

    let tamamlanma = null;
    try {
      tamamlanma = await findCompletionDate(issueKey, m => logs.push(m));
    } catch (e) {
      logs.push(`  [FATAL] ${e.message}`);
      errors++;
    }

    if (tamamlanma) {
      console.log(`✅ ${tamamlanma}`);
      found++;
    } else {
      console.log(`⬜ bulunamadı`);
      notFound++;
    }
    logs.forEach(l => console.log(l));

    results.push({
      no:                    issueKey,
      backlog_giris_tarihi:  normalizeDate(row['Backlog Giriş Tarihi']),
      sprint_no:             row['Sprint No'],
      sprint_baslangic:      normalizeDate(row['Sprint Baslangic']),
      sprint_bitis:          normalizeDate(row['Sprint Bitis']),
      tamamlanma_tarihi:     tamamlanma,
    });
  }

  // ── Summary ───────────────────────────────────────────────────────────────
  console.log('\n' + '─'.repeat(60));
  console.log(`✅ Tarih bulundu  : ${found}`);
  console.log(`⬜ Bulunamadı     : ${notFound}`);
  console.log(`❌ Hata           : ${errors}`);
  console.log(`📊 Toplam         : ${results.length}`);
  console.log('─'.repeat(60));

  // ── Write output Excel ────────────────────────────────────────────────────
  const outData = results.map(r => ({
    'No':                    r.no,
    'Backlog Giriş Tarihi':  r.backlog_giris_tarihi,
    'Sprint No':             r.sprint_no,
    'Sprint Baslangic':      r.sprint_baslangic,
    'Sprint Bitis':          r.sprint_bitis,
    'Tamamlanma Tarihi':     r.tamamlanma_tarihi,
  }));
  const outSheet = xlsx.utils.json_to_sheet(outData);
  const outWb    = xlsx.utils.book_new();
  xlsx.utils.book_append_sheet(outWb, outSheet, 'Backlog');
  xlsx.writeFile(outWb, OUTPUT_FILE);
  console.log(`\n📁 Excel yazıldı  : ${OUTPUT_FILE}`);

  // ── JSON ──────────────────────────────────────────────────────────────────
  const jsonOut = path.resolve(OUTPUT_FILE.replace(/\.xlsx$/i, '.json'));
  require('fs').writeFileSync(jsonOut, JSON.stringify(results, null, 2), 'utf8');
  console.log(`📄 JSON yazıldı   : ${jsonOut}\n`);
}

main().catch(e => { console.error('FATAL:', e.message); process.exit(1); });
