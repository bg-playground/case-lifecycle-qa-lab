/**
 * Boundary check: fails if the repo contains private names, real-looking
 * emails or URLs, local workspace paths, or Pega npm packages.
 *
 * Usage:
 *   npm run boundary                 scan files tracked or not ignored by git
 *   npm run boundary -- --root DIR   scan every text file under DIR
 *   npm run boundary -- --self-test  prove each rule fires on planted samples
 *
 * Generic rules (emails, URLs, paths, @pega packages) and their documented
 * exemptions live in this repo (boundary/allowlist.json).
 *
 * Private terms (private repo names, codenames and similar) are NOT stored in
 * the repo, not even as hashes. They are read at run time, one per line, from:
 *   1. the BOUNDARY_PRIVATE_TERMS env var (CI: the GitHub Actions secret of
 *      the same name), else
 *   2. the file named by BOUNDARY_PRIVATE_TERMS_FILE, else
 *   3. .boundary-private-terms in the repo root (git-ignored).
 * Lines starting with # are comments. Matching is case-insensitive and finds
 * a term inside longer strings and paths. Findings never print the term.
 *
 * Fail-closed: if no private terms are found, the run FAILS unless
 * BOUNDARY_REQUIRE_PRIVATE_TERMS=false (CI sets that only for pull requests
 * from forks, which cannot read secrets). Then it prints a loud warning and
 * runs the generic rules only.
 */
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

interface PrivateTerm { index: number; text: string }
interface Allowlist {
  emailDomainSuffixes: Array<{ suffix: string }>;
  urlHosts: Array<{ host: string }>;
  urlHostSuffixes: Array<{ suffix: string }>;
  skipPaths: Array<{ path: string; checks: Rule[] }>;
}
type Rule = 'term' | 'email' | 'url' | 'path' | 'pega-package';
interface Finding { file: string; line: number; rule: Rule; detail: string }
interface TermSource { terms: PrivateTerm[]; source: string | null }

