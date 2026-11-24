/**
 * Drives the real RoomCore (the code inside the Durable Object) through fake
 * sockets, storage and alarms. Covers the betting rules, server-authoritative
 * scoring, secrecy, idempotency, timers, hibernation and reconnection.
 */
import { describe, expect, it } from "vitest";
import { CHIPS, LIMITS } from "../../shared/constants";
import type { ClientView } from "../../shared/views";
import {
  correctChoice,
  createRoom,
  currentDeal,
  FakeWorld,
  hostAdvance,
  joinPlayer,
  lockBet,
  setBet,
  setupRoom,
  wrongChoice,
  type FakeSocket,
  type TestRoom,
} from "../helpers";

const P = (room: TestRoom, name: string) => room.players.find((p) => p.name === name)!;
const chips = (room: TestRoom) => Object.fromEntries(room.world.state.players.map((p) => [p.name, p.chips]));
const TIMER_MS = 30_000;

type Plan = { pick: "right" | "wrong" | null; wager: number; lock?: boolean };

/** Place bets per plan (locked unless lock: false). */
async function placeBets(room: TestRoom, plan: Record<string, Plan>) {
  for (const [name, b] of Object.entries(plan)) {
    if (room.world.state.phase !== "betting") break;
    const choice = b.pick === null ? null : b.pick === "right" ? correctChoice(room.world) : wrongChoice(room.world);
    if (b.lock === false || choice === null) await setBet(room.world, P(room, name).socket, choice, b.wager);
    else await lockBet(room.world, P(room, name).socket, choice, b.wager);
  }
}

/** From betting: close (if needed), reveal wagers, reveal answer, show scoreboard. */
async function finishRound(room: TestRoom) {
  const w = room.world;
  if (w.state.phase === "betting") await hostAdvance(w, room.host);
  expect(w.state.phase).toBe("wagerReveal");
  await hostAdvance(w, room.host);
  expect(w.state.phase).toBe("answerReveal");
  await hostAdvance(w, room.host);
  expect(w.state.phase).toBe("scoreboard");
}

async function start(room: TestRoom, config: Partial<ClientView["config"]> = {}) {
  if (Object.keys(config).length) await room.world.act(room.host, { type: "configure", config });
  await room.world.act(room.host, { type: "start" });
  expect(room.world.state.phase).toBe("betting");
}

/** Every message ever sent to a socket, as raw JSON strings. */
const wire = (s: FakeSocket) => s.sent.join("\n");

// ---------------------------------------------------------------------------

