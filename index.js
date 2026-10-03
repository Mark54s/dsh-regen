/**
 * dsh-regen — host half.
 *
 * Adds one same-origin endpoint, POST /regen, that performs a ChatGPT-style
 * "regenerate": fork the source session at the closed boundary before the target
 * turn, then re-admit that turn's original user input to the child's agent so the
 * model answers again.
 *
 * The target turn may be one whose generation FAILED or was interrupted: such
 * turns carry no assistant message but still carry the user input, so they are
 * folded in the same way. The source session is never modified: the branch is a
 * new session that keeps its lineage through parentSession.
 */
export const name = "dsh-regen";
/** Public host services used by the fork transaction. */
export const inject = ["agents", "sessions", "sessionQuery", "workspaceRegistry", "webServer"];
/** Same-origin endpoint owned by this plugin's client half. */
export const REGEN_PATH = "/regen";

function sessionIdOf(value) {
  if (typeof value !== "string" || value.length === 0) throw new TypeError("sessionId 必须是非空字符串。");
  return value;
}
function integerOf(value, name) {
  if (value === void 0 || value === null || value === "") return void 0;
  if (!Number.isSafeInteger(value) || value < 0) throw new TypeError(name + " 必须是非负整数。");
  return value;
}

/**
 * Fold turns, closed or not. A turn is closed by its matching turn/end; a tail
 * turn without one (interrupted run) is kept with endSeq === null, because that
 * is exactly the turn a user wants to regenerate after a failure.
 */
function turnsOf(events) {
  const result = [];
  let current;
  for (const event of events) {
    if (event.type === "turn/start") {
      current = { turn: event.data.turn, startSeq: event.seq, endSeq: null, assistants: [], user: void 0 };
      continue;
    }
    if (current === void 0) continue;
    if (event.type === "user/message" && current.user === void 0 && event.data.source?.kind === "user") {
      current.user = event;
      continue;
    }
    if (event.type === "assistant/message" && event.data.turn === current.turn) {
      current.assistants.push(event);
      continue;
    }
    if (event.type === "turn/end" && event.data.turn === current.turn) {
      current.endSeq = event.seq;
      result.push(current);
      current = void 0;
    }
  }
  if (current !== void 0) result.push(current);
  return result;
}

function messageIdsOf(turn) {
  return turn.assistants.map((event) => event.data?.message?.id).filter((id) => typeof id === "string");
}

/** Copy the original user input as a fresh message owned by this fork. */
function cloneUserInput(message) {
  return Object.freeze({
    id: crypto.randomUUID(),
    role: "user",
    content: structuredClone(message.content),
    source: Object.freeze({ kind: "user" })
  });
}

/**
 * Model route for the child: the route of the last real request in this history,
 * falling back to the profile's current default selection. A history whose first
 * turn failed before any request has no route of its own — the default keeps the
 * retry usable instead of refusing it.
 */
function agentOptions(ctx, events) {
  const config = events.findLast((event) => event.type === "request/header")?.data?.header?.config;
  let provider = config?.provider;
  let model = config?.model;
  const maxTokens = config?.maxTokens;
  if (provider === void 0 || String(provider).length === 0 || model === void 0 || String(model).length === 0) {
    const selection = ctx.agentDefaultModel?.currentSelection?.();
    provider = selection?.provider;
    model = selection?.model;
  }
  if (provider === void 0 || String(provider).length === 0 || model === void 0 || String(model).length === 0) throw new Error("无法解析模型路由：会话历史里没有成功请求，且 profile 没有默认模型。");
  return { provider, model, ...(maxTokens === void 0 ? {} : { maxTokens }) };
}

/** Agent preset of the source session, mounted on the child when available. */
async function presetPlan(ctx, snapshot) {
  const presets = ctx.get("agentPresets");
  let presetId;
  for (let index = snapshot.events.length - 1; index >= 0; index -= 1) {
    const event = snapshot.events[index];
    if (event?.type === "agent-preset/selected") { presetId = event.data?.agentPreset; break; }
  }
  if (presetId === void 0) presetId = snapshot.header?.agentPreset;
  if (presets === void 0 || presetId === void 0) return {};
  const resolved = (await presets.resolve(presetId)).id;
  return { agentPreset: resolved, setup: async (agentCtx) => { await presets.mount(agentCtx, resolved); } };
}

/**
 * Cut boundary for one turn: normally the event right before its turn/start.
 * A user prompt that is still pending travels as an agent/inbox/spliced insert
 * just before the turn; the cut moves before it so the prompt is delivered once
 * by this fork instead of being inherited and delivered a second time.
 */
