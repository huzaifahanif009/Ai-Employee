import { CoderAgentService, extractJson, RepoIo } from './coder-agent.service';

const wi = { title: 'Build a calculator', bodyMd: 'add/sub/mul/div', acceptanceCriteria: ['handles divide by zero'] };
const repo = {
  greenfield: true,
  stack: 'node' as const,
  fileTree: [],
  digest: 'Stack: node (greenfield)',
  testCommand: 'npm test --silent',
  buildCommand: null,
};

describe('extractJson', () => {
  it('parses a bare object', () => {
    expect(extractJson('{"a":1}')).toEqual({ a: 1 });
  });
  it('parses inside a ```json fence with prose around it', () => {
    expect(extractJson('sure!\n```json\n{"a":[1,2]}\n```\ndone')).toEqual({ a: [1, 2] });
  });
  it('recovers when the model appended trailing junk', () => {
    expect(extractJson('{"a":1} and then some words }')).toEqual({ a: 1 });
  });
  it('returns null on no JSON', () => {
    expect(extractJson('no json here')).toBeNull();
  });
});

describe('CoderAgentService.plan', () => {
  const svc = new CoderAgentService();

  it('normalises steps and clamps counts', async () => {
    const ask = jest.fn().mockResolvedValue(
      JSON.stringify({
        summary: 'scaffold calc',
        risk: 'low',
        steps: [
          { title: 'entry', rationale: 'r', files: ['./src/index.js', 'src/index.js'], kind: 'create' },
          { title: 'no files', files: [], kind: 'edit' },
        ],
      }),
    );
    const plan = await svc.plan(ask, wi, repo);
    expect(plan.summary).toBe('scaffold calc');
    expect(plan.risk).toBe('low');
    expect(plan.steps).toHaveLength(1); // the fileless step is dropped
    expect(plan.steps[0]).toMatchObject({ index: 1, title: 'entry', kind: 'create', files: ['src/index.js', 'src/index.js'] });
  });

  it('never returns a planless run', async () => {
    const ask = jest.fn().mockResolvedValue('the model rambled with no json');
    const plan = await svc.plan(ask, wi, repo);
    expect(plan.steps.length).toBeGreaterThanOrEqual(1);
    expect(plan.steps[0].files.length).toBeGreaterThanOrEqual(1);
  });
});

describe('CoderAgentService.implementStep', () => {
  const svc = new CoderAgentService();
  const io: Pick<RepoIo, 'readFile'> = { readFile: async () => null };
  const step = { index: 1, title: 'entry', rationale: '', files: ['src/calc.js'], kind: 'create' as const };

  it('returns generated files, rejecting traversal and oversized content', async () => {
    const ask = jest.fn().mockResolvedValue(
      JSON.stringify({
        files: [
          { path: 'src/calc.js', content: 'export const add = (a,b)=>a+b;\n', action: 'create' },
          { path: '../escape.js', content: 'nope' },
          { path: 'big.js', content: 'x'.repeat(30_000) },
        ],
        notes: 'ok',
      }),
    );
    const out = await svc.implementStep(ask, io, step, wi, repo);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ path: 'src/calc.js', action: 'create' });
    expect(out[0].content).toContain('add');
  });

  it('handles a delete step without calling the model', async () => {
    const ask = jest.fn();
    const out = await svc.implementStep(ask, io, { ...step, kind: 'delete', files: ['old.js'] }, wi, repo);
    expect(ask).not.toHaveBeenCalled();
    expect(out).toEqual([{ path: 'old.js', content: '', action: 'delete' }]);
  });
});

