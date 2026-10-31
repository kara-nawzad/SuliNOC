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

  it("opens the inspector in the shared floating dialog card", () => {
    // The site inspector now reuses the Maintenance fleet's dialog: a centred
    // floating card with margins on every side, a dimmed blurred backdrop, a
    // header with the close button, and content that scrolls inside the card.
    expect(styles).toMatch(/\.dialog\s*\{[^}]*overflow:\s*auto/);
    expect(styles).toMatch(
      /dialog\.dialog\s*\{[^}]*max-width:\s*calc\(100vw - 32px\)/s,
    );
    expect(styles).toMatch(
      /dialog\.dialog::backdrop[^}]*backdrop-filter:\s*blur/s,
    );
    // On phones the card keeps clear of both screen edges and the bottom bar.
    expect(styles).toMatch(
      /dialog\.dialog\s*\{[^}]*width:\s*calc\(100vw - 24px\)/s,
    );
    expect(styles).toMatch(/dialog\.dialog\s*\{[^}]*max-height:\s*88dvh/s);
    // The old fixed side panel (330 px) and the phone bottom sheet are gone.
    expect(styles).not.toMatch(/\.inspector\s*\{[^}]*position:\s*fixed/);
    expect(styles).not.toMatch(/\.inspector\s*\{[^}]*width:\s*330px/);
    expect(phone).not.toMatch(/min\(50dvh,\s*480px/);
    // The inspector's own typography rules still apply to its content.
    expect(styles).toMatch(/\.inspector \.spec-group/);
  });

  it("keeps the Wave greeting beside the launcher, never stacked above it", () => {
    // The phone rule is the last `.wave-greeting {` in the sheet.
    const from = styles.lastIndexOf(".wave-greeting {");
    expect(from).toBeGreaterThan(-1);
    const greeting = styles.slice(from, styles.indexOf("}", from));
    expect(greeting).toMatch(/right:\s*calc\(var\(--wave-launcher-right\)/);
    // Vertically centred on the launcher: half its size, half a 48 px pill.
    expect(greeting).toMatch(
      /bottom:\s*calc\(\s*var\(--wave-launcher-bottom\)\s*\+\s*var\(--wave-launcher-size\)\s*\/\s*2\s*-\s*24px/s,
    );
    // Not the old "sits 12 px above the launcher's bottom edge" placement.
    expect(greeting).not.toMatch(/\+\s*12px\)/);
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
