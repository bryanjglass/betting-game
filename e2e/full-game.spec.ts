/**
 * End-to-end: one host controller, one TV display (opened from the host's
 * button), and four phones (2× iPhone, 2× Android emulation) play a full
 * five-round game against the real Worker + Durable Object (wrangler dev).
 *
 * Covers exact chip balances every round, including wins, losses, a zero bet,
 * all-in wins and losses, a broke player betting the round allowance, a
 * skipped question, a timeout that finalises an unlocked draft bet, a player
 * who never bets (abstains), refresh recovery, final standings and a rematch.
 *
 * Hands-free: in round 1 the host skips ahead through every phase with the big
 * button; from round 2 on nobody touches the host controller and the server
 * timers carry the game from reveal to reveal and on to the final results.
 */
import { devices, expect, test, type BrowserContext, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";

/** The test reads the server's question bank directly to know which answers are right. */
const bank = JSON.parse(readFileSync(new URL("../shared/data/questions.json", import.meta.url), "utf8")) as {
  questions: { text: string; options: string[]; correctIndex: number }[];
};

const NAMES = ["Abby", "Owen", "Mom", "Dad"] as const;
type Name = (typeof NAMES)[number];
const TIMER = 15;
/** Generous upper bound for any timed reveal/leaderboard phase to move on by itself. */
const PHASE_WAIT = { timeout: 20_000 };

type Wager = number | "zero" | "25" | "50" | "all" | { plus: number };
type Bet = { pick: "right" | "wrong"; wager: Wager; lock?: boolean } | null;

/** The plan. `null` = never touches the phone. Expected balances are hand-checked. */
const ROUNDS: { bets: Record<Name, Bet>; expected: Record<Name, number>; skipFirst?: boolean }[] = [
  {
    // The worked example from the rules, a zero bet, and an all-in loss.
    bets: {
      Abby: { pick: "right", wager: 500 },
      Owen: { pick: "wrong", wager: 500 },
      Mom: { pick: "right", wager: "zero" },
      Dad: { pick: "wrong", wager: "all" },
    },
    expected: { Abby: 1750, Owen: 750, Mom: 1250, Dad: 0 },
  },
  {
    // Host skips the first question. Abby all-in win; broke Dad bets the 250 allowance;
    // Mom's unlocked draft is finalised by the timer; Owen never bets (abstains).
    skipFirst: true,
    bets: {
      Abby: { pick: "right", wager: "all" },
      Owen: null,
      Mom: { pick: "wrong", wager: 500, lock: false },
      Dad: { pick: "right", wager: "all" },
    },
    expected: { Abby: 4000, Owen: 1000, Mom: 1000, Dad: 500 },
  },
  {
    bets: {
      Abby: { pick: "wrong", wager: 500 },
      Owen: { pick: "right", wager: "zero" },
      Mom: { pick: "right", wager: "all" },
      Dad: { pick: "wrong", wager: "all" },
    },
    expected: { Abby: 3750, Owen: 1250, Mom: 2500, Dad: 0 },
  },
  {
    // Quick-select 25% / 50%, the +50 stepper, and Dad missing the round entirely.
    bets: {
      Abby: { pick: "right", wager: "25" },
      Owen: { pick: "right", wager: "50" },
      Mom: { pick: "wrong", wager: { plus: 2 } },
      Dad: null,
    },
    expected: { Abby: 5000, Owen: 2250, Mom: 2650, Dad: 250 },
  },
  {
    bets: {
      Abby: { pick: "right", wager: "zero" },
      Owen: { pick: "wrong", wager: "all" },
      Mom: { pick: "right", wager: "50" },
      Dad: { pick: "right", wager: "all" },
    },
    expected: { Abby: 5250, Owen: 0, Mom: 4350, Dad: 1000 },
  },
];

const correctAnswerFor = (questionText: string): string => {
  const q = bank.questions.find((x) => x.text === questionText);
  if (!q) throw new Error(`Question not in bank: ${questionText}`);
  return q.options[q.correctIndex]!;
};

async function readStandings(page: Page, testId: string): Promise<Record<string, number>> {
  const out: Record<string, number> = {};
  for (const row of await page.getByTestId(testId).all()) out[(await row.getAttribute("data-name"))!] = Number(await row.getAttribute("data-chips"));
  return out;
}

/** Set a React-controlled range input. */
async function setSlider(page: Page, value: number) {
  await page.getByTestId("wager-slider").evaluate((el, v) => {
    const input = el as HTMLInputElement;
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, String(v));
    input.dispatchEvent(new Event("input", { bubbles: true }));
  }, value);
}