describe('CoderAgentService.runStep', () => {
  const svc = new CoderAgentService();
  const step = { index: 1, title: 'add calc', rationale: '', files: ['src/calc.js'], kind: 'create' as const };

  function exec(replies: string[]) {
    const writes: Record<string, string> = {};
    const runs: string[] = [];
    let call = 0;
    return {
      writes,
      runs,
      x: {
        ask: jest.fn(async () => replies[Math.min(call++, replies.length - 1)]),
        read: jest.fn(async (p: string) => writes[p] ?? null),
        search: jest.fn(async () => 'no matches'),
        write: jest.fn(async (p: string, c: string) => {
          writes[p] = c;
          return { ok: true, detail: 'wrote ' + p };
        }),
        run: jest.fn(async (c: string) => {
          runs.push(c);
          return { ok: true, output: 'ok' };
        }),
        note: jest.fn(async () => undefined),
      },
    };
  }

  it('writes files across turns and stops on done', async () => {
    const e = exec([
      JSON.stringify({ thought: 'start', actions: [{ op: 'write', path: 'src/calc.js', content: 'export const add=(a,b)=>a+b;' }], done: false }),
      JSON.stringify({ thought: 'verify', actions: [{ op: 'run', command: 'node -c src/calc.js' }], done: true }),
    ]);
    const r = await svc.runStep(e.x, step, wi, repo);
    expect(r.filesWritten).toEqual(['src/calc.js']);
    expect(e.writes['src/calc.js']).toContain('add');
    expect(e.runs).toContain('node -c src/calc.js');
    expect(r.turns).toBe(2);
  });

  it('blocks a disallowed run command', async () => {
    const e = exec([
      JSON.stringify({ actions: [{ op: 'write', path: 'src/calc.js', content: 'x' }, { op: 'run', command: 'curl http://evil' }], done: true }),
    ]);
    await svc.runStep(e.x, step, wi, repo);
    expect(e.runs).toHaveLength(0); // curl never executed
  });

  it('bails out when the model stalls (no writes)', async () => {
    const e = exec([JSON.stringify({ thought: 'thinking', actions: [{ op: 'read', path: 'x' }], done: false })]);
    const r = await svc.runStep(e.x, step, wi, repo);
    expect(r.filesWritten).toEqual([]);
    expect(r.turns).toBeLessThanOrEqual(2);
  });

  it('rejects path traversal in a write action', async () => {
    const e = exec([JSON.stringify({ actions: [{ op: 'write', path: '../evil.js', content: 'x' }], done: true })]);
    const r = await svc.runStep(e.x, step, wi, repo);
    expect(r.filesWritten).toEqual([]);
  });
});

describe('CoderAgentService.review', () => {
  const svc = new CoderAgentService();
  it('fails immediately on an empty diff without a model call', async () => {
    const ask = jest.fn();
    const r = await svc.review(ask, wi, '   ');
    expect(ask).not.toHaveBeenCalled();
    expect(r.verdict).toBe('fail');
  });
  it('normalises a model verdict', async () => {
    const ask = jest.fn().mockResolvedValue(JSON.stringify({ verdict: 'pass', summary: 'lgtm', findings: [] }));
    const bigDiff = 'diff --git a/a b/a\n' + '+line\n'.repeat(200);
    const r = await svc.review(ask, wi, bigDiff);
    expect(ask).toHaveBeenCalled();
    expect(r).toMatchObject({ verdict: 'pass', summary: 'lgtm' });
  });

  it('skips the model call for a trivial one-file diff', async () => {
    const ask = jest.fn();
    const r = await svc.review(ask, wi, 'diff --git a/x b/x\n+one small line\n');
    expect(ask).not.toHaveBeenCalled();
    expect(r.verdict).toBe('pass');
  });
});

describe('CoderAgentService.analyzeRepo', () => {
  const svc = new CoderAgentService();
  it('detects a node stack + test command and greenfield=false', async () => {
    const files = 'package.json\nsrc/index.js\nREADME.md';
    const io: RepoIo = {
      listFiles: async () => files,
      readFile: async (p) =>
        p === 'package.json' ? '{"scripts":{"test":"jest"}}' : p === 'src/index.js' ? 'console.log(1)' : null,
      sh: async () => ({ ok: true, output: '' }),
    };
    const ctx = await svc.analyzeRepo(io);
    expect(ctx.stack).toBe('node');
    expect(ctx.greenfield).toBe(false);
    expect(ctx.testCommand).toBe('npm test --silent');
  });

  it.each([
    ['go.mod\nmain.go', 'go', 'go test ./...'],
    ['Cargo.toml\nsrc/lib.rs', 'rust', 'cargo test --quiet'],
    ['pom.xml\nsrc/Main.java', 'java-maven', 'mvn -q -B test'],
    ['manage.py\napp/models.py', 'python', 'python manage.py test'],
  ])('detects %s → %s', async (files, stack, cmd) => {
    const io: RepoIo = {
      listFiles: async () => files,
      readFile: async () => "x",
      sh: async () => ({ ok: true, output: "" }),
    };
    const ctx = await svc.analyzeRepo(io);
    expect(ctx.stack).toBe(stack);
    expect(ctx.testCommand).toBe(cmd);
  });

  it('uses a Makefile test target when present', async () => {
    const io: RepoIo = {
      listFiles: async () => "Makefile\nmain.c",
      readFile: async (p) => (p === "Makefile" ? "test:\n\t./run-tests.sh\n" : "x"),
      sh: async () => ({ ok: true, output: "" }),
    };
    const ctx = await svc.analyzeRepo(io);
    expect(ctx.stack).toBe("make");
    expect(ctx.testCommand).toBe("make test");
  });

  it('flags greenfield when only markdown is present', async () => {
    const io: RepoIo = {
      listFiles: async () => 'README.md\nPRAXIS_NOTES.md',
      readFile: async () => '# hi',
      sh: async () => ({ ok: true, output: '' }),
    };
    const ctx = await svc.analyzeRepo(io);
    expect(ctx.greenfield).toBe(true);
    expect(ctx.stack).toBe('unknown');
  });
});