describe("lobby & multiplayer", () => {
  it("creates a room once; the same code cannot be created twice", async () => {
    const world = new FakeWorld();
    expect(await world.core.create("BCDF", "h1")).toBe(true);
    expect(await world.core.create("BCDF", "h2")).toBe(false);
    expect(world.state.hostToken).toBe("h1");
    expect(world.core.info()).toMatchObject({ exists: true, phase: "lobby", joinable: true });
  });

  it("updates every lobby screen in real time as players join", async () => {
    const { world, host, tv } = await createRoom();
    await joinPlayer(world, "Abby", 0);
    expect(tv.lastView().players.map((p) => p.name)).toEqual(["Abby"]);
    expect(host.lastView().players[0]).toMatchObject({ name: "Abby", connected: true, chips: CHIPS.starting });
    await joinPlayer(world, "Owen", 1);
    expect(tv.lastView().players.map((p) => p.name)).toEqual(["Abby", "Owen"]);
  });

  it("requires unique names (case-insensitive) and valid, unique avatars", async () => {
    const { world } = await createRoom();
    await joinPlayer(world, "  Abby  ", 0);
    expect(world.state.players[0]!.name).toBe("Abby");
    const s = world.connect();
    await world.send(s, { type: "hello", role: "player" });
    for (const [name, avatar, code] of [
      ["   ", 3, "invalid"],
      ["ABBY", 3, "name_taken"],
      ["x".repeat(LIMITS.maxNameLength + 1), 3, "invalid"],
      ["Owen", 0, "invalid"],
      ["Owen", 99, "invalid"],
    ] as const) {
      await world.act(s, { type: "join", name, avatar });
      expect(s.lastError()?.code).toBe(code);
    }
    expect(world.state.players).toHaveLength(1);
  });

  it("supports 2–10 players: refuses an 11th and won't start with one", async () => {
    const { world, host } = await createRoom();
    await joinPlayer(world, "Solo", 0);
    await world.act(host, { type: "start" });
    expect(host.lastError()?.code).toBe("not_enough_players");
    expect(host.lastView().host!.canStart).toBe(false);
    for (let i = 1; i < LIMITS.maxPlayers; i++) await joinPlayer(world, `P${i}`, i);
    expect(host.lastView().host!.canStart).toBe(true);
    const late = world.connect();
    await world.send(late, { type: "hello", role: "player" });
    await world.act(late, { type: "join", name: "Eleven", avatar: 12 });
    expect(late.lastError()?.code).toBe("room_full");
  });

  it("lets the host configure rounds, timer and categories, validating each", async () => {
    const room = await setupRoom(["A", "B"]);
    const { world, host } = room;
    await world.act(host, { type: "configure", config: { rounds: 15, bettingSeconds: 45, categories: ["sports", "history"] } });
    expect(world.state.config).toEqual({ rounds: 15, bettingSeconds: 45, categories: ["sports", "history"] });
    for (const bad of [{ rounds: 7 }, { bettingSeconds: 20 }, { categories: [] }]) {
      await world.act(host, { type: "configure", config: bad });
      expect(host.lastError()?.code).toBe("invalid");
    }
    // 20 rounds needs more questions than a single category has.
    await world.act(host, { type: "configure", config: { rounds: 20, categories: ["sports"] } });
    expect(host.lastView().host!.startBlockers.join()).toMatch(/Not enough questions/);
    await world.act(host, { type: "start" });
    expect(world.state.phase).toBe("lobby");
  });

  it("only the authorised host can control the game", async () => {
    const room = await setupRoom(["A", "B"]);
    const { world } = room;
    const imposter = world.connect();
    await world.send(imposter, { type: "hello", role: "host", token: "wrong" });
    expect(imposter.lastError()?.code).toBe("invalid_token");
    await world.act(imposter, { type: "start" });
    expect(imposter.lastError()?.code).toBe("not_authenticated");
    for (const s of [room.tv, P(room, "A").socket]) {
      await world.act(s, { type: "start" });
      expect(s.lastError()?.code).toBe("unauthorized");
      await world.act(s, { type: "configure", config: { rounds: 5 } });
      expect(s.lastError()?.code).toBe("unauthorized");
    }
    expect(world.state.phase).toBe("lobby");
  });

  it("starts every player with exactly 1,000 chips", async () => {
    const room = await setupRoom();
    await start(room);
    expect(Object.values(chips(room))).toEqual([1000, 1000, 1000, 1000]);
    expect(P(room, "Abby").socket.lastView().me).toMatchObject({ chips: 1000, available: 1250 });
  });
});

describe("questions", () => {
  it("deals 4 shuffled options without the answer, and never repeats a question in a game", async () => {
    const room = await setupRoom(["A", "B"]);
    await start(room, { rounds: 20 });
    const seen = new Set<string>();
    const correctSlots = new Set<number>();
    for (let i = 0; i < 20; i++) {
      const view = room.tv.lastView();
      expect(view.round!.question.options).toHaveLength(4);
      expect(seen.has(view.round!.question.id)).toBe(false);
      seen.add(view.round!.question.id);
      correctSlots.add(correctChoice(room.world));
      // Skip a few to make sure skipped questions aren't reused either.
      if (i % 5 === 0) {
        await room.world.act(room.host, { type: "skipQuestion", ...currentDeal(room.world) });
        seen.add(room.tv.lastView().round!.question.id);
      }
      await finishRound(room);
      await hostAdvance(room.world, room.host);
    }
    expect(room.world.state.phase).toBe("gameOver");
    expect(room.world.state.usedQuestionIds.length).toBe(24);
    expect(new Set(room.world.state.usedQuestionIds).size).toBe(24);
    expect(correctSlots.size).toBeGreaterThan(1); // answer order is randomised
  });

  it("only uses the selected categories", async () => {
    const room = await setupRoom(["A", "B"]);
    await start(room, { rounds: 5, categories: ["weird"] });
    for (let i = 0; i < 5; i++) {
      expect(room.world.state.round!.category).toBe("weird");
      await finishRound(room);
      await hostAdvance(room.world, room.host);
    }
  });
});

