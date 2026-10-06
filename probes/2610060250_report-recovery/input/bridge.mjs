// src/bridge.ts
import { randomUUID } from "node:crypto";

// src/qq-protocol.ts
var INTENT_GROUP_AND_C2C_EVENT = 1 << 25;
function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

// src/probe.ts
function countProbeContent(index, total, msgSeq) {
  return `probe-count \u7B2C ${index}/${total} \u6761\uFF08msg_seq=${msgSeq}\uFF09\uFF1A\u5B9E\u6D4B\u88AB\u52A8\u56DE\u590D\u6B21\u6570\u4E0A\u9650\uFF0C\u6536\u5230\u672C\u6761\u8BF4\u660E\u7B2C ${msgSeq} \u6B21\u88AB\u52A8\u4ECD\u53EF\u7528`;
}
function lengthProbeContent(chars) {
  const label = `L${chars}\uFF1A`;
  return label + "\u6D4B".repeat(Math.max(1, chars - label.length));
}

// src/routing.ts
var COMMAND_HELP = "/\u5E2E\u52A9";
var COMMAND_STATUS = "/\u72B6\u6001";
var COMMAND_FRESH_SESSION = "/\u65B0\u4F1A\u8BDD";
var COMMAND_NAMES = {
  help: COMMAND_HELP,
  status: COMMAND_STATUS,
  "fresh-session": COMMAND_FRESH_SESSION
};
var MENTION_PLACEHOLDER = /^\s*(?:<@!?\d+>\s*)+/;
function normalizeIncoming(content) {
  return content.replace(MENTION_PLACEHOLDER, "").replace(/\r\n/g, "\n").trim();
}
function matchCommand(text) {
  for (const [name, literal] of Object.entries(COMMAND_NAMES)) {
    if (text === literal) return name;
  }
  return null;
}
function splitForSend(text, maxLen) {
  const segments = [];
  let current = "";
  const flush = () => {
    if (current !== "") {
      segments.push(current);
      current = "";
    }
  };
  for (const line of text.split("\n")) {
    if (line.length > maxLen) {
      flush();
      for (let start = 0; start < line.length; start += maxLen) {
        segments.push(line.slice(start, start + maxLen));
      }
      continue;
    }
    const candidate = current === "" ? line : `${current}
${line}`;
    if (candidate.length > maxLen) {
      flush();
      current = line;
    } else {
      current = candidate;
    }
  }
  flush();
  if (segments.length <= 1) return segments;
  return segments.map((segment, index) => `(${index + 1}/${segments.length}) ${segment}`);
}
function tailExcerpt(text, maxChars) {
  if (text.length <= maxChars) return text;
  const omitted = text.length - maxChars;
  return `\u2026\u2026\uFF08\u524D\u9762\u7701\u7565 ${omitted} \u5B57\uFF09
${text.slice(text.length - maxChars)}`;
}

// src/reply-window.ts
var C2C_PASSIVE_WINDOW_MS = 60 * 60 * 1e3;
var GROUP_PASSIVE_WINDOW_MS = 5 * 60 * 1e3;
var C2C_MAX_PASSIVE_REPLIES = 4;
var GROUP_MAX_PASSIVE_REPLIES = 5;
function chooseReplyRoute(scene, trigger, now) {
  if (trigger === null) {
    return scene === "c2c" ? { kind: "active", reason: "no-trigger" } : { kind: "none", reason: "no-trigger" };
  }
  const windowMs = scene === "c2c" ? C2C_PASSIVE_WINDOW_MS : GROUP_PASSIVE_WINDOW_MS;
  const maxReplies = scene === "c2c" ? C2C_MAX_PASSIVE_REPLIES : GROUP_MAX_PASSIVE_REPLIES;
  const exhausted = now - trigger.receivedAt > windowMs ? "window-elapsed" : trigger.repliesSent >= maxReplies ? "replies-used-up" : null;
  if (exhausted === null) return { kind: "passive", msgId: trigger.msgId, msgSeq: trigger.repliesSent + 1 };
  return scene === "c2c" ? { kind: "active", reason: exhausted } : { kind: "none", reason: exhausted };
}

