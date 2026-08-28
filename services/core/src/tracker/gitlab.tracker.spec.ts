import { parseAcceptanceCriteria } from "./gitlab.tracker";

describe("parseAcceptanceCriteria", () => {
  it("pulls a bulleted 'Acceptance criteria' section", () => {
    const body = `Some intro.

## Acceptance criteria
- add() handles negatives
- divide() throws on zero

## Notes
- unrelated bullet`;
    expect(parseAcceptanceCriteria(body)).toEqual([
      "add() handles negatives",
      "divide() throws on zero",
    ]);
  });

  it("pulls markdown checkboxes anywhere", () => {
    const body = `Do the thing.
- [ ] first
- [x] second already done`;
    expect(parseAcceptanceCriteria(body)).toEqual(["first", "second already done"]);
  });

  it("returns [] for a plain description", () => {
    expect(parseAcceptanceCriteria("just fix the bug please")).toEqual([]);
  });

  it("dedupes", () => {
    const body = `## Done when
- x
- x
- [ ] x`;
    expect(parseAcceptanceCriteria(body)).toEqual(["x"]);
  });
});