describe("betting", () => {
  it("validates wagers: 0..balance+250, multiples of 50", async () => {
    const room = await setupRoom(["A", "B"]);
    await start(room);
    const a = P(room, "A").socket;
    for (const wager of [1300, 75, 25]) {
      await setBet(room.world, a, 0, wager);
      expect(a.lastError()?.code).toBe("invalid_wager");
      await lockBet(room.world, a, 0, wager);
      expect(a.lastError()?.code).toBe("invalid_wager");
    }
    await setBet(room.world, a, 0, -50);
    expect(a.lastError()?.code).toBe("bad_message"); // rejected by the schema
    await setBet(room.world, a, 7 as never, 100);
    expect(a.lastError()?.code).toBe("bad_message");
    expect(room.world.state.round!.bets).toEqual({});
    await lockBet(room.world, a, 0, 1250);
    expect(room.world.state.round!.locked).toEqual([P(room, "A").id]);
  });

  it("lets players edit answers and wagers until they lock, then refuses changes", async () => {
    const room = await setupRoom(["A", "B"]);
    await start(room);
    const a = P(room, "A");
    await setBet(room.world, a.socket, 1, 100, "d1");
    await setBet(room.world, a.socket, 2, 300, "d2");
    expect(a.socket.lastView().me!.bet).toEqual({ choice: 2, wager: 300 });
    await lockBet(room.world, a.socket, 3, 400, "l1");
    expect(a.socket.lastView().me).toMatchObject({ locked: true, bet: { choice: 3, wager: 400 } });
    await setBet(room.world, a.socket, 0, 50);
    expect(a.socket.lastError()?.code).toBe("already_locked");
    await lockBet(room.world, a.socket, 0, 50);
    expect(a.socket.lastError()?.code).toBe("already_locked");
    expect(room.world.state.round!.bets[a.id]).toMatchObject({ choice: 3, wager: 400 });
  });

  it("treats a repeated lock message as idempotent (acknowledged, not duplicated)", async () => {
    const room = await setupRoom(["A", "B", "C"]);
    await start(room);
    const a = P(room, "A").socket;
    const version = room.world.state.version;
    await lockBet(room.world, a, 1, 200, "x1");
    await lockBet(room.world, a, 1, 200, "x2");
    await room.world.send(a, { type: "action", ref: "x1", action: { type: "lockBet", ...currentDeal(room.world), choice: 1, wager: 200 } });
    expect(room.world.state.round!.locked).toEqual([P(room, "A").id]);
    expect(room.world.state.version).toBe(version + 1);
    expect(a.messages().filter((m) => m.type === "ack").map((m) => (m as { ref: string }).ref).slice(-3)).toEqual(["x1", "x2", "x1"]);
  });

  it("keeps answers and wagers private while betting: others only see who has locked in", async () => {
    const room = await setupRoom(["A", "B", "C"]);
    await start(room);
    await lockBet(room.world, P(room, "A").socket, 2, 750);
    await setBet(room.world, P(room, "B").socket, 1, 650);
    for (const s of [room.tv, room.host, P(room, "C").socket, P(room, "B").socket]) {
      const v = s.lastView();
      expect(v.round!.lockedIds).toEqual([P(room, "A").id]);
      expect(v.round!.wagers).toBeNull();
      expect(v.round!.reveal).toBeNull();
      expect(wire(s)).not.toMatch(/"wager":750/);
    }
    for (const s of [room.tv, room.host, P(room, "A").socket, P(room, "C").socket]) expect(wire(s)).not.toMatch(/"wager":650/);
    expect(P(room, "B").socket.lastView().me!.bet).toEqual({ choice: 1, wager: 650 });
    expect(P(room, "C").socket.lastView().me!.bet).toBeNull();
  });

  it("closes betting automatically when every player locks in", async () => {
    const room = await setupRoom(["A", "B"]);
    await start(room);
    await lockBet(room.world, P(room, "A").socket, 0, 100);
    expect(room.world.state.phase).toBe("betting");
    expect(room.tv.lastView().round!.lockedIds).toHaveLength(1);
    await lockBet(room.world, P(room, "B").socket, 1, 100);
    expect(room.world.state.phase).toBe("wagerReveal");
    expect(room.world.state.timer).toBeNull();
  });

  it("on timeout, finalises the last valid draft and treats players with no answer as abstaining", async () => {
    const room = await setupRoom(["A", "B", "C", "D"]);
    await start(room);
    const w = room.world;
    await setBet(w, P(room, "A").socket, correctChoice(w), 200); // draft, never locked
    await setBet(w, P(room, "A").socket, correctChoice(w), 400); // last valid draft wins
    await setBet(w, P(room, "A").socket, correctChoice(w), 4000); // invalid → rejected, 400 stands
    await setBet(w, P(room, "B").socket, null, 500); // a wager but no answer → abstain
    await lockBet(w, P(room, "C").socket, wrongChoice(w), 300);
    // D never touches their phone.
    await w.advance(TIMER_MS);
    expect(w.state.phase).toBe("wagerReveal");
    const wagers = Object.fromEntries(room.tv.lastView().round!.wagers!.map((x) => [x.playerId, x]));
    expect(wagers[P(room, "A").id]).toMatchObject({ wager: 400, abstained: false });
    expect(wagers[P(room, "B").id]).toMatchObject({ wager: 0, abstained: true });
    expect(wagers[P(room, "D").id]).toMatchObject({ wager: 0, abstained: true });
    await hostAdvance(w, room.host);
    expect(chips(room)).toEqual({ A: 1650, B: 1250, C: 950, D: 1250 });
  });

  it("rejects late, stale, unauthorised and guest submissions", async () => {
    const room = await setupRoom(["A", "B"]);
    await start(room);
    const w = room.world;
    const deal = currentDeal(w);
    // TV and host can't bet.
    for (const s of [room.tv, room.host]) {
      await w.act(s, { type: "lockBet", ...deal, choice: 0, wager: 0 });
      expect(s.lastError()?.code).toBe("unauthorized");
    }
    // A guest (unknown token) can't bet either.
    const guest = w.connect();
    await w.send(guest, { type: "hello", role: "player", token: "forged-token" });
    expect(guest.lastError()?.code).toBe("invalid_token");
    await w.act(guest, { type: "lockBet", ...deal, choice: 0, wager: 0 });
    expect(guest.lastError()?.code).toBe("unauthorized");
    // Wrong round / skipped question.
    const a = P(room, "A").socket;
    await w.act(a, { type: "lockBet", round: 2, dealId: deal.dealId, choice: 0, wager: 0 });
    expect(a.lastError()?.code).toBe("wrong_phase");
    await w.act(a, { type: "lockBet", round: 1, dealId: "d_bogus", choice: 0, wager: 0 });
    expect(a.lastError()?.code).toBe("stale");
    // Late: the clock passes the deadline (even before the alarm fires).
    w.now += TIMER_MS + 1;
    await w.act(a, { type: "setBet", ...deal, choice: 0, wager: 100 });
    expect(a.lastError()?.code).toBe("too_late");
    expect(w.state.phase).toBe("wagerReveal");
    expect(w.state.round!.finalBets![P(room, "A").id]).toMatchObject({ choice: null, wager: 0 });
  });

  it("doesn't let a disconnected player block the round once their grace period ends", async () => {
    const room = await setupRoom(["A", "B", "C"]);
    await start(room);
    const w = room.world;
    await w.disconnect(P(room, "C").socket);
    await lockBet(w, P(room, "A").socket, 0, 50);
    await lockBet(w, P(room, "B").socket, 0, 50);
    expect(w.state.phase).toBe("betting"); // C still within the grace period
    await w.advance(LIMITS.presenceGraceMs + 10);
    expect(w.state.phase).toBe("wagerReveal");
  });
});

