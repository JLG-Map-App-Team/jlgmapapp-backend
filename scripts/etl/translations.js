/**
 * The ETL translation layer.
 *
 *   raw source / Master Data value -> code_translations.csv -> database code
 *
 * The migrations own the vocabulary. This module is the only place a raw value
 * becomes a code, and it does so by reading scripts/data-validation/
 * code_translations.csv, so the table that scripts/vocabulary.drift.test.mjs
 * checks against the database is the same table the loaders use. There is no
 * second copy of any mapping in code.
 *
 * Rule syntax, as documented on the ETL_Code_Translations sheet:
 *   "A / B / C"      alternatives; any one matches exactly
 *   "OSM way {id}"   {name} matches any text (shortest match)
 *   [NULL]           translate to null
 *   [QUARANTINE]     the record must not load
 *   [INHERIT]        translate the captured {method} with the same domain's rules
 * Any value with no matching rule is untranslatable and quarantines the record.
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

export const TRANSLATIONS_PATH = resolve(import.meta.dirname, '../data-validation/code_translations.csv');

/** RFC 4180 subset: quoted fields may contain commas, newlines and doubled quotes. */
export function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') { field += '"'; i += 1; }
      else if (ch === '"') quoted = false;
      else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') { row.push(field); field = ''; }
    else if (ch === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
    else if (ch !== '\r') field += ch;
  }
  if (field || row.length) { row.push(field); rows.push(row); }
  return rows;
}

/** Parse a CSV with a header row into objects keyed by header. */
export function readCsvObjects(path) {
  const [header, ...rows] = parseCsv(readFileSync(path, 'utf8'));
  return { header, records: rows.map((r) => Object.fromEntries(header.map((h, i) => [h, r[i] ?? '']))) };
}

function escapeRegex(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function compile(sourceValue, domain) {
  // review_flag's source value is prose, not a list of alternatives.
  const alternatives = domain === 'review_flag' ? [sourceValue] : sourceValue.split(' / ');
  return alternatives.map((alt) => {
    const parts = alt.split(/(\{[a-z]+\})/);
    const pattern = parts
      .map((part) => {
        const placeholder = part.match(/^\{([a-z]+)\}$/);
        return placeholder ? `(?<${placeholder[1]}>.+?)` : escapeRegex(part);
      })
      .join('');
    return new RegExp(`^${pattern}$`);
  });
}

export function loadTranslations(path = TRANSLATIONS_PATH) {
  const { records } = readCsvObjects(path);
  const byDomain = new Map();
  for (const r of records) {
    const rule = {
      code: r['Normalized code'],
      table: r['Lookup table'] || null,
      review: r['Review required?'] === 'Yes',
      patterns: compile(r['Source value'], r.Domain),
    };
    if (!byDomain.has(r.Domain)) byDomain.set(r.Domain, []);
    byDomain.get(r.Domain).push(rule);
  }

  /**
   * Translate one raw value.
   * Returns { ok: true, code, table, review } or { ok: false, reason }.
   * code is null for [NULL]; reason is 'quarantine' or 'untranslatable'.
   */
  function translate(domain, raw, depth = 0) {
    const rules = byDomain.get(domain);
    if (!rules) throw new Error(`no translation domain "${domain}"`);
    const value = String(raw ?? '').trim();
    for (const rule of rules) {
      for (const pattern of rule.patterns) {
        const match = pattern.exec(value);
        if (!match) continue;
        if (rule.code === '[QUARANTINE]') return { ok: false, reason: 'quarantine', value };
        if (rule.code === '[NULL]') return { ok: true, code: null, table: null, review: rule.review };
        if (rule.code === '[INHERIT]') {
          if (depth > 3 || !match.groups?.method) return { ok: false, reason: 'untranslatable', value };
          return translate(domain, match.groups.method, depth + 1);
        }
        return { ok: true, code: rule.code, table: rule.table, review: rule.review };
      }
    }
    return { ok: false, reason: 'untranslatable', value };
  }

  return { translate, domains: [...byDomain.keys()] };
}