// src/bridge.ts
var BOT_REPLY_PREFIX = "\u3010\u673A\u5668\u4EBA\u56DE\u6267\u3011";
var HELP_TEXT = "QQ \u2192 ZCode \u901A\u9053\uFF1A\n\xB7 \u76F4\u63A5\u8BF4\u4EFB\u52A1\uFF0C\u6216\u8BF4\u201C\u8BB0\u4E00\u4E0B\uFF1A\u2026\u201D\u201C\u8BB0\u4E2A\u5F85\u529E\uFF1A\u2026\u201D\n\xB7 /\u72B6\u6001 \u67E5\u8FDB\u5EA6\u3001\u53D6\u56DE\u672A\u9001\u8FBE\u7ED3\u679C\n\xB7 /\u65B0\u4F1A\u8BDD \u6362\u4E00\u4E2A ZCode \u4F1A\u8BDD\n\xB7 /\u5E2E\u52A9 \u770B\u8BF4\u660E\n\u505A\u5B8C\u7531 ZCode \u4E3B\u52A8\u56DE\u62A5\uFF1B\u684C\u9762\u7AEF\u9700\u8981\u5F00\u7740\u3002";
var ZcodeBridge = class {
  constructor(deps) {
    this.deps = deps;
    this.queue = deps.read().then((raw) => {
      if (raw === void 0) return;
      if (!isRecord(raw) || raw.version !== 1 || !Array.isArray(raw.sessions) || !Array.isArray(raw.jobs) || !Array.isArray(raw.seen) || !Array.isArray(raw.notices)) throw new Error("QQ \u4EFB\u52A1\u8BB0\u5F55\u683C\u5F0F\u4E0D\u6B63\u786E\uFF0C\u505C\u6B62\u5904\u7406");
      this.book = raw;
    }).catch((error) => {
      this.storageError = error;
      throw error;
    });
  }
  deps;
  book = { version: 1, sessions: [], jobs: [], seen: [], notices: [] };
  queue;
  closed = false;
  storageError;
  lastIncoming = null;
  recentRejected = [];
  serial(run) {
    const next = this.queue.then(() => {
      if (this.storageError !== void 0) throw this.storageError;
      if (this.closed) throw new Error("QQ \u901A\u9053\u5DF2\u5378\u8F7D");
      return run();
    });
    this.queue = next.catch(() => {
    });
    return next;
  }
  async save() {
    try {
      await this.deps.write(this.book);
    } catch (error) {
      this.storageError = error;
      throw error;
    }
  }
  async restore() {
    await this.serial(async () => {
      for (const job of this.book.jobs) if (job.text !== null && job.delivery === "pending") await this.deliverJob(job);
    });
    const outcome = await this.deps.runCommand("zcode.report.replay", { callback: "qq-bot.receive-report" });
    if (!outcome.ok) this.deps.log.warn("ZCode \u56DE\u62A5\u8865\u4EA4\u5165\u53E3\u6682\u4E0D\u53EF\u7528\uFF1B\u5B89\u88C5\u65B0\u7248 ZCode \u540E\u91CD\u8FDE QQ \u901A\u9053");
  }
  handleIncoming(message) {
    return this.serial(async () => {
      if (!this.deps.allowedOpenids().includes(message.senderOpenid)) {
        this.recentRejected.push({ openid: message.senderOpenid, scene: message.scene, at: (/* @__PURE__ */ new Date()).toISOString(), excerpt: message.content.slice(0, 40) });
        if (this.recentRejected.length > 10) this.recentRejected.shift();
        this.deps.log.info(`\u62D2\u7EDD\u767D\u540D\u5355\u5916\u7684 ${message.scene} \u6D88\u606F\uFF0Copenid=${message.senderOpenid}`);
        return;
      }
      const text = normalizeIncoming(message.content);
      if (text === "" || message.senderIsBot === true && text.startsWith(BOT_REPLY_PREFIX)) return;
      const key = `${message.scene}:${message.replyTarget}:${message.msgId}`;
      if (this.book.seen.includes(key)) return;
      this.book.seen.push(key);
      if (this.book.seen.length > 1e4) this.book.seen.shift();
      const route = { scene: message.scene, target: message.replyTarget, trigger: { msgId: message.msgId, receivedAt: Date.now(), repliesSent: 0 } };
      this.lastIncoming = route;
      const session = this.sessionFor(message.senderOpenid);
      await this.save();
      const command = matchCommand(text);
      if (command === "help") {
        await this.reply(HELP_TEXT, route);
        return;
      }
      if (command === "status") {
        await this.status(session, route);
        return;
      }
      if (command !== null) {
        await this.fresh(session, route);
        return;
      }
      await this.dispatch(session, route, text);
    });
  }
  sessionFor(openid) {
    let session = this.book.sessions.find((each) => each.openid === openid);
    if (session === void 0) {
      session = { openid, workspace: "", taskId: null, roundIndex: 0, latest: null };
      this.book.sessions.push(session);
    }
    return session;
  }
  latest(session) {
    return this.book.jobs.find((job) => job.id === session.latest);
  }
  async dispatch(session, route, text) {
    const workspace = session.taskId === null ? this.deps.defaultWorkspace() : session.workspace;
    if (workspace === "") {
      await this.reply("\u8BF7\u5148\u5728 qq-bot \u8BBE\u7F6E\u4E2D\u586B\u5199 default-workspace", route);
      return;
    }
    const job = { id: randomUUID(), openid: session.openid, taskId: session.taskId, workspace, round: session.roundIndex + 1, route, state: "pending", text: null, delivery: "pending" };
    session.latest = job.id;
    session.workspace = workspace;
    session.roundIndex = job.round;
    this.book.jobs.push(job);
    await this.save();
    const lib = this.deps.journalLibrary();
    const noteContext = lib === "" ? "" : `

[\u968F\u624B\u8BB0\u7EA6\u5B9A] \u7528\u6237\u8981\u6C42\u8BB0\u5F55\u6216\u5F85\u529E\u65F6\uFF0C\u4F7F\u7528 ${this.deps.reportServer()} MCP \u670D\u52A1\u4E2D\u7684 bn-journal / block-note \u547D\u4EE4\uFF0C\u5199\u5165\u5E93 ${JSON.stringify(lib)} \u7684\u5F53\u65E5\u65E5\u5FD7\u3002\u5148\u8BFB bn-journal \u8BF4\u660E\u4E66\uFF0C\u8BB0\u5F55\u4FDD\u7559\u539F\u8BDD\uFF1B\u521B\u5EFA\u6210\u529F\u3001\u53D6\u5F97\u5757 id \u540E\u624D\u62A5\u544A\u5DF2\u4FDD\u5B58\u3002\u4E0D\u5C5E\u4E8E\u8BB0\u5F55\u8BF7\u6C42\u65F6\u5FFD\u7565\u672C\u7EA6\u5B9A\u3002`;
    const args = { workspace, prompt: text + noteContext, report: { id: job.id, callback: "qq-bot.receive-report", server: this.deps.reportServer() } };
    if (session.taskId !== null) args.task = session.taskId;
    let outcome;
    try {
      outcome = await this.deps.runCommand(session.taskId === null ? "zcode.create" : "zcode.send", args);
    } catch (error) {
      outcome = { ok: false, error: String(error) };
    }
    if (!outcome.ok || !isRecord(outcome.data) || typeof outcome.data.taskId !== "string") {
      job.state = "dispatch_unknown";
      await this.save();
      await this.reply(`\u6D3E\u5355\u672A\u786E\u8BA4\uFF1A${outcome.error ?? "\u7F3A\u5C11 taskId"}\u3002\u8FD9\u8F6E\u8BB0\u5F55\u5DF2\u4FDD\u7559\uFF1B\u5148\u5728 ZCode \u4FA7\u680F\u786E\u8BA4\uFF0C\u907F\u514D\u91CD\u590D\u6D3E\u53D1\u3002`, route);
      return;
    }
    job.taskId = outcome.data.taskId;
    session.taskId = job.taskId;
    await this.save();
    await this.reply(`\u6536\u5230\uFF0C\u5DF2\u6D3E\u7ED9 ZCode \u4F1A\u8BDD ${job.taskId} \u7B2C ${job.round} \u8F6E\uFF1B\u505A\u5B8C\u4E3B\u52A8\u56DE\u4F60`, route);
  }
  receiveReport(raw) {
    return this.serial(async () => {
      if (!isRecord(raw) || typeof raw.id !== "string" || typeof raw.taskId !== "string" || typeof raw.text !== "string" || !["completed", "failed", "needs_input"].includes(String(raw.state))) throw new Error("ZCode \u56DE\u62A5\u683C\u5F0F\u4E0D\u6B63\u786E");
      const job = this.book.jobs.find((each) => each.id === raw.id);
      if (job === void 0 || raw.workspace !== job.workspace || job.taskId !== null && raw.taskId !== job.taskId) throw new Error("\u56DE\u62A5\u4E0D\u5C5E\u4E8E\u672C home \u7684\u8FD9\u8F6E QQ \u4EFB\u52A1");
      if (job.text !== null) {
        if (job.text !== raw.text || job.state !== raw.state) throw new Error("\u8FD9\u8F6E QQ \u4EFB\u52A1\u5DF2\u6709\u4E0D\u540C\u7ED3\u679C");
        return { accepted: true };
      }
      job.taskId = raw.taskId;
      job.state = raw.state;
      job.text = raw.text;
      const session = this.sessionFor(job.openid);
      if (session.latest === job.id) session.taskId = job.taskId;
      await this.save();
      await this.deliverJob(job);
      return { accepted: true };
    });
  }
  async deliverJob(job) {
    job.delivery = "sending";
    await this.save();
    const heading = job.state === "needs_input" ? "\u9700\u8981\u4F60\u56DE\u590D\uFF1A\n" : job.state === "failed" ? "\u4EFB\u52A1\u672A\u5B8C\u6210\uFF1A\n" : "";
    try {
      job.delivery = await this.reply(heading + tailExcerpt(job.text ?? "", 600), job.route) ? "delivered" : "undelivered";
    } catch {
      job.delivery = "undelivered";
      this.deps.log.warn(`\u4EFB\u52A1 ${job.id} \u7684\u7ED3\u679C\u5DF2\u4FDD\u5B58\uFF0CQQ \u53D1\u9001\u5931\u8D25\uFF0C\u7B49 /\u72B6\u6001 \u53D6\u56DE`);
    }
    await this.save();
  }
  async status(session, route) {
    const pending = this.book.jobs.filter((job2) => job2.openid === session.openid && job2.text !== null && job2.delivery !== "delivered");
    if (pending.length > 0) {
      for (const job2 of pending) {
        if (await this.reply(`\u7B2C ${job2.round} \u8F6E\u7ED3\u679C\uFF1A
${tailExcerpt(job2.text ?? "", 600)}`, route)) job2.delivery = "delivered";
        else break;
        await this.save();
      }
      return;
    }
    const job = this.latest(session);
    if (job?.text !== null && job?.text !== void 0) {
      await this.reply(`\u4E0A\u4E00\u8F6E\u7ED3\u679C\uFF1A
${tailExcerpt(job.text, 600)}`, route);
      return;
    }
    if (session.taskId === null) {
      await this.reply(job ? "\u6D3E\u5355\u5C1A\u672A\u786E\u8BA4\uFF0C\u8BF7\u67E5\u770B ZCode \u4FA7\u680F\uFF1B\u672C\u8F6E\u4ECD\u4FDD\u7559\uFF0C\u672A\u81EA\u52A8\u91CD\u53D1\u3002" : "\u8FD8\u6CA1\u6709\u4F1A\u8BDD\uFF0C\u76F4\u63A5\u8BF4\u4EFB\u52A1\u5373\u53EF\u3002", route);
      return;
    }
    const outcome = await this.deps.runCommand("zcode.status", { workspace: session.workspace, task: session.taskId, waitSeconds: 0, replyTailChars: 600 });
    const data = isRecord(outcome.data) ? outcome.data : {};
    const replies = Array.isArray(data.replies) ? data.replies.filter((reply) => typeof reply === "string") : [];
    await this.reply(outcome.ok ? `\u672C\u8F6E\u5C1A\u672A\u6536\u5230\u4E3B\u52A8\u56DE\u62A5\u3002ZCode \u5F53\u524D\u72B6\u6001\uFF1A${String(data.status ?? "\u672A\u77E5")}
${tailExcerpt(replies.at(-1) ?? "", 600)}` : `\u67E5\u8BE2\u5931\u8D25\uFF1A${outcome.error ?? "\u672A\u77E5\u539F\u56E0"}`, route);
  }
  async fresh(session, route) {
    if (session.taskId !== null) {
      const result = await this.deps.runCommand("zcode.archive", { workspace: session.workspace, task: session.taskId });
      if (!result.ok) {
        await this.reply(`\u6682\u65F6\u4E0D\u80FD\u6362\u4F1A\u8BDD\uFF1A${result.error ?? "\u65E7\u4F1A\u8BDD\u672A\u80FD\u5F52\u6863"}`, route);
        return;
      }
    }
    session.taskId = null;
    session.latest = null;
    session.roundIndex = 0;
    await this.save();
    await this.reply("\u4E0B\u4E00\u6761\u6D88\u606F\u8D77\u4F7F\u7528\u65B0\u7684 ZCode \u4F1A\u8BDD\uFF1B\u672A\u9001\u8FBE\u7684\u65E7\u7ED3\u679C\u4ECD\u53EF\u7528 /\u72B6\u6001 \u53D6\u56DE\u3002", route);
  }
  notify(raw) {
    return this.serial(async () => {
      if (!isRecord(raw) || Object.keys(raw).some((key) => !["id", "text"].includes(key)) || typeof raw.id !== "string" || raw.id.trim() === "" || typeof raw.text !== "string" || raw.text.trim() === "" || raw.text.length > 600) throw new Error("qq-bot.notify \u9700\u8981 {id, text}\uFF0C\u6B63\u6587 1\u2013600 \u5B57\u7B26");
      const target = this.deps.ownerOpenid();
      if (target === "" || !this.deps.allowedOpenids().includes(target)) throw new Error("\u8BF7\u663E\u5F0F\u914D\u7F6E\u4E3B\u4EBA\u79C1\u804A owner-openid\uFF0C\u5E76\u5C06\u5176\u52A0\u5165 allowed-openids");
      const existing = this.book.notices.find((notice2) => notice2.id === raw.id);
      if (existing !== void 0) {
        if (existing.text !== raw.text || existing.target !== target) throw new Error("\u901A\u77E5 id \u5DF2\u7528\u4E8E\u4E0D\u540C\u5185\u5BB9\u6216\u6536\u4EF6\u4EBA");
        return { delivered: existing.state === "delivered", duplicate: true };
      }
      const notice = { id: raw.id, target, text: raw.text, state: "sending" };
      this.book.notices.push(notice);
      await this.save();
      try {
        notice.state = (await this.deps.sendC2c(target, raw.text, void 0, void 0)).ok ? "delivered" : "failed";
      } catch {
        notice.state = "failed";
      }
      await this.save();
      return { delivered: notice.state === "delivered", duplicate: false };
    });
  }
  async reply(text, route) {
    for (const segment of splitForSend(text, 700)) {
      const chosen = chooseReplyRoute(route.scene, route.trigger, Date.now());
      if (chosen.kind === "none") return false;
      if (chosen.kind === "passive") {
        route.trigger.repliesSent += 1;
        await this.save();
        const sent = await this.send(route.scene, route.target, segment, chosen.msgId, chosen.msgSeq);
        if (sent.ok) continue;
        if (route.scene === "group") return false;
      }
      if (!(await this.send(route.scene, route.target, segment, void 0, void 0)).ok) return false;
    }
    return true;
  }
  send(scene, target, text, msgId, msgSeq) {
    return scene === "c2c" ? this.deps.sendC2c(target, text, msgId, msgSeq) : this.deps.sendGroup(target, `${BOT_REPLY_PREFIX}
${text}`, msgId, msgSeq);
  }
  report() {
    return { sessions: this.book.sessions.map((session) => {
      const job = this.latest(session);
      return { openid: session.openid, taskId: session.taskId, workspace: session.workspace, roundIndex: session.roundIndex, roundRunning: job !== void 0 && job.text === null, resultDelivered: job === void 0 || job.delivery === "delivered" };
    }), pendingResults: this.book.jobs.filter((job) => job.text !== null && job.delivery !== "delivered").length, recentRejected: [...this.recentRejected] };
  }
  async dispose() {
    this.closed = true;
    await this.queue;
  }
  probe(args) {
    return this.serial(async () => {
      if (this.lastIncoming === null) throw new Error("\u5148\u5728 QQ \u4E0A\u53D1\u9001\u4E00\u6761\u767D\u540D\u5355\u6D88\u606F");
      const { scene, target, trigger } = this.lastIncoming;
      if (args.experiment === "length" && scene === "group") throw new Error("length \u53EA\u5728\u79C1\u804A\u6D4B");
      const results = [];
      const values = args.experiment === "count" ? Array.from({ length: args.sends }, (_, index) => index + 1) : args.chars;
      for (const value of values) {
        const msgSeq = trigger.repliesSent + 1;
        const text = args.experiment === "count" ? countProbeContent(value, args.sends, msgSeq) : lengthProbeContent(value);
        if (args.experiment === "count") {
          trigger.repliesSent++;
          await this.save();
        }
        const outcome = await this.send(scene, target, text, args.experiment === "count" ? trigger.msgId : void 0, args.experiment === "count" ? msgSeq : void 0);
        results.push(args.experiment === "count" ? { index: value, msgSeq, ...outcome } : { chars: value, contentChars: text.length, ...outcome });
        await new Promise((resolve) => setTimeout(resolve, 500));
      }
      return { experiment: args.experiment, scene, results };
    });
  }
};
export {
  ZcodeBridge
};