describe("reveal & scoring", () => {
  it("reveals wagers first (answers hidden), then the answer and everyone's picks", async () => {
    const room = await setupRoom(["A", "B", "C"]);
    await start(room);
    const w = room.world;
    const fact = w.state.round!.fact;
    const source = w.state.round!.source;
    await placeBets(room, { A: { pick: "right", wager: 1250 }, B: { pick: "wrong", wager: 650 }, C: { pick: "right", wager: 0 } });
    expect(w.state.phase).toBe("wagerReveal");
    for (const s of [room.tv, room.host, P(room, "C").socket]) {
      const v = s.lastView();
      expect(v.round!.wagers!.map((x) => [x.wager, x.allIn, x.bigBet])).toEqual([
        [1250, true, true],
        [650, false, true],
        [0, false, false],
      ]);
      expect(v.round!.reveal).toBeNull();
      expect(JSON.stringify(v.round!.wagers)).not.toMatch(/choice/);
      expect(wire(s)).not.toMatch(/correctIndex/);
      if (fact) expect(wire(s)).not.toContain(JSON.stringify(fact).slice(1, -1));
      expect(wire(s)).not.toContain(JSON.stringify(source).slice(1, -1));
    }
    // Chips don't move until the answer is revealed.
    expect(chips(room)).toEqual({ A: 1000, B: 1000, C: 1000 });

    await hostAdvance(w, room.host);
    const v = room.tv.lastView();
    expect(v.phase).toBe("answerReveal");
    expect(v.round!.reveal!.correctIndex).toBe(correctChoice(w));
    expect(v.round!.reveal!.source).toBe(source);
    const byId = Object.fromEntries(v.round!.reveal!.results.map((r) => [r.playerId, r]));
    expect(byId[P(room, "A").id]).toMatchObject({ outcome: "won", wagerDelta: 1250, before: 1000, after: 2500, allIn: true });
    expect(byId[P(room, "B").id]).toMatchObject({ outcome: "lost", wagerDelta: -650, after: 600, choice: wrongChoice(w) });
    expect(byId[P(room, "C").id]).toMatchObject({ outcome: "won", wagerDelta: 0, after: 1250 });
    expect(v.round!.reveal!.pickers[correctChoice(w)]).toEqual([P(room, "A").id, P(room, "C").id]);
    expect(P(room, "B").socket.lastView().me!.result).toMatchObject({ outcome: "lost", after: 600 });
    expect(chips(room)).toEqual({ A: 2500, B: 600, C: 1250 });
  });

  it("plays several rounds with exact balances: wins, losses, zero, all-in, abstain, bust and recovery", async () => {
    const room = await setupRoom(["Abby", "Owen", "Mom", "Dad"]);
    await start(room, { rounds: 5 });
    const expected: Record<string, number>[] = [
      { Abby: 1750, Owen: 750, Mom: 1250, Dad: 0 },
      { Abby: 4000, Owen: 1000, Mom: 1000, Dad: 500 },
      { Abby: 3750, Owen: 1250, Mom: 2500, Dad: 0 },
    ];
    // Round 1: the worked example, plus an all-in loss.
    await placeBets(room, {
      Abby: { pick: "right", wager: 500 },
      Owen: { pick: "wrong", wager: 500 },
      Mom: { pick: "right", wager: 0 },
      Dad: { pick: "wrong", wager: 1250 },
    });
    await finishRound(room);
    expect(chips(room)).toEqual(expected[0]);
    await hostAdvance(room.world, room.host);
    // Round 2: Abby all-in win; Dad (broke) bets the allowance and wins; Owen abstains; Mom loses.
    await placeBets(room, {
      Abby: { pick: "right", wager: 2000 }, // all in: 1,750 + 250
      Dad: { pick: "right", wager: 250 },
      Mom: { pick: "wrong", wager: 500 },
      Owen: { pick: null, wager: 0 },
    });
    await finishRound(room);
    expect(chips(room)).toEqual(expected[1]);
    await hostAdvance(room.world, room.host);
    // Round 3: Dad all-in loss back to zero; Mom all-in win.
    await placeBets(room, {
      Abby: { pick: "wrong", wager: 500 },
      Owen: { pick: "right", wager: 0 },
      Mom: { pick: "right", wager: 1250 },
      Dad: { pick: "wrong", wager: 750 },
    });
    await finishRound(room);
    expect(chips(room)).toEqual(expected[2]);
    for (const s of [room.tv, room.host, ...room.players.map((p) => p.socket)]) {
      expect(Object.fromEntries(s.lastView().players.map((p) => [p.name, p.chips]))).toEqual(expected[2]);
    }
    expect(room.tv.lastView().scoreboard!.standings.map((r) => [r.name, r.rank, r.previousRank])).toEqual([
      ["Abby", 1, 1],
      ["Mom", 2, 2],
      ["Owen", 3, 2],
      ["Dad", 4, 4],
    ]);
  });

  it("applies chips exactly once, however many times the host clicks or messages replay", async () => {
    const room = await setupRoom(["A", "B"]);
    await start(room);
    const w = room.world;
    await placeBets(room, { A: { pick: "right", wager: 500 }, B: { pick: "wrong", wager: 500 } });
    const advance = { type: "action", ref: "adv", action: { type: "advance", from: { phase: "wagerReveal", round: 1, dealId: w.state.round!.dealId } } };
    await w.send(room.host, advance);
    await w.send(room.host, advance);
    await w.send(room.host, advance);
    expect(room.host.lastError()?.code).toBe("stale");
    expect(chips(room)).toEqual({ A: 1750, B: 750 });
    expect(w.state.history).toHaveLength(1);
    // Alarms firing repeatedly and hibernation don't re-apply anything.
    await w.core.onAlarm();
    w.hibernate();
    await w.core.onAlarm();
    expect(chips(room)).toEqual({ A: 1750, B: 750 });
  });

  it("skipping a question changes no balances and discards bets", async () => {
    const room = await setupRoom(["A", "B"]);
    await start(room);
    const w = room.world;
    const firstDeal = currentDeal(w);
    await lockBet(w, P(room, "A").socket, correctChoice(w), 1250);
    await w.act(room.host, { type: "skipQuestion", ...firstDeal });
    expect(w.state.phase).toBe("betting");
    expect(w.state.round!.number).toBe(1);
    expect(w.state.round!.dealId).not.toBe(firstDeal.dealId);
    expect(w.state.round!.bets).toEqual({});
    // The replayed skip is stale and doesn't skip the new question too.
    await w.act(room.host, { type: "skipQuestion", ...firstDeal });
    expect(room.host.lastError()?.code).toBe("stale");
    // Skipping during the wager reveal also discards everything.
    await placeBets(room, { A: { pick: "right", wager: 1250 }, B: { pick: "right", wager: 1250 } });
    expect(w.state.phase).toBe("wagerReveal");
    await w.act(room.host, { type: "skipQuestion", ...currentDeal(w) });
    expect(w.state.phase).toBe("betting");
    expect(chips(room)).toEqual({ A: 1000, B: 1000 });
    // Can't skip once the answer is out.
    await placeBets(room, { A: { pick: "right", wager: 100 }, B: { pick: "right", wager: 100 } });
    await hostAdvance(w, room.host);
    await w.act(room.host, { type: "skipQuestion", ...currentDeal(w) });
    expect(room.host.lastError()?.code).toBe("wrong_phase");
    expect(chips(room)).toEqual({ A: 1350, B: 1350 });
  });

  it("ranks tied balances together", async () => {
    const room = await setupRoom(["A", "B", "C"]);
    await start(room, { rounds: 5 });
    await placeBets(room, { A: { pick: "right", wager: 500 }, B: { pick: "right", wager: 500 }, C: { pick: "wrong", wager: 100 } });
    await finishRound(room);
    expect(room.tv.lastView().players.map((p) => [p.name, p.rank])).toEqual([["A", 1], ["B", 1], ["C", 3]]);
  });
});