function promptBoundary(events, startSeq) {
  let boundary = startSeq - 1;
  for (let index = boundary; index >= 0; index -= 1) {
    const event = events[index];
    const isPendingUserInput = event.type === "agent/inbox/spliced"
      && Array.isArray(event.data?.inserted)
      && event.data.inserted.some((message) => message?.role === "user")
      && (event.data.removedCount ?? 0) === 0;
    if (!isPendingUserInput) break;
    boundary = index - 1;
  }
  return boundary;
}

/** Resolve the turn to regenerate from explicit turn number, message id, or the tail. */
function pickTurn(turns, turnNumber, messageId) {
  if (turnNumber !== void 0) {
    const exact = turns.find((turn) => turn.turn === turnNumber);
    if (exact === void 0) throw new Error("找不到第 " + String(turnNumber) + " 轮。");
    return exact;
  }
  if (messageId !== void 0) {
    const owner = turns.find((turn) => messageIdsOf(turn).includes(messageId));
    if (owner === void 0) throw new Error("找不到这条回复所属的回合。");
    return owner;
  }
  for (let index = turns.length - 1; index >= 0; index -= 1) {
    if (turns[index].user !== void 0) return turns[index];
  }
  throw new Error("这个会话还没有可重新生成的用户提问。");
}

async function regenerate(ctx, input) {
  const sessionId = sessionIdOf(input?.sessionId);
  const turnNumber = integerOf(input?.turn, "turn");
  const messageId = typeof input?.messageId === "string" && input.messageId.length > 0 ? input.messageId : void 0;
  const snapshot = await ctx.sessionQuery.readSession(sessionId);
  const events = snapshot.events;
  const header = snapshot.session ?? snapshot.header ?? {};
  const turns = turnsOf(events);
  const target = pickTurn(turns, turnNumber, messageId);
  if (target.user === void 0) throw new Error("该回合没有可重建的用户输入。");
  const boundary = promptBoundary(events, target.startSeq);
  if (boundary >= 0 && events[boundary]?.seq !== boundary) throw new Error("分叉边界不是连续会话事件。");
  const seed = boundary >= 0 ? events.slice(0, boundary + 1) : [];
  const childId = `session-${crypto.randomUUID()}`;
  const options = agentOptions(ctx, events);
  const preset = await presetPlan(ctx, { header, events });
  const workspace = ctx.workspaceRegistry.list().find((entry) => entry.sessionIds.includes(sessionId));
  const cwd = header.cwd ?? workspace?.path ?? events.find((event) => typeof event.data?.cwd === "string")?.data.cwd;
  const child = await ctx.agents.create({
    sessionId: childId,
    seed,
    inheritedEventCount: boundary + 1,
    meta: {
      ...(cwd === void 0 ? {} : { cwd }),
      parentSession: sessionId,
      isSeeded: true,
      ...(preset.agentPreset === void 0 ? {} : { agentPreset: preset.agentPreset })
    },
    agentOptions: options,
    ...(preset.setup === void 0 ? {} : { setup: preset.setup })
  });
  const notes = [];
  try {
    try { await ctx.sessions.flush(child.agent.session); } catch (error) { notes.push("flush: " + String(error?.message ?? error)); }
    if (workspace !== void 0) { try { await workspace.attachSession(childId); } catch (error) { notes.push("attach: " + String(error?.message ?? error)); } }
    child.agent.followup(cloneUserInput(target.user.data));
    return {
      sessionId: childId,
      parentSessionId: sessionId,
      turn: target.turn,
      hadAssistantReply: target.assistants.length > 0,
      cwd,
      notes
    };
  } catch (error) {
    try { await child.dispose(); } catch {}
    throw error;
  }
}

async function jsonBody(request) {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  const text = Buffer.concat(chunks).toString("utf8").trim();
  return text.length === 0 ? {} : JSON.parse(text);
}

function respondJson(response, status, value) {
  const body = JSON.stringify(value);
  response.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
  response.end(body);
}

export function apply(ctx) {
  ctx.effect(() => ctx.webServer.register({
    kind: "exact",
    path: REGEN_PATH,
    handler: async (request, response) => {
      try {
        if (request.method !== "POST") { respondJson(response, 405, { error: "POST only" }); return; }
        respondJson(response, 200, await regenerate(ctx, await jsonBody(request)));
      } catch (error) {
        respondJson(response, error instanceof TypeError ? 400 : 409, { error: error instanceof Error ? error.message : String(error) });
      }
    }
  }), "dsh-regen: HTTP route");
}