const REPO = fileURLToPath(new URL('..', import.meta.url));
const LOCAL_TERMS_FILE = '.boundary-private-terms';
const EMAIL = /[A-Za-z0-9._%+-]+@(?:[A-Za-z0-9-]+\.)+[A-Za-z]{2,}/g;
const URL_RE = /\bhttps?:\/\/[^\s"'<>()`\]|]+/g;
// Written as escaped regexes so this file does not match its own rules.
const PLAIN_PATTERNS: Array<{ re: RegExp; detail: string }> = [
  { re: /\/workspace\//, detail: 'local workspace path' },
  { re: /pegacea\.net/i, detail: 'Pega trial/exercise hostname' },
];
const PEGA_PACKAGE = /"@pega\//;
const MANIFESTS = new Set(['package.json', 'package-lock.json']);

export class BoundaryCheck {
  /** Parses one term per line; blank lines and # comments are ignored. */
  static parseTerms(raw: string): PrivateTerm[] {
    return raw
      .split(/\r?\n/)
      .map((l) => l.trim().toLowerCase().replace(/\s+/g, ' '))
      .filter((l) => l && !l.startsWith('#'))
      .map((text, i) => ({ index: i + 1, text }));
  }

  /**
   * Loads private terms from env, an explicit file, or the git-ignored local file.
   * The SHA-256 of each term is added as an extra term, so a hash of a private
   * name committed by mistake is caught too.
   */
  static loadPrivateTerms(): TermSource {
    let raw: string | null = null;
    let source: string | null = null;
    if (process.env.BOUNDARY_PRIVATE_TERMS?.trim()) {
      raw = process.env.BOUNDARY_PRIVATE_TERMS;
      source = 'env BOUNDARY_PRIVATE_TERMS';
    } else if (process.env.BOUNDARY_PRIVATE_TERMS_FILE && existsSync(process.env.BOUNDARY_PRIVATE_TERMS_FILE)) {
      raw = readFileSync(process.env.BOUNDARY_PRIVATE_TERMS_FILE, 'utf8');
      source = 'file from BOUNDARY_PRIVATE_TERMS_FILE';
    } else if (existsSync(join(REPO, LOCAL_TERMS_FILE))) {
      raw = readFileSync(join(REPO, LOCAL_TERMS_FILE), 'utf8');
      source = `local ${LOCAL_TERMS_FILE}`;
    }
    const terms = raw ? BoundaryCheck.parseTerms(raw) : [];
    return { terms: BoundaryCheck.withHashes(terms), source: terms.length ? source : null };
  }

  static withHashes(terms: PrivateTerm[]): PrivateTerm[] {
    const hashes = terms.map((t) => ({ index: t.index, text: createHash('sha256').update(t.text).digest('hex') }));
    return [...terms, ...hashes];
  }

  static allowlist(): Allowlist {
    return JSON.parse(readFileSync(join(REPO, 'boundary/allowlist.json'), 'utf8')) as Allowlist;
  }

  /** Files to scan: git-tracked plus untracked-but-not-ignored, or everything under a root. */
  static files(root: string | null): Array<{ abs: string; rel: string }> {
    if (root) {
      const out: Array<{ abs: string; rel: string }> = [];
      const walk = (dir: string) => {
        for (const name of readdirSync(dir)) {
          if (name === 'node_modules' || name === '.git') continue;
          const abs = join(dir, name);
          if (statSync(abs).isDirectory()) walk(abs);
          else out.push({ abs, rel: relative(root, abs) });
        }
      };
      walk(root);
      return out;
    }
    const listed = execFileSync('git', ['ls-files', '-co', '--exclude-standard', '-z'], { cwd: REPO, encoding: 'utf8' });
    return listed.split('\0').filter(Boolean).filter((rel) => existsSync(join(REPO, rel))).map((rel) => ({ abs: join(REPO, rel), rel }));
  }

  static scanText(rel: string, text: string, terms: PrivateTerm[], allow: Allowlist): Finding[] {
    const findings: Finding[] = [];
    const skipped = new Set(allow.skipPaths.filter((s) => s.path === rel).flatMap((s) => s.checks));
    const base = rel.split('/').pop() ?? rel;

    text.split(/\r?\n/).forEach((raw, i) => {
      const line = i + 1;
      if (!skipped.has('term')) {
        const norm = raw.toLowerCase().replace(/\s+/g, ' ');
        for (const t of terms) {
          if (norm.includes(t.text)) {
            const kind = /^[0-9a-f]{64}$/.test(t.text) ? 'SHA-256 of private term' : 'private term';
            findings.push({ file: rel, line, rule: 'term', detail: `${kind} #${t.index} (value not printed)` });
          }
        }
      }
      if (!skipped.has('path')) {
        for (const p of PLAIN_PATTERNS) if (p.re.test(raw)) findings.push({ file: rel, line, rule: 'path', detail: p.detail });
      }
      if (MANIFESTS.has(base) && PEGA_PACKAGE.test(raw)) {
        findings.push({ file: rel, line, rule: 'pega-package', detail: '@pega npm package in a manifest' });
      }
      if (!skipped.has('email')) {
        for (const m of raw.matchAll(EMAIL)) {
          const domain = m[0].split('@')[1]!.toLowerCase();
          if (!allow.emailDomainSuffixes.some((a) => domain.endsWith(a.suffix))) {
            findings.push({ file: rel, line, rule: 'email', detail: `email on non-reserved domain: ${domain}` });
          }
        }
      }
      if (!skipped.has('url')) {
        for (const m of raw.matchAll(URL_RE)) {
          const host = BoundaryCheck.host(m[0]);
          const ok = host !== null && (
            allow.urlHosts.some((a) => a.host === host) ||
            allow.urlHostSuffixes.some((a) => host.endsWith(a.suffix))
          );
          if (!ok) findings.push({ file: rel, line, rule: 'url', detail: `URL host not allowlisted: ${host ?? m[0]}` });
        }
      }
    });
    return findings;
  }

  static scan(root: string | null, terms: PrivateTerm[]): Finding[] {
    const allow = BoundaryCheck.allowlist();
    const findings: Finding[] = [];
    for (const f of BoundaryCheck.files(root)) {
      const buf = readFileSync(f.abs);
      if (buf.includes(0)) continue; // binary
      findings.push(...BoundaryCheck.scanText(f.rel, buf.toString('utf8'), terms, allow));
    }
    return findings;
  }

  /** Plants one sample per rule in a temp dir, with a run-time canary term, and checks each is caught. */
  static selfTest(): boolean {
    const dir = mkdtempSync(join(tmpdir(), 'boundary-self-test-'));
    try {
      const canary = ['bgstm', 'boundary', 'canary'].join('-');
      const terms = BoundaryCheck.withHashes(BoundaryCheck.parseTerms(canary));
      const canaryHash = terms[1]!.text;
      const samples: Record<string, { text: string; rule: Rule | null }> = {
        'term.md': { text: `see repo Owner/${canary.toUpperCase()}-v2`, rule: 'term' },
        'term-hash.json': { text: `{ "sha256": "${canaryHash}" }`, rule: 'term' },
        'email.md': { text: `contact ${['someone', 'mail.test-domain.com'].join('@')}`, rule: 'email' },
        'url.md': { text: `see ${'https'}://tracker.${'test-domain'}.com/x`, rule: 'url' },
        'path.md': { text: `file at ${'/work'}${'space/'}notes.md`, rule: 'path' },
        'package.json': { text: `{ "dependencies": { "${'@pega'}/anything": "1.0.0" } }`, rule: 'pega-package' },
        'clean.md': { text: 'avery@claimant.example https://docs.pega.com/x http://127.0.0.1:3333/', rule: null },
      };
      for (const [name, s] of Object.entries(samples)) writeFileSync(join(dir, name), s.text);
      const findings = BoundaryCheck.scan(dir, terms);
      let pass = true;
      for (const [name, s] of Object.entries(samples)) {
        const got = findings.filter((f) => f.file === name).map((f) => f.rule);
        const ok = s.rule === null ? got.length === 0 : got.includes(s.rule);
        console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}: expected ${s.rule ?? 'no findings'}, got [${got.join(', ')}]`);
        pass &&= ok;
      }
      return pass;
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }

  static main(argv: string[]): number {
    if (argv[0] === '--self-test') {
      const ok = BoundaryCheck.selfTest();
      console.log(ok ? 'boundary self-test: PASS' : 'boundary self-test: FAIL');
      return ok ? 0 : 1;
    }
    const required = (process.env.BOUNDARY_REQUIRE_PRIVATE_TERMS ?? 'true').toLowerCase() !== 'false';
    const { terms, source } = BoundaryCheck.loadPrivateTerms();
    let missingFatal = false;
    if (!source) {
      if (required) {
        console.log('::error::boundary check: NO PRIVATE TERMS LOADED. Set the BOUNDARY_PRIVATE_TERMS secret/env var or a git-ignored .boundary-private-terms file. Failing closed.');
        missingFatal = true;
      } else {
        console.log('::warning::boundary check: NO PRIVATE TERMS LOADED (BOUNDARY_REQUIRE_PRIVATE_TERMS=false, e.g. a fork PR). Private-name rule SKIPPED; generic rules only.');
      }
    } else {
      console.log(`boundary check: ${terms.length / 2} private term(s) loaded from ${source} (values not printed)`);
    }

    const root = argv[0] === '--root' && argv[1] ? argv[1] : null;
    const findings = BoundaryCheck.scan(root, terms);
    for (const f of findings) console.log(`${f.file}:${f.line}: [${f.rule}] ${f.detail}`);
    const count = BoundaryCheck.files(root).length;
    const failed = findings.length > 0 || missingFatal;
    console.log(
      failed
        ? `boundary check: FAIL (${findings.length} finding(s) in ${count} files${missingFatal ? '; private terms missing' : ''})`
        : `boundary check: PASS (${count} files scanned)`,
    );
    return failed ? 1 : 0;
  }

  private static host(url: string): string | null {
    try {
      // Template literals such as http://127.0.0.1:${PORT} are checked with a placeholder value.
      return new URL(url.replace(/\$\{[^}]*\}/g, '0')).hostname.toLowerCase();
    } catch {
      return null;
    }
  }
}

process.exitCode = BoundaryCheck.main(process.argv.slice(2));