describe("game lifecycle", () => {
  it("rejects invalid phase transitions", async () => {
    const room = await setupRoom(["A", "B"]);
    const w = room.world;
    await w.act(room.host, { type: "advance", from: { phase: "lobby", round: 0 } });
    expect(room.host.lastError()?.code).toBe("wrong_phase");
    await start(room);
    await w.act(room.host, { type: "advance", from: { phase: "answerReveal", round: 1 } });
    expect(room.host.lastError()?.code).toBe("stale");
    await w.act(room.host, { type: "start" });
    expect(room.host.lastError()?.code).toBe("wrong_phase");
    await w.act(room.host, { type: "rematch" });
    expect(room.host.lastError()?.code).toBe("wrong_phase");
    expect(w.state.phase).toBe("betting");
  });

  it("pauses and resumes the server timer", async () => {
    const room = await setupRoom(["A", "B"]);
    await start(room);
    const w = room.world;
    await w.advance(10_000);
    await w.act(room.host, { type: "pause" });
    expect(room.tv.lastView().timer).toMatchObject({ paused: true, remainingMs: 20_000, deadline: null });
    await w.advance(120_000);
    expect(w.state.phase).toBe("betting");
    // Players can still change bets while paused.
    await setBet(w, P(room, "A").socket, 0, 100);
    expect(P(room, "A").socket.lastError()).toBeUndefined();
    await w.act(room.host, { type: "resume" });
    await w.advance(19_000);
    expect(w.state.phase).toBe("betting");
    await w.advance(1_100);
    expect(w.state.phase).toBe("wagerReveal");
  });

  it("ends after the configured number of rounds and ranks by remaining chips", async () => {
    const room = await setupRoom(["A", "B", "C"]);
    await start(room, { rounds: 5 });
    for (let i = 0; i < 5; i++) {
      await placeBets(room, { A: { pick: "right", wager: 100 }, B: { pick: "wrong", wager: 100 }, C: { pick: "right", wager: 100 } });
      await finishRound(room);
      await hostAdvance(room.world, room.host);
    }
    const final = room.tv.lastView().final!;
    expect(room.world.state.phase).toBe("gameOver");
    expect(final.roundsPlayed).toBe(5);
    expect(final.standings.map((s) => [s.name, s.chips, s.rank])).toEqual([
      ["A", 2750, 1],
      ["C", 2750, 1],
      ["B", 1750, 3],
    ]);
    expect(final.winnerIds).toEqual([P(room, "A").id, P(room, "C").id]);
    expect(final.stats.find((s) => s.playerId === P(room, "B").id)).toMatchObject({ wrong: 5, totalWagered: 500 });
  });

  it("rematch keeps the roster but resets balances, history and questions", async () => {
    const room = await setupRoom(["A", "B"]);
    await start(room, { rounds: 5 });
    const firstGameQuestions = new Set<string>();
    for (let i = 0; i < 5; i++) {
      firstGameQuestions.add(room.world.state.round!.questionId);
      await placeBets(room, { A: { pick: "right", wager: 1250 }, B: { pick: "wrong", wager: 50 } });
      await finishRound(room);
      await hostAdvance(room.world, room.host);
    }
    expect(room.world.state.phase).toBe("gameOver");
    await room.world.act(room.host, { type: "rematch" });
    const v = P(room, "A").socket.lastView();
    expect(v.phase).toBe("betting");
    expect(v.gameNumber).toBe(2);
    expect(v.round!.number).toBe(1);
    expect(v.players.map((p) => [p.name, p.chips])).toEqual([["A", 1000], ["B", 1000]]);
    expect(room.world.state.history).toEqual([]);
    expect(firstGameQuestions.has(room.world.state.round!.questionId)).toBe(false);
    // Rematch to the lobby lets new players join.
    await room.world.act(room.host, { type: "endGame" });
    await room.world.act(room.host, { type: "rematch", toLobby: true });
    expect(room.world.state.phase).toBe("lobby");
    await joinPlayer(room.world, "C", 5);
    expect(room.world.state.players).toHaveLength(3);
  });

  it("end game discards an unsettled round but keeps settled chips", async () => {
    const room = await setupRoom(["A", "B"]);
    await start(room);
    await placeBets(room, { A: { pick: "right", wager: 500 }, B: { pick: "wrong", wager: 500 } });
    await finishRound(room);
    await hostAdvance(room.world, room.host);
    await lockBet(room.world, P(room, "A").socket, correctChoice(room.world), 1000);
    await room.world.act(room.host, { type: "endGame" });
    expect(room.world.state.phase).toBe("gameOver");
    expect(chips(room)).toEqual({ A: 1750, B: 750 });
    expect(room.tv.lastView().final!.roundsPlayed).toBe(1);
  });
});