async function pickOption(page: Page, correct: string, pick: "right" | "wrong") {
  for (let i = 0; i < 4; i++) {
    const option = page.getByTestId(`option-${i}`);
    const text = await option.getAttribute("data-option-text");
    if ((text === correct) === (pick === "right")) {
      await option.click();
      await expect(option).toHaveAttribute("aria-checked", "true");
      return;
    }
  }
  throw new Error("option not found");
}

async function placeBet(page: Page, bet: NonNullable<Bet>, correct: string, last: boolean) {
  await pickOption(page, correct, bet.pick);
  const w = bet.wager;
  if (typeof w === "number") await setSlider(page, w);
  else if (typeof w === "object") for (let i = 0; i < w.plus; i++) await page.getByTestId("wager-plus").click();
  else await page.getByTestId(`wager-quick-${w}`).click();
  if (bet.lock === false) {
    await expect(page.getByTestId("bet-sync")).toContainText("Saved");
    return;
  }
  await page.getByTestId("lock-bet").click();
  // The last lock closes betting for everyone, so the locked card may be skipped.
  if (!last) await expect(page.getByTestId("bet-locked")).toBeVisible();
}

test("host, TV and four phones play a full five-round game with exact chip balances, then a rematch", async ({ browser }) => {
  test.setTimeout(420_000); // rounds 2–5 run at the real timer pace
  // ---- Host + TV -----------------------------------------------------------
  const hostCtx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const host = await hostCtx.newPage();
  host.on("dialog", (d) => d.accept());
  await host.goto("/");
  await host.getByTestId("create-room").click();
  const code = (await host.getByTestId("room-code").textContent())!.trim();
  expect(code).toMatch(/^[A-Z]{4}$/);

  const [tv] = await Promise.all([hostCtx.waitForEvent("page"), host.getByTestId("open-tv").click()]);
  await tv.setViewportSize({ width: 1920, height: 1080 });
  await tv.emulateMedia({ reducedMotion: "reduce" });
  await expect(tv.getByTestId("tv-room-code")).toHaveText(code);
  await expect(host.getByTestId("tv-status")).toContainText("TV connected");

  // ---- Players join ----------------------------------------------------------
  const phoneDevices = [devices["iPhone 13"], devices["Pixel 7"], devices["iPhone 13"], devices["Pixel 7"]];
  const phones = {} as Record<Name, Page>;
  const contexts: BrowserContext[] = [];
  for (const [i, name] of NAMES.entries()) {
    const { defaultBrowserType: _ignored, ...device } = phoneDevices[i]!;
    const ctx = await browser.newContext({ ...device, reducedMotion: "reduce" });
    contexts.push(ctx);
    const page = await ctx.newPage();
    if (i === 0) {
      // First player types the room code; the others use the QR-code link.
      await page.goto("/");
      await page.getByTestId("join-code").fill(code.toLowerCase());
      await page.getByTestId("join-go").click();
    } else {
      await page.goto(`/#/play/${code}`);
    }
    await page.getByTestId("name-input").fill(name);
    await page.getByTestId(`avatar-${i * 3}`).click();
    await page.getByTestId("join-submit").click();
    await expect(page.getByTestId("lobby-wait")).toBeVisible();
    phones[name] = page;
  }
  await expect(tv.getByTestId("tv-lobby-players")).toContainText("Dad");
  await expect(host.getByTestId("player-count")).toHaveText("4 / 10");

  // Duplicate names (case-insensitive) are rejected.
  const dupCtx = await browser.newContext({ ...devices["Pixel 7"] });
  const dup = await dupCtx.newPage();
  await dup.goto(`/#/play/${code}`);
  await dup.getByTestId("name-input").fill("mOM");
  await dup.getByTestId("join-submit").click();
  await expect(dup.getByTestId("join-error")).toContainText("already taken");
  await dupCtx.close();

  // ---- Configure + start ----------------------------------------------------------
  await host.getByTestId("rounds-5").click();
  await host.getByTestId(`timer-${TIMER}`).click();
  await expect(host.getByTestId(`timer-${TIMER}`)).toHaveAttribute("aria-checked", "true");
  await host.getByTestId("host-primary").click(); // Start Game
  for (const n of NAMES) await expect(phones[n].getByTestId("me-chips")).toHaveText("1,000");

  let balances: Record<Name, number> = { Abby: 1000, Owen: 1000, Mom: 1000, Dad: 1000 };

  for (const [r, round] of ROUNDS.entries()) {
    const number = r + 1;
    const hostSkipsAhead = number === 1;
    await expect(tv.getByTestId("tv-app")).toHaveAttribute("data-phase", "betting", PHASE_WAIT);
    await expect(tv.getByTestId("tv-round")).toContainText(`Round ${number}`);

    if (round.skipFirst) {
      const skipped = (await tv.getByTestId("tv-question-text").textContent())!;
      await host.getByTestId("skip-question").click();
      await expect(tv.getByTestId("tv-question-text")).not.toHaveText(skipped);
      await expect(tv.getByTestId("tv-round")).toContainText(`Round ${number}`);
      for (const n of NAMES) await expect(phones[n].getByTestId("me-chips")).toHaveText(balances[n].toLocaleString("en-US"));
    }

    const question = (await tv.getByTestId("tv-question-text").textContent())!;
    const correct = correctAnswerFor(question);
    for (const n of NAMES) await expect(phones[n].getByTestId("phone-question")).toHaveText(question);

    // Bets are secret: nothing about wagers or results is on the TV.
    await expect(tv.getByTestId("tv-wager")).toHaveCount(0);
    await expect(tv.getByTestId("tv-correct-option")).toHaveCount(0);

    const betting = NAMES.filter((n) => round.bets[n]);
    const lockers = betting.filter((n) => round.bets[n]!.lock !== false);
    const everyoneLocks = lockers.length === NAMES.length;

    // Refresh recovery mid-round: a phone reload restores identity and balance.
    if (number === 3) {
      await phones.Owen.reload();
      await expect(phones.Owen.getByTestId("me-name")).toHaveText("Owen");
      await expect(phones.Owen.getByTestId("me-chips")).toHaveText(balances.Owen.toLocaleString("en-US"));
    }

    for (const n of betting) {
      const bet = round.bets[n]!;
      const isLast = everyoneLocks && n === lockers[lockers.length - 1];
      if (number === 1 && n === "Abby") {
        // The wager controls show exactly what's at risk and both outcomes.
        await pickOption(phones.Abby, correct, "right");
        await setSlider(phones.Abby, 500);
        await expect(phones.Abby.getByTestId("wager-amount")).toHaveText("500");
        await expect(phones.Abby.getByTestId("if-right")).toHaveText("1,750");
        await expect(phones.Abby.getByTestId("if-wrong")).toHaveText("750");
        // Edit before locking: change the answer, then change it back.
        await pickOption(phones.Abby, correct, "wrong");
        await pickOption(phones.Abby, correct, "right");
        await phones.Abby.getByTestId("lock-bet").click();
        await expect(phones.Abby.getByTestId("bet-locked")).toBeVisible();
        continue;
      }
      await placeBet(phones[n], bet, correct, isLast);
    }

    if (!everyoneLocks) {
      await expect(tv.getByTestId("tv-locked-count")).toContainText(String(lockers.length));
      // The server timer closes betting.
      await expect(tv.getByTestId("tv-app")).toHaveAttribute("data-phase", "wagerReveal", { timeout: (TIMER + 10) * 1000 });
    }

    // ---- Wager reveal: amounts public, answers still hidden ----
    await expect(tv.getByTestId("tv-app")).toHaveAttribute("data-phase", "wagerReveal");
    await expect(tv.getByTestId("tv-wager")).toHaveCount(NAMES.length);
    await expect(tv.getByTestId("tv-correct-option")).toHaveCount(0);
    const expectedWagers = Object.fromEntries(
      NAMES.map((n) => {
        const bet = round.bets[n];
        if (!bet) return [n, 0];
        const after = round.expected[n];
        return [n, Math.abs(after - balances[n] - 250)];
      }),
    );
    for (const n of NAMES) {
      await expect(tv.locator(`[data-testid=tv-wager][data-name="${n}"]`)).toHaveAttribute("data-wager", String(expectedWagers[n]));
    }
    await expect(host.getByTestId("host-app")).toHaveAttribute("data-phase", "wagerReveal");
    await expect(host.getByTestId("host-autopilot")).toContainText("runs itself");
    if (hostSkipsAhead) await host.getByTestId("host-primary").click(); // Reveal the answer now

    // ---- Answer reveal ----
    await expect(tv.getByTestId("tv-app")).toHaveAttribute("data-phase", "answerReveal", PHASE_WAIT);
    await expect(tv.getByTestId("tv-correct-option")).toContainText(correct);
    for (const n of NAMES) {
      const result = tv.locator(`[data-testid=tv-result][data-name="${n}"]`);
      await expect(result).toHaveAttribute("data-after", String(round.expected[n]));
      const bet = round.bets[n];
      await expect(result).toHaveAttribute("data-outcome", bet ? (bet.pick === "right" ? "won" : "lost") : "abstained");
      await expect(phones[n].getByTestId("my-result")).toHaveAttribute("data-outcome", bet ? (bet.pick === "right" ? "won" : "lost") : "abstained");
    }
    if (number === 1) await expect(tv.locator(`[data-testid=tv-result][data-name="Dad"]`)).toContainText("BUSTED");
    if (number === 2) await expect(tv.locator(`[data-testid=tv-result][data-name="Abby"]`)).toContainText("ALL-IN WIN");
    if (hostSkipsAhead) await host.getByTestId("host-primary").click(); // Show leaderboard now

    // ---- Scoreboard: exact balances everywhere ----
    await expect(tv.getByTestId("tv-app")).toHaveAttribute("data-phase", "scoreboard", PHASE_WAIT);
    balances = { ...round.expected };
    await expect.poll(() => readStandings(host, "standing-row")).toEqual(balances);
    await expect.poll(() => readStandings(tv, "tv-standing-row")).toEqual(balances);
    for (const n of NAMES) await expect(phones[n].getByTestId("me-chips")).toHaveText(balances[n].toLocaleString("en-US"));
    await expect(host.getByTestId("host-app")).toHaveAttribute("data-phase", "scoreboard");
    const nextUp = number === ROUNDS.length ? "Final results in" : "Next question in";
    await expect(tv.getByTestId("tv-next-countdown")).toContainText(nextUp);
    await expect(phones.Abby.getByTestId("next-countdown")).toContainText(nextUp);
    if (number === 3) {
      // The host can pause to linger on the leaderboard; everyone sees it, then it carries on.
      await host.getByTestId("pause").click();
      await expect(tv.getByTestId("tv-paused")).toBeVisible();
      await expect(host.getByTestId("host-autopilot")).toContainText("Paused");
      await expect(tv.getByTestId("tv-app")).toHaveAttribute("data-phase", "scoreboard");
      await host.getByTestId("resume").click();
      await expect(tv.getByTestId("tv-paused")).toHaveCount(0);
    }
    if (hostSkipsAhead) await host.getByTestId("host-primary").click(); // Next question now
  }

  // ---- Final results (reached with no host input) ----
  await expect(tv.getByTestId("tv-app")).toHaveAttribute("data-phase", "gameOver", PHASE_WAIT);
  await expect(tv.getByTestId("tv-winners")).toHaveText("Abby");
  await expect.poll(() => readStandings(tv, "tv-standing-row")).toEqual({ Abby: 5250, Mom: 4350, Dad: 1000, Owen: 0 });
  await expect
    .poll(() => tv.getByTestId("tv-standing-row").evaluateAll((rows) => rows.map((r) => `${r.getAttribute("data-rank")}:${r.getAttribute("data-name")}`)))
    .toEqual(["1:Abby", "2:Mom", "3:Dad", "4:Owen"]);
  await expect(phones.Abby.getByTestId("final-phone")).toContainText("You won!");
  await expect(phones.Owen.getByTestId("final-chips")).toHaveAttribute("data-chips", "0");

  // Final results survive a TV and host refresh.
  await tv.reload();
  await expect.poll(() => readStandings(tv, "tv-standing-row")).toEqual({ Abby: 5250, Mom: 4350, Dad: 1000, Owen: 0 });
  await host.reload();
  await expect(host.getByTestId("host-app")).toHaveAttribute("data-phase", "gameOver");

  // ---- Rematch: same roster, fresh balances and questions ----
  await host.getByTestId("host-primary").click(); // Rematch
  await expect(tv.getByTestId("tv-app")).toHaveAttribute("data-phase", "betting");
  await expect(tv.getByTestId("tv-round")).toContainText("Round 1");
  for (const n of NAMES) {
    await expect(phones[n].getByTestId("me-name")).toHaveText(n);
    await expect(phones[n].getByTestId("me-chips")).toHaveText("1,000");
  }
  // One quick bet in the rematch proves betting works on fresh balances.
  const q = (await tv.getByTestId("tv-question-text").textContent())!;
  await placeBet(phones.Abby, { pick: "right", wager: "all" }, correctAnswerFor(q), false);
  await expect(phones.Abby.getByTestId("my-bet-summary")).toContainText("1,250");

  for (const c of contexts) await c.close();
  await hostCtx.close();
});
