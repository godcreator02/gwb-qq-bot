// src/reports.ts
import { randomUUID } from "node:crypto";
function object(raw, keys) {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) throw new Error("\u56DE\u62A5\u53C2\u6570\u5FC5\u987B\u662F\u5BF9\u8C61");
  const value = raw;
  if (Object.keys(value).some((key) => !keys.includes(key))) throw new Error(`\u56DE\u62A5\u53C2\u6570\u53EA\u63A5\u53D7 ${keys.join(", ")}`);
  return value;
}
function string(value, name) {
  if (typeof value !== "string" || value.trim() === "") throw new Error(`\u7F3A\u5C11 ${name}`);
  return value;
}
function parseReportTarget(raw) {
  if (raw === void 0) return void 0;
  const value = object(raw, ["id", "callback", "server"]);
  const id = string(value.id, "report.id");
  const callback = string(value.callback, "report.callback");
  const server = string(value.server, "report.server");
  if (!/^[\w.-]{1,160}$/u.test(id) || !/^[a-z][\w.-]{1,100}$/u.test(callback) || !/^[\w-]{1,80}$/u.test(server)) throw new Error("report \u7684 id / callback / server \u683C\u5F0F\u4E0D\u6B63\u786E");
  return { id, callback, server };
}
function parseReport(raw) {
  const value = object(raw, ["ticket", "state", "text"]);
  if (!["completed", "failed", "needs_input"].includes(String(value.state))) throw new Error("state \u5FC5\u987B\u662F completed / failed / needs_input");
  const text = string(value.text, "text");
  if (text.length > 16e3) throw new Error("\u56DE\u62A5\u6700\u591A 16000 \u5B57\u7B26\uFF0C\u8BF7\u63D0\u4EA4\u7ED3\u679C\u6458\u8981");
  return { ticket: string(value.ticket, "ticket"), state: value.state, text };
}
function parseReplay(raw) {
  return string(object(raw, ["callback"]).callback, "callback");
}
var ReportBook = class {
  constructor(deps) {
    this.deps = deps;
    this.queue = deps.read().then((raw) => {
      if (raw === void 0) return;
      const doc = raw;
      if (doc.version !== 1 || !Array.isArray(doc.entries)) throw new Error("ZCode \u56DE\u62A5\u8BB0\u5F55\u683C\u5F0F\u4E0D\u6B63\u786E\uFF0C\u505C\u6B62\u5199\u5165");
      this.entries = doc.entries;
    }).catch((error) => {
      this.storageError = error;
      throw error;
    });
  }
  deps;
  entries = [];
  queue;
  storageError;
  delivering = /* @__PURE__ */ new Map();
  serial(run) {
    const next = this.queue.then(() => {
      if (this.storageError !== void 0) throw this.storageError;
      return run();
    });
    this.queue = next.catch(() => {
    });
    return next;
  }
  async save() {
    try {
      await this.deps.write({ version: 1, entries: this.entries });
    } catch (error) {
      this.storageError = error;
      throw error;
    }
  }
  async prepare(target, workspace, taskId) {
    return this.serial(async () => {
      if (this.entries.some((entry) => entry.target.id === target.id)) throw new Error("\u8FD9\u8F6E\u6D3E\u5355 id \u5DF2\u5B58\u5728\uFF1B\u4E0D\u8981\u91CD\u590D\u6D3E\u53D1\uFF0C\u8BF7\u67E5\u539F\u4EFB\u52A1");
      const ticket = randomUUID();
      this.entries.push({ target, ticket, workspace, taskId, result: null, accepted: false });
      await this.save();
      return ticket;
    });
  }
  prompt(prompt, target, ticket) {
    return `${prompt}

[\u672C\u8F6E\u7ED3\u679C\u56DE\u62A5\u7EA6\u5B9A]
\u4EFB\u52A1\u6765\u6E90 home=${this.deps.home}\uFF0CMCP \u670D\u52A1\u540D=${target.server}\u3002\u672C\u8F6E ticket=${ticket}\u3002
\u5B8C\u6210\u5DE5\u4F5C\u540E\u3001\u6700\u7EC8\u7B54\u590D\u4E4B\u524D\uFF0C\u7ECF\u8FD9\u4E2A MCP \u670D\u52A1\u7684 run \u8C03\u7528 zcode.report\uFF0C\u53C2\u6570 {ticket: \u4E0A\u9762\u7684\u672C\u8F6E ticket, state: "completed" \u6216 "failed" \u6216 "needs_input", text: \u7ED9\u53D1\u8D77\u4EBA\u7684\u7ED3\u679C\u6216\u9700\u8981\u56DE\u7B54\u7684\u95EE\u9898}\u3002\u5FC5\u987B\u5B9E\u9645\u8C03\u7528\u5DE5\u5177\uFF0C\u4E0D\u80FD\u53EA\u5728\u804A\u5929\u91CC\u5199\u7ED3\u679C\u3002\u56DE\u62A5\u6210\u529F\u540E\u7ED3\u675F\u672C\u8F6E\uFF0C\u4E0D\u518D\u6267\u884C\u5DE5\u4F5C\u3002\u53EA\u7528\u672C\u8F6E ticket\uFF0C\u4E0D\u80FD\u7528\u5386\u53F2 ticket\uFF1B\u4E0D\u8981\u628A ticket \u53D1\u5230 QQ\u3001\u7B14\u8BB0\u6216\u4ED3\u5E93\u3002\u8C03\u7528\u5931\u8D25\u65F6\u4FDD\u7559\u539F ticket \u91CD\u8BD5\u62A5\u544A\uFF0C\u4E0D\u80FD\u91CD\u505A\u4EFB\u52A1\u3002\u4E0D\u8981\u901A\u8FC7\u5176\u4ED6 home \u7684\u540C\u540D\u547D\u4EE4\u56DE\u62A5\u3002`;
  }
  async report(raw) {
    const input = parseReport(raw);
    await this.queue;
    const entry = this.entries.find((each) => each.ticket === input.ticket);
    if (entry === void 0) throw new Error("\u672C home \u4E0D\u8BA4\u8BC6\u8FD9\u4E2A\u56DE\u62A5 ticket\uFF0C\u8BF7\u4F7F\u7528\u6D3E\u5355\u6307\u5B9A\u7684 MCP \u670D\u52A1");
    if (entry.result !== null && (entry.result.text !== input.text || entry.result.state !== input.state)) throw new Error("\u672C\u8F6E\u5DF2\u6709\u4E0D\u540C\u7ED3\u679C\uFF0C\u4E0D\u80FD\u8986\u76D6\uFF1B\u8BF7\u5F00\u542F\u4E0B\u4E00\u8F6E");
    const duplicate = entry.result !== null;
    await this.serial(async () => {
      if (entry.result !== null && (entry.result.text !== input.text || entry.result.state !== input.state)) throw new Error("\u672C\u8F6E\u5DF2\u6709\u4E0D\u540C\u7ED3\u679C");
      if (entry.result === null) {
        entry.result = { id: entry.target.id, taskId: entry.taskId, workspace: entry.workspace, state: input.state, text: input.text, reportedAt: (/* @__PURE__ */ new Date()).toISOString() };
        await this.save();
      }
    });
    return { recorded: true, accepted: await this.deliver(entry), duplicate };
  }
  async replay(callback) {
    await this.queue;
    const entries = this.entries.filter((entry) => entry.target.callback === callback && entry.result !== null && !entry.accepted);
    for (const entry of entries) await this.deliver(entry);
    return { pending: entries.filter((entry) => !entry.accepted).length };
  }
  deliver(entry) {
    if (entry.accepted) return Promise.resolve(true);
    const running = this.delivering.get(entry.ticket);
    if (running !== void 0) return running;
    const pending = this.deliverOnce(entry).finally(() => this.delivering.delete(entry.ticket));
    this.delivering.set(entry.ticket, pending);
    return pending;
  }
  async deliverOnce(entry) {
    if (entry.result === null) return false;
    try {
      const outcome = await this.deps.deliver(entry.target.callback, entry.result);
      if (!outcome.ok) {
        this.deps.warn(`\u56DE\u62A5 ${entry.target.id} \u5DF2\u4FDD\u5B58\uFF0C\u63A5\u6536\u65B9\u6682\u672A\u63A5\u6536`);
        return false;
      }
      await this.serial(async () => {
        entry.accepted = true;
        await this.save();
      });
      return true;
    } catch {
      this.deps.warn(`\u56DE\u62A5 ${entry.target.id} \u5DF2\u4FDD\u5B58\uFF0C\u63A5\u6536\u65B9\u8C03\u7528\u5931\u8D25`);
      return false;
    }
  }
  async close() {
    await Promise.allSettled([this.queue, ...this.delivering.values()]);
  }
};
export {
  ReportBook,
  parseReplay,
  parseReport,
  parseReportTarget
};
