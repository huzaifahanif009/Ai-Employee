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
    const r = await svc.review(ask, wi, 'diff --git a/x b/x');
    expect(r).toMatchObject({ verdict: 'pass', summary: 'lgtm' });
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