describe("reliability & security", () => {
  it("reconnecting with the saved token restores identity, bet and chips", async () => {
    const room = await setupRoom(["A", "B"]);
    await start(room);
    await placeBets(room, { A: { pick: "right", wager: 500 }, B: { pick: "wrong", wager: 500 } });
    await finishRound(room);
    await hostAdvance(room.world, room.host);
    const a = P(room, "A");
    await setBet(room.world, a.socket, 2, 300);
    await room.world.disconnect(a.socket);
    expect(room.tv.lastView().players[0]!.connected).toBe(false);
    const again = room.world.connect();
    await room.world.send(again, { type: "hello", role: "player", token: a.token });
    const v = again.lastView();
    expect(v.me).toMatchObject({ id: a.id, name: "A", chips: 1750, bet: { choice: 2, wager: 300 } });
    expect(room.tv.lastView().players[0]!.connected).toBe(true);
  });

  it("refreshing the host or TV restores the current state", async () => {
    const room = await setupRoom(["A", "B"]);
    await start(room);
    await placeBets(room, { A: { pick: "right", wager: 500 }, B: { pick: "wrong", wager: 500 } });
    await room.world.disconnect(room.host);
    await room.world.disconnect(room.tv);
    const host = room.world.connect();
    await room.world.send(host, { type: "hello", role: "host", token: "host-secret-token" });
    const tv = room.world.connect();
    await room.world.send(tv, { type: "hello", role: "tv" });
    expect(host.lastView().phase).toBe("wagerReveal");
    expect(tv.lastView().round!.wagers).toHaveLength(2);
    expect(host.lastView().host).not.toBeNull();
    expect(tv.lastView().host).toBeNull();
  });

  it("server timers and bets survive Durable Object hibernation", async () => {
    const room = await setupRoom(["A", "B"]);
    await start(room);
    const w = room.world;
    await setBet(w, P(room, "A").socket, correctChoice(w), 600);
    w.hibernate();
    expect(w.alarm).toBe(w.state.timer!.deadline);
    await w.advance(TIMER_MS);
    expect(w.state.phase).toBe("wagerReveal");
    w.hibernate();
    await hostAdvance(w, room.host);
    expect(chips(room)).toEqual({ A: 1850, B: 1250 });
    w.hibernate();
    const again = w.connect();
    await w.send(again, { type: "hello", role: "player", token: P(room, "A").token });
    expect(again.lastView().me!.result).toMatchObject({ after: 1850 });
  });

  it("never sends tokens or the correct answer to clients early", async () => {
    const room = await setupRoom(["A", "B"]);
    await start(room);
    const w = room.world;
    await placeBets(room, { A: { pick: "right", wager: 50 } });
    await w.advance(TIMER_MS);
    for (const s of [room.tv, room.host, ...room.players.map((p) => p.socket)]) {
      const text = wire(s);
      expect(text).not.toContain("host-secret-token");
      for (const p of room.players) if (p.socket !== s) expect(text).not.toContain(p.token);
      expect(text).not.toMatch(/correctIndex/);
    }
    await hostAdvance(w, room.host);
    expect(room.tv.lastView().round!.reveal!.correctIndex).toBe(correctChoice(w));
  });

  it("keeps independent rooms isolated", async () => {
    const one = await setupRoom(["A", "B"]);
    const two = await setupRoom(["A", "B"]);
    await start(one);
    expect(two.world.state.phase).toBe("lobby");
    // A token from one room means nothing in another.
    const s = two.world.connect();
    await two.world.send(s, { type: "hello", role: "player", token: P(one, "A").token });
    expect(s.lastError()?.code).toBe("invalid_token");
    await lockBet(one.world, P(one, "A").socket, 0, 100);
    expect(two.world.state.round).toBeNull();
  });

  it("final results stay consistent after reconnecting", async () => {
    const room = await setupRoom(["A", "B"]);
    await start(room, { rounds: 5 });
    for (let i = 0; i < 5; i++) {
      await placeBets(room, { A: { pick: "right", wager: 300 }, B: { pick: null, wager: 0 } });
      await finishRound(room);
      await hostAdvance(room.world, room.host);
    }
    const before = room.tv.lastView().final;
    room.world.hibernate();
    const tv = room.world.connect();
    await room.world.send(tv, { type: "hello", role: "tv" });
    expect(tv.lastView().final).toEqual(before);
    expect(before!.standings.map((s) => s.chips)).toEqual([1000 + 5 * 550, 1000 + 5 * 250]);
  });
});
