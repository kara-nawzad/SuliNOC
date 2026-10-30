import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/** Phone layout contracts for the two panels that were unusable on a 390 px
 *  screen: the site inspector sheet and the towers list.
 *
 *  There is no layout engine in this test runner, so these assertions pin the
 *  rules that make the phone layouts work — and, just as important, that the
 *  desktop rules they replace are still there.
 */
const styles = readFileSync("src/styles/app.css", "utf8");

/** The block from the last matching media query to the end of the file, so an
 *  earlier desktop rule cannot satisfy a phone assertion by accident. */
function phoneBlock(query: string) {
  const start = styles.lastIndexOf(`@media ${query}`);
  expect(start).toBeGreaterThan(-1);
  return styles.slice(start);
}

describe("phone panels", () => {
  const phone = phoneBlock("(max-width: 767px)");

  it("sizes the inspector sheet to a peek, not the whole screen", () => {
    expect(phone).toMatch(
      /\.app-shell \.inspector\s*\{[^}]*max-height:\s*min\(62dvh,\s*560px\)/s,
    );
    // Older browsers that do not parse min()/dvh keep the plain fallback.
    expect(phone).toMatch(/\.app-shell \.inspector\s*\{[^}]*max-height:\s*62vh/s);
    expect(phone).toMatch(
      /\.app-shell \.inspector\s*\{[^}]*overscroll-behavior:\s*contain/s,
    );
    // Desktop still gets the fixed side panel it has always had.
    expect(styles).toMatch(/\.inspector\s*\{[^}]*width:\s*330px/s);
  });

  it("lays the towers table out as two lines per row instead of a sideways scroll", () => {
    const narrow = phoneBlock("(max-width: 600px)");
    expect(narrow).toMatch(
      /\.app-shell \.tower-row\s*\{[^}]*grid-template-columns:\s*repeat\(4,\s*minmax\(0,\s*1fr\)\)/s,
    );
    expect(narrow).toMatch(/\.app-shell \.tower-row\s*\{[^}]*min-width:\s*0/s);
    expect(narrow).toMatch(
      /\.app-shell \.tower-table\s*\{[^}]*overflow-x:\s*hidden/s,
    );
    // Site id and status share the first line; the readings sit on the second.
    for (const [child, column] of [
      [1, "1 / span 2"],
      [2, "3 / span 2"],
      [3, "1"],
      [4, "2"],
      [5, "3"],
      [6, "4"],
    ] as const) {
      expect(narrow).toMatch(
        new RegExp(
          `\\.app-shell \\.tower-row > span:nth-child\\(${child}\\)\\s*\\{[^}]*grid-column:\\s*${column.replace(
            / \/ /g,
            " / ",
          )}`,
          "s",
        ),
      );
    }
    // The column header is kept for assistive tech but not drawn, so the
    // inline labels below carry the column names.
    expect(narrow).toMatch(
      /\.app-shell \.tower-row\.tower-head\s*\{[^}]*clip-path:\s*inset\(50%\)/s,
    );
    for (const label of ["PRB", "CQI", "RING"]) {
      expect(narrow).toContain(`content: "${label} "`);
    }
    // Desktop keeps its six columns and its sticky header.
    return expect(styles).toMatch(
      /\.app-shell \.tower-row\s*\{\s*grid-template-columns:\s*1\.1fr 1\.3fr 0\.7fr 0\.55fr 0\.55fr 0\.95fr/s,
    );
  });
});
